import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeGlare, getGlareScore, isGlared } from '../src';

describe('glare-score test suite', () => {
  let cleanCardBuffer: Buffer;
  let glaredCardBuffer: Buffer;
  let multiGlaredCardBuffer: Buffer;
  let uniformWhiteBuffer: Buffer;
  let darkBuffer: Buffer;
  let tinyHighlightBuffer: Buffer;
  let tempFilePath: string;

  beforeAll(async () => {
    // 1. Clean ID card mockup: 500x300, grayish-blue (RGB 70, 90, 120), luminance ~85
    cleanCardBuffer = await sharp({
      create: {
        width: 500,
        height: 300,
        channels: 3,
        background: { r: 70, g: 90, b: 120 },
      },
    })
      .png()
      .toBuffer();

    // 2. Glossy card with a circular flash reflection hotspot:
    // Radius 30 circle (area ~2827px) filled with pure white (#ffffff)
    const flashSvg = Buffer.from(`
      <svg width="500" height="300">
        <circle cx="250" cy="150" r="30" fill="white" />
      </svg>
    `);

    glaredCardBuffer = await sharp({
      create: {
        width: 500,
        height: 300,
        channels: 3,
        background: { r: 70, g: 90, b: 120 },
      },
    })
      .composite([{ input: flashSvg, top: 0, left: 0 }])
      .png()
      .toBuffer();

    // 3. Multi-glared card: 2 distinct flash hotspots
    const multiFlashSvg = Buffer.from(`
      <svg width="500" height="300">
        <circle cx="120" cy="100" r="25" fill="white" />
        <circle cx="380" cy="200" r="25" fill="white" />
      </svg>
    `);

    multiGlaredCardBuffer = await sharp({
      create: {
        width: 500,
        height: 300,
        channels: 3,
        background: { r: 70, g: 90, b: 120 },
      },
    })
      .composite([{ input: multiFlashSvg, top: 0, left: 0 }])
      .png()
      .toBuffer();

    // 4. Uniform white image (300x300 #ffffff)
    uniformWhiteBuffer = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    // 5. Dark image (300x300 #101010)
    darkBuffer = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 16, g: 16, b: 16 },
      },
    })
      .png()
      .toBuffer();

    // 6. Tiny highlight speckle (4x4 square, 16 pixels - below minHotspotArea default 50)
    const speckleSvg = Buffer.from(`
      <svg width="500" height="300">
        <rect x="250" y="150" width="4" height="4" fill="white" />
      </svg>
    `);

    tinyHighlightBuffer = await sharp({
      create: {
        width: 500,
        height: 300,
        channels: 3,
        background: { r: 70, g: 90, b: 120 },
      },
    })
      .composite([{ input: speckleSvg, top: 0, left: 0 }])
      .png()
      .toBuffer();

    // 7. Temporary file for filepath input test
    tempFilePath = path.join(process.cwd(), 'temp-test-glare.png');
    await fs.writeFile(tempFilePath, glaredCardBuffer);
  });

  afterAll(async () => {
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // ignore
    }
  });

  describe('analyzeGlare()', () => {
    it('should correctly analyze a clean image with zero glare', async () => {
      const result = await analyzeGlare(cleanCardBuffer);

      expect(result.score).toBe(0);
      expect(result.hasGlare).toBe(false);
      expect(result.glarePercentage).toBe(0);
      expect(result.hotspotCount).toBe(0);
      expect(result.quality).toBe('excellent');
      expect(result.details.saturatedPixelCount).toBe(0);
      expect(result.details.peakLuminance).toBeLessThan(245);
      expect(result.details.avgLuminance).toBeGreaterThan(0);
    });

    it('should detect a flash glare reflection hotspot on a card', async () => {
      const result = await analyzeGlare(glaredCardBuffer);

      expect(result.hasGlare).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.15);
      expect(result.hotspotCount).toBe(1);
      expect(result.glarePercentage).toBeGreaterThan(0.5);
      expect(['fair', 'poor']).toContain(result.quality);
      expect(result.details.saturatedPixelCount).toBeGreaterThan(1000);
      expect(result.details.peakLuminance).toBe(255);
    });

    it('should detect multiple glare hotspots', async () => {
      const result = await analyzeGlare(multiGlaredCardBuffer);

      expect(result.hasGlare).toBe(true);
      expect(result.hotspotCount).toBe(2);
      expect(result.score).toBeGreaterThan(0.2);
    });

    it('should distinguish diffuse uniform white from specular flash glare', async () => {
      const result = await analyzeGlare(uniformWhiteBuffer);

      // Diffuse white paper has no sharp local contrast gradient
      expect(result.hotspotCount).toBe(0);
      expect(result.hasGlare).toBe(false);
      expect(result.score).toBe(0);
      expect(result.glarePercentage).toBe(0);
      expect(result.details.peakLuminance).toBe(255);
      expect(result.details.avgLuminance).toBe(255);
      expect(result.details.saturatedPixelCount).toBe(300 * 300);
    });

    it('should handle dark images without glare', async () => {
      const result = await analyzeGlare(darkBuffer);

      expect(result.score).toBe(0);
      expect(result.hasGlare).toBe(false);
      expect(result.hotspotCount).toBe(0);
      expect(result.quality).toBe('excellent');
      expect(result.details.saturatedPixelCount).toBe(0);
    });

    it('should ignore tiny highlights smaller than minHotspotArea', async () => {
      const resultDefault = await analyzeGlare(tinyHighlightBuffer);
      expect(resultDefault.hotspotCount).toBe(0);
      expect(resultDefault.hasGlare).toBe(false);
      expect(resultDefault.score).toBe(0);

      // When minHotspotArea is reduced, it should detect the tiny highlight
      const resultCustom = await analyzeGlare(tinyHighlightBuffer, { minHotspotArea: 10 });
      expect(resultCustom.hotspotCount).toBe(1);
      expect(resultCustom.details.saturatedPixelCount).toBe(16);
    });

    it('should work with file path string input', async () => {
      const result = await analyzeGlare(tempFilePath);
      expect(result.hasGlare).toBe(true);
      expect(result.hotspotCount).toBe(1);
    });

    it('should work with Uint8Array input', async () => {
      const uint8 = new Uint8Array(glaredCardBuffer);
      const result = await analyzeGlare(uint8);
      expect(result.hasGlare).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.15);
    });
  });

  describe('getGlareScore()', () => {
    it('should return a number between 0 and 1', async () => {
      const cleanScore = await getGlareScore(cleanCardBuffer);
      const glaredScore = await getGlareScore(glaredCardBuffer);

      expect(cleanScore).toBe(0);
      expect(glaredScore).toBeGreaterThan(0.15);
      expect(glaredScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('isGlared()', () => {
    it('should return false for clean images and true for glared images', async () => {
      expect(await isGlared(cleanCardBuffer)).toBe(false);
      expect(await isGlared(glaredCardBuffer)).toBe(true);
    });

    it('should honor custom threshold parameter', async () => {
      // With very high threshold, even glared image may be below it
      const highThreshold = await isGlared(glaredCardBuffer, 0.99);
      expect(highThreshold).toBe(false);

      // With very low threshold, even small score triggers true
      const lowThreshold = await isGlared(glaredCardBuffer, 0.05);
      expect(lowThreshold).toBe(true);
    });
  });

  describe('Options configuration', () => {
    it('should support custom downsampleWidth', async () => {
      const result = await analyzeGlare(glaredCardBuffer, { downsampleWidth: 256 });
      expect(result.hasGlare).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('should support custom luminanceCutoff', async () => {
      // If cutoff is higher than 255 (not allowed), it throws
      // If cutoff is 250, white (255) is still detected
      const result = await analyzeGlare(glaredCardBuffer, { luminanceCutoff: 250 });
      expect(result.hasGlare).toBe(true);
    });
  });

  describe('Validation & Error Handling', () => {
    it('should throw on null or undefined input', async () => {
      // @ts-expect-error test invalid input
      await expect(analyzeGlare(null)).rejects.toThrow(TypeError);
      // @ts-expect-error test invalid input
      await expect(analyzeGlare(undefined)).rejects.toThrow(TypeError);
    });

    it('should throw on empty string', async () => {
      await expect(analyzeGlare('   ')).rejects.toThrow('file path string cannot be empty');
    });

    it('should throw on empty buffer', async () => {
      await expect(analyzeGlare(Buffer.alloc(0))).rejects.toThrow('buffer cannot be empty');
      await expect(analyzeGlare(new Uint8Array([]))).rejects.toThrow('buffer cannot be empty');
    });

    it('should throw on invalid input types', async () => {
      // @ts-expect-error test invalid input
      await expect(analyzeGlare(12345)).rejects.toThrow(TypeError);
      // @ts-expect-error test invalid input
      await expect(analyzeGlare({})).rejects.toThrow(TypeError);
    });

    it('should throw on invalid options', async () => {
      await expect(analyzeGlare(cleanCardBuffer, { threshold: -1 })).rejects.toThrow(RangeError);
      await expect(analyzeGlare(cleanCardBuffer, { threshold: 1.5 })).rejects.toThrow(RangeError);
      await expect(analyzeGlare(cleanCardBuffer, { luminanceCutoff: -5 })).rejects.toThrow(
        RangeError
      );
      await expect(analyzeGlare(cleanCardBuffer, { luminanceCutoff: 260 })).rejects.toThrow(
        RangeError
      );
      await expect(analyzeGlare(cleanCardBuffer, { minHotspotArea: 0 })).rejects.toThrow(
        RangeError
      );
      await expect(analyzeGlare(cleanCardBuffer, { downsampleWidth: 10 })).rejects.toThrow(
        RangeError
      );
    });

    it('should throw when sharp encounters invalid image data', async () => {
      const invalidData = Buffer.from('this is not an image');
      await expect(analyzeGlare(invalidData)).rejects.toThrow();
    });
  });
});

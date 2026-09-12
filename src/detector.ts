import sharp from 'sharp';
import type { GlareOptions, GlareResult } from './types';
import { normalizeOptions, validateInput } from './utils';

interface ClusterInfo {
  pixels: number[];
  meanLuminance: number;
  surroundingLuminance: number;
  contrast: number;
  contrastFactor: number;
}

/**
 * Analyzes an image for specular glare and flash reflection hotspots.
 *
 * @param input - File path, Buffer, or Uint8Array representing an image.
 * @param options - Configurable parameters for glare detection.
 * @returns Promise resolving to a detailed GlareResult.
 */
export async function analyzeGlare(
  input: string | Buffer | Uint8Array,
  options?: GlareOptions
): Promise<GlareResult> {
  validateInput(input);
  const opts = normalizeOptions(options);

  // Resize maintaining aspect ratio to the downsample width for blazing performance
  const imagePipeline = sharp(input);
  const { data, info } = await imagePipeline
    .resize({ width: opts.downsampleWidth, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const totalPixels = width * height;

  if (totalPixels === 0) {
    throw new Error('Image contains no pixel data.');
  }

  // 1. Calculate overall luminance stats & identify saturated pixels
  let peakLuminance = 0;
  let luminanceSum = 0;
  let saturatedPixelCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const lum = data[i]!;
    if (lum > peakLuminance) peakLuminance = lum;
    luminanceSum += lum;
    if (lum >= opts.luminanceCutoff) {
      saturatedPixelCount++;
    }
  }

  const avgLuminance = Number((luminanceSum / totalPixels).toFixed(2));

  // If no pixels reach the luminance cutoff, image is pristine
  if (saturatedPixelCount === 0) {
    return {
      score: 0,
      hasGlare: false,
      glarePercentage: 0,
      hotspotCount: 0,
      quality: 'excellent',
      details: {
        peakLuminance,
        avgLuminance,
        saturatedPixelCount: 0,
      },
    };
  }

  // 2. Connected Component Analysis on saturated pixels (4-way connectivity)
  const visited = new Uint8Array(totalPixels);
  const candidateClusters: ClusterInfo[] = [];

  // Queue for BFS
  const queue = new Int32Array(totalPixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;

      if (visited[startIdx] === 1 || data[startIdx]! < opts.luminanceCutoff) {
        continue;
      }

      // Start BFS to extract connected saturated cluster
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      const clusterPixels: number[] = [];
      let clusterLumSum = 0;

      while (head < tail) {
        const currIdx = queue[head++]!;
        clusterPixels.push(currIdx);
        clusterLumSum += data[currIdx]!;

        const cx = currIdx % width;
        const cy = Math.floor(currIdx / width);

        // Check 4-connected neighbors
        // Right
        if (cx + 1 < width) {
          const nIdx = currIdx + 1;
          if (visited[nIdx] === 0 && data[nIdx]! >= opts.luminanceCutoff) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        // Left
        if (cx - 1 >= 0) {
          const nIdx = currIdx - 1;
          if (visited[nIdx] === 0 && data[nIdx]! >= opts.luminanceCutoff) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        // Down
        if (cy + 1 < height) {
          const nIdx = currIdx + width;
          if (visited[nIdx] === 0 && data[nIdx]! >= opts.luminanceCutoff) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        // Up
        if (cy - 1 >= 0) {
          const nIdx = currIdx - width;
          if (visited[nIdx] === 0 && data[nIdx]! >= opts.luminanceCutoff) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }

      // Check if cluster meets minimum hotspot area threshold
      if (clusterPixels.length < opts.minHotspotArea) {
        continue;
      }

      // If cluster occupies virtually the whole image (> 75%) and avg luminance is very high,
      // this is a diffuse white background or uniform paper, not a localized specular hotspot.
      if (clusterPixels.length / totalPixels > 0.75 && avgLuminance > 230) {
        continue;
      }

      const meanClusterLum = clusterLumSum / clusterPixels.length;

      // 3. Local Contrast Analysis: Examine peripheral non-cluster pixels
      // Collect immediate surrounding background pixels within a 3px dilation
      const surroundingSet = new Set<number>();
      const clusterSet = new Set<number>(clusterPixels);

      for (const pIdx of clusterPixels) {
        const px = pIdx % width;
        const py = Math.floor(pIdx / width);

        // Check surrounding window (up to 3 pixels away)
        for (let dy = -3; dy <= 3; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= height) continue;

          for (let dx = -3; dx <= 3; dx++) {
            if (dx === 0 && dy === 0) continue;
            // Manhattan distance <= 3 for smooth circular neighborhood
            if (Math.abs(dx) + Math.abs(dy) > 3) continue;

            const nx = px + dx;
            if (nx < 0 || nx >= width) continue;

            const nIdx = ny * width + nx;
            if (!clusterSet.has(nIdx)) {
              surroundingSet.add(nIdx);
            }
          }
        }
      }

      let surroundingLuminance = meanClusterLum;
      let contrast = 0;

      if (surroundingSet.size > 0) {
        let surrSum = 0;
        for (const sIdx of surroundingSet) {
          surrSum += data[sIdx]!;
        }
        surroundingLuminance = surrSum / surroundingSet.size;
        contrast = Math.max(0, meanClusterLum - surroundingLuminance);
      }

      // Specular glare has sharp local contrast (>= 15 luminance drop-off)
      // Diffuse white paper has very low contrast (< 15)
      if (contrast < 15) {
        continue;
      }

      // Contrast factor scales between 0.3 (moderate contrast) to 1.0 (high contrast specular flash)
      const contrastFactor = Math.min(1.0, Math.max(0.3, contrast / 50));

      candidateClusters.push({
        pixels: clusterPixels,
        meanLuminance: meanClusterLum,
        surroundingLuminance,
        contrast,
        contrastFactor,
      });
    }
  }

  // 4. Compute final GlareResult metrics
  const hotspotCount = candidateClusters.length;

  if (hotspotCount === 0) {
    return {
      score: 0,
      hasGlare: false,
      glarePercentage: 0,
      hotspotCount: 0,
      quality: 'excellent',
      details: {
        peakLuminance,
        avgLuminance,
        saturatedPixelCount,
      },
    };
  }

  let totalGlarePixels = 0;
  let weightedContrastSum = 0;

  for (const cluster of candidateClusters) {
    totalGlarePixels += cluster.pixels.length;
    weightedContrastSum += cluster.pixels.length * cluster.contrastFactor;
  }

  const glarePercentage = Number(((totalGlarePixels / totalPixels) * 100).toFixed(2));
  const areaRatio = totalGlarePixels / totalPixels;
  const avgContrastFactor = weightedContrastSum / totalGlarePixels;

  // Normalized score calculation: concave sqrt curve mapping area + contrast
  const rawScore = Math.min(
    1.0,
    Math.sqrt(areaRatio) * 1.9 * (0.6 + 0.4 * avgContrastFactor)
  );
  const score = Number(rawScore.toFixed(4));

  const hasGlare = score >= opts.threshold;

  let quality: 'excellent' | 'good' | 'fair' | 'poor';
  if (score < 0.05) {
    quality = 'excellent';
  } else if (score < opts.threshold) {
    quality = 'good';
  } else if (score < 0.40) {
    quality = 'fair';
  } else {
    quality = 'poor';
  }

  return {
    score,
    hasGlare,
    glarePercentage,
    hotspotCount,
    quality,
    details: {
      peakLuminance,
      avgLuminance,
      saturatedPixelCount,
    },
  };
}

/**
 * Returns only the normalized glare severity score (0.0 to 1.0).
 *
 * @param input - File path, Buffer, or Uint8Array.
 * @param options - Optional glare options.
 * @returns Promise resolving to a number between 0.0 and 1.0.
 */
export async function getGlareScore(
  input: string | Buffer | Uint8Array,
  options?: GlareOptions
): Promise<number> {
  const result = await analyzeGlare(input, options);
  return result.score;
}

/**
 * Determines whether an image has glare exceeding the given threshold.
 *
 * @param input - File path, Buffer, or Uint8Array.
 * @param threshold - Glare score threshold (default: 0.15).
 * @returns Promise resolving to a boolean.
 */
export async function isGlared(
  input: string | Buffer | Uint8Array,
  threshold?: number
): Promise<boolean> {
  const options: GlareOptions = {};
  if (threshold !== undefined) {
    options.threshold = threshold;
  }
  const result = await analyzeGlare(input, options);
  return result.hasGlare;
}

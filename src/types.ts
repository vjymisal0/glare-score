/**
 * Configuration options for glare detection.
 */
export interface GlareOptions {
  /**
   * Hotspot score threshold to determine whether an image is considered glared.
   * If `score >= threshold`, `hasGlare` is set to `true`.
   * @default 0.15
   */
  threshold?: number;

  /**
   * Pixel brightness cutoff (0-255) for classifying saturated candidate pixels.
   * Pixels with luminance >= luminanceCutoff are evaluated for glare hotspots.
   * @default 245
   */
  luminanceCutoff?: number;

  /**
   * Minimum number of connected pixels required to constitute a valid glare cluster / hotspot.
   * Filters out isolated sensor noise, speckles, or tiny specular highlights.
   * @default 50
   */
  minHotspotArea?: number;

  /**
   * Target maximum width to downsample the image maintaining aspect ratio before analysis.
   * Provides consistent scale and blazing-fast execution speeds (typically < 15ms).
   * @default 512
   */
  downsampleWidth?: number;
}

/**
 * Result of the glare analysis.
 */
export interface GlareResult {
  /**
   * Normalized glare severity score from 0.0 (pristine / glare-free) to 1.0 (severe blinding glare).
   */
  score: number;

  /**
   * Whether the image exceeds the glare threshold (`score >= threshold`).
   */
  hasGlare: boolean;

  /**
   * Percentage of total image area covered by detected glare hotspots (0.0 to 100.0).
   */
  glarePercentage: number;

  /**
   * Number of distinct glare clusters / hotspots detected.
   */
  hotspotCount: number;

  /**
   * Qualitative classification based on the glare score:
   * - `'excellent'`: Pristine image with no discernible glare (< 0.05).
   * - `'good'`: Minimal glare, perfectly usable for OCR / KYC (< 0.15).
   * - `'fair'`: Moderate glare present, may partially obscure details (< 0.40).
   * - `'poor'`: Severe glare hotspots, likely illegible or failed KYC (>= 0.40).
   */
  quality: 'excellent' | 'good' | 'fair' | 'poor';

  /**
   * Low-level image luminance statistics.
   */
  details: {
    /** Maximum pixel luminance found in the image (0-255). */
    peakLuminance: number;
    /** Average pixel luminance across the entire image (0.0 to 255.0). */
    avgLuminance: number;
    /** Total count of saturated pixels (luminance >= luminanceCutoff). */
    saturatedPixelCount: number;
  };
}

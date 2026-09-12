import type { GlareOptions } from './types';

/**
 * Validates the image input parameter.
 */
export function validateInput(input: unknown): void {
  if (input === null || input === undefined) {
    throw new TypeError('Invalid image input: input must be a file path string, Buffer, or Uint8Array.');
  }

  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      throw new Error('Invalid image input: file path string cannot be empty.');
    }
    return;
  }

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    if (input.length === 0) {
      throw new Error('Invalid image input: buffer cannot be empty.');
    }
    return;
  }

  throw new TypeError('Invalid image input: expected a file path string, Buffer, or Uint8Array.');
}

/**
 * Validates and normalizes user-provided glare options with defaults.
 */
export function normalizeOptions(options?: GlareOptions): Required<GlareOptions> {
  const threshold = options?.threshold ?? 0.15;
  const luminanceCutoff = options?.luminanceCutoff ?? 245;
  const minHotspotArea = options?.minHotspotArea ?? 50;
  const downsampleWidth = options?.downsampleWidth ?? 512;

  if (typeof threshold !== 'number' || Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(`Invalid option 'threshold': expected a number between 0 and 1, got ${threshold}.`);
  }

  if (
    typeof luminanceCutoff !== 'number' ||
    Number.isNaN(luminanceCutoff) ||
    luminanceCutoff < 0 ||
    luminanceCutoff > 255
  ) {
    throw new RangeError(
      `Invalid option 'luminanceCutoff': expected a number between 0 and 255, got ${luminanceCutoff}.`
    );
  }

  if (
    typeof minHotspotArea !== 'number' ||
    Number.isNaN(minHotspotArea) ||
    minHotspotArea < 1 ||
    !Number.isInteger(minHotspotArea)
  ) {
    throw new RangeError(
      `Invalid option 'minHotspotArea': expected a positive integer >= 1, got ${minHotspotArea}.`
    );
  }

  if (
    typeof downsampleWidth !== 'number' ||
    Number.isNaN(downsampleWidth) ||
    downsampleWidth < 16 ||
    !Number.isInteger(downsampleWidth)
  ) {
    throw new RangeError(
      `Invalid option 'downsampleWidth': expected an integer >= 16, got ${downsampleWidth}.`
    );
  }

  return {
    threshold,
    luminanceCutoff,
    minHotspotArea,
    downsampleWidth,
  };
}

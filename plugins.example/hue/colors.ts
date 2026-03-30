/**
 * Color definitions and CIE XY conversion utilities.
 */

// =============================================================================
// Named Colors (CIE XY coordinates)
// =============================================================================

export const COLORS: Record<string, { x: number; y: number }> = {
  red: { x: 0.675, y: 0.322 },
  blue: { x: 0.167, y: 0.04 },
  green: { x: 0.17, y: 0.7 },
  yellow: { x: 0.44, y: 0.517 },
  purple: { x: 0.25, y: 0.1 },
  orange: { x: 0.58, y: 0.39 },
  pink: { x: 0.4, y: 0.2 },
  cyan: { x: 0.17, y: 0.34 },
  magenta: { x: 0.38, y: 0.16 },
  white: { x: 0.3127, y: 0.3290 },
  'warm white': { x: 0.4578, y: 0.4101 },
  'cool white': { x: 0.3174, y: 0.3207 },
  warm: { x: 0.4578, y: 0.4101 },
  cool: { x: 0.3174, y: 0.3207 },
};

// Rainbow colors for default color_loop
export const RAINBOW_COLORS = ['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'];

// =============================================================================
// Hex to CIE XY Conversion
// =============================================================================

/**
 * Parse a hex color string (#RRGGBB or RRGGBB) to RGB components (0-1).
 * Returns null if invalid.
 */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const h = match[1];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/**
 * Apply gamma correction for sRGB to linear conversion.
 */
function gammaCorrect(c: number): number {
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

/**
 * Convert hex color (#RRGGBB) to CIE XY coordinates.
 * Uses the Wide RGB D65 conversion matrix.
 * Returns null if hex is invalid.
 */
export function hexToXY(hex: string): { x: number; y: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const r = gammaCorrect(rgb.r);
  const g = gammaCorrect(rgb.g);
  const b = gammaCorrect(rgb.b);

  // Wide RGB D65 conversion
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.3290 }; // Default to D65 white point

  return {
    x: Math.round((X / sum) * 10000) / 10000,
    y: Math.round((Y / sum) * 10000) / 10000,
  };
}

/**
 * Resolve a color input to CIE XY coordinates.
 * Accepts named colors (from COLORS map) or hex strings (#RRGGBB).
 * Returns null if unrecognized.
 */
export function resolveColor(input: string): { x: number; y: number } | null {
  const named = COLORS[input.toLowerCase()];
  if (named) return named;
  return hexToXY(input);
}

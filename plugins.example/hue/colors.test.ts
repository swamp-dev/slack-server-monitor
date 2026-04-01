import { describe, it, expect } from 'vitest';
import {
  COLORS,
  RAINBOW_COLORS,
  parseHex,
  hexToXY,
  resolveColor,
} from './colors.js';

describe('hue colors', () => {
  describe('COLORS map', () => {
    it('should contain core named colors', () => {
      expect(COLORS.red).toBeDefined();
      expect(COLORS.blue).toBeDefined();
      expect(COLORS.green).toBeDefined();
      expect(COLORS.yellow).toBeDefined();
      expect(COLORS.purple).toBeDefined();
      expect(COLORS.orange).toBeDefined();
      expect(COLORS.pink).toBeDefined();
      expect(COLORS.white).toBeDefined();
      expect(COLORS['warm white']).toBeDefined();
      expect(COLORS['cool white']).toBeDefined();
    });

    it('should have valid CIE XY values (0-1 range)', () => {
      for (const [name, xy] of Object.entries(COLORS)) {
        expect(xy.x, `${name}.x`).toBeGreaterThanOrEqual(0);
        expect(xy.x, `${name}.x`).toBeLessThanOrEqual(1);
        expect(xy.y, `${name}.y`).toBeGreaterThanOrEqual(0);
        expect(xy.y, `${name}.y`).toBeLessThanOrEqual(1);
      }
    });

    it('should have "warm" and "cool" as aliases', () => {
      expect(COLORS.warm).toEqual(COLORS['warm white']);
      expect(COLORS.cool).toEqual(COLORS['cool white']);
    });
  });

  describe('RAINBOW_COLORS', () => {
    it('should have 7 colors', () => {
      expect(RAINBOW_COLORS).toHaveLength(7);
    });

    it('should all be valid hex strings', () => {
      for (const color of RAINBOW_COLORS) {
        expect(parseHex(color), `${color} should be valid hex`).not.toBeNull();
      }
    });
  });

  describe('parseHex', () => {
    it('should parse #RRGGBB format', () => {
      expect(parseHex('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
      expect(parseHex('#00FF00')).toEqual({ r: 0, g: 1, b: 0 });
      expect(parseHex('#0000FF')).toEqual({ r: 0, g: 0, b: 1 });
    });

    it('should parse RRGGBB without hash', () => {
      expect(parseHex('FF0000')).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('should handle lowercase hex', () => {
      expect(parseHex('#ff8000')).toEqual({
        r: 1,
        g: expect.closeTo(0.502, 2),
        b: 0,
      });
    });

    it('should return null for invalid formats', () => {
      expect(parseHex('')).toBeNull();
      expect(parseHex('#FFF')).toBeNull();
      expect(parseHex('#GGGGGG')).toBeNull();
      expect(parseHex('not-a-color')).toBeNull();
      expect(parseHex('#FF00FF00')).toBeNull();
    });

    it('should return correct fractional values', () => {
      const result = parseHex('#808080');
      expect(result).not.toBeNull();
      expect(result?.r).toBeCloseTo(0.502, 2);
      expect(result?.g).toBeCloseTo(0.502, 2);
      expect(result?.b).toBeCloseTo(0.502, 2);
    });
  });

  describe('hexToXY', () => {
    it('should convert pure red to high x value', () => {
      const xy = hexToXY('#FF0000');
      expect(xy).not.toBeNull();
      expect(xy?.x).toBeGreaterThan(0.6);
      expect(xy?.y).toBeGreaterThan(0.2);
      expect(xy?.y).toBeLessThan(0.4);
    });

    it('should convert pure green to high y value', () => {
      const xy = hexToXY('#00FF00');
      expect(xy).not.toBeNull();
      expect(xy?.y).toBeGreaterThan(0.6);
    });

    it('should convert pure blue to low x and y', () => {
      const xy = hexToXY('#0000FF');
      expect(xy).not.toBeNull();
      expect(xy?.x).toBeLessThan(0.2);
      expect(xy?.y).toBeLessThan(0.1);
    });

    it('should handle black (#000000) as D65 white point', () => {
      const xy = hexToXY('#000000');
      expect(xy).not.toBeNull();
      expect(xy?.x).toBeCloseTo(0.3127, 3);
      expect(xy?.y).toBeCloseTo(0.3290, 3);
    });

    it('should return null for invalid hex', () => {
      expect(hexToXY('not-hex')).toBeNull();
      expect(hexToXY('')).toBeNull();
    });

    it('should produce values in 0-1 range', () => {
      const testColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#FF8000', '#800080'];
      for (const hex of testColors) {
        const xy = hexToXY(hex);
        expect(xy, `${hex}`).not.toBeNull();
        expect(xy?.x, `${hex}.x`).toBeGreaterThanOrEqual(0);
        expect(xy?.x, `${hex}.x`).toBeLessThanOrEqual(1);
        expect(xy?.y, `${hex}.y`).toBeGreaterThanOrEqual(0);
        expect(xy?.y, `${hex}.y`).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('resolveColor', () => {
    it('should resolve named colors', () => {
      expect(resolveColor('red')).toEqual(COLORS.red);
      expect(resolveColor('blue')).toEqual(COLORS.blue);
      expect(resolveColor('warm white')).toEqual(COLORS['warm white']);
    });

    it('should be case-insensitive for named colors', () => {
      expect(resolveColor('RED')).toEqual(COLORS.red);
      expect(resolveColor('Blue')).toEqual(COLORS.blue);
      expect(resolveColor('Warm White')).toEqual(COLORS['warm white']);
    });

    it('should resolve hex colors', () => {
      const result = resolveColor('#FF0000');
      expect(result).not.toBeNull();
      expect(result?.x).toBeGreaterThan(0.6);
    });

    it('should return null for unrecognized input', () => {
      expect(resolveColor('chartreuse')).toBeNull();
      expect(resolveColor('')).toBeNull();
      expect(resolveColor('not-a-color')).toBeNull();
    });

    it('should prefer named colors over hex parsing', () => {
      expect(resolveColor('red')).toEqual(COLORS.red);
    });
  });
});

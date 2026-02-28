/**
 * Tests for the lift plugin warmup calculator
 *
 * These tests verify the plate loading algorithm and warmup set calculations
 * without needing to test Slack integration.
 */
import { describe, it, expect } from 'vitest';
import {
  PLATE_SIZES,
  HOME_PLATE_SIZES,
  WARMUP_PERCENTAGES,
  MAX_TARGET_WEIGHT,
  GYM_PLATES,
  HOME_PLATES,
  calculatePlateConfig,
} from '../../plugins.example/lift.js';
import type { PlateConfig } from '../../plugins.example/lift.js';

/**
 * Calculate warmup sets for a target weight
 */
function calculateWarmupSets(
  targetWeight: number,
  config: PlateConfig = GYM_PLATES,
): { percent: number; weight: number; config: string }[] {
  return WARMUP_PERCENTAGES.map((pct) => ({
    percent: Math.round(pct * 100),
    weight: Math.round(targetWeight * pct),
    config: calculatePlateConfig(Math.round(targetWeight * pct), config),
  }));
}

describe('lift plugin warmup calculator', () => {
  describe('calculatePlateConfig', () => {
    describe('dumbbell cases (weight < 45 lbs)', () => {
      it('should return dumbbells for weights under 45 lbs', () => {
        expect(calculatePlateConfig(40, GYM_PLATES)).toBe('2x20lb DBs');
      });

      it('should round dumbbell weight to nearest 5 lbs', () => {
        expect(calculatePlateConfig(32, GYM_PLATES)).toBe('2x15lb DBs');
        expect(calculatePlateConfig(38, GYM_PLATES)).toBe('2x20lb DBs');
      });

      it('should handle very light weights', () => {
        expect(calculatePlateConfig(10, GYM_PLATES)).toBe('2x5lb DBs');
        expect(calculatePlateConfig(20, GYM_PLATES)).toBe('2x10lb DBs');
      });

      it('should handle edge case of 0 lbs', () => {
        // 0 lbs -> round(0/10)*5 = 0 lbs per hand
        expect(calculatePlateConfig(0, GYM_PLATES)).toBe('2x0lb DBs');
      });

      it('should handle edge case of 5 lbs', () => {
        // 5 lbs -> round(5/10)*5 = round(0.5)*5 = 5 lbs per hand
        expect(calculatePlateConfig(5, GYM_PLATES)).toBe('2x5lb DBs');
      });

      it('should handle edge case near 45 lbs', () => {
        expect(calculatePlateConfig(44, GYM_PLATES)).toBe('2x20lb DBs');
      });
    });

    describe('bar only case', () => {
      it('should return bar only for exactly 45 lbs', () => {
        expect(calculatePlateConfig(45)).toBe('Bar only');
      });

      it('should return bar only when weight is between 45 and 50 lbs', () => {
        // Can't add any plates because smallest plate pair is 2.5x2 = 5 lbs
        expect(calculatePlateConfig(48)).toBe('Bar only');
        expect(calculatePlateConfig(49)).toBe('Bar only');
      });
    });

    describe('simple plate configurations', () => {
      it('should calculate bar + 2.5 plates', () => {
        expect(calculatePlateConfig(50)).toBe('Bar + 2.5x2');
      });

      it('should calculate bar + 5 plates', () => {
        expect(calculatePlateConfig(55)).toBe('Bar + 5x2');
      });

      it('should calculate bar + 10 plates', () => {
        expect(calculatePlateConfig(65)).toBe('Bar + 10x2');
      });

      it('should calculate bar + 25 plates', () => {
        expect(calculatePlateConfig(95)).toBe('Bar + 25x2');
      });

      it('should calculate bar + 35 plates', () => {
        expect(calculatePlateConfig(115)).toBe('Bar + 35x2');
      });

      it('should calculate bar + 45 plates', () => {
        expect(calculatePlateConfig(135)).toBe('Bar + 45x2');
      });
    });

    describe('complex plate configurations', () => {
      it('should calculate 200 lbs correctly', () => {
        // 200 - 45 = 155 remaining
        // 45: 155 >= 90? Yes, 155-90=65, count=1
        // 35: 65 >= 70? No
        // 25: 65 >= 50? Yes, 65-50=15, count=1
        // 10: 15 >= 20? No
        // 5: 15 >= 10? Yes, 15-10=5, count=1
        // 2.5: 5 >= 5? Yes, 5-5=0, count=1
        expect(calculatePlateConfig(200)).toBe('Bar + 45x2 + 25x2 + 5x2 + 2.5x2');
      });

      it('should calculate 225 lbs correctly (common weight)', () => {
        // 225 - 45 = 180 remaining
        // 45: 180 >= 90? Yes, 180-90=90, count=1
        // 45: 90 >= 90? Yes, 90-90=0, count=2
        expect(calculatePlateConfig(225)).toBe('Bar + 45x4');
      });

      it('should calculate 315 lbs correctly (common weight)', () => {
        // 315 - 45 = 270 remaining
        // 45: 270 >= 90? Yes -> 180 -> 90 -> 0, count=3
        expect(calculatePlateConfig(315)).toBe('Bar + 45x6');
      });

      it('should calculate 135 lbs correctly (common weight)', () => {
        // 135 - 45 = 90 remaining
        // 45: 90 >= 90? Yes, 90-90=0, count=1
        expect(calculatePlateConfig(135)).toBe('Bar + 45x2');
      });

      it('should calculate 185 lbs correctly', () => {
        // 185 - 45 = 140 remaining
        // 45: 140 >= 90? Yes, 140-90=50, count=1
        // 25: 50 >= 50? Yes, 50-50=0, count=1
        expect(calculatePlateConfig(185)).toBe('Bar + 45x2 + 25x2');
      });

      it('should calculate 155 lbs correctly', () => {
        // 155 - 45 = 110 remaining
        // 45: 110 >= 90? Yes, 110-90=20, count=1
        // 10: 20 >= 20? Yes, 20-20=0, count=1
        expect(calculatePlateConfig(155)).toBe('Bar + 45x2 + 10x2');
      });
    });

    describe('edge cases', () => {
      it('should handle very heavy weights', () => {
        // 500 - 45 = 455 remaining
        // 45: 455 -> 365 -> 275 -> 185 -> 95 -> 5, count=5
        // 2.5: 5 >= 5? Yes, count=1
        expect(calculatePlateConfig(500)).toBe('Bar + 45x10 + 2.5x2');
      });

      it('should handle weights with remainders', () => {
        // 205 - 45 = 160 remaining
        // 45: 160 >= 90? Yes, 160-90=70, count=1
        // 35: 70 >= 70? Yes, 70-70=0, count=1
        expect(calculatePlateConfig(205)).toBe('Bar + 45x2 + 35x2');
      });

      it('should handle non-loadable weights (remainder after algorithm)', () => {
        // 46 - 45 = 1 remaining, can't load 1 lb with standard plates
        // Returns bar only (50 lbs is closest achievable)
        expect(calculatePlateConfig(46)).toBe('Bar only');
        expect(calculatePlateConfig(47)).toBe('Bar only');
        expect(calculatePlateConfig(49)).toBe('Bar only');
      });
    });
  });

  describe('calculateWarmupSets', () => {
    it('should calculate correct percentages for 200 lbs', () => {
      const sets = calculateWarmupSets(200);

      expect(sets).toHaveLength(4);
      // 40% of 200 = 80 lbs: 80 - 45 = 35 remaining
      // 10: 35 >= 20? Yes -> 15, 5: 15 >= 10? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[0]).toEqual({ percent: 40, weight: 80, config: 'Bar + 10x2 + 5x2 + 2.5x2' });
      // 60% of 200 = 120 lbs: 120 - 45 = 75 remaining
      // 35: 75 >= 70? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[1]).toEqual({ percent: 60, weight: 120, config: 'Bar + 35x2 + 2.5x2' });
      // 80% of 200 = 160 lbs: 160 - 45 = 115 remaining
      // 45: 115 >= 90? Yes -> 25, 10: 25 >= 20? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[2]).toEqual({ percent: 80, weight: 160, config: 'Bar + 45x2 + 10x2 + 2.5x2' });
      // 100% of 200 = 200 lbs: 200 - 45 = 155 remaining
      // 45: 155 >= 90? Yes -> 65, 25: 65 >= 50? Yes -> 15, 5: 15 >= 10? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[3]).toEqual({ percent: 100, weight: 200, config: 'Bar + 45x2 + 25x2 + 5x2 + 2.5x2' });
    });

    it('should calculate correct percentages for 315 lbs', () => {
      const sets = calculateWarmupSets(315);

      // 40% of 315 = 126 lbs: 126 - 45 = 81 remaining
      // 35: 81 >= 70? Yes -> 11, 5: 11 >= 10? Yes -> 1
      expect(sets[0]).toEqual({ percent: 40, weight: 126, config: 'Bar + 35x2 + 5x2' });
      // 60% of 315 = 189 lbs: 189 - 45 = 144 remaining
      // 45: 144 >= 90? Yes -> 54, 25: 54 >= 50? Yes -> 4
      expect(sets[1]).toEqual({ percent: 60, weight: 189, config: 'Bar + 45x2 + 25x2' });
      // 80% of 315 = 252 lbs: 252 - 45 = 207 remaining
      // 45: 207 >= 90? Yes -> 117 -> 27, count=2, 10: 27 >= 20? Yes -> 7, 2.5: 7 >= 5? Yes -> 2
      expect(sets[2]).toEqual({ percent: 80, weight: 252, config: 'Bar + 45x4 + 10x2 + 2.5x2' });
      // 100% of 315 = 315 lbs: 315 - 45 = 270 remaining
      // 45: 270 >= 90? Yes -> 180 -> 90 -> 0, count=3
      expect(sets[3]).toEqual({ percent: 100, weight: 315, config: 'Bar + 45x6' });
    });

    it('should handle light weights with dumbbells', () => {
      const sets = calculateWarmupSets(80);

      // 40% of 80 = 32 lbs -> dumbbells (round 32/10 = 3.2, round to 3, *5 = 15 per hand)
      expect(sets[0]).toEqual({ percent: 40, weight: 32, config: '2x15lb DBs' });
      // 60% of 80 = 48 lbs -> bar only (48 - 45 = 3, can't fit any plate pairs)
      expect(sets[1]).toEqual({ percent: 60, weight: 48, config: 'Bar only' });
      // 80% of 80 = 64 lbs: 64 - 45 = 19 remaining
      // 5: 19 >= 10? Yes -> 9, 2.5: 9 >= 5? Yes -> 4
      expect(sets[2]).toEqual({ percent: 80, weight: 64, config: 'Bar + 5x2 + 2.5x2' });
      // 100% of 80 = 80 lbs: 80 - 45 = 35 remaining
      // 10: 35 >= 20? Yes -> 15, 5: 15 >= 10? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[3]).toEqual({ percent: 100, weight: 80, config: 'Bar + 10x2 + 5x2 + 2.5x2' });
    });

    it('should round weights to nearest integer', () => {
      const sets = calculateWarmupSets(137);

      // 40% of 137 = 54.8 -> 55 lbs
      expect(sets[0].weight).toBe(55);
      // 60% of 137 = 82.2 -> 82 lbs
      expect(sets[1].weight).toBe(82);
      // 80% of 137 = 109.6 -> 110 lbs
      expect(sets[2].weight).toBe(110);
      // 100% of 137 = 137 lbs
      expect(sets[3].weight).toBe(137);
    });
  });

  describe('warmup percentages constant', () => {
    it('should have correct percentages', () => {
      expect(WARMUP_PERCENTAGES).toEqual([0.4, 0.6, 0.8, 1.0]);
    });
  });

  describe('plate sizes constant', () => {
    it('should be in descending order', () => {
      for (let i = 0; i < PLATE_SIZES.length - 1; i++) {
        expect(PLATE_SIZES[i]).toBeGreaterThan(PLATE_SIZES[i + 1]);
      }
    });

    it('should include standard Olympic plates', () => {
      expect(PLATE_SIZES).toContain(45);
      expect(PLATE_SIZES).toContain(25);
      expect(PLATE_SIZES).toContain(10);
      expect(PLATE_SIZES).toContain(5);
      expect(PLATE_SIZES).toContain(2.5);
    });
  });

  describe('max weight constant', () => {
    it('should be 1000 lbs', () => {
      expect(MAX_TARGET_WEIGHT).toBe(1000);
    });
  });

  describe('warmup tool error handling simulation', () => {
    // These tests simulate the error handling logic in the warmup tool

    function simulateWarmupTool(targetWeights: number[]): string {
      if (!targetWeights || targetWeights.length === 0) {
        return 'Error: target_weights array is required';
      }

      const results: string[] = [];
      for (const targetWeight of targetWeights) {
        if (targetWeight <= 0) {
          results.push(`Skipping invalid weight: ${targetWeight}`);
          continue;
        }
        if (targetWeight > MAX_TARGET_WEIGHT) {
          results.push(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): ${targetWeight}`);
          continue;
        }

        const lines: string[] = [`Warmup for ${targetWeight} lbs:`];
        for (const pct of WARMUP_PERCENTAGES) {
          const weight = Math.round(targetWeight * pct);
          const config = calculatePlateConfig(weight);
          lines.push(`  ${Math.round(pct * 100)}%: ${weight} lbs - ${config}`);
        }
        results.push(lines.join('\n'));
      }

      return results.join('\n\n');
    }

    it('should return error for empty array', () => {
      expect(simulateWarmupTool([])).toBe('Error: target_weights array is required');
    });

    it('should skip negative weights', () => {
      const result = simulateWarmupTool([-50, 100]);
      expect(result).toContain('Skipping invalid weight: -50');
      expect(result).toContain('Warmup for 100 lbs');
    });

    it('should skip zero weight', () => {
      const result = simulateWarmupTool([0, 100]);
      expect(result).toContain('Skipping invalid weight: 0');
      expect(result).toContain('Warmup for 100 lbs');
    });

    it('should skip weights exceeding maximum', () => {
      const result = simulateWarmupTool([1500, 100]);
      expect(result).toContain(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): 1500`);
      expect(result).toContain('Warmup for 100 lbs');
    });

    it('should handle all invalid weights', () => {
      const result = simulateWarmupTool([-10, 0, 1500]);
      expect(result).toContain('Skipping invalid weight: -10');
      expect(result).toContain('Skipping invalid weight: 0');
      expect(result).toContain(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): 1500`);
      expect(result).not.toContain('Warmup for');
    });

    it('should accept weights at the maximum limit', () => {
      const result = simulateWarmupTool([1000]);
      expect(result).toContain('Warmup for 1000 lbs');
      expect(result).not.toContain('Skipping');
    });

    it('should handle multiple valid weights', () => {
      const result = simulateWarmupTool([135, 225, 315]);
      expect(result).toContain('Warmup for 135 lbs');
      expect(result).toContain('Warmup for 225 lbs');
      expect(result).toContain('Warmup for 315 lbs');
      // Check that percentages are calculated for each
      expect(result).toContain('40%:');
      expect(result).toContain('100%:');
    });

    it('should handle mix of valid and invalid weights', () => {
      const result = simulateWarmupTool([-10, 200, 2000]);
      expect(result).toContain('Skipping invalid weight: -10');
      expect(result).toContain('Warmup for 200 lbs');
      expect(result).toContain(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): 2000`);
    });
  });

  describe('home warmup plate config', () => {
    describe('home plate sizes constant', () => {
      it('should be in descending order', () => {
        for (let i = 0; i < HOME_PLATE_SIZES.length - 1; i++) {
          expect(HOME_PLATE_SIZES[i]).toBeGreaterThan(HOME_PLATE_SIZES[i + 1]);
        }
      });

      it('should include 55 lb plates, 15 lb plates, and 1.25 lb plates', () => {
        expect(HOME_PLATE_SIZES).toContain(55);
        expect(HOME_PLATE_SIZES).toContain(15);
        expect(HOME_PLATE_SIZES).toContain(1.25);
      });

      it('should have exactly 9 plate sizes', () => {
        expect(HOME_PLATE_SIZES).toHaveLength(9);
      });
    });

    describe('PlateConfig barWeight', () => {
      it('should have 45 lb bar for gym config', () => {
        expect(GYM_PLATES.barWeight).toBe(45);
      });

      it('should have 5 lb bar for home config', () => {
        expect(HOME_PLATES.barWeight).toBe(5);
      });
    });

    describe('below bar weight (no dumbbells at home)', () => {
      it('should return bar only for weights under 5 lbs', () => {
        expect(calculatePlateConfig(3, HOME_PLATES)).toBe('5lb bar only');
      });

      it('should load plates for weights that were previously dumbbell range', () => {
        // 40 - 5 = 35. 15x2=30 -> 5. 2.5x2=5 -> 0
        expect(calculatePlateConfig(40, HOME_PLATES)).toBe('5lb bar + 15x2 + 2.5x2');
        // 32 - 5 = 27. 15? No (27 < 30). 10x2=20 -> 7. 5? No (7 < 10). 2.5x2=5 -> 2. 1.25? No (2 < 2.5)
        expect(calculatePlateConfig(32, HOME_PLATES)).toBe('5lb bar + 10x2 + 2.5x2');
      });
    });

    describe('bar only with home plates', () => {
      it('should return bar only for exactly 5 lbs', () => {
        expect(calculatePlateConfig(5, HOME_PLATES)).toBe('5lb bar only');
      });

      it('should return bar only when smallest pair (1.25x2=2.5) cannot fit', () => {
        expect(calculatePlateConfig(6, HOME_PLATES)).toBe('5lb bar only');
        expect(calculatePlateConfig(7, HOME_PLATES)).toBe('5lb bar only');
      });

      it('should load 1.25 plates at 7.5 lbs', () => {
        expect(calculatePlateConfig(7.5, HOME_PLATES)).toBe('5lb bar + 1.25x2');
      });
    });

    describe('simple home plate configurations', () => {
      it('should calculate bar + 1.25 plates', () => {
        expect(calculatePlateConfig(7.5, HOME_PLATES)).toBe('5lb bar + 1.25x2');
      });

      it('should calculate bar + 2.5 plates', () => {
        expect(calculatePlateConfig(10, HOME_PLATES)).toBe('5lb bar + 2.5x2');
      });

      it('should calculate bar + 5 plates', () => {
        expect(calculatePlateConfig(15, HOME_PLATES)).toBe('5lb bar + 5x2');
      });

      it('should calculate bar + 10 plates', () => {
        expect(calculatePlateConfig(25, HOME_PLATES)).toBe('5lb bar + 10x2');
      });

      it('should calculate bar + 15 plates', () => {
        expect(calculatePlateConfig(35, HOME_PLATES)).toBe('5lb bar + 15x2');
      });

      it('should calculate bar + 25 plates', () => {
        expect(calculatePlateConfig(55, HOME_PLATES)).toBe('5lb bar + 25x2');
      });

      it('should calculate bar + 35 plates', () => {
        expect(calculatePlateConfig(75, HOME_PLATES)).toBe('5lb bar + 35x2');
      });

      it('should calculate bar + 45 plates', () => {
        expect(calculatePlateConfig(95, HOME_PLATES)).toBe('5lb bar + 45x2');
      });

      it('should calculate bar + 55 plates', () => {
        expect(calculatePlateConfig(115, HOME_PLATES)).toBe('5lb bar + 55x2');
      });
    });

    describe('single-pair constraint', () => {
      it('should differ from gym for 225 lbs', () => {
        // Gym: 225 - 45 = 180. 45x2=90 -> 90 left, 45x2=90 -> 0. 45x4
        expect(calculatePlateConfig(225, GYM_PLATES)).toBe('Bar + 45x4');
        // Home: 225 - 5 = 220. 55x2=110 -> 110. 45x2=90 -> 20. 10x2=20 -> 0
        expect(calculatePlateConfig(225, HOME_PLATES)).toBe('5lb bar + 55x2 + 45x2 + 10x2');
      });

      it('should differ from gym for 315 lbs', () => {
        // Gym: 315 - 45 = 270. 45x2=90 three times -> 0. 45x6
        expect(calculatePlateConfig(315, GYM_PLATES)).toBe('Bar + 45x6');
        // Home: 315 - 5 = 310. 55x2=110 -> 200. 45x2=90 -> 110. 35x2=70 -> 40. 25? No. 15x2=30 -> 10. 10? No. 5x2=10 -> 0
        expect(calculatePlateConfig(315, HOME_PLATES)).toBe('5lb bar + 55x2 + 45x2 + 35x2 + 15x2 + 5x2');
      });

      it('should differ from gym for 155 lbs', () => {
        // Home: 155 - 5 = 150. 55x2=110 -> 40. 45? No. 35? No. 25? No. 15x2=30 -> 10. 10? No. 5x2=10 -> 0
        expect(calculatePlateConfig(155, HOME_PLATES)).toBe('5lb bar + 55x2 + 15x2 + 5x2');
        // Gym: 155 - 45 = 110. 45x2=90 -> 20, 10x2=20 -> 0
        expect(calculatePlateConfig(155, GYM_PLATES)).toBe('Bar + 45x2 + 10x2');
      });

      it('should use 1.25 plates for fine-grained loading (52.5 lbs)', () => {
        // 52.5 - 5 = 47.5. 55? No. 45? No. 35? No. 25? No. 15x2=30 -> 17.5. 10? No. 5x2=10 -> 7.5. 2.5x2=5 -> 2.5. 1.25x2=2.5 -> 0
        expect(calculatePlateConfig(52.5, HOME_PLATES)).toBe('5lb bar + 15x2 + 5x2 + 2.5x2 + 1.25x2');
      });

      it('should use max plates for heavy load (all 9 sizes)', () => {
        // Need: 55+45+35+25+15+10+5+2.5+1.25 = 193.75 per side = 387.5 + 5 bar = 392.5
        const allPlatesWeight = 5 + (55 + 45 + 35 + 25 + 15 + 10 + 5 + 2.5 + 1.25) * 2;
        expect(allPlatesWeight).toBe(392.5);
        expect(calculatePlateConfig(allPlatesWeight, HOME_PLATES)).toBe(
          '5lb bar + 55x2 + 45x2 + 35x2 + 25x2 + 15x2 + 10x2 + 5x2 + 2.5x2 + 1.25x2'
        );
      });

      it('should document greedy algorithm for 200 lbs (exact with 5lb bar)', () => {
        // Home: 200 - 5 = 195. 55x2=110 -> 85. 45? No. 35x2=70 -> 15. 25? No. 15? No. 10? No. 5x2=10 -> 5. 2.5x2=5 -> 0
        // Result: 5 + 110 + 70 + 10 + 5 = 200 (exact!)
        expect(calculatePlateConfig(200, HOME_PLATES)).toBe(
          '5lb bar + 55x2 + 35x2 + 5x2 + 2.5x2'
        );
      });
    });

    describe('home warmup sets', () => {
      it('should calculate warmup sets for 225 lbs with home plates', () => {
        const sets = calculateWarmupSets(225, HOME_PLATES);

        expect(sets).toHaveLength(4);
        // 40% of 225 = 90: 90 - 5 = 85. 55? No. 45? No. 35x2=70 -> 15. 25? No. 15? No. 10? No. 5x2=10 -> 5. 2.5x2=5 -> 0
        expect(sets[0]).toEqual({ percent: 40, weight: 90, config: '5lb bar + 35x2 + 5x2 + 2.5x2' });
        // 60% of 225 = 135: 135 - 5 = 130. 55x2=110 -> 20. 45? No. 35? No. 25? No. 15? No. 10x2=20 -> 0
        expect(sets[1]).toEqual({ percent: 60, weight: 135, config: '5lb bar + 55x2 + 10x2' });
        // 80% of 225 = 180: 180 - 5 = 175. 55x2=110 -> 65. 45? No. 35? No. 25x2=50 -> 15. 15? No. 10? No. 5x2=10 -> 5. 2.5x2=5 -> 0
        expect(sets[2]).toEqual({ percent: 80, weight: 180, config: '5lb bar + 55x2 + 25x2 + 5x2 + 2.5x2' });
        // 100% of 225 = 225: 225 - 5 = 220. 55x2=110 -> 110. 45x2=90 -> 20. 35? No. 25? No. 15? No. 10x2=20 -> 0
        expect(sets[3]).toEqual({ percent: 100, weight: 225, config: '5lb bar + 55x2 + 45x2 + 10x2' });
      });

      it('should calculate warmup sets for 315 lbs with home plates', () => {
        const sets = calculateWarmupSets(315, HOME_PLATES);

        // 40% of 315 = 126: 126 - 5 = 121. 55x2=110 -> 11. 45? No. 35? No. 25? No. 15? No. 10? No. 5x2=10 -> 1
        expect(sets[0]).toEqual({ percent: 40, weight: 126, config: '5lb bar + 55x2 + 5x2' });
        // 60% of 315 = 189: 189 - 5 = 184. 55x2=110 -> 74. 45? No. 35x2=70 -> 4. 25? No. 15? No. 10? No. 5? No. 2.5? No. 1.25x2=2.5 -> 1.5 (dropped)
        expect(sets[1]).toEqual({ percent: 60, weight: 189, config: '5lb bar + 55x2 + 35x2 + 1.25x2' });
        // 80% of 315 = 252: 252 - 5 = 247. 55x2=110 -> 137. 45x2=90 -> 47. 35? No. 25? No. 15x2=30 -> 17. 10? No. 5x2=10 -> 7. 2.5x2=5 -> 2. 1.25? No
        expect(sets[2]).toEqual({ percent: 80, weight: 252, config: '5lb bar + 55x2 + 45x2 + 15x2 + 5x2 + 2.5x2' });
        // 100% of 315 = 315: 315 - 5 = 310. 55x2=110 -> 200. 45x2=90 -> 110. 35x2=70 -> 40. 25? No. 15x2=30 -> 10. 10? No. 5x2=10 -> 0
        expect(sets[3]).toEqual({ percent: 100, weight: 315, config: '5lb bar + 55x2 + 45x2 + 35x2 + 15x2 + 5x2' });
      });
    });

    describe('gym vs home comparison', () => {
      it('gym allows multiple pairs of same plate, home does not', () => {
        // 225: gym uses four 45s, home uses 55+45+10
        const gymConfig = calculatePlateConfig(225, GYM_PLATES);
        const homeConfig = calculatePlateConfig(225, HOME_PLATES);
        expect(gymConfig).toContain('45x4');
        expect(homeConfig).not.toContain('x4');
      });

      it('different bar labels for same conceptual weight', () => {
        // 135: gym Bar + 45x2, home 5lb bar + 55x2 + 10x2 (different bar weight means different plates)
        expect(calculatePlateConfig(135, GYM_PLATES)).toBe('Bar + 45x2');
        // 135 - 5 = 130. 55x2=110 -> 20. 45? No. 35? No. 25? No. 15? No. 10x2=20 -> 0
        expect(calculatePlateConfig(135, HOME_PLATES)).toBe('5lb bar + 55x2 + 10x2');
      });
    });
  });

  describe('warmup tool with home parameter', () => {
    function simulateWarmupToolWithConfig(
      targetWeights: number[],
      config: PlateConfig = GYM_PLATES,
    ): string {
      if (!targetWeights || targetWeights.length === 0) {
        return 'Error: target_weights array is required';
      }

      const results: string[] = [];
      for (const targetWeight of targetWeights) {
        if (targetWeight <= 0) {
          results.push(`Skipping invalid weight: ${targetWeight}`);
          continue;
        }
        if (targetWeight > MAX_TARGET_WEIGHT) {
          results.push(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): ${targetWeight}`);
          continue;
        }

        const lines: string[] = [`${config.label} for ${targetWeight} lbs:`];
        for (const pct of WARMUP_PERCENTAGES) {
          const weight = Math.round(targetWeight * pct);
          const plateConfig = calculatePlateConfig(weight, config);
          lines.push(`  ${Math.round(pct * 100)}%: ${weight} lbs - ${plateConfig}`);
        }
        results.push(lines.join('\n'));
      }

      return results.join('\n\n');
    }

    it('should use gym config by default', () => {
      const result = simulateWarmupToolWithConfig([225]);
      expect(result).toContain('Warmup for 225 lbs');
      expect(result).toContain('45x4');
    });

    it('should use home config when specified', () => {
      const result = simulateWarmupToolWithConfig([225], HOME_PLATES);
      expect(result).toContain('Home Warmup for 225 lbs');
      expect(result).not.toContain('45x4');
      expect(result).toContain('55x2 + 45x2 + 10x2');
    });

    it('should handle multiple weights with home config', () => {
      const result = simulateWarmupToolWithConfig([135, 225], HOME_PLATES);
      expect(result).toContain('Home Warmup for 135 lbs');
      expect(result).toContain('Home Warmup for 225 lbs');
    });
  });

  describe('handleWarmupCommand behavior', () => {
    type WeightUnit = 'lbs' | 'kg';

    function kgToLbs(kg: number): number {
      return kg * 2.20462;
    }

    /**
     * Simulates handleWarmupCommand logic for testing.
     * Returns { headers, skipped, contextParts } to verify behavior.
     */
    function simulateHandleWarmup(
      weightArgs: string[],
      config: PlateConfig,
      unit: WeightUnit = 'lbs',
    ): { headers: string[]; skipped: string[]; contextParts: string[] } | { error: string } {
      const parsed = weightArgs.map((w) => ({ raw: w, value: parseFloat(w) }));
      const validInputs = parsed.filter((p) => !isNaN(p.value) && p.value > 0);
      const invalidInputs = parsed.filter((p) => isNaN(p.value) || p.value <= 0);

      const cmd = config.singlePairOnly ? 'wh' : 'w';

      // No valid weights at all
      if (validInputs.length === 0) {
        return { error: `Usage: /lift ${cmd} <weight> [weight2] ...` };
      }

      const headers: string[] = [];
      const skipped: string[] = [];

      // Warn about non-numeric/negative inputs
      for (const inv of invalidInputs) {
        skipped.push(`Skipping invalid input: ${inv.raw}`);
      }

      for (const input of validInputs) {
        const weightLbs = unit === 'kg' ? Math.round(kgToLbs(input.value)) : input.value;

        if (weightLbs > MAX_TARGET_WEIGHT) {
          const display = unit === 'kg' ? `${input.value} kg` : `${weightLbs} lbs`;
          skipped.push(`Skipping ${display}: exceeds maximum`);
          continue;
        }

        // Build display label for header
        const displayLabel = unit === 'kg'
          ? `${input.value} kg (~${weightLbs} lbs)`
          : `${weightLbs} lbs`;
        headers.push(`${config.label}: ${displayLabel}`);
      }

      // Only show bar weight in footer for gym config (rows already include "5lb bar" for home)
      const contextParts = ['Percentages: 40%, 60%, 80%, 100%'];
      if (config.barWeight === 45) {
        contextParts.push(`Bar = ${config.barWeight} lbs`);
      }
      contextParts.push('Plate count is total (both sides)');
      if (config.singlePairOnly) {
        contextParts.push('1 pair per plate');
      }
      if (unit === 'kg') {
        contextParts.push('Plate loading in lbs (standard plates)');
      }

      return { headers, skipped, contextParts };
    }

    describe('per-weight max validation', () => {
      it('should show valid weights even when mixed with over-max weights', () => {
        const result = simulateHandleWarmup(['200', '1500'], GYM_PLATES);
        expect(result).not.toHaveProperty('error');
        if ('headers' in result) {
          expect(result.headers).toHaveLength(1);
          expect(result.headers[0]).toContain('200 lbs');
          expect(result.skipped).toHaveLength(1);
          expect(result.skipped[0]).toContain('1500');
          expect(result.skipped[0]).toContain('exceeds maximum');
        }
      });

      it('should show error only when ALL weights are invalid', () => {
        const result = simulateHandleWarmup(['1500', '2000'], GYM_PLATES);
        expect(result).not.toHaveProperty('error');
        if ('headers' in result) {
          expect(result.headers).toHaveLength(0);
          expect(result.skipped).toHaveLength(2);
        }
      });

      it('should show all valid weights when none exceed max', () => {
        const result = simulateHandleWarmup(['135', '225', '315'], GYM_PLATES);
        if ('headers' in result) {
          expect(result.headers).toHaveLength(3);
          expect(result.skipped).toHaveLength(0);
        }
      });
    });

    describe('invalid weight feedback', () => {
      it('should report non-numeric inputs as skipped', () => {
        const result = simulateHandleWarmup(['foo', '200'], GYM_PLATES);
        if ('headers' in result) {
          expect(result.headers).toHaveLength(1);
          expect(result.headers[0]).toContain('200 lbs');
          expect(result.skipped).toHaveLength(1);
          expect(result.skipped[0]).toContain('foo');
        }
      });

      it('should report negative weights as skipped', () => {
        const result = simulateHandleWarmup(['-100', '200'], GYM_PLATES);
        if ('headers' in result) {
          expect(result.headers).toHaveLength(1);
          expect(result.skipped).toHaveLength(1);
          expect(result.skipped[0]).toContain('-100');
        }
      });

      it('should show usage error when all inputs are garbage', () => {
        const result = simulateHandleWarmup(['foo', 'bar'], GYM_PLATES);
        expect(result).toHaveProperty('error');
      });
    });

    describe('kg unit display in header', () => {
      it('should show original kg value and lbs conversion in header', () => {
        const result = simulateHandleWarmup(['100'], GYM_PLATES, 'kg');
        if ('headers' in result) {
          expect(result.headers).toHaveLength(1);
          expect(result.headers[0]).toContain('100 kg');
          expect(result.headers[0]).toContain('~220 lbs');
        }
      });

      it('should show lbs only for lbs unit', () => {
        const result = simulateHandleWarmup(['225'], GYM_PLATES, 'lbs');
        if ('headers' in result) {
          expect(result.headers[0]).toBe('Warmup: 225 lbs');
          expect(result.headers[0]).not.toContain('kg');
        }
      });

      it('should include plate loading note in context for kg users', () => {
        const result = simulateHandleWarmup(['100'], GYM_PLATES, 'kg');
        if ('headers' in result) {
          expect(result.contextParts).toContain('Plate loading in lbs (standard plates)');
        }
      });

      it('should skip over-max kg weights and still show valid ones', () => {
        // 500 kg = ~1102 lbs > 1000 max
        const result = simulateHandleWarmup(['100', '500'], GYM_PLATES, 'kg');
        if ('headers' in result) {
          expect(result.headers).toHaveLength(1);
          expect(result.headers[0]).toContain('100 kg');
          expect(result.skipped).toHaveLength(1);
          expect(result.skipped[0]).toContain('500 kg');
        }
      });
    });

    describe('footer context for gym vs home', () => {
      it('should include Bar = 45 lbs for gym config', () => {
        const result = simulateHandleWarmup(['225'], GYM_PLATES);
        if ('headers' in result) {
          expect(result.contextParts).toContain('Bar = 45 lbs');
        }
      });

      it('should not include bar weight for home config (already in row labels)', () => {
        const result = simulateHandleWarmup(['225'], HOME_PLATES);
        if ('headers' in result) {
          expect(result.contextParts).not.toContain('Bar = 5 lbs');
          expect(result.contextParts).not.toContain('Bar = 45 lbs');
        }
      });
    });
  });

});

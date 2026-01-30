/**
 * Tests for the lift plugin warmup calculator
 *
 * These tests verify the plate loading algorithm and warmup set calculations
 * without needing to test Slack integration.
 */
import { describe, it, expect } from 'vitest';

// Constants matching lift.ts
const BAR_WEIGHT = 45;
const PLATE_SIZES = [45, 35, 25, 10, 5, 2.5] as const;
const WARMUP_PERCENTAGES = [0.4, 0.6, 0.8, 1.0] as const;
const MAX_TARGET_WEIGHT = 1000;

/**
 * Calculate plate configuration for a given target weight
 * This is a copy of the function from lift.ts for testing
 */
function calculatePlateConfig(targetWeight: number): string {
  if (targetWeight < BAR_WEIGHT) {
    // Dumbbell case: round total weight to nearest 10 lbs (5 lb increments per hand)
    const perHandWeight = Math.round(targetWeight / 10) * 5;
    return `2x${perHandWeight}lb DBs`;
  }

  // Greedy algorithm: fill with largest plates first
  let remaining = targetWeight - BAR_WEIGHT;
  const plates: string[] = [];

  for (const plateSize of PLATE_SIZES) {
    let pairCount = 0;
    while (remaining >= plateSize * 2) {
      remaining -= plateSize * 2;
      pairCount++;
    }
    if (pairCount > 0) {
      // Show as plates per side (e.g., "45x1" means one 45 on each side)
      plates.push(`${plateSize}x${pairCount}`);
    }
  }

  return plates.length > 0 ? `Bar + ${plates.join(' + ')}` : 'Bar only';
}

/**
 * Calculate warmup sets for a target weight
 */
function calculateWarmupSets(targetWeight: number): { percent: number; weight: number; config: string }[] {
  return WARMUP_PERCENTAGES.map((pct) => ({
    percent: Math.round(pct * 100),
    weight: Math.round(targetWeight * pct),
    config: calculatePlateConfig(Math.round(targetWeight * pct)),
  }));
}

describe('lift plugin warmup calculator', () => {
  describe('calculatePlateConfig', () => {
    describe('dumbbell cases (weight < 45 lbs)', () => {
      it('should return dumbbells for weights under 45 lbs', () => {
        expect(calculatePlateConfig(40)).toBe('2x20lb DBs');
      });

      it('should round dumbbell weight to nearest 5 lbs', () => {
        expect(calculatePlateConfig(32)).toBe('2x15lb DBs');
        expect(calculatePlateConfig(38)).toBe('2x20lb DBs');
      });

      it('should handle very light weights', () => {
        expect(calculatePlateConfig(10)).toBe('2x5lb DBs');
        expect(calculatePlateConfig(20)).toBe('2x10lb DBs');
      });

      it('should handle edge case near 45 lbs', () => {
        expect(calculatePlateConfig(44)).toBe('2x20lb DBs');
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
        expect(calculatePlateConfig(50)).toBe('Bar + 2.5x1');
      });

      it('should calculate bar + 5 plates', () => {
        expect(calculatePlateConfig(55)).toBe('Bar + 5x1');
      });

      it('should calculate bar + 10 plates', () => {
        expect(calculatePlateConfig(65)).toBe('Bar + 10x1');
      });

      it('should calculate bar + 25 plates', () => {
        expect(calculatePlateConfig(95)).toBe('Bar + 25x1');
      });

      it('should calculate bar + 35 plates', () => {
        expect(calculatePlateConfig(115)).toBe('Bar + 35x1');
      });

      it('should calculate bar + 45 plates', () => {
        expect(calculatePlateConfig(135)).toBe('Bar + 45x1');
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
        expect(calculatePlateConfig(200)).toBe('Bar + 45x1 + 25x1 + 5x1 + 2.5x1');
      });

      it('should calculate 225 lbs correctly (common weight)', () => {
        // 225 - 45 = 180 remaining
        // 45: 180 >= 90? Yes, 180-90=90, count=1
        // 45: 90 >= 90? Yes, 90-90=0, count=2
        expect(calculatePlateConfig(225)).toBe('Bar + 45x2');
      });

      it('should calculate 315 lbs correctly (common weight)', () => {
        // 315 - 45 = 270 remaining
        // 45: 270 >= 90? Yes -> 180 -> 90 -> 0, count=3
        expect(calculatePlateConfig(315)).toBe('Bar + 45x3');
      });

      it('should calculate 135 lbs correctly (common weight)', () => {
        // 135 - 45 = 90 remaining
        // 45: 90 >= 90? Yes, 90-90=0, count=1
        expect(calculatePlateConfig(135)).toBe('Bar + 45x1');
      });

      it('should calculate 185 lbs correctly', () => {
        // 185 - 45 = 140 remaining
        // 45: 140 >= 90? Yes, 140-90=50, count=1
        // 25: 50 >= 50? Yes, 50-50=0, count=1
        expect(calculatePlateConfig(185)).toBe('Bar + 45x1 + 25x1');
      });

      it('should calculate 155 lbs correctly', () => {
        // 155 - 45 = 110 remaining
        // 45: 110 >= 90? Yes, 110-90=20, count=1
        // 10: 20 >= 20? Yes, 20-20=0, count=1
        expect(calculatePlateConfig(155)).toBe('Bar + 45x1 + 10x1');
      });
    });

    describe('edge cases', () => {
      it('should handle very heavy weights', () => {
        // 500 - 45 = 455 remaining
        // 45: 455 -> 365 -> 275 -> 185 -> 95 -> 5, count=5
        // 2.5: 5 >= 5? Yes, count=1
        expect(calculatePlateConfig(500)).toBe('Bar + 45x5 + 2.5x1');
      });

      it('should handle weights with remainders', () => {
        // 205 - 45 = 160 remaining
        // 45: 160 >= 90? Yes, 160-90=70, count=1
        // 35: 70 >= 70? Yes, 70-70=0, count=1
        expect(calculatePlateConfig(205)).toBe('Bar + 45x1 + 35x1');
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
      expect(sets[0]).toEqual({ percent: 40, weight: 80, config: 'Bar + 10x1 + 5x1 + 2.5x1' });
      // 60% of 200 = 120 lbs: 120 - 45 = 75 remaining
      // 35: 75 >= 70? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[1]).toEqual({ percent: 60, weight: 120, config: 'Bar + 35x1 + 2.5x1' });
      // 80% of 200 = 160 lbs: 160 - 45 = 115 remaining
      // 45: 115 >= 90? Yes -> 25, 10: 25 >= 20? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[2]).toEqual({ percent: 80, weight: 160, config: 'Bar + 45x1 + 10x1 + 2.5x1' });
      // 100% of 200 = 200 lbs: 200 - 45 = 155 remaining
      // 45: 155 >= 90? Yes -> 65, 25: 65 >= 50? Yes -> 15, 5: 15 >= 10? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[3]).toEqual({ percent: 100, weight: 200, config: 'Bar + 45x1 + 25x1 + 5x1 + 2.5x1' });
    });

    it('should calculate correct percentages for 315 lbs', () => {
      const sets = calculateWarmupSets(315);

      // 40% of 315 = 126 lbs: 126 - 45 = 81 remaining
      // 35: 81 >= 70? Yes -> 11, 5: 11 >= 10? Yes -> 1
      expect(sets[0]).toEqual({ percent: 40, weight: 126, config: 'Bar + 35x1 + 5x1' });
      // 60% of 315 = 189 lbs: 189 - 45 = 144 remaining
      // 45: 144 >= 90? Yes -> 54, 25: 54 >= 50? Yes -> 4
      expect(sets[1]).toEqual({ percent: 60, weight: 189, config: 'Bar + 45x1 + 25x1' });
      // 80% of 315 = 252 lbs: 252 - 45 = 207 remaining
      // 45: 207 >= 90? Yes -> 117 -> 27, count=2, 10: 27 >= 20? Yes -> 7, 2.5: 7 >= 5? Yes -> 2
      expect(sets[2]).toEqual({ percent: 80, weight: 252, config: 'Bar + 45x2 + 10x1 + 2.5x1' });
      // 100% of 315 = 315 lbs: 315 - 45 = 270 remaining
      // 45: 270 >= 90? Yes -> 180 -> 90 -> 0, count=3
      expect(sets[3]).toEqual({ percent: 100, weight: 315, config: 'Bar + 45x3' });
    });

    it('should handle light weights with dumbbells', () => {
      const sets = calculateWarmupSets(80);

      // 40% of 80 = 32 lbs -> dumbbells (round 32/10 = 3.2, round to 3, *5 = 15 per hand)
      expect(sets[0]).toEqual({ percent: 40, weight: 32, config: '2x15lb DBs' });
      // 60% of 80 = 48 lbs -> bar only (48 - 45 = 3, can't fit any plate pairs)
      expect(sets[1]).toEqual({ percent: 60, weight: 48, config: 'Bar only' });
      // 80% of 80 = 64 lbs: 64 - 45 = 19 remaining
      // 5: 19 >= 10? Yes -> 9, 2.5: 9 >= 5? Yes -> 4
      expect(sets[2]).toEqual({ percent: 80, weight: 64, config: 'Bar + 5x1 + 2.5x1' });
      // 100% of 80 = 80 lbs: 80 - 45 = 35 remaining
      // 10: 35 >= 20? Yes -> 15, 5: 15 >= 10? Yes -> 5, 2.5: 5 >= 5? Yes
      expect(sets[3]).toEqual({ percent: 100, weight: 80, config: 'Bar + 10x1 + 5x1 + 2.5x1' });
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
  });
});

/**
 * Tests for lift plugin unit conversion and preference system
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { WeightUnit } from '../../plugins.example/lift.js';

// =============================================================================
// Unit Conversion Functions
// =============================================================================

describe('unit conversions', () => {
  // Import will fail until we implement - that's the TDD red phase
  let lbsToKg: (lbs: number) => number;
  let kgToLbs: (kg: number) => number;
  let LBS_TO_KG: number;
  let KG_TO_LBS: number;

  beforeAll(async () => {
    const mod = await import('../../plugins.example/lift.js');
    lbsToKg = mod.lbsToKg;
    kgToLbs = mod.kgToLbs;
    LBS_TO_KG = mod.LBS_TO_KG;
    KG_TO_LBS = mod.KG_TO_LBS;
  });

  describe('constants', () => {
    it('should have correct conversion factors', () => {
      expect(LBS_TO_KG).toBeCloseTo(0.453592, 5);
      expect(KG_TO_LBS).toBeCloseTo(2.20462, 4);
    });

    it('should be reciprocals of each other', () => {
      expect(LBS_TO_KG * KG_TO_LBS).toBeCloseTo(1, 5);
    });
  });

  describe('lbsToKg', () => {
    it('should convert 0 lbs to 0 kg', () => {
      expect(lbsToKg(0)).toBe(0);
    });

    it('should convert 100 lbs to ~45.36 kg', () => {
      expect(lbsToKg(100)).toBeCloseTo(45.3592, 1);
    });

    it('should convert 225 lbs to ~102.06 kg', () => {
      expect(lbsToKg(225)).toBeCloseTo(102.058, 1);
    });

    it('should convert 1 lb to ~0.4536 kg', () => {
      expect(lbsToKg(1)).toBeCloseTo(0.4536, 3);
    });

    it('should handle decimal input', () => {
      expect(lbsToKg(2.5)).toBeCloseTo(1.134, 2);
    });
  });

  describe('kgToLbs', () => {
    it('should convert 0 kg to 0 lbs', () => {
      expect(kgToLbs(0)).toBe(0);
    });

    it('should convert 100 kg to ~220.46 lbs', () => {
      expect(kgToLbs(100)).toBeCloseTo(220.462, 1);
    });

    it('should convert 60 kg to ~132.28 lbs', () => {
      expect(kgToLbs(60)).toBeCloseTo(132.277, 1);
    });

    it('should convert 1 kg to ~2.205 lbs', () => {
      expect(kgToLbs(1)).toBeCloseTo(2.205, 2);
    });
  });

  describe('roundtrip conversions', () => {
    it('should roundtrip lbs -> kg -> lbs accurately', () => {
      const original = 225;
      const converted = kgToLbs(lbsToKg(original));
      expect(converted).toBeCloseTo(original, 1);
    });

    it('should roundtrip kg -> lbs -> kg accurately', () => {
      const original = 100;
      const converted = lbsToKg(kgToLbs(original));
      expect(converted).toBeCloseTo(original, 1);
    });
  });
});

// =============================================================================
// User Unit Preferences
// =============================================================================

/**
 * Create a mock DB that tracks stored preferences
 */
function createPrefsDb(): PluginDatabase & { _store: Map<string, string> } {
  const store = new Map<string, string>();

  const db = {
    prefix: 'plugin_lift_',
    _store: store,
    prepare: vi.fn((sql: string) => {
      if (sql.includes('INSERT OR REPLACE')) {
        return {
          run: vi.fn((...args: unknown[]) => {
            const [userId, unit] = args as [string, string];
            store.set(userId, unit);
            return { changes: 1 };
          }),
        };
      }
      if (sql.includes('SELECT') && sql.includes('user_prefs')) {
        return {
          get: vi.fn((...args: unknown[]) => {
            const [userId] = args as [string];
            const unit = store.get(userId);
            return unit ? { weight_unit: unit } : undefined;
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    }),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn()),
  } as unknown as PluginDatabase & { _store: Map<string, string> };

  return db;
}

describe('user unit preferences', () => {
  let getUserUnit: (userId: string, db: PluginDatabase) => WeightUnit;
  let setUserUnit: (userId: string, unit: WeightUnit, db: PluginDatabase) => void;

  beforeAll(async () => {
    const mod = await import('../../plugins.example/lift.js');
    getUserUnit = mod.getUserUnit;
    setUserUnit = mod.setUserUnit;
  });

  describe('getUserUnit', () => {
    it('should default to lbs when no preference set', () => {
      const db = createPrefsDb();
      expect(getUserUnit('U_NEW_USER', db)).toBe('lbs');
    });

    it('should return stored preference', () => {
      const db = createPrefsDb();
      db._store.set('U123', 'kg');
      expect(getUserUnit('U123', db)).toBe('kg');
    });

    it('should return lbs for stored lbs preference', () => {
      const db = createPrefsDb();
      db._store.set('U123', 'lbs');
      expect(getUserUnit('U123', db)).toBe('lbs');
    });
  });

  describe('setUserUnit', () => {
    it('should store lbs preference', () => {
      const db = createPrefsDb();
      setUserUnit('U123', 'lbs', db);
      expect(db._store.get('U123')).toBe('lbs');
    });

    it('should store kg preference', () => {
      const db = createPrefsDb();
      setUserUnit('U123', 'kg', db);
      expect(db._store.get('U123')).toBe('kg');
    });

    it('should overwrite existing preference', () => {
      const db = createPrefsDb();
      setUserUnit('U123', 'kg', db);
      setUserUnit('U123', 'lbs', db);
      expect(db._store.get('U123')).toBe('lbs');
    });

    it('should store preferences per user', () => {
      const db = createPrefsDb();
      setUserUnit('U1', 'kg', db);
      setUserUnit('U2', 'lbs', db);
      expect(db._store.get('U1')).toBe('kg');
      expect(db._store.get('U2')).toBe('lbs');
    });
  });
});

// =============================================================================
// Weight Display Helper
// =============================================================================

describe('formatWeight', () => {
  let formatWeight: (value: number, unit: WeightUnit) => string;

  beforeAll(async () => {
    const mod = await import('../../plugins.example/lift.js');
    formatWeight = mod.formatWeight;
  });

  it('should format lbs with 1 decimal', () => {
    expect(formatWeight(225, 'lbs')).toBe('225.0 lbs');
  });

  it('should format kg with 1 decimal', () => {
    expect(formatWeight(100, 'kg')).toBe('100.0 kg');
  });

  it('should format decimal values', () => {
    expect(formatWeight(102.058, 'kg')).toBe('102.1 kg');
    expect(formatWeight(225.5, 'lbs')).toBe('225.5 lbs');
  });
});

// =============================================================================
// Command Integration: Wilks/DOTS/1RM with Units
// =============================================================================

describe('calculator commands with unit preferences', () => {
  let lbsToKg: (lbs: number) => number;
  let kgToLbs: (kg: number) => number;

  beforeAll(async () => {
    const mod = await import('../../plugins.example/lift.js');
    lbsToKg = mod.lbsToKg;
    kgToLbs = mod.kgToLbs;
  });

  describe('wilks/dots input conversion', () => {
    it('should pass through kg values when unit is kg', () => {
      // User inputs 500 kg, unit is kg -> calculation gets 500 kg
      const inputKg = 500;
      const unit: WeightUnit = 'kg';
      const calcKg = unit === 'kg' ? inputKg : lbsToKg(inputKg);
      expect(calcKg).toBe(500);
    });

    it('should convert lbs to kg when unit is lbs', () => {
      // User inputs 1102 lbs, unit is lbs -> calculation gets ~500 kg
      const inputLbs = 1102;
      const unit: WeightUnit = 'lbs';
      const calcKg = unit === 'kg' ? inputLbs : lbsToKg(inputLbs);
      expect(calcKg).toBeCloseTo(500, 0);
    });
  });

  describe('1rm output conversion', () => {
    it('should show result in kg when unit is kg', () => {
      // 1RM calculated as 120 kg -> display 120 kg
      const resultKg = 120;
      const unit: WeightUnit = 'kg';
      const display = unit === 'kg' ? resultKg : kgToLbs(resultKg);
      expect(display).toBe(120);
    });

    it('should show result in lbs when unit is lbs', () => {
      // 1RM calculated as 120 kg -> display ~264.6 lbs
      const resultKg = 120;
      const unit: WeightUnit = 'lbs';
      const display = unit === 'kg' ? resultKg : kgToLbs(resultKg);
      expect(display).toBeCloseTo(264.6, 0);
    });
  });

  describe('warmup with kg input', () => {
    it('should convert kg input to lbs for plate loading', () => {
      // User inputs 100 kg for warmup with kg unit -> 220.5 lbs for plate calc
      const inputKg = 100;
      const lbsForCalc = kgToLbs(inputKg);
      expect(lbsForCalc).toBeCloseTo(220.5, 0);
    });
  });
});

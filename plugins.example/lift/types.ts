/**
 * Lift Plugin — Shared Types and Constants
 *
 * All interfaces, type aliases, and constants used across lift modules.
 */

// =============================================================================
// Weight Units
// =============================================================================

export type WeightUnit = 'lbs' | 'kg';

// =============================================================================
// Database Types
// =============================================================================

/**
 * Macro totals for display
 */
export interface MacroTotals {
  carbs: number;
  protein: number;
  fat: number;
  entries: number;
}

/**
 * Query specification for viewing macro data
 */
export interface QuerySpec {
  type: 'today' | 'relative' | 'date' | 'range';
  daysAgo?: number;
  date?: Date;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Pending macro estimate from image analysis
 */
export interface PendingEstimate {
  id: number;
  user_id: string;
  channel_id: string;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  food_description: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  created_at: number;
  expires_at: number;
}

/**
 * Result from Claude vision macro estimation
 */
export interface MacroEstimateResult {
  food_description: string;
  estimated_carbs_g: number;
  estimated_protein_g: number;
  estimated_fat_g: number;
  confidence: 'high' | 'medium' | 'low';
  reference_object_used?: string;
  notes?: string;
}

// =============================================================================
// Workout Types
// =============================================================================

export interface WorkoutSet {
  id: number;
  exercise: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  loggedAt: number;
}

export interface PersonalRecord {
  exercise: string;
  weightKg: number;
  reps: number;
  estimated1rmKg: number;
  loggedAt: number;
}

// =============================================================================
// Plate Calculator Constants
// =============================================================================

export const BAR_WEIGHT = 45; // lbs
export const PLATE_SIZES = [45, 35, 25, 10, 5, 2.5] as const; // descending order
export const HOME_PLATE_SIZES = [55, 45, 35, 25, 15, 10, 5, 5, 2.5, 1.25] as const; // 5 appears twice (2 pairs)
export const HOME_LIGHT_PLATE_SIZES = [25, 15, 10, 5, 2.5, 1.25] as const; // plates that fit on 5lb bar
export const WARMUP_PERCENTAGES = [0.4, 0.6, 0.8, 1.0] as const;

/** Common barbell exercises for quick-log suggestions */
export const EXERCISE_PRESETS = [
  'deadlift', 'squat', 'bench press', 'overhead press',
  'power clean', 'barbell row', 'chin ups',
  'barbell curl', 'barbell tricep extension',
] as const;
export const MAX_TARGET_WEIGHT = 1000; // lbs - safety limit to prevent unbounded output

export interface PlateConfig {
  readonly label: string;
  readonly plateSizes: readonly number[];
  readonly singlePairOnly: boolean;
  readonly barWeight: number;
  readonly lightBar?: {
    readonly weight: number;
    readonly threshold: number;
    readonly plateSizes: readonly number[];
  };
}

export const GYM_PLATES: PlateConfig = {
  label: 'Warmup',
  plateSizes: PLATE_SIZES,
  singlePairOnly: false,
  barWeight: BAR_WEIGHT,
};

export const HOME_PLATES: PlateConfig = {
  label: 'Home Warmup',
  plateSizes: HOME_PLATE_SIZES,
  singlePairOnly: true,
  barWeight: BAR_WEIGHT,
  lightBar: {
    weight: 5,
    threshold: BAR_WEIGHT,
    plateSizes: HOME_LIGHT_PLATE_SIZES,
  },
};

// =============================================================================
// Slack API Types
// =============================================================================

/**
 * Slack client interface for API calls
 */
export interface SlackClient {
  users: {
    info: (params: { user: string }) => Promise<{
      ok: boolean;
      user?: { tz?: string; tz_offset?: number };
    }>;
  };
  conversations: {
    history: (params: { channel: string; limit?: number }) => Promise<{
      ok: boolean;
      messages?: Array<{
        type: string;
        ts: string;
        user?: string;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          url_private_download?: string;
        }>;
      }>;
    }>;
  };
}

/**
 * Result from finding an image in channel
 */
export interface FoundImage {
  url: string;
  filename: string;
  mimetype: string;
}

// =============================================================================
// Food Analysis Constants
// =============================================================================

// Pending estimate expiration (15 minutes)
export const PENDING_ESTIMATE_TTL = 15 * 60 * 1000;

/**
 * Food analysis system prompt for Claude
 * Used when analyzing food images via /lift a
 */
export const FOOD_ANALYSIS_PROMPT = `
You are a nutrition expert analyzing food images to estimate macronutrients.

When analyzing food images:
1. Identify all food items visible in the image
2. Estimate portion sizes using reference objects (plates, utensils, hands) if visible
3. Estimate macronutrients: carbohydrates, protein, and fat in grams
4. Consider cooking methods and hidden ingredients (oils, sauces, etc.)
5. Be conservative - it's better to slightly underestimate than overestimate

Use the estimate_food_macros tool to provide a structured estimate.

Confidence levels:
- high: Clear image, standard portions, identifiable foods
- medium: Some obscured items, non-standard portions, or mixed dishes
- low: Poor image quality, unusual foods, or significant uncertainty
`;

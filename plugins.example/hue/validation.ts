/**
 * Zod validation schemas for all Hue tool inputs.
 */

import { z } from 'zod';

// =============================================================================
// Shared Schemas
// =============================================================================

const colorInput = z.string().min(1, 'Color is required');
const targetName = z.string().min(1, 'Target name is required');
const brightness = z.number().int().min(0).max(100);
const positiveInt = z.number().int().positive();

// =============================================================================
// Control Tool Schemas
// =============================================================================

export const ControlLightSchema = z.object({
  target: targetName,
  action: z.enum(['on', 'off', 'dim', 'color']),
  brightness: brightness.optional(),
  color_name: colorInput.optional(),
});

export const ActivateSceneSchema = z.object({
  scene_name: z.string().min(1, 'Scene name is required'),
});

// =============================================================================
// Effect Tool Schemas
// =============================================================================

export const FlashEffectSchema = z.object({
  target: targetName,
  color: colorInput.optional().default('#FFFFFF'),
  flash_count: positiveInt.optional().default(3),
  flash_duration_ms: positiveInt.optional().default(200),
});

export const PulseEffectSchema = z.object({
  target: targetName,
  min_brightness: brightness.optional().default(10),
  max_brightness: brightness.optional().default(100),
  pulse_count: positiveInt.optional().default(5),
  pulse_duration_ms: positiveInt.optional().default(2000),
});

export const ColorLoopSchema = z.object({
  target: targetName,
  colors: z.array(colorInput).min(2).optional(),
  transition_ms: positiveInt.optional().default(1000),
  loop: z.boolean().optional().default(true),
});

export const StrobeEffectSchema = z.object({
  target: targetName,
  color: colorInput.optional().default('#FFFFFF'),
  strobe_rate_ms: z.number().int().min(50).optional().default(100),
  duration_ms: positiveInt.optional().default(5000),
});

export const AlertEffectSchema = z.object({
  target: targetName,
  alert_color: colorInput.optional().default('#FF0000'),
  normal_color: colorInput.optional().default('#FFFFFF'),
});

export const FadeEffectSchema = z.object({
  target: targetName,
  start_color: colorInput.optional(),
  end_color: colorInput.optional(),
  start_brightness: brightness.optional(),
  end_brightness: brightness.optional(),
  duration_ms: positiveInt.optional().default(3000),
  steps: z.number().int().min(2).max(100).optional().default(20),
});

export const StopSequenceSchema = z.object({
  sequence_id: z.string().min(1, 'Sequence ID is required (or "all")'),
});

// =============================================================================
// Sequence / Batch Schemas
// =============================================================================

export const SequenceStepSchema = z.object({
  action: z.enum(['on', 'off', 'color', 'brightness', 'scene']),
  target: z.string().min(1),
  value: z.string().optional(),
  delay_ms: z.number().int().min(0).optional(),
});

export const CustomSequenceSchema = z.object({
  steps: z.array(SequenceStepSchema).min(1, 'At least one step is required'),
  loop: z.boolean().optional().default(false),
  name: z.string().optional(),
});

export const BatchCommandsSchema = z.object({
  commands: z.array(SequenceStepSchema).min(1, 'At least one command is required'),
  delay_ms: positiveInt.optional().default(100),
  async: z.boolean().optional().default(true),
  cache_name: z.string().optional(),
  cache_description: z.string().optional(),
});

// =============================================================================
// Scene CRUD Schemas
// =============================================================================

export const CreateSceneSchema = z.object({
  name: z.string().min(1, 'Scene name is required'),
  room_name: z.string().min(1, 'Room name is required'),
});

export const UpdateSceneSchema = z.object({
  scene_name: z.string().min(1, 'Scene name is required'),
  new_name: z.string().min(1).optional(),
});

export const DeleteSceneSchema = z.object({
  scene_name: z.string().min(1, 'Scene name is required'),
});

// =============================================================================
// Query Schemas
// =============================================================================

export const GetLightStateSchema = z.object({
  light_name: z.string().min(1, 'Light name is required'),
});

export const GetDeviceSchema = z.object({
  device_name: z.string().min(1, 'Device name is required'),
});

// =============================================================================
// Custom Scene Cache Schemas
// =============================================================================

export const RecallCustomSceneSchema = z.object({
  name: z.string().min(1, 'Scene name is required'),
});

export const ClearCustomSceneSchema = z.object({
  name: z.string().min(1, 'Scene name is required'),
});

// =============================================================================
// Validation Helper
// =============================================================================

/**
 * Validate input against a Zod schema. Returns the parsed value or an error string.
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  return { success: false, error: messages.join('; ') };
}

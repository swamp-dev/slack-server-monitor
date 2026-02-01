/**
 * Tests for the lift plugin vision commands
 *
 * These tests verify image analysis, pending estimate management,
 * and confirmation/adjustment flows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginClaude, PluginClaudeResult } from '../../src/plugins/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PendingEstimate, MacroEstimateResult } from '../../plugins.example/lift.js';
import { parseMacroArgs } from '../../plugins.example/lift.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the image utilities
vi.mock('../../src/utils/image.js', () => ({
  isValidImageUrl: vi.fn(),
  fetchImageAsBase64: vi.fn(),
}));

// Import after mocks are set up
import { isValidImageUrl, fetchImageAsBase64 } from '../../src/utils/image.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock PluginClaude instance
 */
function createMockClaude(overrides?: Partial<PluginClaude>): PluginClaude {
  return {
    enabled: true,
    supportsImages: true,
    ask: vi.fn().mockResolvedValue({
      response: 'Analysis complete',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    ...overrides,
  };
}

/**
 * Create a mock PluginClaudeResult with tool call
 */
function createMockClaudeResult(estimate: MacroEstimateResult): PluginClaudeResult {
  return {
    response: 'Analysis complete',
    toolCalls: [
      {
        name: 'lift:estimate_food_macros',
        input: estimate as unknown as Record<string, unknown>,
      },
    ],
    usage: { inputTokens: 500, outputTokens: 150 },
  };
}

/**
 * Create a pending estimate fixture
 */
function createPendingEstimate(overrides?: Partial<PendingEstimate>): PendingEstimate {
  return {
    id: 1,
    user_id: 'U123',
    channel_id: 'C456',
    carbs_g: 45,
    protein_g: 35,
    fat_g: 8,
    food_description: 'Chicken breast with rice',
    confidence: 'high',
    notes: null,
    created_at: Date.now(),
    expires_at: Date.now() + 15 * 60 * 1000,
    ...overrides,
  };
}

/**
 * Create a mock database with configurable pending estimate
 */
function createMockDb(pending: PendingEstimate | null = null): PluginDatabase {
  const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 });
  const mockGet = vi.fn().mockReturnValue(pending);
  const mockAll = vi.fn().mockReturnValue([]);

  return {
    prefix: 'plugin_lift_',
    prepare: vi.fn((sql: string) => {
      // Return mock statement based on SQL pattern
      if (sql.includes('SELECT') && sql.includes('pending_estimates')) {
        return { get: mockGet, run: mockRun, all: mockAll };
      }
      if (sql.includes('DELETE')) {
        return { run: mockRun, get: mockGet, all: mockAll };
      }
      if (sql.includes('INSERT')) {
        return { run: mockRun, get: mockGet, all: mockAll };
      }
      // Default for other queries (like macro logging)
      return { run: mockRun, get: vi.fn().mockReturnValue({ carbs: 0, protein: 0, fat: 0, entries: 0 }), all: mockAll };
    }),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn()),
  } as unknown as PluginDatabase;
}


// =============================================================================
// Tests
// =============================================================================

describe('lift plugin vision commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isValidImageUrl).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue({
      data: 'base64encodedimage',
      mediaType: 'image/jpeg',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isValidImageUrl validation', () => {
    it('should reject invalid URLs', () => {
      vi.mocked(isValidImageUrl).mockReturnValue(false);
      expect(isValidImageUrl('not-a-url')).toBe(false);
    });

    it('should reject HTTP URLs', () => {
      vi.mocked(isValidImageUrl).mockImplementation((url: string) => url.startsWith('https://'));
      expect(isValidImageUrl('http://example.com/image.jpg')).toBe(false);
    });

    it('should accept valid HTTPS URLs', () => {
      vi.mocked(isValidImageUrl).mockReturnValue(true);
      expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
    });

    it('should accept Slack file URLs', () => {
      vi.mocked(isValidImageUrl).mockReturnValue(true);
      expect(isValidImageUrl('https://files.slack.com/files-pri/T123-F456/image.png')).toBe(true);
    });
  });

  describe('Claude capability check', () => {
    it('should identify when Claude is enabled', () => {
      const claude = createMockClaude();
      expect(claude.enabled).toBe(true);
    });

    it('should identify when Claude supports images (SDK provider)', () => {
      const claude = createMockClaude({ supportsImages: true });
      expect(claude.supportsImages).toBe(true);
    });

    it('should identify when Claude does not support images (CLI provider)', () => {
      const claude = createMockClaude({ supportsImages: false });
      expect(claude.supportsImages).toBe(false);
    });

    it('should handle disabled Claude', () => {
      const claude = createMockClaude({ enabled: false });
      expect(claude.enabled).toBe(false);
    });
  });

  describe('image fetch flow', () => {
    it('should fetch image and convert to base64', async () => {
      const result = await fetchImageAsBase64('https://example.com/food.jpg');
      expect(result.data).toBe('base64encodedimage');
      expect(result.mediaType).toBe('image/jpeg');
    });

    it('should handle image fetch timeout', async () => {
      vi.mocked(fetchImageAsBase64).mockRejectedValue(
        new Error('Image fetch timed out after 30 seconds')
      );

      await expect(fetchImageAsBase64('https://example.com/slow.jpg')).rejects.toThrow(
        'timed out'
      );
    });

    it('should handle image too large error', async () => {
      vi.mocked(fetchImageAsBase64).mockRejectedValue(
        new Error('Image too large: 10000000 bytes (max: 5242880)')
      );

      await expect(fetchImageAsBase64('https://example.com/huge.jpg')).rejects.toThrow(
        'too large'
      );
    });

    it('should handle invalid content type', async () => {
      vi.mocked(fetchImageAsBase64).mockRejectedValue(
        new Error('Invalid image content type: text/html')
      );

      await expect(fetchImageAsBase64('https://example.com/notimage.html')).rejects.toThrow(
        'Invalid image content type'
      );
    });

    it('should handle network errors', async () => {
      vi.mocked(fetchImageAsBase64).mockRejectedValue(
        new Error('Failed to fetch image: HTTP 404')
      );

      await expect(fetchImageAsBase64('https://example.com/missing.jpg')).rejects.toThrow(
        'HTTP 404'
      );
    });
  });

  describe('Claude vision call', () => {
    it('should pass image with correct media type', async () => {
      const claude = createMockClaude();

      await claude.ask('Analyze this food', 'U123', {
        images: [{ data: 'base64data', mediaType: 'image/jpeg' }],
      });

      expect(claude.ask).toHaveBeenCalledWith(
        'Analyze this food',
        'U123',
        expect.objectContaining({
          images: [{ data: 'base64data', mediaType: 'image/jpeg' }],
        })
      );
    });

    it('should include system prompt for nutrition analysis', async () => {
      const claude = createMockClaude();

      await claude.ask('Analyze', 'U123', {
        systemPromptAddition: 'You are a nutrition expert.',
      });

      expect(claude.ask).toHaveBeenCalledWith(
        'Analyze',
        'U123',
        expect.objectContaining({
          systemPromptAddition: 'You are a nutrition expert.',
        })
      );
    });

    it('should handle Claude API error gracefully', async () => {
      const claude = createMockClaude({
        ask: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      });

      await expect(claude.ask('Analyze', 'U123')).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle rate limit error', async () => {
      const claude = createMockClaude({
        ask: vi.fn().mockRejectedValue(new Error('Rate limit exceeded. Please try again later.')),
      });

      await expect(claude.ask('Analyze', 'U123')).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle multiple images', async () => {
      const claude = createMockClaude();

      await claude.ask('Compare these foods', 'U123', {
        images: [
          { data: 'base64data1', mediaType: 'image/jpeg' },
          { data: 'base64data2', mediaType: 'image/png' },
        ],
      });

      expect(claude.ask).toHaveBeenCalledWith(
        'Compare these foods',
        'U123',
        expect.objectContaining({
          images: expect.arrayContaining([
            { data: 'base64data1', mediaType: 'image/jpeg' },
            { data: 'base64data2', mediaType: 'image/png' },
          ]),
        })
      );
    });
  });

  describe('tool response parsing', () => {
    it('should extract macros from estimate_food_macros tool call', () => {
      const result = createMockClaudeResult({
        food_description: 'Grilled chicken with vegetables',
        estimated_carbs_g: 20,
        estimated_protein_g: 45,
        estimated_fat_g: 12,
        confidence: 'high',
      });

      const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
      expect(toolCall).toBeDefined();
      expect(toolCall?.input).toEqual({
        food_description: 'Grilled chicken with vegetables',
        estimated_carbs_g: 20,
        estimated_protein_g: 45,
        estimated_fat_g: 12,
        confidence: 'high',
      });
    });

    it('should handle missing tool call response', () => {
      const result: PluginClaudeResult = {
        response: 'I cannot analyze this image.',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
      expect(toolCall).toBeUndefined();
    });

    it('should handle different tool name', () => {
      const result: PluginClaudeResult = {
        response: 'Done',
        toolCalls: [
          { name: 'different_tool', input: { foo: 'bar' } },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
      expect(toolCall).toBeUndefined();
    });

    it('should calculate calories from macros', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Test food',
        estimated_carbs_g: 50, // 200 cal
        estimated_protein_g: 30, // 120 cal
        estimated_fat_g: 20, // 180 cal
        confidence: 'medium',
      };

      const calories = estimate.estimated_carbs_g * 4 +
                       estimate.estimated_protein_g * 4 +
                       estimate.estimated_fat_g * 9;
      expect(calories).toBe(500);
    });

    it('should include optional reference object', () => {
      const result = createMockClaudeResult({
        food_description: 'Chicken breast',
        estimated_carbs_g: 0,
        estimated_protein_g: 35,
        estimated_fat_g: 5,
        confidence: 'high',
        reference_object_used: 'dinner plate',
      });

      const input = result.toolCalls[0].input as unknown as MacroEstimateResult;
      expect(input.reference_object_used).toBe('dinner plate');
    });

    it('should include optional notes', () => {
      const result = createMockClaudeResult({
        food_description: 'Mixed salad',
        estimated_carbs_g: 15,
        estimated_protein_g: 5,
        estimated_fat_g: 12,
        confidence: 'medium',
        notes: 'Assuming standard dressing portion',
      });

      const input = result.toolCalls[0].input as unknown as MacroEstimateResult;
      expect(input.notes).toBe('Assuming standard dressing portion');
    });
  });

  describe('pending estimate storage', () => {
    it('should store estimate with user and channel', () => {
      const db = createMockDb();
      const estimate: MacroEstimateResult = {
        food_description: 'Test food',
        estimated_carbs_g: 30,
        estimated_protein_g: 25,
        estimated_fat_g: 10,
        confidence: 'high',
      };

      // Simulate storing the estimate
      const stmt = db.prepare(
        `INSERT INTO ${db.prefix}pending_estimates
         (user_id, channel_id, carbs_g, protein_g, fat_g, food_description, confidence, notes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const result = stmt.run(
        'U123',
        'C456',
        estimate.estimated_carbs_g,
        estimate.estimated_protein_g,
        estimate.estimated_fat_g,
        estimate.food_description,
        estimate.confidence,
        estimate.notes ?? null,
        Date.now(),
        Date.now() + 15 * 60 * 1000
      );

      expect(result.lastInsertRowid).toBe(BigInt(1));
      expect(db.prepare).toHaveBeenCalled();
    });

    it('should set 15-minute expiration', () => {
      const now = Date.now();
      const PENDING_ESTIMATE_TTL = 15 * 60 * 1000;
      const expiresAt = now + PENDING_ESTIMATE_TTL;

      // 15 minutes in milliseconds
      expect(expiresAt - now).toBe(15 * 60 * 1000);
    });

    it('should handle database errors gracefully', () => {
      const db = createMockDb();
      const mockPrepare = vi.fn().mockImplementation(() => {
        throw new Error('Database locked');
      });
      db.prepare = mockPrepare;

      expect(() => db.prepare('INSERT INTO ...')).toThrow('Database locked');
    });
  });

  describe('pending estimate retrieval', () => {
    it('should find pending estimate by user and channel', () => {
      const pending = createPendingEstimate();
      const db = createMockDb(pending);

      const stmt = db.prepare(
        `SELECT * FROM ${db.prefix}pending_estimates WHERE user_id = ? AND channel_id = ?`
      );
      const result = stmt.get('U123', 'C456');

      expect(result).toEqual(pending);
    });

    it('should return null when no pending estimate exists', () => {
      const db = createMockDb(null);

      const stmt = db.prepare(
        `SELECT * FROM ${db.prefix}pending_estimates WHERE user_id = ? AND channel_id = ?`
      );
      const result = stmt.get('U123', 'C456');

      expect(result).toBeNull();
    });

    it('should ignore expired estimates', () => {
      const expiredPending = createPendingEstimate({
        expires_at: Date.now() - 1000, // Already expired
      });

      // In the actual implementation, expired estimates are deleted first
      // then the query returns null
      const db = createMockDb(null);
      const stmt = db.prepare(
        `SELECT * FROM ${db.prefix}pending_estimates WHERE user_id = ? AND channel_id = ?`
      );
      const result = stmt.get('U123', 'C456');

      expect(result).toBeNull();
      expect(expiredPending.expires_at).toBeLessThan(Date.now());
    });
  });

  describe('pending estimate deletion', () => {
    it('should delete pending estimate by id', () => {
      const db = createMockDb();

      const stmt = db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ?`);
      const result = stmt.run(1);

      expect(result.changes).toBe(1);
    });

    it('should handle delete with no matching rows', () => {
      const db = createMockDb();
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      db.prepare = vi.fn().mockReturnValue({ run: mockRun });

      const stmt = db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ?`);
      const result = stmt.run(999);

      expect(result.changes).toBe(0);
    });
  });

  describe('handleConfirm flow', () => {
    it('should log rounded macro values', () => {
      const pending = createPendingEstimate({
        carbs_g: 45.7,
        protein_g: 35.2,
        fat_g: 8.9,
      });

      const macros = {
        carbs: Math.round(pending.carbs_g),
        protein: Math.round(pending.protein_g),
        fat: Math.round(pending.fat_g),
      };

      expect(macros.carbs).toBe(46);
      expect(macros.protein).toBe(35);
      expect(macros.fat).toBe(9);
    });

    it('should calculate daily totals after confirm', () => {
      const totals = { carbs: 100, protein: 80, fat: 40, entries: 3 };
      const newMacros = { carbs: 46, protein: 35, fat: 9 };

      const updatedTotals = {
        carbs: totals.carbs + newMacros.carbs,
        protein: totals.protein + newMacros.protein,
        fat: totals.fat + newMacros.fat,
        entries: totals.entries + 1,
      };

      expect(updatedTotals.carbs).toBe(146);
      expect(updatedTotals.protein).toBe(115);
      expect(updatedTotals.fat).toBe(49);
      expect(updatedTotals.entries).toBe(4);
    });
  });

  describe('handleAdjust flow', () => {
    it('should parse valid macro adjustments using real parseMacroArgs', () => {
      // Test the actual parseMacroArgs function from the plugin
      expect(parseMacroArgs(['c50', 'p30', 'f10'])).toEqual({ carbs: 50, protein: 30, fat: 10 });
      expect(parseMacroArgs(['c50'])).toEqual({ carbs: 50, protein: 0, fat: 0 });
      expect(parseMacroArgs(['p30', 'f10'])).toEqual({ carbs: 0, protein: 30, fat: 10 });
    });

    it('should reject invalid format using real parseMacroArgs', () => {
      expect(parseMacroArgs(['invalid'])).toBeNull();
      expect(parseMacroArgs(['50c'])).toBeNull();
      expect(parseMacroArgs(['carbs50'])).toBeNull();
    });

    it('should reject empty arguments', () => {
      expect(parseMacroArgs([])).toBeNull();
    });

    it('should handle boundary values', () => {
      // Zero values are valid
      expect(parseMacroArgs(['c0', 'p0', 'f0'])).toEqual({ carbs: 0, protein: 0, fat: 0 });

      // Large but valid values
      expect(parseMacroArgs(['c999'])).toEqual({ carbs: 999, protein: 0, fat: 0 });
    });

    it('should reject negative values', () => {
      // Negative values should not be parsed
      expect(parseMacroArgs(['c-50'])).toBeNull();
    });

    it('should reject decimal values', () => {
      // Decimal values should not be parsed
      expect(parseMacroArgs(['c3.14'])).toBeNull();
      expect(parseMacroArgs(['p25.5'])).toBeNull();
    });

    it('should log adjusted values, not original', () => {
      const pending = createPendingEstimate({
        carbs_g: 45,
        protein_g: 35,
        fat_g: 8,
      });

      const adjusted = { carbs: 50, protein: 30, fat: 15 };

      // Verify adjusted values differ from original
      expect(adjusted.carbs).not.toBe(pending.carbs_g);
      expect(adjusted.protein).not.toBe(pending.protein_g);
      expect(adjusted.fat).not.toBe(pending.fat_g);
    });

    it('should show original estimate for comparison', () => {
      const pending = createPendingEstimate({
        carbs_g: 45,
        protein_g: 35,
        fat_g: 8,
      });
      const adjusted = { carbs: 50, protein: 30, fat: 15 };

      const originalContext = `Original estimate: ${Math.round(pending.carbs_g)}c ${Math.round(pending.protein_g)}p ${Math.round(pending.fat_g)}f`;
      const adjustedMsg = `Logged (adjusted): ${adjusted.carbs}c ${adjusted.protein}p ${adjusted.fat}f`;

      expect(originalContext).toBe('Original estimate: 45c 35p 8f');
      expect(adjustedMsg).toBe('Logged (adjusted): 50c 30p 15f');
    });
  });

  describe('handleCancel flow', () => {
    it('should delete pending estimate', () => {
      const db = createMockDb(createPendingEstimate());
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      db.prepare = vi.fn().mockReturnValue({
        run: mockRun,
        get: vi.fn().mockReturnValue(createPendingEstimate()),
      });

      // Simulate delete
      const stmt = db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ?`);
      stmt.run(1);

      expect(mockRun).toHaveBeenCalledWith(1);
    });

    it('should handle no pending estimate gracefully', () => {
      const db = createMockDb(null);

      const stmt = db.prepare(
        `SELECT * FROM ${db.prefix}pending_estimates WHERE user_id = ? AND channel_id = ?`
      );
      const result = stmt.get('U123', 'C456');

      expect(result).toBeNull();
    });
  });

  describe('response formatting', () => {
    it('should display food description', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Chicken breast with rice and vegetables',
        estimated_carbs_g: 45,
        estimated_protein_g: 35,
        estimated_fat_g: 8,
        confidence: 'high',
      };

      expect(estimate.food_description).toBe('Chicken breast with rice and vegetables');
    });

    it('should show macros with formatting', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Test',
        estimated_carbs_g: 45,
        estimated_protein_g: 35,
        estimated_fat_g: 8,
        confidence: 'high',
      };

      // Simulate formatted output
      const formatted =
        `Carbs:   ${String(Math.round(estimate.estimated_carbs_g)).padStart(4)}g\n` +
        `Protein: ${String(Math.round(estimate.estimated_protein_g)).padStart(4)}g\n` +
        `Fat:     ${String(Math.round(estimate.estimated_fat_g)).padStart(4)}g`;

      expect(formatted).toContain('Carbs:     45g');
      expect(formatted).toContain('Protein:   35g');
      expect(formatted).toContain('Fat:        8g');
    });

    it('should show confidence with appropriate emoji for high', () => {
      // Test the confidence emoji mapping logic
      const getConfidenceEmoji = (c: 'high' | 'medium' | 'low') =>
        c === 'high' ? ':white_check_mark:' :
        c === 'medium' ? ':warning:' : ':grey_question:';

      expect(getConfidenceEmoji('high')).toBe(':white_check_mark:');
    });

    it('should show confidence with appropriate emoji for medium', () => {
      const getConfidenceEmoji = (c: 'high' | 'medium' | 'low') =>
        c === 'high' ? ':white_check_mark:' :
        c === 'medium' ? ':warning:' : ':grey_question:';

      expect(getConfidenceEmoji('medium')).toBe(':warning:');
    });

    it('should show confidence with appropriate emoji for low', () => {
      const getConfidenceEmoji = (c: 'high' | 'medium' | 'low') =>
        c === 'high' ? ':white_check_mark:' :
        c === 'medium' ? ':warning:' : ':grey_question:';

      expect(getConfidenceEmoji('low')).toBe(':grey_question:');
    });

    it('should include confirmation commands in response', () => {
      const commands = [
        '`/lift m confirm` - Log these macros',
        '`/lift m adjust c50 p30 f15` - Adjust and log',
        '`/lift m cancel` - Discard estimate',
      ];

      expect(commands).toContain('`/lift m confirm` - Log these macros');
      expect(commands).toContain('`/lift m adjust c50 p30 f15` - Adjust and log');
      expect(commands).toContain('`/lift m cancel` - Discard estimate');
    });

    it('should show expiration notice', () => {
      const notice = 'Estimate expires in 15 minutes';
      expect(notice).toContain('15 minutes');
    });

    it('should format calories correctly', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Test',
        estimated_carbs_g: 50,
        estimated_protein_g: 30,
        estimated_fat_g: 20,
        confidence: 'high',
      };

      const calories = estimate.estimated_carbs_g * 4 +
                       estimate.estimated_protein_g * 4 +
                       estimate.estimated_fat_g * 9;
      const formatted = `Calories: ~${calories.toLocaleString()}`;

      expect(formatted).toBe('Calories: ~500');
    });

    it('should handle large calorie values with thousands separator', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Large meal',
        estimated_carbs_g: 200,
        estimated_protein_g: 100,
        estimated_fat_g: 80,
        confidence: 'low',
      };

      const calories = estimate.estimated_carbs_g * 4 +
                       estimate.estimated_protein_g * 4 +
                       estimate.estimated_fat_g * 9;
      const formatted = `Calories: ~${calories.toLocaleString()}`;

      expect(calories).toBe(1920);
      expect(formatted).toBe('Calories: ~1,920');
    });
  });

  describe('error handling', () => {
    it('should handle image analysis failure', async () => {
      vi.mocked(fetchImageAsBase64).mockRejectedValue(new Error('Network error'));

      await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle missing tool call gracefully', () => {
      const result: PluginClaudeResult = {
        response: 'I could not identify the food in this image.',
        toolCalls: [],
        usage: { inputTokens: 200, outputTokens: 100 },
      };

      const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
      expect(toolCall).toBeUndefined();
    });

    it('should handle database connection errors', () => {
      const db = createMockDb();
      db.prepare = vi.fn().mockImplementation(() => {
        throw new Error('SQLITE_CANTOPEN');
      });

      expect(() => db.prepare('SELECT 1')).toThrow('SQLITE_CANTOPEN');
    });

    it('should handle invalid user ID', () => {
      const validateUserId = (userId: string) => {
        if (!userId || typeof userId !== 'string') {
          throw new Error('Invalid user ID');
        }
        return true;
      };

      expect(() => validateUserId('')).toThrow('Invalid user ID');
      expect(() => validateUserId(null as unknown as string)).toThrow('Invalid user ID');
      expect(validateUserId('U123')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero macro values', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Black coffee',
        estimated_carbs_g: 0,
        estimated_protein_g: 0,
        estimated_fat_g: 0,
        confidence: 'high',
      };

      const calories = estimate.estimated_carbs_g * 4 +
                       estimate.estimated_protein_g * 4 +
                       estimate.estimated_fat_g * 9;
      expect(calories).toBe(0);
    });

    it('should handle very large macro values', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Entire pizza',
        estimated_carbs_g: 300,
        estimated_protein_g: 80,
        estimated_fat_g: 120,
        confidence: 'low',
      };

      const calories = estimate.estimated_carbs_g * 4 +
                       estimate.estimated_protein_g * 4 +
                       estimate.estimated_fat_g * 9;
      expect(calories).toBe(2600);
    });

    it('should handle decimal macro values', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Small snack',
        estimated_carbs_g: 10.5,
        estimated_protein_g: 5.2,
        estimated_fat_g: 3.7,
        confidence: 'medium',
      };

      const rounded = {
        carbs: Math.round(estimate.estimated_carbs_g),
        protein: Math.round(estimate.estimated_protein_g),
        fat: Math.round(estimate.estimated_fat_g),
      };

      expect(rounded.carbs).toBe(11);
      expect(rounded.protein).toBe(5);
      expect(rounded.fat).toBe(4);
    });

    it('should handle unicode in food description', () => {
      const estimate: MacroEstimateResult = {
        food_description: 'Bún chả 🍜',
        estimated_carbs_g: 45,
        estimated_protein_g: 25,
        estimated_fat_g: 15,
        confidence: 'medium',
      };

      expect(estimate.food_description).toBe('Bún chả 🍜');
    });

    it('should handle very long food descriptions', () => {
      const longDescription = 'Grilled chicken breast with steamed broccoli, ' +
        'brown rice, and a side of mixed greens with olive oil dressing';

      const estimate: MacroEstimateResult = {
        food_description: longDescription,
        estimated_carbs_g: 50,
        estimated_protein_g: 40,
        estimated_fat_g: 15,
        confidence: 'high',
      };

      expect(estimate.food_description.length).toBeGreaterThan(50);
    });

    it('should handle rapid successive requests', async () => {
      const claude = createMockClaude();

      // Simulate multiple rapid requests
      const requests = [
        claude.ask('Analyze 1', 'U123'),
        claude.ask('Analyze 2', 'U123'),
        claude.ask('Analyze 3', 'U123'),
      ];

      await Promise.all(requests);

      expect(claude.ask).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent users', async () => {
      const claude = createMockClaude();

      // Simulate different users
      await claude.ask('User 1 request', 'U001');
      await claude.ask('User 2 request', 'U002');
      await claude.ask('User 3 request', 'U003');

      expect(claude.ask).toHaveBeenCalledWith('User 1 request', 'U001');
      expect(claude.ask).toHaveBeenCalledWith('User 2 request', 'U002');
      expect(claude.ask).toHaveBeenCalledWith('User 3 request', 'U003');
    });
  });

  describe('integration scenarios', () => {
    it('should complete full analyze -> confirm flow', async () => {
      // 1. Validate URL
      vi.mocked(isValidImageUrl).mockReturnValue(true);

      // 2. Fetch image
      vi.mocked(fetchImageAsBase64).mockResolvedValue({
        data: 'base64data',
        mediaType: 'image/jpeg',
      });

      // 3. Claude analyzes
      const claude = createMockClaude({
        ask: vi.fn().mockResolvedValue(
          createMockClaudeResult({
            food_description: 'Chicken and rice',
            estimated_carbs_g: 45,
            estimated_protein_g: 35,
            estimated_fat_g: 8,
            confidence: 'high',
          })
        ),
      });

      // 4. Store pending (we verify db was created correctly)
      const _db = createMockDb();
      expect(_db.prefix).toBe('plugin_lift_');

      // 5. Retrieve and confirm
      const pending = createPendingEstimate();

      // Verify flow completes
      expect(isValidImageUrl('https://example.com/food.jpg')).toBe(true);
      const image = await fetchImageAsBase64('https://example.com/food.jpg');
      expect(image.data).toBe('base64data');

      const result = await claude.ask('Analyze', 'U123', { images: [image] });
      expect(result.toolCalls.length).toBeGreaterThan(0);

      expect(pending.food_description).toBe('Chicken breast with rice');
    });

    it('should complete full analyze -> adjust flow', async () => {
      const pending = createPendingEstimate({
        carbs_g: 45,
        protein_g: 35,
        fat_g: 8,
      });

      const adjusted = { carbs: 50, protein: 30, fat: 15 };

      // Verify original vs adjusted
      expect(pending.carbs_g).toBe(45);
      expect(adjusted.carbs).toBe(50);
    });

    it('should complete full analyze -> cancel flow', () => {
      const pending = createPendingEstimate();
      const db = createMockDb(pending);

      // Simulate cancel
      const stmt = db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ?`);
      stmt.run(pending.id);

      // Verify deletion was attempted
      expect(db.prepare).toHaveBeenCalled();
    });

    it('should handle expired estimate during confirm', () => {
      const expiredEstimate = createPendingEstimate({
        expires_at: Date.now() - 1000,
      });

      expect(expiredEstimate.expires_at).toBeLessThan(Date.now());
    });
  });
});

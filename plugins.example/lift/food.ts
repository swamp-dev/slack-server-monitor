/**
 * Lift Plugin — Food Analysis (Claude Vision, Pending Estimates)
 */

import type { RespondFn } from '@slack/bolt';
import type { PluginClaude } from '../../src/plugins/index.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { SlackClient, MacroEstimateResult, PendingEstimate } from './types.js';
import { PENDING_ESTIMATE_TTL } from './types.js';
import { parseMacroArgs } from './parsing.js';
import { logMacros, getDailyTotals } from './data.js';
import { formatMacroSummary } from './formatting.js';
import { isValidImageUrl, fetchImageAsBase64 } from '../../src/utils/image.js';
import { header, section, divider, context, buildResponse } from '../../src/formatters/blocks.js';
import { logger } from '../../src/utils/logger.js';

// =============================================================================
// Channel Image Search
// =============================================================================

/**
 * Find the most recent image file shared in a channel
 *
 * @param client - Slack client instance
 * @param channelId - Channel ID to search
 * @returns Image info or null if no recent image found
 */
export async function findRecentImageInChannel(
  client: SlackClient,
  channelId: string
): Promise<{ url: string; filename: string; mimetype: string } | null> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 20, // Check last 20 messages
    });

    if (!result.ok || !result.messages) {
      logger.warn('Failed to fetch channel history', { channelId });
      return null;
    }

    // Find first message with an image file
    for (const message of result.messages) {
      if (!message.files) continue;

      for (const file of message.files) {
        // Check if it's an image
        if (file.mimetype?.startsWith('image/') && file.url_private_download) {
          logger.debug('Found recent image in channel', {
            channelId,
            filename: file.name,
            mimetype: file.mimetype,
          });
          return {
            url: file.url_private_download,
            filename: file.name,
            mimetype: file.mimetype,
          };
        }
      }
    }

    logger.debug('No recent image found in channel', { channelId });
    return null;
  } catch (error) {
    logger.error('Error searching channel for images', { error, channelId });
    return null;
  }
}

// =============================================================================
// Image Analysis
// =============================================================================

/**
 * Analyze a food image using Claude vision
 */
export async function analyzeFood(
  imageUrl: string,
  userId: string,
  claude: PluginClaude
): Promise<MacroEstimateResult | null> {
  // Fetch and convert image to base64
  const image = await fetchImageAsBase64(imageUrl);

  // Ask Claude to analyze the image
  const result = await claude.ask(
    'Analyze this food image and estimate the macronutrients. ' +
    'Look for reference objects like plates, utensils, or hands to estimate portion size. ' +
    'Use the estimate_food_macros tool to provide your structured estimate.',
    userId,
    {
      images: [image],
      systemPromptAddition:
        'You are a nutrition expert. Analyze food images to estimate macronutrients. ' +
        'Be conservative in estimates - it\'s better to slightly underestimate than overestimate. ' +
        'Always use the estimate_food_macros tool to provide structured output.',
    }
  );

  // Extract the tool call result
  const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
  if (!toolCall) {
    logger.warn('Claude did not use estimate_food_macros tool', { response: result.response });
    return null;
  }

  return toolCall.input as MacroEstimateResult;
}

// =============================================================================
// Pending Estimates
// =============================================================================

/**
 * Store a pending estimate for user confirmation
 */
export function storePendingEstimate(
  userId: string,
  channelId: string,
  estimate: MacroEstimateResult,
  db: PluginDatabase
): number {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO ${db.prefix}pending_estimates
     (user_id, channel_id, carbs_g, protein_g, fat_g, food_description, confidence, notes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    channelId,
    estimate.estimated_carbs_g,
    estimate.estimated_protein_g,
    estimate.estimated_fat_g,
    estimate.food_description,
    estimate.confidence,
    estimate.notes ?? null,
    now,
    now + PENDING_ESTIMATE_TTL
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get the most recent pending estimate for a user
 */
export function getPendingEstimate(userId: string, channelId: string, db: PluginDatabase): PendingEstimate | null {
  // Clean up expired estimates first
  db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE expires_at < ?`).run(Date.now());

  return db.prepare(
    `SELECT * FROM ${db.prefix}pending_estimates
     WHERE user_id = ? AND channel_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId, channelId) as PendingEstimate | null;
}

/**
 * Delete a pending estimate
 */
export function deletePendingEstimate(id: number, userId: string, db: PluginDatabase): void {
  db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ? AND user_id = ?`).run(id, userId);
}

// =============================================================================
// Estimate Formatting
// =============================================================================

/**
 * Format a macro estimate for display
 */
export function formatEstimate(estimate: MacroEstimateResult | PendingEstimate): ReturnType<typeof section | typeof context>[] {
  const carbs = 'estimated_carbs_g' in estimate ? estimate.estimated_carbs_g : estimate.carbs_g;
  const protein = 'estimated_protein_g' in estimate ? estimate.estimated_protein_g : estimate.protein_g;
  const fat = 'estimated_fat_g' in estimate ? estimate.estimated_fat_g : estimate.fat_g;
  const description = estimate.food_description;
  const confidence = estimate.confidence;
  const notes = estimate.notes;

  const calories = carbs * 4 + protein * 4 + fat * 9;
  const confidenceEmoji = confidence === 'high' ? ':white_check_mark:' :
                          confidence === 'medium' ? ':warning:' : ':grey_question:';

  const blocks: ReturnType<typeof section | typeof context>[] = [
    section(
      `*${description}*\n` +
      '```\n' +
      `Carbs:   ${String(Math.round(carbs)).padStart(4)}g\n` +
      `Protein: ${String(Math.round(protein)).padStart(4)}g\n` +
      `Fat:     ${String(Math.round(fat)).padStart(4)}g\n` +
      '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
      `Calories: ~${calories.toLocaleString()}\n` +
      '```'
    ),
    context(`${confidenceEmoji} Confidence: ${confidence}${notes ? ` | ${notes}` : ''}`),
  ];

  return blocks;
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * Handle /lift m analyze <url> command
 */
export async function handleAnalyze(
  imageUrl: string,
  userId: string,
  channelId: string,
  db: PluginDatabase,
  claude: PluginClaude,
  respond: RespondFn
): Promise<void> {
  // Validate URL
  if (!isValidImageUrl(imageUrl)) {
    await respond(
      buildResponse([
        section(':x: Invalid image URL. Must be HTTPS.'),
        context('Tip: Upload an image to Slack and copy the URL'),
      ])
    );
    return;
  }

  // Check if Claude supports images
  if (!claude.supportsImages) {
    await respond(
      buildResponse([
        section(':x: Image analysis requires SDK provider with vision support.'),
        context('Set ANTHROPIC_API_KEY and CLAUDE_PROVIDER=sdk to enable'),
      ])
    );
    return;
  }

  // Show processing message
  await respond(buildResponse([section(':hourglass_flowing_sand: Analyzing image...')]));

  try {
    const estimate = await analyzeFood(imageUrl, userId, claude);

    if (!estimate) {
      await respond(
        buildResponse([
          section(':x: Could not estimate macros from this image.'),
          context('Try a clearer image with visible portion sizes'),
        ])
      );
      return;
    }

    // Store pending estimate for confirmation
    storePendingEstimate(userId, channelId, estimate, db);

    // Show estimate with confirmation prompt
    await respond(
      buildResponse([
        header('Macro Estimate'),
        ...formatEstimate(estimate),
        divider(),
        section(
          '*Commands:*\n' +
          '`/lift m confirm` - Log these macros\n' +
          '`/lift m adjust c50 p30 f15` - Adjust and log\n' +
          '`/lift m cancel` - Discard estimate'
        ),
        context('Estimate expires in 15 minutes'),
      ])
    );
  } catch (error) {
    logger.error('Failed to analyze food image', { error, imageUrl, userId });
    const message = error instanceof Error ? error.message : 'Unknown error';
    await respond(
      buildResponse([
        section(`:x: Failed to analyze image: ${message}`),
      ])
    );
  }
}

/**
 * Handle /lift m confirm command
 */
export async function handleConfirm(
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':x: No pending estimate to confirm.'),
        context('Use `/lift m analyze <url>` to analyze a food image'),
      ])
    );
    return;
  }

  // Log the macros
  const macros = {
    carbs: Math.round(pending.carbs_g),
    protein: Math.round(pending.protein_g),
    fat: Math.round(pending.fat_g),
  };

  try {
    logMacros(userId, macros, db);
    deletePendingEstimate(pending.id, userId, db);

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: Logged: ${macros.carbs}c ${macros.protein}p ${macros.fat}f`),
        context(`From: ${pending.food_description}`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
  } catch (error) {
    logger.error('Failed to confirm macros', { error, userId });
    await respond(buildResponse([section(':x: Failed to log macros. Please try again.')]));
  }
}

/**
 * Handle /lift m adjust <macros> command
 */
export async function handleAdjust(
  args: string[],
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':x: No pending estimate to adjust.'),
        context('Use `/lift m analyze <url>` to analyze a food image'),
      ])
    );
    return;
  }

  // Parse adjusted macros
  const adjustedMacros = parseMacroArgs(args);
  if (!adjustedMacros) {
    await respond(
      buildResponse([
        section(':x: Invalid macro format for adjustment.'),
        context('Example: `/lift m adjust c50 p30 f15`'),
      ])
    );
    return;
  }

  try {
    logMacros(userId, adjustedMacros, db);
    deletePendingEstimate(pending.id, userId, db);

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: Logged (adjusted): ${adjustedMacros.carbs}c ${adjustedMacros.protein}p ${adjustedMacros.fat}f`),
        context(`Original estimate: ${Math.round(pending.carbs_g)}c ${Math.round(pending.protein_g)}p ${Math.round(pending.fat_g)}f`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
  } catch (error) {
    logger.error('Failed to log adjusted macros', { error, userId });
    await respond(buildResponse([section(':x: Failed to log macros. Please try again.')]));
  }
}

/**
 * Handle /lift m cancel command
 */
export async function handleCancel(
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':information_source: No pending estimate to cancel.'),
      ])
    );
    return;
  }

  deletePendingEstimate(pending.id, db);
  await respond(
    buildResponse([
      section(':wastebasket: Estimate discarded.'),
    ])
  );
}

/**
 * Lift Plugin — Slash Command Handler
 *
 * Main /lift command registration with all subcommand routing.
 */

import type { App, RespondFn } from '@slack/bolt';
import type { PluginApp, PluginClaude } from '../../src/plugins/index.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { SlackClient, PlateConfig, WorkoutSet, PersonalRecord, MacroEstimateResult } from './types.js';
import { BAR_WEIGHT, GYM_PLATES, HOME_PLATES, MAX_TARGET_WEIGHT, FOOD_ANALYSIS_PROMPT } from './types.js';
import { getUserUnit, setUserUnit, lbsToKg, kgToLbs, formatWeight } from './units.js';
import { calculateWilks, calculateDots, calculate1rm, formatWarmupTable } from './calculations.js';
import { parseLogArgs, parseMacroArgs, parseQueryArgs } from './parsing.js';
import { logWorkoutSet, getWorkoutForDate, checkForPR, getPersonalRecords, getAllPersonalRecords, logBodyweight, getLatestBodyweight, getBodyweightHistory, formatBodyweightTrend, logMacros, getDailyTotals, getTotalsForDate, getTotalsForRange } from './data.js';
import { titleCase, formatWorkoutSummary, formatPersonalRecords, formatDateLabel, formatMacroSummary } from './formatting.js';
import { getUserTimezone, getStartOfDayInTimezone } from './timezone.js';
import { findRecentImageInChannel, storePendingEstimate, formatEstimate, handleAnalyze, handleConfirm, handleAdjust, handleCancel } from './food.js';
import { header, section, divider, context, buildResponse } from '../../src/formatters/blocks.js';
import { downloadImageToFile, cleanupTempImage } from '../../src/utils/image.js';
import { logger } from '../../src/utils/logger.js';
import crypto from 'crypto';

// =============================================================================
// Macro Command Handler
// =============================================================================

/**
 * Handle /lift m commands
 * @param client Slack client for fetching user timezone
 * @param channelId Channel ID for pending estimate storage
 * @param claude PluginClaude instance for image analysis
 */
async function handleMacros(
  args: string[],
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  client: SlackClient,
  claude: PluginClaude | undefined
): Promise<void> {
  // Get user's timezone for accurate day boundaries
  const tz = await getUserTimezone(userId, client);

  // Check for subcommands first
  const subcommand = args[0]?.toLowerCase();

  // Handle analyze <url>
  if (subcommand === 'analyze') {
    if (!claude || !claude.enabled) {
      await respond(
        buildResponse([
          section(':x: Image analysis requires Claude to be enabled.'),
          context('Set CLAUDE_ENABLED=true and configure ANTHROPIC_API_KEY'),
        ])
      );
      return;
    }

    const imageUrl = args[1];
    if (!imageUrl) {
      await respond(
        buildResponse([
          section(':warning: Usage: `/lift m analyze <image_url>`'),
          context('Upload an image to Slack and copy its URL'),
        ])
      );
      return;
    }

    await handleAnalyze(imageUrl, userId, channelId, db, claude, respond);
    return;
  }

  // Handle confirm
  if (subcommand === 'confirm') {
    await handleConfirm(userId, channelId, db, respond, tz);
    return;
  }

  // Handle adjust <macros>
  if (subcommand === 'adjust') {
    await handleAdjust(args.slice(1), userId, channelId, db, respond, tz);
    return;
  }

  // Handle cancel
  if (subcommand === 'cancel') {
    await handleCancel(userId, channelId, db, respond);
    return;
  }

  // 1. Try to parse as macro input (c20 p40 f15)
  const macros = parseMacroArgs(args);
  if (macros) {
    // Log the entry with error handling
    try {
      logMacros(userId, macros, db);
    } catch (error) {
      logger.error('Failed to save macros', { error, userId });
      await respond(buildResponse([section(':x: Failed to save macros. Please try again.')]));
      return;
    }

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: +${macros.carbs}c ${macros.protein}p ${macros.fat}f`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
    return;
  }

  // 2. Check for help
  if (args.length === 1 && args[0].toLowerCase() === 'help') {
    await respond(
      buildResponse([
        header('Macro Tracker'),
        section(
          '*Log:* `/lift m c20 p40 f15`\n' +
            '*Today:* `/lift m`\n' +
            '*Yesterday:* `/lift m -1`\n' +
            '*Date:* `/lift m 1/15`\n' +
            '*Range:* `/lift m 1/10-1/15`'
        ),
        divider(),
        section(
          '*Image Analysis:*\n' +
            '`/lift m analyze <url>` - Estimate macros from image\n' +
            '`/lift m confirm` - Log pending estimate\n' +
            '`/lift m adjust c50 p30` - Adjust and log\n' +
            '`/lift m cancel` - Discard estimate'
        ),
        context('c=carbs p=protein f=fat (grams)'),
      ])
    );
    return;
  }

  // 3. Try to parse as query (date, range, or relative)
  const query = parseQueryArgs(args);
  if (query) {
    switch (query.type) {
      case 'today': {
        const today = getDailyTotals(userId, 0, db, tz);
        await respond(buildResponse(formatMacroSummary('Today', today)));
        break;
      }
      case 'relative': {
        const rel = getDailyTotals(userId, query.daysAgo!, db, tz);
        const label = query.daysAgo === -1 ? 'Yesterday' : `Last ${-query.daysAgo!} days`;
        await respond(buildResponse(formatMacroSummary(label, rel)));
        break;
      }
      case 'date': {
        const dateTotal = getTotalsForDate(userId, query.date!, db, tz);
        await respond(buildResponse(formatMacroSummary(formatDateLabel(query.date!), dateTotal)));
        break;
      }
      case 'range': {
        const rangeTotal = getTotalsForRange(userId, query.startDate!, query.endDate!, db, tz);
        const rangeLabel = `${formatDateLabel(query.startDate!)} - ${formatDateLabel(query.endDate!)}`;
        await respond(buildResponse(formatMacroSummary(rangeLabel, rangeTotal)));
        break;
      }
    }
    return;
  }

  // 4. Invalid input - show usage hint
  await respond(
    buildResponse([section(':warning: Invalid input. Try `/lift m c20 p40` or `/lift m help`')])
  );
}

// =============================================================================
// Warmup Command Helper
// =============================================================================

/**
 * Handle warmup command for both gym and home configurations
 */
async function handleWarmupCommand(
  weightArgs: string[],
  config: PlateConfig,
  unit: 'lbs' | 'kg',
  respond: RespondFn,
): Promise<void> {
  const parsed = weightArgs.map((w) => ({ raw: w, value: parseFloat(w) }));
  const validInputs = parsed.filter((p) => !isNaN(p.value) && p.value > 0);
  const invalidInputs = parsed.filter((p) => isNaN(p.value) || p.value <= 0);

  const cmd = config.singlePairOnly ? 'wh' : 'w';
  if (validInputs.length === 0) {
    await respond(
      buildResponse([
        section(`:warning: Usage: \`/lift ${cmd} <weight> [weight2] ...\``),
        context(`Example: \`/lift ${cmd} ${unit === 'lbs' ? '225' : '100'}\` (${unit})`),
      ])
    );
    return;
  }

  const maxDisplay = unit === 'kg'
    ? `${Math.round(lbsToKg(MAX_TARGET_WEIGHT))} kg`
    : `${MAX_TARGET_WEIGHT} lbs`;

  const blocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [];
  const skipped: string[] = [];

  // Report non-numeric/negative inputs
  for (const inv of invalidInputs) {
    skipped.push(`Skipping invalid input: ${inv.raw}`);
  }

  // Process each valid weight individually
  for (const input of validInputs) {
    const weightLbs = unit === 'kg' ? Math.round(kgToLbs(input.value)) : input.value;

    if (weightLbs > MAX_TARGET_WEIGHT) {
      const display = unit === 'kg' ? `${input.value} kg` : `${weightLbs} lbs`;
      skipped.push(`Skipping ${display}: exceeds maximum of ${maxDisplay}`);
      continue;
    }

    // Build display label preserving original unit for kg users
    const displayLabel = unit === 'kg'
      ? `${input.value} kg (~${weightLbs} lbs)`
      : undefined;

    if (blocks.length > 0) blocks.push(divider());
    blocks.push(...formatWarmupTable(weightLbs, config, displayLabel));
  }

  // Show skipped warnings before context footer
  if (skipped.length > 0) {
    blocks.push(section(`:warning: ${skipped.join('\n')}`));
  }

  const contextParts = ['Percentages: 40%, 60%, 80%, 100%'];
  if (config.lightBar) {
    contextParts.push(
      `${config.lightBar.weight}lb bar (<${config.lightBar.threshold} lbs) / Bar = ${config.barWeight} lbs`
    );
  } else if (config.barWeight === BAR_WEIGHT) {
    contextParts.push(`Bar = ${config.barWeight} lbs`);
  }
  contextParts.push('Plate count is total (both sides)');
  if (config.singlePairOnly) {
    contextParts.push('1 pair per plate (2 pairs of 5lb)');
  }
  if (unit === 'kg') {
    contextParts.push('Plate loading in lbs (standard plates)');
  }
  blocks.push(context(contextParts.join(' | ')));

  await respond(buildResponse(blocks));
}

// =============================================================================
// Main Command Registration
// =============================================================================

export function registerLiftCommand(
  app: App | PluginApp,
  getDb: () => PluginDatabase | null,
  getClaude: () => PluginClaude | undefined
): void {
  app.command('/lift', async ({ command, ack, respond, client }) => {
    await ack();

    const pluginDb = getDb();
    const pluginClaude = getClaude();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() ?? 'help';

    try {
      switch (subcommand) {
        case 'wilks': {
          // /lift wilks <total> <m|f>        (uses stored bodyweight)
          // /lift wilks <total> <bw> <m|f>   (explicit bodyweight)
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, totalStr, secondArg, thirdArg] = args;

          // Validate total early (before DB lookup)
          const totalInput = parseFloat(totalStr);
          if (isNaN(totalInput) || totalInput <= 0) {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift wilks <total> <m|f>\` or \`/lift wilks <total> <bw> <m|f>\``),
                context(`Example: \`/lift wilks ${unit === 'lbs' ? '1100' : '500'} m\` (uses stored bw) or \`/lift wilks ${unit === 'lbs' ? '1100 183' : '500 83'} m\``),
              ])
            );
            return;
          }

          // Determine if second arg is sex (auto-BW) or bodyweight (explicit)
          let bwInput: number;
          let isMale: boolean;
          let usedStoredBw = false;

          if (secondArg && (secondArg.toLowerCase() === 'm' || secondArg.toLowerCase() === 'f')) {
            // /lift wilks <total> <m|f> — use stored bodyweight
            isMale = secondArg.toLowerCase() === 'm';
            if (!pluginDb) {
              await respond(buildResponse([section(':x: Database not initialized')]));
              return;
            }
            const stored = getLatestBodyweight(command.user_id, pluginDb);
            if (!stored) {
              await respond(
                buildResponse([
                  section(':warning: No bodyweight logged. Log with `/lift bw <weight>` first, or specify explicitly.'),
                  context(`Usage: \`/lift wilks <total> <bodyweight> <m|f>\``),
                ])
              );
              return;
            }
            bwInput = unit === 'kg' ? stored.weightKg : kgToLbs(stored.weightKg);
            usedStoredBw = true;
          } else if (secondArg && !isNaN(parseFloat(secondArg)) && thirdArg && (thirdArg.toLowerCase() === 'm' || thirdArg.toLowerCase() === 'f')) {
            // /lift wilks <total> <bw> <m|f>
            bwInput = parseFloat(secondArg);
            isMale = thirdArg.toLowerCase() === 'm';
            if (bwInput <= 0) {
              await respond(buildResponse([section(':x: Bodyweight must be positive.')]));
              return;
            }
          } else {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift wilks <total> <m|f>\` or \`/lift wilks <total> <bw> <m|f>\``),
                context(`Example: \`/lift wilks ${unit === 'lbs' ? '1100' : '500'} m\` (uses stored bw) or \`/lift wilks ${unit === 'lbs' ? '1100 183' : '500 83'} m\``),
              ])
            );
            return;
          }

          const totalKg = unit === 'kg' ? totalInput : lbsToKg(totalInput);
          const bwKg = unit === 'kg' ? bwInput : lbsToKg(bwInput);

          const wilks = calculateWilks(totalKg, bwKg, isMale);
          const bwNote = usedStoredBw ? ' _(from logged bw)_' : '';
          await respond(
            buildResponse([
              header('Wilks Score'),
              section(`*Total:* ${formatWeight(totalInput, unit)}\n*Bodyweight:* ${formatWeight(bwInput, unit)}${bwNote}\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *Wilks Score: ${wilks.toFixed(2)}*`),
              context('Using Wilks 2020 formula'),
            ])
          );
          break;
        }

        case 'dots': {
          // /lift dots <total> <m|f>        (uses stored bodyweight)
          // /lift dots <total> <bw> <m|f>   (explicit bodyweight)
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, totalStr, secondArg, thirdArg] = args;

          // Validate total early (before DB lookup)
          const totalInput = parseFloat(totalStr);
          if (isNaN(totalInput) || totalInput <= 0) {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift dots <total> <m|f>\` or \`/lift dots <total> <bw> <m|f>\``),
                context(`Example: \`/lift dots ${unit === 'lbs' ? '1100' : '500'} m\` (uses stored bw) or \`/lift dots ${unit === 'lbs' ? '1100 183' : '500 83'} m\``),
              ])
            );
            return;
          }

          let bwInput: number;
          let isMale: boolean;
          let usedStoredBw = false;

          if (secondArg && (secondArg.toLowerCase() === 'm' || secondArg.toLowerCase() === 'f')) {
            isMale = secondArg.toLowerCase() === 'm';
            if (!pluginDb) {
              await respond(buildResponse([section(':x: Database not initialized')]));
              return;
            }
            const stored = getLatestBodyweight(command.user_id, pluginDb);
            if (!stored) {
              await respond(
                buildResponse([
                  section(':warning: No bodyweight logged. Log with `/lift bw <weight>` first, or specify explicitly.'),
                  context(`Usage: \`/lift dots <total> <bodyweight> <m|f>\``),
                ])
              );
              return;
            }
            bwInput = unit === 'kg' ? stored.weightKg : kgToLbs(stored.weightKg);
            usedStoredBw = true;
          } else if (secondArg && !isNaN(parseFloat(secondArg)) && thirdArg && (thirdArg.toLowerCase() === 'm' || thirdArg.toLowerCase() === 'f')) {
            bwInput = parseFloat(secondArg);
            isMale = thirdArg.toLowerCase() === 'm';
            if (bwInput <= 0) {
              await respond(buildResponse([section(':x: Bodyweight must be positive.')]));
              return;
            }
          } else {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift dots <total> <m|f>\` or \`/lift dots <total> <bw> <m|f>\``),
                context(`Example: \`/lift dots ${unit === 'lbs' ? '1100' : '500'} m\` (uses stored bw) or \`/lift dots ${unit === 'lbs' ? '1100 183' : '500 83'} m\``),
              ])
            );
            return;
          }

          const totalKg = unit === 'kg' ? totalInput : lbsToKg(totalInput);
          const bwKg = unit === 'kg' ? bwInput : lbsToKg(bwInput);

          const dots = calculateDots(totalKg, bwKg, isMale);
          const bwNote = usedStoredBw ? ' _(from logged bw)_' : '';
          await respond(
            buildResponse([
              header('DOTS Score'),
              section(`*Total:* ${formatWeight(totalInput, unit)}\n*Bodyweight:* ${formatWeight(bwInput, unit)}${bwNote}\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *DOTS Score: ${dots.toFixed(2)}*`),
              context('DOTS = Dynamic Object Tracking System'),
            ])
          );
          break;
        }

        case '1rm': {
          // /lift 1rm <weight> <reps>
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, weightStr, repsStr] = args;
          if (!weightStr || !repsStr) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift 1rm <weight> <reps>`'),
                context(`Example: \`/lift 1rm ${unit === 'lbs' ? '225 5' : '100 5'}\` (${unit})`),
              ])
            );
            return;
          }

          const weightInput = parseFloat(weightStr);
          const reps = parseInt(repsStr, 10);

          if (isNaN(weightInput) || isNaN(reps) || weightInput <= 0 || reps <= 0 || reps > 20) {
            await respond(
              buildResponse([section(':x: Invalid input. Weight must be positive, reps must be 1-20.')])
            );
            return;
          }

          const weightKg = unit === 'kg' ? weightInput : lbsToKg(weightInput);
          const estimated1rmKg = calculate1rm(weightKg, reps);
          const estimated1rmDisplay = unit === 'kg' ? estimated1rmKg : kgToLbs(estimated1rmKg);

          await respond(
            buildResponse([
              header('Estimated 1RM'),
              section(`*Weight:* ${formatWeight(weightInput, unit)}\n*Reps:* ${reps}`),
              divider(),
              section(`:muscle: *Estimated 1RM: ${formatWeight(estimated1rmDisplay, unit)}*`),
              context('Using Epley formula: weight × (1 + reps/30)'),
            ])
          );
          break;
        }

        case 'units': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const unitArg = args[1]?.toLowerCase();
          if (!unitArg) {
            // Show current preference
            const currentUnit = getUserUnit(command.user_id, pluginDb);
            await respond(
              buildResponse([
                section(`:straight_ruler: Current unit: *${currentUnit}*`),
                context('Change with `/lift units lbs` or `/lift units kg`'),
              ])
            );
          } else if (unitArg === 'lbs' || unitArg === 'kg') {
            setUserUnit(command.user_id, unitArg, pluginDb);
            await respond(
              buildResponse([
                section(`:white_check_mark: Weight unit set to *${unitArg}*`),
                context('All calculator commands will now use ' + unitArg),
              ])
            );
          } else {
            await respond(
              buildResponse([
                section(':warning: Invalid unit. Use `lbs` or `kg`.'),
                context('Example: `/lift units lbs` or `/lift units kg`'),
              ])
            );
          }
          break;
        }

        case 'bw':
        case 'bodyweight': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const unit = getUserUnit(command.user_id, pluginDb);
          const bwArg = args[1];

          if (bwArg) {
            // /lift bw <weight> — log bodyweight
            const weightInput = parseFloat(bwArg);
            if (isNaN(weightInput) || weightInput <= 0) {
              await respond(buildResponse([section(':x: Invalid weight. Must be a positive number.')]));
              return;
            }

            const weightKg = unit === 'kg' ? weightInput : lbsToKg(weightInput);
            logBodyweight(command.user_id, weightKg, pluginDb);

            await respond(
              buildResponse([
                section(`:white_check_mark: Bodyweight logged: *${formatWeight(weightInput, unit)}*`),
                context('View trend with `/lift bw`'),
              ])
            );
          } else {
            // /lift bw — show trend
            const history = getBodyweightHistory(command.user_id, 30, pluginDb);
            const trend = formatBodyweightTrend(history, unit);

            if (history.length === 0) {
              await respond(
                buildResponse([
                  section(':scale: ' + trend),
                  context('Log with `/lift bw <weight>`'),
                ])
              );
            } else {
              const recentHistory = getBodyweightHistory(command.user_id, 7, pluginDb);
              const trend7d = formatBodyweightTrend(recentHistory, unit);

              await respond(
                buildResponse([
                  header('Bodyweight Trend'),
                  section(`:scale: *30 day:* ${trend}`),
                  section(`*7 day:* ${trend7d}`),
                  context(`${String(history.length)} entries | Unit: ${unit} | View chart in web dashboard: \`/weblogin\` > Lift > Bodyweight`),
                ])
              );
            }
          }
          break;
        }

        case 'm':
        case 'macros': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }
          await handleMacros(
            args.slice(1),
            command.user_id,
            command.channel_id,
            pluginDb,
            respond,
            client as unknown as SlackClient,
            pluginClaude
          );
          break;
        }

        case 'log':
        case 'l': {
          // /lift log <exercise> <weight> <reps> [@rpe]
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const parsed = parseLogArgs(args.slice(1));
          if (!parsed) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift log <exercise> <weight> <reps> [@rpe]`'),
                context('Example: `/lift log squat 100 5 @8`'),
              ])
            );
            return;
          }

          const logUnit = getUserUnit(command.user_id, pluginDb);
          const logWeightKg = logUnit === 'kg' ? parsed.weight : lbsToKg(parsed.weight);
          const tz = await getUserTimezone(command.user_id, client as unknown as SlackClient);

          // Check for PR before logging (so the new set isn't counted against itself)
          const isPR = checkForPR(command.user_id, parsed.exercise, logWeightKg, parsed.reps, pluginDb);

          logWorkoutSet(command.user_id, parsed.exercise, logWeightKg, parsed.reps, parsed.rpe, pluginDb);

          // Build confirmation
          const rpeStr = parsed.rpe != null ? ` @${parsed.rpe}` : '';
          const confirmBlocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [
            section(`:white_check_mark: ${formatWeight(parsed.weight, logUnit)} × ${parsed.reps}${rpeStr} — ${titleCase(parsed.exercise)}`),
          ];

          if (isPR) {
            const est1rm = calculate1rm(logWeightKg, parsed.reps);
            const display1rm = logUnit === 'kg' ? est1rm : kgToLbs(est1rm);
            confirmBlocks.push(
              section(`:trophy: *New PR!* Est 1RM: ${formatWeight(display1rm, logUnit)}`)
            );
          }

          // Show today's workout summary
          const todaySets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
          if (todaySets.length > 0) {
            confirmBlocks.push(divider());
            confirmBlocks.push(header('Today'));
            confirmBlocks.push(section(formatWorkoutSummary(todaySets, logUnit)));
          }

          await respond(buildResponse(confirmBlocks));
          break;
        }

        case 'workout':
        case 'wo': {
          // /lift workout [date] - Show workout for a date
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const tz = await getUserTimezone(command.user_id, client as unknown as SlackClient);
          const wUnit = getUserUnit(command.user_id, pluginDb);
          const queryArgs = args.slice(1);
          const query = parseQueryArgs(queryArgs);

          if (!query) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift workout [date]`'),
                context('Examples: `/lift wo`, `/lift wo -1`, `/lift wo 2/14`'),
              ])
            );
            return;
          }

          let wSets: WorkoutSet[];
          let wLabel: string;

          switch (query.type) {
            case 'today':
              wSets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
              wLabel = 'Today';
              break;
            case 'relative': {
              const daysBack = Math.abs(query.daysAgo!);
              // Use timezone-aware start of day to find the correct date
              const targetTs = getStartOfDayInTimezone(tz, daysBack);
              const targetDate = new Date(targetTs);
              wSets = getWorkoutForDate(command.user_id, targetDate, pluginDb, tz);
              wLabel = daysBack === 1 ? 'Yesterday' : `${daysBack} days ago`;
              break;
            }
            case 'date':
              wSets = getWorkoutForDate(command.user_id, query.date!, pluginDb, tz);
              wLabel = formatDateLabel(query.date!);
              break;
            default:
              wSets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
              wLabel = 'Today';
          }

          await respond(
            buildResponse([
              header(`Workout: ${wLabel}`),
              section(formatWorkoutSummary(wSets, wUnit)),
              context('View full workout log, manage sets, and track streaks in the web dashboard: `/weblogin` then navigate to Lift'),
            ])
          );
          break;
        }

        case 'pr': {
          // /lift pr [exercise] - Show personal records
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const prUnit = getUserUnit(command.user_id, pluginDb);
          const exerciseArg = args.slice(1).join(' ').toLowerCase();

          let prs: PersonalRecord[];
          if (exerciseArg) {
            prs = getPersonalRecords(command.user_id, exerciseArg, pluginDb);
          } else {
            prs = getAllPersonalRecords(command.user_id, pluginDb);
          }

          const prTitle = exerciseArg ? `PR: ${titleCase(exerciseArg)}` : 'Personal Records';
          await respond(
            buildResponse([
              header(prTitle),
              section(formatPersonalRecords(prs, prUnit)),
              context('View PR gallery with badges and trends in the web dashboard: `/weblogin` then navigate to Lift > PRs'),
            ])
          );
          break;
        }

        case 'a':
        case 'analyze': {
          // /lift a [context] - Quick food photo analysis from recent channel image
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          if (!pluginClaude || !pluginClaude.enabled) {
            await respond(
              buildResponse([
                section(':x: Image analysis requires Claude to be enabled.'),
                context('Set CLAUDE_ENABLED=true'),
              ])
            );
            return;
          }

          // Get context hint (e.g., "breakfast", "lunch", "dinner")
          const contextHint = args.slice(1).join(' ');

          // Find recent image in channel
          const imageInfo = await findRecentImageInChannel(
            client as unknown as SlackClient,
            command.channel_id
          );

          if (!imageInfo) {
            await respond(
              buildResponse([
                section(':warning: No recent image found in this channel.'),
                context('Share or paste a food photo first, then use `/lift a`'),
              ])
            );
            return;
          }

          // Download image to temp file with cryptographically random suffix
          const randomSuffix = crypto.randomBytes(8).toString('hex');
          const tempPath = `/tmp/lift-food-${Date.now()}-${randomSuffix}.jpg`;
          try {
            // Get bot token from environment for downloading Slack private files
            const botToken = process.env.SLACK_BOT_TOKEN;
            if (!botToken) {
              logger.warn('SLACK_BOT_TOKEN not set, image download may fail for private Slack files');
            }
            await downloadImageToFile(imageInfo.url, tempPath, botToken);

            // Show processing message
            await respond(buildResponse([section(':hourglass_flowing_sand: Analyzing food image...')]));

            // Call Claude CLI with local file reference
            const prompt = contextHint
              ? `Analyze this food image (${contextHint}) and estimate the macronutrients.`
              : 'Analyze this food image and estimate the macronutrients.';

            const result = await pluginClaude.ask(prompt, command.user_id, {
              localImagePath: tempPath,
              systemPromptAddition: FOOD_ANALYSIS_PROMPT,
            });

            // Parse result for structured macro estimate
            const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
            if (toolCall) {
              const estimate = toolCall.input as unknown as MacroEstimateResult;

              // Store pending estimate for confirmation
              storePendingEstimate(command.user_id, command.channel_id, estimate, pluginDb);

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
            } else {
              // No structured estimate - show raw response
              await respond(
                buildResponse([
                  header('Food Analysis'),
                  section(result.response),
                  context('Tip: Use `/lift m c<carbs> p<protein> f<fat>` to log macros'),
                ])
              );
            }
          } catch (error) {
            logger.error('Failed to analyze food image', { error, imageUrl: imageInfo.url });
            const message = error instanceof Error ? error.message : 'Unknown error';
            await respond(
              buildResponse([
                section(`:x: Failed to analyze image: ${message}`),
              ])
            );
          } finally {
            // Cleanup temp file
            await cleanupTempImage(tempPath);
          }
          break;
        }

        case 'w':
        case 'warmup': {
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          await handleWarmupCommand(args.slice(1), GYM_PLATES, unit, respond);
          break;
        }

        case 'wh': {
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          await handleWarmupCommand(args.slice(1), HOME_PLATES, unit, respond);
          break;
        }

        case 'h':
        case 'help':
        default: {
          const helpUnit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          await respond(
            buildResponse([
              header('Lift Plugin'),
              section('*Workout Tracking:*'),
              section(
                '`/lift log <exercise> <weight> <reps> [@rpe]` - Log a set\n' +
                  '`/lift workout` - Today\'s workout\n' +
                  '`/lift workout -1` - Yesterday\'s workout\n' +
                  '`/lift pr` - All personal records\n' +
                  '`/lift pr squat` - PR for specific exercise'
              ),
              divider(),
              section('*Calculators:*'),
              section(
                '`/lift wilks <total> <bw> <m|f>` - Wilks score\n' +
                  '`/lift dots <total> <bw> <m|f>` - DOTS score\n' +
                  '`/lift 1rm <weight> <reps>` - Estimate 1RM\n' +
                  '`/lift w <weight>` - Warmup sets\n' +
                  '`/lift wh <weight>` - Home warmup (5lb/45lb bar)'
              ),
              context(`Weights in ${helpUnit} | Change with \`/lift units lbs\` or \`/lift units kg\``),
              divider(),
              section('*Quick Food Analysis:*'),
              section(
                '`/lift a` - Analyze latest photo in channel\n' +
                  '`/lift a breakfast` - With meal context hint'
              ),
              divider(),
              section('*Macro Tracking:*'),
              section(
                '`/lift m c20 p40 f15` - Log macros\n' +
                  '`/lift m` - Today\'s totals\n' +
                  '`/lift m -1` - Yesterday\n' +
                  '`/lift m 1/15` - Specific date\n' +
                  '`/lift m 1/10-1/15` - Date range\n' +
                  '`/lift m confirm` - Confirm pending estimate\n' +
                  '`/lift m adjust c50 p30 f15` - Adjust and log'
              ),
              divider(),
              section('*Bodyweight:*'),
              section(
                '`/lift bw <weight>` - Log today\'s bodyweight\n' +
                  '`/lift bw` - Show trend (7d/30d)'
              ),
              divider(),
              section('*Settings:*'),
              section(
                '`/lift units` - View current unit\n' +
                  '`/lift units lbs` - Set to pounds\n' +
                  '`/lift units kg` - Set to kilograms'
              ),
            ])
          );
        }
      }
    } catch (error) {
      await respond(
        buildResponse([section(`:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`)])
      );
    }
  });
}

/**
 * Lift Plugin — Web Dashboard
 *
 * Pages:
 * - /p/lift/         Dashboard home (streak, PRs, today's workout, macros, bodyweight)
 * - /p/lift/workouts Workout log with date navigation and set management
 * - /p/lift/prs      Personal records gallery with PR levels
 * - /p/lift/macros   Macro tracking view with weekly chart
 * - /p/lift/bodyweight  Bodyweight trend chart and logging
 */

import type { Request, Response } from 'express';
import type { PluginContext, PluginRouter } from '../../src/plugins/index.js';
import { renderPluginPage, pluginCard, pluginStyles, escapeHtml } from '../../src/plugins/index.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { DashboardWidget } from '../../src/plugins/types.js';
import { KG_TO_LBS, lbsToKg } from './units.js';
import { getUserUnit as getUserUnitShared } from './units.js';
import { calculate1rm, calculateWilks, calculateDots, calculatePlateConfig } from './calculations.js';
import { GYM_PLATES, HOME_PLATES, WARMUP_PERCENTAGES } from './types.js';

// ─── Types (web-specific row shapes) ─────────────────────────────────

interface WorkoutSet {
  id: number;
  exercise: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  logged_at: number;
}

interface PRRecord {
  exercise: string;
  weight_kg: number;
  reps: number;
  estimated_1rm_kg: number;
  logged_at: number;
}

interface MacroEntry {
  id: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  logged_at: number;
}

interface BodyweightEntry {
  weight_kg: number;
  logged_at: number;
}

// ─── Data Helpers ─────────────────────────────────────────────────────

function getUserUnit(db: PluginDatabase, userId: string): 'lbs' | 'kg' {
  return getUserUnitShared(userId, db);
}

function fmtW(kg: number, unit: 'lbs' | 'kg'): string {
  const val = unit === 'lbs' ? kg * KG_TO_LBS : kg;
  return `${val % 1 === 0 ? String(Math.round(val)) : val.toFixed(1)} ${unit}`;
}

function estimate1rm(weight: number, reps: number): number {
  return calculate1rm(weight, reps);
}

function getWorkoutStreak(db: PluginDatabase, userId: string): number {
  const rows = db.prepare(`
    SELECT DISTINCT date(logged_at / 1000, 'unixepoch') as day
    FROM ${db.prefix}workout_sets WHERE user_id = ?
    ORDER BY day DESC
  `).all(userId) as { day: string }[];

  if (rows.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < rows.length; i++) {
    const expected = new Date(today);
    expected.setUTCDate(expected.getUTCDate() - i);
    const expectedStr = expected.toISOString().slice(0, 10);
    if (rows[i]?.day === expectedStr) {
      streak++;
    } else if (i === 0) {
      // Allow today to be missing (day not over yet) — check if yesterday matches
      expected.setUTCDate(expected.getUTCDate() - 1);
      const yesterdayStr = expected.toISOString().slice(0, 10);
      if (rows[0]?.day === yesterdayStr) {
        streak++;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return streak;
}

function getTodaySets(db: PluginDatabase, userId: string): WorkoutSet[] {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return db.prepare(`
    SELECT id, exercise, weight_kg, reps, rpe, logged_at
    FROM ${db.prefix}workout_sets
    WHERE user_id = ? AND logged_at >= ?
    ORDER BY logged_at ASC
  `).all(userId, startOfDay.getTime()) as WorkoutSet[];
}

function getAllPRs(db: PluginDatabase, userId: string): PRRecord[] {
  const sets = db.prepare(`
    SELECT exercise, weight_kg, reps, logged_at
    FROM ${db.prefix}workout_sets WHERE user_id = ?
  `).all(userId) as { exercise: string; weight_kg: number; reps: number; logged_at: number }[];

  const prMap = new Map<string, PRRecord>();
  for (const s of sets) {
    const e1rm = estimate1rm(s.weight_kg, s.reps);
    const existing = prMap.get(s.exercise);
    if (!existing || e1rm > existing.estimated_1rm_kg) {
      prMap.set(s.exercise, { exercise: s.exercise, weight_kg: s.weight_kg, reps: s.reps, estimated_1rm_kg: e1rm, logged_at: s.logged_at });
    }
  }
  return [...prMap.values()].sort((a, b) => a.exercise.localeCompare(b.exercise));
}

function getTodayMacros(db: PluginDatabase, userId: string): { carbs: number; protein: number; fat: number; entries: number } {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = db.prepare(`
    SELECT carbs_g, protein_g, fat_g FROM ${db.prefix}macros
    WHERE user_id = ? AND logged_at >= ?
  `).all(userId, startOfDay.getTime()) as { carbs_g: number; protein_g: number; fat_g: number }[];

  return rows.reduce((acc, r) => ({
    carbs: acc.carbs + r.carbs_g,
    protein: acc.protein + r.protein_g,
    fat: acc.fat + r.fat_g,
    entries: acc.entries + 1,
  }), { carbs: 0, protein: 0, fat: 0, entries: 0 });
}

function getRecentBodyweight(db: PluginDatabase, userId: string, days: number): BodyweightEntry[] {
  const cutoff = Date.now() - days * 86400000;
  return db.prepare(`
    SELECT weight_kg, logged_at FROM ${db.prefix}bodyweight
    WHERE user_id = ? AND logged_at >= ?
    ORDER BY logged_at ASC
  `).all(userId, cutoff) as BodyweightEntry[];
}

function getStreakEmoji(streak: number): string {
  if (streak >= 90) return '&#x1F525;&#x1F451;'; // fire + crown
  if (streak >= 30) return '&#x1F525;&#x1F4AA;'; // fire + flexed bicep
  if (streak >= 14) return '&#x1F525;&#x1F525;'; // double fire
  if (streak >= 7) return '&#x1F525;';            // fire
  if (streak >= 3) return '&#x2B50;';             // star
  return '';
}

function getStreakLabel(streak: number): string {
  if (streak >= 90) return 'LEGENDARY';
  if (streak >= 60) return 'UNSTOPPABLE';
  if (streak >= 30) return 'ON FIRE';
  if (streak >= 14) return 'DEDICATED';
  if (streak >= 7) return 'ROLLING';
  return '';
}

function getWilksClassification(score: number): string {
  if (score >= 500) return 'Elite';
  if (score >= 400) return 'International';
  if (score >= 350) return 'Advanced';
  if (score >= 300) return 'Intermediate';
  if (score >= 200) return 'Novice';
  return 'Beginner';
}

// ─── CSS ──────────────────────────────────────────────────────────────

const liftCSS = `
  .lift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin: 16px 0; }
  .lift-stat { text-align: center; padding: 20px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; }
  .lift-stat-value { font-size: 2rem; font-weight: 700; color: var(--text); }
  .lift-stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }

  .streak-card { text-align: center; padding: 24px; background: linear-gradient(135deg, rgba(255,184,108,0.1), rgba(255,121,198,0.1)); border: 1px solid var(--yellow); border-radius: 12px; }
  .streak-count { font-size: 3rem; font-weight: 800; color: var(--yellow); line-height: 1; }
  .streak-label { font-size: 0.875rem; font-weight: 600; color: var(--orange); margin-top: 4px; letter-spacing: 2px; }
  .streak-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; }

  .pr-card { padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .pr-card.recent { border-color: var(--yellow); background: linear-gradient(135deg, rgba(241,250,140,0.05), transparent); }
  .pr-exercise { font-weight: 600; color: var(--text); }
  .pr-value { font-family: 'SF Mono', monospace; color: var(--cyan); font-size: 0.875rem; }
  .pr-date { font-size: 0.6875rem; color: var(--text-muted); }
  .pr-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.625rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
  .pr-badge.gold { background: rgba(241,250,140,0.2); color: var(--yellow); }

  .macro-ring { display: flex; align-items: center; gap: 16px; padding: 16px; }
  .macro-bars { flex: 1; }
  .macro-bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .macro-bar-fill { height: 20px; border-radius: 4px; min-width: 4px; transition: width 0.3s; }
  .macro-bar-label { font-size: 0.75rem; color: var(--text-muted); min-width: 60px; }
  .macro-bar-value { font-size: 0.75rem; font-family: 'SF Mono', monospace; color: var(--text); min-width: 40px; text-align: right; }
  .macro-calories { text-align: center; min-width: 80px; }
  .macro-cal-value { font-size: 1.5rem; font-weight: 700; color: var(--text); }
  .macro-cal-label { font-size: 0.625rem; color: var(--text-muted); text-transform: uppercase; }

  .workout-group { margin-bottom: 16px; }
  .workout-exercise { font-weight: 600; color: var(--cyan); font-size: 0.9375rem; margin-bottom: 6px; }
  .workout-set { display: flex; gap: 12px; padding: 4px 0; font-size: 0.8125rem; color: var(--text-muted); }
  .workout-set strong { color: var(--text); }

  .inline-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
  .inline-form input, .inline-form select { padding: 6px 10px; font-size: 0.8125rem; font-family: inherit; background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
  .inline-form input:focus { border-color: var(--accent); outline: none; }
  .inline-form button { padding: 6px 14px; font-size: 0.8125rem; font-family: inherit; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  .inline-form button:hover { opacity: 0.9; }

  .delete-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
  .delete-btn:hover { color: var(--red); background: rgba(255,85,85,0.1); }

  .nav-pills { display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap; }
  .nav-pill { padding: 8px 18px; font-size: 0.875rem; text-decoration: none; border-radius: 20px; background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
  .nav-pill:hover { color: var(--text); border-color: var(--accent); }
  .nav-pill.active { background: var(--accent); color: #fff; border-color: var(--accent); }

  .bw-chart { display: flex; align-items: flex-end; gap: 2px; height: 80px; padding: 8px 0; }
  .bw-bar { flex: 1; background: var(--cyan); border-radius: 2px 2px 0 0; min-width: 3px; opacity: 0.7; transition: opacity 0.2s; }
  .bw-bar:hover { opacity: 1; }

  .calc-result { margin-top: 12px; padding: 16px; background: var(--surface); border-radius: 8px; }
  .calc-result-value { font-size: 1.5rem; font-weight: 700; color: var(--cyan); }
  .calc-result-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-top: 2px; }
  .calc-result-sub { font-size: 0.8125rem; color: var(--text-muted); margin-top: 4px; }
  .warmup-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-top: 8px; }
  .warmup-table th, .warmup-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  .warmup-table th { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
  .warmup-table td:first-child { font-weight: 600; }

  @media (max-width: 640px) {
    .plugin-lift .lift-grid { grid-template-columns: 1fr; gap: 12px; }
    .plugin-lift .nav-pills { gap: 4px; }
    .plugin-lift .nav-pill { padding: 6px 10px; font-size: 0.75rem; }
    .plugin-lift .inline-form { flex-direction: column; align-items: stretch; }
    .plugin-lift .inline-form input,
    .plugin-lift .inline-form select { width: 100% !important; }
    .plugin-lift .inline-form button { width: 100%; padding: 10px; }
    .plugin-lift .streak-count { font-size: 2rem; }
    .plugin-lift .pr-card { flex-direction: column; align-items: flex-start; gap: 4px; }
    .plugin-lift .macro-ring { flex-direction: column; }
    .plugin-lift .bw-chart { height: 60px; }
    .plugin-lift .lift-stat-value { font-size: 1.5rem; }
    .plugin-lift .warmup-table th,
    .plugin-lift .warmup-table td { padding: 6px 8px; font-size: 0.75rem; }
  }
`;

// ─── Navigation ───────────────────────────────────────────────────────

function liftNav(active: string): string {
  const pills = [
    { href: '/p/lift/', label: 'Dashboard', key: 'dashboard' },
    { href: '/p/lift/workouts', label: 'Workouts', key: 'workouts' },
    { href: '/p/lift/prs', label: 'PRs', key: 'prs' },
    { href: '/p/lift/macros', label: 'Macros', key: 'macros' },
    { href: '/p/lift/bodyweight', label: 'Bodyweight', key: 'bodyweight' },
    { href: '/p/lift/calculator', label: 'Calculator', key: 'calculator' },
  ];
  return `<nav class="nav-pills">${pills.map((p) =>
    `<a href="${p.href}" class="nav-pill${p.key === active ? ' active' : ''}">${p.label}</a>`
  ).join('')}</nav>`;
}

// ─── Page: Dashboard Home ─────────────────────────────────────────────

function renderDashboard(db: PluginDatabase, userId: string): string {
  const unit = getUserUnit(db, userId);
  const streak = getWorkoutStreak(db, userId);
  const todaySets = getTodaySets(db, userId);
  const prs = getAllPRs(db, userId);
  const macros = getTodayMacros(db, userId);
  const bw = getRecentBodyweight(db, userId, 30);
  const calories = Math.round(macros.carbs * 4 + macros.protein * 4 + macros.fat * 9);

  // Group today's sets by exercise
  const exerciseGroups = new Map<string, WorkoutSet[]>();
  for (const s of todaySets) {
    const group = exerciseGroups.get(s.exercise) ?? [];
    group.push(s);
    exerciseGroups.set(s.exercise, group);
  }

  const totalVolume = todaySets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);

  // Streak card
  const streakHtml = `
    <div class="streak-card">
      <div class="streak-count">${String(streak)} ${getStreakEmoji(streak)}</div>
      <div class="streak-label">${streak > 0 ? `${getStreakLabel(streak)} STREAK` : 'START YOUR STREAK'}</div>
      <div class="streak-sub">${streak > 0 ? 'consecutive workout days' : 'Log a workout to begin!'}</div>
    </div>`;

  // Today's workout
  let workoutHtml = '';
  if (exerciseGroups.size > 0) {
    let wkBody = '';
    for (const [exercise, sets] of exerciseGroups) {
      wkBody += `<div class="workout-group"><div class="workout-exercise">${escapeHtml(exercise)}</div>`;
      for (const s of sets) {
        wkBody += `<div class="workout-set"><strong>${fmtW(s.weight_kg, unit)}</strong> x ${String(s.reps)}${s.rpe ? ` @${String(s.rpe)}` : ''}</div>`;
      }
      wkBody += '</div>';
    }
    wkBody += `<div style="margin-top:8px;font-size:0.75rem;color:var(--text-muted);">${String(exerciseGroups.size)} exercises, ${String(todaySets.length)} sets, ${fmtW(totalVolume, unit)} total volume</div>`;
    workoutHtml = pluginCard("Today's Workout", wkBody, { icon: 'activity' });
  } else {
    workoutHtml = pluginCard("Today's Workout", '<p style="color:var(--text-muted);">No sets logged yet today. Get after it!</p>', { icon: 'activity' });
  }

  // Recent PRs (last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const recentPRs = prs.filter((p) => p.logged_at > thirtyDaysAgo).slice(0, 5);
  let prHtml = '';
  if (recentPRs.length > 0) {
    prHtml = recentPRs.map((p) =>
      `<div class="pr-card recent"><div><span class="pr-exercise">${escapeHtml(p.exercise)}</span> <span class="pr-badge gold">PR</span></div><div><span class="pr-value">${fmtW(p.weight_kg, unit)} x ${String(p.reps)}</span></div></div>`
    ).join('');
  } else {
    prHtml = '<p style="color:var(--text-muted);">No recent PRs. Time to push some limits!</p>';
  }

  // Macros
  const maxMacro = Math.max(macros.carbs, macros.protein, macros.fat, 1);
  const macroHtml = `
    <div class="macro-ring">
      <div class="macro-bars">
        <div class="macro-bar"><span class="macro-bar-label">Carbs</span><div class="macro-bar-fill" style="width:${String(Math.round(macros.carbs / maxMacro * 100))}%;background:var(--cyan);"></div><span class="macro-bar-value">${String(Math.round(macros.carbs))}g</span></div>
        <div class="macro-bar"><span class="macro-bar-label">Protein</span><div class="macro-bar-fill" style="width:${String(Math.round(macros.protein / maxMacro * 100))}%;background:var(--green);"></div><span class="macro-bar-value">${String(Math.round(macros.protein))}g</span></div>
        <div class="macro-bar"><span class="macro-bar-label">Fat</span><div class="macro-bar-fill" style="width:${String(Math.round(macros.fat / maxMacro * 100))}%;background:var(--orange);"></div><span class="macro-bar-value">${String(Math.round(macros.fat))}g</span></div>
      </div>
      <div class="macro-calories"><div class="macro-cal-value">${String(calories)}</div><div class="macro-cal-label">calories</div></div>
    </div>`;

  // Bodyweight sparkline
  let bwHtml = '';
  if (bw.length > 0) {
    const weights = bw.map((b) => unit === 'lbs' ? b.weight_kg * KG_TO_LBS : b.weight_kg);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;
    const bars = weights.map((w) => {
      const pct = Math.max(10, ((w - minW) / range) * 100);
      return `<div class="bw-bar" style="height:${String(Math.round(pct))}%;" title="${w.toFixed(1)} ${unit}"></div>`;
    }).join('');
    const latest = weights[weights.length - 1] ?? 0;
    bwHtml = `<div class="bw-chart">${bars}</div><div style="font-size:0.75rem;color:var(--text-muted);">Current: <strong style="color:var(--text);">${latest.toFixed(1)} ${unit}</strong> (${String(bw.length)} entries, 30d)</div>`;
  } else {
    bwHtml = '<p style="color:var(--text-muted);">No bodyweight data. Log with <code>/lift bw</code></p>';
  }

  const body = `
    ${liftNav('dashboard')}
    <div class="lift-grid">
      <div>${streakHtml}</div>
      <div>${pluginCard("Today's Macros", macroHtml, { icon: 'chart' })}</div>
    </div>
    ${workoutHtml}
    ${pluginCard('Recent PRs', prHtml, { icon: 'star', link: '/p/lift/prs' })}
    ${pluginCard('Bodyweight Trend', bwHtml, { icon: 'activity', link: '/p/lift/bodyweight' })}
  `;

  return renderPluginPage({ title: 'Lift Dashboard', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Page: Workouts ───────────────────────────────────────────────────

function renderWorkouts(db: PluginDatabase, userId: string, dateOffset: number): string {
  const unit = getUserUnit(db, userId);
  const targetDate = new Date();
  targetDate.setUTCDate(targetDate.getUTCDate() + dateOffset);
  targetDate.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(targetDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const sets = db.prepare(`
    SELECT id, exercise, weight_kg, reps, rpe, logged_at
    FROM ${db.prefix}workout_sets
    WHERE user_id = ? AND logged_at >= ? AND logged_at < ?
    ORDER BY logged_at ASC
  `).all(userId, targetDate.getTime(), nextDay.getTime()) as WorkoutSet[];

  const dateLabel = targetDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const isToday = dateOffset === 0;

  // Group by exercise
  const groups = new Map<string, WorkoutSet[]>();
  for (const s of sets) {
    const g = groups.get(s.exercise) ?? [];
    g.push(s);
    groups.set(s.exercise, g);
  }

  let setsHtml = '';
  if (groups.size > 0) {
    for (const [exercise, exSets] of groups) {
      setsHtml += `<div class="workout-group"><div class="workout-exercise">${escapeHtml(exercise)}</div>`;
      for (const s of exSets) {
        setsHtml += `<div class="workout-set">
          <strong>${fmtW(s.weight_kg, unit)}</strong> x ${String(s.reps)}${s.rpe ? ` @${String(s.rpe)}` : ''}
          <form method="POST" action="/p/lift/sets/${String(s.id)}/delete" style="display:inline;margin-left:auto;">
            <button type="submit" class="delete-btn" onclick="return confirm('Delete this set?')">x</button>
          </form>
        </div>`;
      }
      setsHtml += '</div>';
    }
  } else {
    setsHtml = `<p style="color:var(--text-muted);">No sets logged${isToday ? ' yet today' : ' this day'}.</p>`;
  }

  // Log form (only on today)
  const logForm = isToday ? `
    <form class="inline-form" method="POST" action="/p/lift/log">
      <input name="exercise" placeholder="Exercise" required style="width:140px;">
      <input name="weight" type="number" step="0.5" placeholder="Weight" required style="width:80px;">
      <input name="reps" type="number" min="1" placeholder="Reps" required style="width:60px;">
      <input name="rpe" type="number" min="1" max="10" step="0.5" placeholder="RPE" style="width:60px;">
      <button type="submit">Log Set</button>
    </form>` : '';

  // Date navigation
  const prevOffset = dateOffset - 1;
  const nextOffset = dateOffset + 1;
  const navHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin:12px 0;">
      <a href="/p/lift/workouts?d=${String(prevOffset)}" style="color:var(--link);">&larr; Prev</a>
      <strong>${dateLabel}${isToday ? ' (Today)' : ''}</strong>
      ${dateOffset < 0 ? `<a href="/p/lift/workouts?d=${String(nextOffset)}" style="color:var(--link);">Next &rarr;</a>` : ''}
    </div>`;

  const body = `
    ${liftNav('workouts')}
    ${navHtml}
    ${logForm}
    ${pluginCard(`Workout — ${dateLabel}`, setsHtml, { icon: 'activity' })}
  `;

  return renderPluginPage({ title: 'Workouts — Lift', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Page: PRs ────────────────────────────────────────────────────────

function renderPRs(db: PluginDatabase, userId: string): string {
  const unit = getUserUnit(db, userId);
  const prs = getAllPRs(db, userId);
  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  const prCards = prs.length > 0
    ? prs.map((p) => {
        const isRecent = p.logged_at > thirtyDaysAgo;
        const dateStr = new Date(p.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `
          <div class="pr-card${isRecent ? ' recent' : ''}">
            <div>
              <span class="pr-exercise">${escapeHtml(p.exercise)}</span>
              ${isRecent ? '<span class="pr-badge gold">NEW</span>' : ''}
              <div class="pr-date">${dateStr}</div>
            </div>
            <div style="text-align:right;">
              <div class="pr-value">${fmtW(p.weight_kg, unit)} x ${String(p.reps)}</div>
              <div class="pr-date">Est. 1RM: ${fmtW(p.estimated_1rm_kg, unit)}</div>
            </div>
          </div>`;
      }).join('')
    : '<p style="color:var(--text-muted);">No personal records yet. Start logging workouts!</p>';

  const body = `
    ${liftNav('prs')}
    <h2 style="margin:16px 0 8px;">Personal Records (${String(prs.length)} exercises)</h2>
    ${prCards}
  `;

  return renderPluginPage({ title: 'PRs — Lift', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Page: Macros ─────────────────────────────────────────────────────

function renderMacros(db: PluginDatabase, userId: string): string {
  const today = getTodayMacros(db, userId);
  const calories = Math.round(today.carbs * 4 + today.protein * 4 + today.fat * 9);

  // Last 7 days
  const weekData: { label: string; carbs: number; protein: number; fat: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setUTCDate(dayStart.getUTCDate() - i);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const rows = db.prepare(`
      SELECT carbs_g, protein_g, fat_g FROM ${db.prefix}macros
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?
    `).all(userId, dayStart.getTime(), dayEnd.getTime()) as { carbs_g: number; protein_g: number; fat_g: number }[];

    const totals = rows.reduce((acc, r) => ({
      carbs: acc.carbs + r.carbs_g, protein: acc.protein + r.protein_g, fat: acc.fat + r.fat_g,
    }), { carbs: 0, protein: 0, fat: 0 });

    weekData.push({ label: dayStart.toLocaleDateString('en-US', { weekday: 'short' }), ...totals });
  }

  const maxCal = Math.max(...weekData.map((d) => d.carbs * 4 + d.protein * 4 + d.fat * 9), 1);
  const weekChart = weekData.map((d) => {
    const cal = Math.round(d.carbs * 4 + d.protein * 4 + d.fat * 9);
    const pct = Math.round((cal / maxCal) * 100);
    return `<div style="text-align:center;flex:1;"><div style="height:60px;display:flex;align-items:flex-end;justify-content:center;"><div style="width:100%;max-width:30px;height:${String(Math.max(4, pct))}%;background:var(--cyan);border-radius:3px 3px 0 0;"></div></div><div style="font-size:0.625rem;color:var(--text-muted);margin-top:4px;">${d.label}</div><div style="font-size:0.625rem;color:var(--text);">${String(cal)}</div></div>`;
  }).join('');

  // Today's entries for deletion
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const entries = db.prepare(`
    SELECT id, carbs_g, protein_g, fat_g, logged_at FROM ${db.prefix}macros
    WHERE user_id = ? AND logged_at >= ?
    ORDER BY logged_at ASC
  `).all(userId, startOfDay.getTime()) as MacroEntry[];

  const entriesHtml = entries.length > 0
    ? entries.map((e) => `<div class="workout-set">
        C:${String(Math.round(e.carbs_g))}g P:${String(Math.round(e.protein_g))}g F:${String(Math.round(e.fat_g))}g
        <span style="color:var(--text-muted);font-size:0.6875rem;">${new Date(e.logged_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        <form method="POST" action="/p/lift/macros/${String(e.id)}/delete" style="display:inline;margin-left:auto;"><button type="submit" class="delete-btn" onclick="return confirm('Delete?')">x</button></form>
      </div>`).join('')
    : '<p style="color:var(--text-muted);">No entries today.</p>';

  const maxMacro = Math.max(today.carbs, today.protein, today.fat, 1);
  const todayBars = `
    <div class="macro-ring">
      <div class="macro-bars">
        <div class="macro-bar"><span class="macro-bar-label">Carbs</span><div class="macro-bar-fill" style="width:${String(Math.round(today.carbs / maxMacro * 100))}%;background:var(--cyan);"></div><span class="macro-bar-value">${String(Math.round(today.carbs))}g</span></div>
        <div class="macro-bar"><span class="macro-bar-label">Protein</span><div class="macro-bar-fill" style="width:${String(Math.round(today.protein / maxMacro * 100))}%;background:var(--green);"></div><span class="macro-bar-value">${String(Math.round(today.protein))}g</span></div>
        <div class="macro-bar"><span class="macro-bar-label">Fat</span><div class="macro-bar-fill" style="width:${String(Math.round(today.fat / maxMacro * 100))}%;background:var(--orange);"></div><span class="macro-bar-value">${String(Math.round(today.fat))}g</span></div>
      </div>
      <div class="macro-calories"><div class="macro-cal-value">${String(calories)}</div><div class="macro-cal-label">calories</div></div>
    </div>`;

  const body = `
    ${liftNav('macros')}
    ${pluginCard("Today's Macros", todayBars, { icon: 'chart' })}
    <form class="inline-form" method="POST" action="/p/lift/macros/log">
      <input name="carbs" type="number" step="0.1" min="0" placeholder="Carbs (g)" required style="width:90px;">
      <input name="protein" type="number" step="0.1" min="0" placeholder="Protein (g)" required style="width:90px;">
      <input name="fat" type="number" step="0.1" min="0" placeholder="Fat (g)" required style="width:90px;">
      <button type="submit">Log Macros</button>
    </form>
    ${pluginCard('This Week', `<div style="display:flex;gap:4px;align-items:flex-end;">${weekChart}</div>`, { icon: 'chart' })}
    ${pluginCard("Today's Entries", entriesHtml)}
  `;

  return renderPluginPage({ title: 'Macros — Lift', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Page: Bodyweight ─────────────────────────────────────────────────

function renderBodyweight(db: PluginDatabase, userId: string): string {
  const unit = getUserUnit(db, userId);
  const history = getRecentBodyweight(db, userId, 90);

  let chartHtml = '';
  let statsHtml = '';

  if (history.length > 0) {
    const weights = history.map((b) => unit === 'lbs' ? b.weight_kg * KG_TO_LBS : b.weight_kg);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;
    const latest = weights[weights.length - 1] ?? 0;
    const avg7 = weights.slice(-7).reduce((a, b) => a + b, 0) / Math.min(weights.length, 7);
    const avg30 = weights.slice(-30).reduce((a, b) => a + b, 0) / Math.min(weights.length, 30);

    const bars = history.map((b) => {
      const w = unit === 'lbs' ? b.weight_kg * KG_TO_LBS : b.weight_kg;
      const pct = Math.max(10, ((w - minW) / range) * 100);
      const dateStr = new Date(b.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<div class="bw-bar" style="height:${String(Math.round(pct))}%;" title="${w.toFixed(1)} ${unit} — ${dateStr}"></div>`;
    }).join('');
    chartHtml = `<div class="bw-chart" style="height:120px;">${bars}</div>`;

    statsHtml = `<div class="lift-grid">
      <div class="lift-stat"><div class="lift-stat-value">${latest.toFixed(1)}</div><div class="lift-stat-label">Current (${unit})</div></div>
      <div class="lift-stat"><div class="lift-stat-value">${avg7.toFixed(1)}</div><div class="lift-stat-label">7-Day Avg</div></div>
      <div class="lift-stat"><div class="lift-stat-value">${avg30.toFixed(1)}</div><div class="lift-stat-label">30-Day Avg</div></div>
    </div>`;
  } else {
    chartHtml = '<p style="color:var(--text-muted);">No bodyweight data yet. Start logging!</p>';
  }

  const body = `
    ${liftNav('bodyweight')}
    ${pluginCard('Bodyweight Trend (90 days)', chartHtml + statsHtml, { icon: 'activity' })}
    <form class="inline-form" method="POST" action="/p/lift/bodyweight/log">
      <input name="weight" type="number" step="0.1" min="1" placeholder="Weight (${unit})" required style="width:120px;">
      <button type="submit">Log Bodyweight</button>
    </form>
  `;

  return renderPluginPage({ title: 'Bodyweight — Lift', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Page: Calculator ────────────────────────────────────────────────

interface CalculatorResult {
  type: 'rm' | 'wilks' | 'dots' | 'plates';
  value?: string;
  label?: string;
  sub?: string;
  warmupRows?: { pct: string; weight: string; plates: string }[];
}

function renderCalculator(db: PluginDatabase, userId: string, result?: CalculatorResult): string {
  const unit = getUserUnit(db, userId);
  const unitLabel = unit;

  // 1RM result
  let rmResultHtml = '';
  if (result?.type === 'rm') {
    rmResultHtml = `<div class="calc-result"><div class="calc-result-value">${escapeHtml(result.value ?? '')}</div><div class="calc-result-label">${escapeHtml(result.label ?? '')}</div></div>`;
  }

  // Wilks result
  let wilksResultHtml = '';
  if (result?.type === 'wilks') {
    wilksResultHtml = `<div class="calc-result"><div class="calc-result-value">${escapeHtml(result.value ?? '')}</div><div class="calc-result-label">${escapeHtml(result.label ?? '')}</div>${result.sub ? `<div class="calc-result-sub">${escapeHtml(result.sub)}</div>` : ''}</div>`;
  }

  // DOTS result
  let dotsResultHtml = '';
  if (result?.type === 'dots') {
    dotsResultHtml = `<div class="calc-result"><div class="calc-result-value">${escapeHtml(result.value ?? '')}</div><div class="calc-result-label">${escapeHtml(result.label ?? '')}</div></div>`;
  }

  // Plate/warmup result
  let platesResultHtml = '';
  if (result?.type === 'plates' && result.warmupRows) {
    const rows = result.warmupRows.map((r) =>
      `<tr><td>${escapeHtml(r.pct)}</td><td>${escapeHtml(r.weight)}</td><td>${escapeHtml(r.plates)}</td></tr>`
    ).join('');
    platesResultHtml = `<div class="calc-result">
      <div class="calc-result-value">${escapeHtml(result.value ?? '')}</div>
      <div class="calc-result-label">${escapeHtml(result.label ?? '')}</div>
      <table class="warmup-table"><thead><tr><th>%</th><th>Weight</th><th>Plates</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  const body = `
    ${liftNav('calculator')}
    ${pluginCard('1RM Estimator', `
      <form class="inline-form" method="POST" action="/p/lift/calculator">
        <input type="hidden" name="calc" value="rm">
        <input name="weight" type="number" step="0.5" min="1" placeholder="Weight (${unitLabel})" required style="width:120px;">
        <input name="reps" type="number" min="1" max="100" placeholder="Reps" required style="width:80px;">
        <button type="submit">Calculate</button>
      </form>
      ${rmResultHtml}
    `, { icon: 'activity' })}

    ${pluginCard('Wilks Score', `
      <form class="inline-form" method="POST" action="/p/lift/calculator">
        <input type="hidden" name="calc" value="wilks">
        <input name="total" type="number" step="0.5" min="1" placeholder="Total S+B+D (${unitLabel})" required style="width:160px;">
        <input name="bodyweight" type="number" step="0.1" min="1" placeholder="Bodyweight (${unitLabel})" required style="width:140px;">
        <select name="gender" required>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <button type="submit">Calculate</button>
      </form>
      ${wilksResultHtml}
    `, { icon: 'star' })}

    ${pluginCard('DOTS Score', `
      <form class="inline-form" method="POST" action="/p/lift/calculator">
        <input type="hidden" name="calc" value="dots">
        <input name="total" type="number" step="0.5" min="1" placeholder="Total S+B+D (${unitLabel})" required style="width:160px;">
        <input name="bodyweight" type="number" step="0.1" min="1" placeholder="Bodyweight (${unitLabel})" required style="width:140px;">
        <select name="gender" required>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <button type="submit">Calculate</button>
      </form>
      ${dotsResultHtml}
    `, { icon: 'star' })}

    ${pluginCard('Plate Calculator & Warmup', `
      <form class="inline-form" method="POST" action="/p/lift/calculator">
        <input type="hidden" name="calc" value="plates">
        <input name="target" type="number" step="0.5" min="1" max="1000" placeholder="Target weight (lbs)" required style="width:140px;">
        <select name="config">
          <option value="gym">Gym plates</option>
          <option value="home">Home plates</option>
        </select>
        <button type="submit">Calculate</button>
      </form>
      ${platesResultHtml}
    `, { icon: 'chart' })}
  `;

  return renderPluginPage({ title: 'Calculator — Lift', pluginName: 'lift', body, styles: pluginStyles('lift', liftCSS) });
}

// ─── Route Registration ───────────────────────────────────────────────

export function registerLiftWebRoutes(router: PluginRouter): void {
  // Dashboard home
  router.get('/', (_req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    res.type('html').send(renderDashboard(ctx.db, userId));
  });

  // Workouts page
  router.get('/workouts', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const offset = parseInt(String(req.query.d ?? '0'), 10) || 0;
    res.type('html').send(renderWorkouts(ctx.db, userId, Math.min(offset, 0)));
  });

  // PRs page
  router.get('/prs', (_req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    res.type('html').send(renderPRs(ctx.db, userId));
  });

  // Macros page
  router.get('/macros', (_req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    res.type('html').send(renderMacros(ctx.db, userId));
  });

  // Bodyweight page
  router.get('/bodyweight', (_req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    res.type('html').send(renderBodyweight(ctx.db, userId));
  });

  // Calculator page
  router.get('/calculator', (_req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    res.type('html').send(renderCalculator(ctx.db, userId));
  });

  router.post('/calculator', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const body = req.body as Record<string, string>;
    const calc = body.calc;
    const unit = getUserUnit(ctx.db, userId);

    let result: CalculatorResult | undefined;

    if (calc === 'rm') {
      const weight = parseFloat(body.weight ?? '');
      const reps = parseInt(body.reps ?? '', 10);
      if (!isNaN(weight) && !isNaN(reps) && weight > 0 && weight <= 2000 && reps > 0 && reps <= 100) {
        const rm = calculate1rm(weight, reps);
        result = { type: 'rm', value: `${rm % 1 === 0 ? String(Math.round(rm)) : rm.toFixed(1)} ${unit}`, label: 'Estimated 1 Rep Max' };
      }
    } else if (calc === 'wilks') {
      const total = parseFloat(body.total ?? '');
      const bw = parseFloat(body.bodyweight ?? '');
      const isMale = body.gender === 'male';
      if ((body.gender === 'male' || body.gender === 'female') && !isNaN(total) && !isNaN(bw) && total > 0 && bw > 0) {
        const totalKg = unit === 'lbs' ? total / KG_TO_LBS : total;
        const bwKg = unit === 'lbs' ? bw / KG_TO_LBS : bw;
        const score = calculateWilks(totalKg, bwKg, isMale);
        result = { type: 'wilks', value: score.toFixed(2), label: 'Wilks Score', sub: getWilksClassification(score) };
      }
    } else if (calc === 'dots') {
      const total = parseFloat(body.total ?? '');
      const bw = parseFloat(body.bodyweight ?? '');
      const isMale = body.gender === 'male';
      if ((body.gender === 'male' || body.gender === 'female') && !isNaN(total) && !isNaN(bw) && total > 0 && bw > 0) {
        const totalKg = unit === 'lbs' ? total / KG_TO_LBS : total;
        const bwKg = unit === 'lbs' ? bw / KG_TO_LBS : bw;
        const score = calculateDots(totalKg, bwKg, isMale);
        result = { type: 'dots', value: score.toFixed(2), label: 'DOTS Score' };
      }
    } else if (calc === 'plates') {
      const target = parseFloat(body.target ?? '');
      const config = body.config === 'home' ? HOME_PLATES : GYM_PLATES;
      if (!isNaN(target) && target > 0 && target <= 1000) {
        const plateStr = calculatePlateConfig(target, config);
        const warmupRows = WARMUP_PERCENTAGES.map((pct) => {
          const w = Math.round(target * pct);
          return { pct: `${Math.round(pct * 100)}%`, weight: `${String(w)} lbs`, plates: calculatePlateConfig(w, config) };
        });
        result = { type: 'plates', value: plateStr, label: `Plate loading for ${String(Math.round(target))} lbs`, warmupRows };
      }
    }

    res.type('html').send(renderCalculator(ctx.db, userId, result));
  });

  // ─── POST: Log workout set ──────────────────────────────────────────
  router.post('/log', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const body = req.body as Record<string, string>;
    const exercise = body.exercise?.trim();
    const weight = parseFloat(body.weight ?? '');
    const reps = parseInt(body.reps ?? '', 10);
    const rpe = body.rpe ? parseFloat(body.rpe) : null;

    if (!exercise || isNaN(weight) || isNaN(reps) || weight <= 0 || reps <= 0
        || weight > 2000 || reps > 100 || (rpe !== null && (rpe < 1 || rpe > 10))) {
      res.redirect('/p/lift/workouts');
      return;
    }

    const unit = getUserUnit(ctx.db, userId);
    const weightKg = unit === 'lbs' ? lbsToKg(weight) : weight;
    const now = Date.now();

    ctx.db.prepare(`
      INSERT INTO ${ctx.db.prefix}workout_sets (user_id, exercise, weight_kg, reps, rpe, logged_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, exercise.toLowerCase(), weightKg, reps, rpe, now, now);

    res.redirect('/p/lift/workouts');
  });

  // ─── POST: Delete workout set ───────────────────────────────────────
  router.post('/sets/:id/delete', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!isNaN(id)) {
      ctx.db.prepare(`DELETE FROM ${ctx.db.prefix}workout_sets WHERE id = ? AND user_id = ?`).run(id, userId);
    }
    res.redirect('/p/lift/workouts');
  });

  // ─── POST: Log macros ───────────────────────────────────────────────
  router.post('/macros/log', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const body = req.body as Record<string, string>;
    const carbs = parseFloat(body.carbs ?? '');
    const protein = parseFloat(body.protein ?? '');
    const fat = parseFloat(body.fat ?? '');

    if (isNaN(carbs) || isNaN(protein) || isNaN(fat)
        || carbs < 0 || protein < 0 || fat < 0
        || carbs > 5000 || protein > 2000 || fat > 2000) {
      res.redirect('/p/lift/macros');
      return;
    }

    const now = Date.now();
    ctx.db.prepare(`
      INSERT INTO ${ctx.db.prefix}macros (user_id, carbs_g, protein_g, fat_g, logged_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, carbs, protein, fat, now, now);

    res.redirect('/p/lift/macros');
  });

  // ─── POST: Delete macro entry ───────────────────────────────────────
  router.post('/macros/:id/delete', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!isNaN(id)) {
      ctx.db.prepare(`DELETE FROM ${ctx.db.prefix}macros WHERE id = ? AND user_id = ?`).run(id, userId);
    }
    res.redirect('/p/lift/macros');
  });

  // ─── POST: Log bodyweight ──────────────────────────────────────────
  router.post('/bodyweight/log', (req: Request, res: Response, ctx: PluginContext) => {
    const userId = (res.locals.userId as string) ?? 'web-user';
    const body = req.body as Record<string, string>;
    const weight = parseFloat(body.weight ?? '');

    if (isNaN(weight) || weight <= 0 || weight > 1000) {
      res.redirect('/p/lift/bodyweight');
      return;
    }

    const unit = getUserUnit(ctx.db, userId);
    const weightKg = unit === 'lbs' ? lbsToKg(weight) : weight;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Upsert: one entry per day
    ctx.db.prepare(`
      INSERT OR REPLACE INTO ${ctx.db.prefix}bodyweight (user_id, weight_kg, logged_at)
      VALUES (?, ?, ?)
    `).run(userId, weightKg, startOfDay.getTime());

    res.redirect('/p/lift/bodyweight');
  });
}

// ─── Dashboard Widget ─────────────────────────────────────────────────

export function getLiftWidgets(db: PluginDatabase): DashboardWidget[] {
  // Widget shows aggregate stats since getWidgets() has no user context
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const todaySets = db.prepare(`
    SELECT COUNT(*) as count FROM ${db.prefix}workout_sets WHERE logged_at >= ?
  `).get(startOfDay.getTime()) as { count: number };

  const totalExercises = db.prepare(`
    SELECT COUNT(DISTINCT exercise) as count FROM ${db.prefix}workout_sets WHERE logged_at >= ?
  `).get(startOfDay.getTime()) as { count: number };

  const todayDisplay = todaySets.count > 0
    ? `${String(totalExercises.count)} exercises, ${String(todaySets.count)} sets logged today`
    : 'No workouts logged today';

  return [{
    title: 'Lift',
    icon: 'activity',
    link: '/p/lift/',
    priority: 20,
    size: 'medium',
    html: `<div style="font-size:0.875rem;">${todayDisplay}</div>`,
  }];
}

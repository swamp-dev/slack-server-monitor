/**
 * Health Plugin - Web Dashboard
 *
 * Provides a web UI for the family health tracker:
 * - Dashboard home with family member cards and medication status
 * - Member detail pages with medication management, dose logging, appointments, vaccinations
 * - Medications overview across all family members
 * - POST endpoints for all CRUD actions
 */

import type { PluginRouter } from '../../src/plugins/index.js';
import type { PluginContext, PluginSSE } from '../../src/plugins/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { DashboardWidget } from '../../src/plugins/types.js';
import {
  renderPluginPage,
  pluginCard,
  pluginTable,
  escapeHtml,
} from '../../src/plugins/index.js';
import type {
  Frequency,
} from '../health.js';
import {
  dosesExpectedToday,
  formatDateShort,
  formatDateWithDay,
  getStartOfDay,
  parseFrequency,
  parseAppointmentDate,
  parseVaxDate,
} from '../health.js';

// =============================================================================
// Types (mirroring health.ts internal types)
// =============================================================================

interface Member {
  id: number;
  user_id: string;
  name: string;
  created_at: number;
}

interface Medication {
  id: number;
  user_id: string;
  member_id: number;
  name: string;
  dosage: string;
  frequency: Frequency;
  active: number;
  created_at: number;
}

interface MedStatus {
  member_name: string;
  member_id: number;
  med_name: string;
  med_id: number;
  dosage: string;
  frequency: Frequency;
  doses_today: number;
}

interface Appointment {
  id: number;
  user_id: string;
  member_id: number;
  appointment_date: number;
  type: string;
  notes: string | null;
  created_at: number;
  member_name?: string;
}

interface Vaccination {
  id: number;
  user_id: string;
  member_id: number;
  vaccine_name: string;
  administered_date: number;
  notes: string | null;
  created_at: number;
}

// =============================================================================
// Module state
// =============================================================================

let sseBroadcast: PluginSSE | null = null;

/**
 * Store SSE reference for dose broadcast from Slack commands
 */
export function setSSE(sse: PluginSSE): void {
  sseBroadcast = sse;
}

// =============================================================================
// Database helpers (same queries as health.ts)
// =============================================================================

function getMembers(db: PluginDatabase, userId: string): Member[] {
  return db.prepare(
    `SELECT * FROM plugin_health_members WHERE user_id = ? ORDER BY name`
  ).all(userId) as Member[];
}

function getMemberById(db: PluginDatabase, id: number, userId: string): Member | undefined {
  return db.prepare(
    `SELECT * FROM plugin_health_members WHERE id = ? AND user_id = ?`
  ).get(id, userId) as Member | undefined;
}

function getMemberByName(db: PluginDatabase, userId: string, name: string): Member | undefined {
  return db.prepare(
    `SELECT * FROM plugin_health_members WHERE user_id = ? AND name = ? COLLATE NOCASE`
  ).get(userId, name) as Member | undefined;
}

function getActiveMeds(db: PluginDatabase, memberId: number): Medication[] {
  return db.prepare(
    `SELECT * FROM plugin_health_medications
     WHERE member_id = ? AND active = 1 ORDER BY name`
  ).all(memberId) as Medication[];
}

function getMedStatusForUser(db: PluginDatabase, userId: string, startOfDay: number): MedStatus[] {
  return db.prepare(
    `SELECT m.name as member_name, m.id as member_id, med.name as med_name, med.id as med_id,
            med.dosage, med.frequency,
            (SELECT COUNT(*) FROM plugin_health_doses d
             WHERE d.medication_id = med.id AND d.taken_at >= ?) as doses_today
     FROM plugin_health_medications med
     JOIN plugin_health_members m ON med.member_id = m.id
     WHERE med.user_id = ? AND med.active = 1
     ORDER BY m.name, med.name`
  ).all(startOfDay, userId) as MedStatus[];
}

function getUpcomingAppointments(
  db: PluginDatabase,
  userId: string,
  fromTs: number,
  days: number
): (Appointment & { member_name: string })[] {
  const toTs = fromTs + days * 24 * 60 * 60 * 1000;
  return db.prepare(
    `SELECT a.*, m.name as member_name
     FROM plugin_health_appointments a
     JOIN plugin_health_members m ON a.member_id = m.id
     WHERE a.user_id = ? AND a.appointment_date >= ? AND a.appointment_date <= ?
     ORDER BY a.appointment_date`
  ).all(userId, fromTs, toTs) as (Appointment & { member_name: string })[];
}

function getDoseCountForDay(db: PluginDatabase, medId: number, startOfDay: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM plugin_health_doses
     WHERE medication_id = ? AND taken_at >= ?`
  ).get(medId, startOfDay) as { cnt: number };
  return row.cnt;
}



function getVaccinations(db: PluginDatabase, memberId: number): Vaccination[] {
  return db.prepare(
    `SELECT * FROM plugin_health_vaccinations
     WHERE member_id = ?
     ORDER BY administered_date DESC`
  ).all(memberId) as Vaccination[];
}

function getMemberAppointments(
  db: PluginDatabase,
  userId: string,
  memberId: number,
  fromTs: number,
  days: number
): Appointment[] {
  const toTs = fromTs + days * 24 * 60 * 60 * 1000;
  return db.prepare(
    `SELECT * FROM plugin_health_appointments
     WHERE user_id = ? AND member_id = ? AND appointment_date >= ? AND appointment_date <= ?
     ORDER BY appointment_date`
  ).all(userId, memberId, fromTs, toTs) as Appointment[];
}

// =============================================================================
// CSS
// =============================================================================

const healthCSS = `
.nav-pills {
  display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;
}
.nav-pills a {
  padding: 6px 16px; border-radius: 20px; text-decoration: none;
  background: var(--surface); color: var(--text-muted); font-size: 0.9rem;
  transition: background 0.15s, color 0.15s;
}
.nav-pills a:hover { background: var(--surface-hover); color: var(--text); }
.nav-pills a.active { background: var(--accent); color: #fff; }

.family-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px; margin-bottom: 24px;
}
.member-card {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px; transition: border-color 0.15s;
}
.member-card:hover { border-color: var(--accent); }
.member-card-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
}
.avatar {
  width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-weight: 700; font-size: 1.1rem; color: #fff; flex-shrink: 0;
}
.member-card-name {
  font-weight: 600; font-size: 1.05rem;
}
.member-card-name a { color: var(--text); text-decoration: none; }
.member-card-name a:hover { color: var(--accent); }

.progress-bar-track {
  height: 8px; background: var(--surface); border-radius: 4px; overflow: hidden;
  margin: 6px 0;
}
.progress-bar-fill {
  height: 100%; border-radius: 4px; transition: width 0.3s;
}
.progress-label {
  font-size: 0.8rem; color: var(--text-muted);
}

.status-green { color: var(--green); }
.status-yellow { color: var(--yellow); }
.status-red { color: var(--red); }

.next-appt {
  font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;
  padding-top: 8px; border-top: 1px solid var(--border);
}

.section-title {
  font-size: 1.1rem; font-weight: 600; margin: 24px 0 12px; color: var(--text);
}

.quick-actions {
  display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;
}
.quick-actions a, .quick-actions button {
  display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.85rem;
  text-decoration: none; cursor: pointer; border: 1px solid var(--border);
  background: var(--surface); color: var(--text-muted); transition: background 0.15s;
}
.quick-actions a:hover, .quick-actions button:hover {
  background: var(--surface-hover); color: var(--text);
}

.inline-form {
  display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin: 8px 0;
}
.inline-form label {
  display: flex; flex-direction: column; gap: 2px; font-size: 0.85rem; color: var(--text-muted);
}
.inline-form input, .inline-form select, .inline-form textarea {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface); color: var(--text); font-size: 0.9rem;
}
.inline-form input:focus, .inline-form select:focus, .inline-form textarea:focus {
  outline: none; border-color: var(--accent);
}

.btn {
  padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer;
  font-size: 0.85rem; transition: opacity 0.15s;
}
.btn:hover { opacity: 0.85; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-success { background: var(--green); color: #fff; }
.btn-danger { background: var(--red); color: #fff; }
.btn-small { padding: 3px 8px; font-size: 0.8rem; }

.delete-btn {
  background: none; border: none; color: var(--red); cursor: pointer;
  font-size: 0.8rem; padding: 2px 6px; opacity: 0.7;
}
.delete-btn:hover { opacity: 1; text-decoration: underline; }

.adherence-grid {
  display: flex; gap: 4px; margin: 8px 0;
}
.adherence-cell {
  width: 36px; height: 36px; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; font-size: 0.8rem; color: var(--text-muted);
}
.adherence-green { background: var(--green); color: #fff; }
.adherence-yellow { background: var(--yellow); color: #000; }
.adherence-red { background: var(--red); color: #fff; }
.adherence-gray { background: var(--surface); }

.appt-list {
  list-style: none; padding: 0; margin: 0;
}
.appt-list li {
  padding: 8px 0; border-bottom: 1px solid var(--border); display: flex;
  justify-content: space-between; align-items: center;
}
.appt-list li:last-child { border-bottom: none; }

.empty-state {
  color: var(--text-muted); font-style: italic; padding: 12px 0;
}

.plugin-table { width: 100%; }
.plugin-table th { text-align: left; }
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

.quick-actions .btn-log-all {
  background: var(--green); color: #fff; border: none; border-radius: 6px;
  padding: 4px 10px; font-size: 0.8rem; font-weight: 600; cursor: pointer;
}
.quick-actions .btn-log-all:hover { opacity: 0.85; }

.btn-log-dose-done {
  background: var(--surface); color: var(--text-muted); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; cursor: default; opacity: 0.6;
}

.summary-strip {
  display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;
}
.summary-stat {
  flex: 1; min-width: 120px; padding: 12px 16px; background: var(--card-bg);
  border: 1px solid var(--border); border-radius: 8px; text-align: center;
}
.summary-stat-value { font-size: 1.5rem; font-weight: 700; color: var(--text); }
.summary-stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }

.member-card.needs-attention { border-left: 3px solid var(--red); }

.adherence-header {
  display: flex; gap: 4px; margin-bottom: 2px;
}
.adherence-header-cell {
  width: 36px; text-align: center; font-size: 0.6875rem; color: var(--text-muted); font-weight: 600;
}

@media (max-width: 640px) {
  .adherence-cell { width: 28px; height: 28px; font-size: 0.7rem; }
  .adherence-header-cell { width: 28px; font-size: 0.625rem; }
  .summary-strip { gap: 8px; }
  .summary-stat { padding: 8px 12px; }
  .summary-stat-value { font-size: 1.25rem; }
}
`;

// =============================================================================
// Color helpers
// =============================================================================

const AVATAR_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Today's date as YYYY-MM-DD using local time (not UTC) */
function localDateISO(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function progressColor(taken: number, expected: number): string {
  if (expected === 0) return 'var(--text-muted)';
  const ratio = taken / expected;
  if (ratio >= 1) return 'var(--green)';
  if (ratio > 0) return 'var(--yellow)';
  return 'var(--red)';
}

function statusClass(taken: number, expected: number): string {
  if (expected === 0) return '';
  const ratio = taken / expected;
  if (ratio >= 1) return 'status-green';
  if (ratio > 0) return 'status-yellow';
  return 'status-red';
}

// =============================================================================
// Navigation pills
// =============================================================================

function navPills(active: 'dashboard' | 'medications' | 'member'): string {
  const items = [
    { href: '/p/health/', label: 'Dashboard', key: 'dashboard' as const },
    { href: '/p/health/medications', label: 'Medications', key: 'medications' as const },
  ];
  return `<div class="nav-pills">${items.map(i =>
    `<a href="${i.href}"${i.key === active ? ' class="active"' : ''}>${escapeHtml(i.label)}</a>`
  ).join('')}</div>`;
}

// =============================================================================
// Dashboard Home Page
// =============================================================================

function renderDashboard(db: PluginDatabase, userId: string): string {
  const members = getMembers(db, userId);
  const startOfDay = getStartOfDay(null);
  const now = Date.now();

  if (members.length === 0) {
    return navPills('dashboard') +
      pluginCard('Family Health', `
        <p class="empty-state">No family members yet.</p>
        <form method="POST" action="/p/health/members" class="inline-form">
          <label>Name <input type="text" name="name" required maxlength="50" placeholder="e.g. Emma"></label>
          <button type="submit" class="btn btn-primary">Add Member</button>
        </form>
      `);
  }

  const statuses = getMedStatusForUser(db, userId, startOfDay);
  const statusByMember = new Map<number, MedStatus[]>();
  for (const s of statuses) {
    const arr = statusByMember.get(s.member_id) || [];
    arr.push(s);
    statusByMember.set(s.member_id, arr);
  }

  const appointments = getUpcomingAppointments(db, userId, now, 30);
  const apptByMember = new Map<number, (Appointment & { member_name: string })[]>();
  for (const a of appointments) {
    const arr = apptByMember.get(a.member_id) || [];
    arr.push(a);
    apptByMember.set(a.member_id, arr);
  }

  // Calculate per-member dose progress for summary + sorting
  interface MemberProgress {
    member: Member;
    meds: MedStatus[];
    memberAppts: (Appointment & { member_name: string })[];
    totalExpected: number;
    totalTaken: number;
    ratio: number;
  }

  const memberProgress: MemberProgress[] = members.map(member => {
    const meds = statusByMember.get(member.id) || [];
    const memberAppts = apptByMember.get(member.id) || [];
    let totalExpected = 0;
    let totalTaken = 0;
    for (const m of meds) {
      const expected = dosesExpectedToday(m.frequency);
      totalExpected += expected;
      totalTaken += Math.min(m.doses_today, expected);
    }
    const ratio = totalExpected > 0 ? totalTaken / totalExpected : 1;
    return { member, meds, memberAppts, totalExpected, totalTaken, ratio };
  });

  // Sort by attention needed (lowest adherence first)
  memberProgress.sort((a, b) => a.ratio - b.ratio);

  // Summary banner
  const totalDosesTaken = memberProgress.reduce((sum, m) => sum + m.totalTaken, 0);
  const totalDosesExpected = memberProgress.reduce((sum, m) => sum + m.totalExpected, 0);
  const upcomingAppts7d = getUpcomingAppointments(db, userId, now, 7).length;
  const overallRatio = totalDosesExpected > 0 ? totalDosesTaken / totalDosesExpected : 1;
  const overallStatus = overallRatio >= 1 ? 'status-green' : overallRatio > 0 ? 'status-yellow' : 'status-red';
  const overallIcon = overallRatio >= 1 ? '&#x2705;' : overallRatio > 0 ? '&#x26A0;&#xFE0F;' : '&#x274C;';

  const summaryBanner = totalDosesExpected > 0 ? `
    <div class="summary-strip">
      <div class="summary-stat">
        <div class="summary-stat-value ${overallStatus}">${totalDosesTaken}/${totalDosesExpected}</div>
        <div class="summary-stat-label">${overallIcon} Doses Today</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-value">${upcomingAppts7d}</div>
        <div class="summary-stat-label">Appts This Week</div>
      </div>
    </div>
  ` : '';

  // Family member cards (sorted by attention needed)
  let cards = '<div class="family-grid">';
  for (const mp of memberProgress) {
    const { member, meds, memberAppts, totalExpected, totalTaken, ratio } = mp;
    const initial = member.name.charAt(0).toUpperCase();
    const color = avatarColor(member.name);

    const pct = totalExpected > 0 ? Math.round((totalTaken / totalExpected) * 100) : 0;
    const barColor = progressColor(totalTaken, totalExpected);
    const sClass = statusClass(totalTaken, totalExpected);
    const needsAttention = totalExpected > 0 && ratio === 0;

    // Check if there are undosed scheduled meds (for Log All Doses button)
    const hasUndosedMeds = meds.some(m => {
      if (m.frequency === 'as-needed') return false;
      return m.doses_today < dosesExpectedToday(m.frequency);
    });

    cards += `<div class="member-card${needsAttention ? ' needs-attention' : ''}">
      <div class="member-card-header">
        <div class="avatar" style="background:${color}">${initial}</div>
        <div>
          <div class="member-card-name"><a href="/p/health/member/${encodeURIComponent(member.name)}">${escapeHtml(member.name)}</a></div>
          ${meds.length > 0 ? `<span class="progress-label ${sClass}">${totalTaken}/${totalExpected} doses today</span>` : '<span class="progress-label">No medications</span>'}
        </div>
      </div>
      ${meds.length > 0 ? `
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      ` : ''}
      ${memberAppts.length > 0 ? `
        <div class="next-appt">
          Next: ${escapeHtml(memberAppts[0].type)} (${formatDateShort(memberAppts[0].appointment_date)})
        </div>
      ` : ''}
      <div class="quick-actions">
        <a href="/p/health/member/${encodeURIComponent(member.name)}">View</a>
        ${hasUndosedMeds ? `
          <form method="POST" action="/p/health/dose-all/${member.id}" style="display:inline">
            <button type="submit" class="btn-log-all">Log All Doses</button>
          </form>
        ` : ''}
      </div>
    </div>`;
  }
  cards += '</div>';

  // Upcoming appointments section
  let apptSection = '';
  if (appointments.length > 0) {
    const apptRows = appointments.map(a => {
      const dateStr = formatDateWithDay(a.appointment_date);
      const notes = a.notes ? ` - ${escapeHtml(a.notes)}` : '';
      return `<li>
        <span><strong>${escapeHtml(a.member_name)}</strong> - ${escapeHtml(dateStr)} - ${escapeHtml(a.type)}${notes}</span>
      </li>`;
    }).join('');
    apptSection = `
      <div class="section-title">Upcoming Appointments (30 days)</div>
      ${pluginCard('Appointments', `<ul class="appt-list">${apptRows}</ul>`)}
    `;
  }

  // Add member form
  const addMemberForm = `
    <div class="section-title">Add Family Member</div>
    <form method="POST" action="/p/health/members" class="inline-form">
      <label>Name <input type="text" name="name" required maxlength="50" placeholder="e.g. Emma"></label>
      <button type="submit" class="btn btn-primary">Add Member</button>
    </form>
  `;

  return navPills('dashboard') + summaryBanner + cards + apptSection + addMemberForm;
}

// =============================================================================
// Member Detail Page
// =============================================================================

function renderMemberDetail(db: PluginDatabase, userId: string, memberName: string): string | null {
  const member = getMemberByName(db, userId, memberName);
  if (!member) return null;

  const startOfDay = getStartOfDay(null);
  const now = Date.now();
  const meds = getActiveMeds(db, member.id);

  // --- Medication list with dose counts ---
  let medsHtml = '';
  if (meds.length === 0) {
    medsHtml = '<p class="empty-state">No active medications.</p>';
  } else {
    const medRows: string[] = [];
    for (const med of meds) {
      const expected = dosesExpectedToday(med.frequency);
      const taken = getDoseCountForDay(db, med.id, startOfDay);
      const sClass = statusClass(taken, expected);
      const statusText = med.frequency === 'as-needed'
        ? `${taken} taken`
        : `${taken}/${expected}`;

      medRows.push(`<tr>
        <td>${escapeHtml(med.name)}</td>
        <td>${escapeHtml(med.dosage)}</td>
        <td>${escapeHtml(med.frequency)}</td>
        <td class="${sClass}">${statusText}</td>
        <td>
          <form method="POST" action="/p/health/dose" style="display:inline">
            <input type="hidden" name="memberId" value="${member.id}">
            <input type="hidden" name="medicationId" value="${med.id}">
            <button type="submit" class="btn btn-success btn-small">Log Dose</button>
          </form>
          <form method="POST" action="/p/health/medications/${med.id}/delete" style="display:inline">
            <button type="submit" class="delete-btn" data-confirm="Stop tracking ${escapeHtml(med.name)}?" onclick="return confirm(this.dataset.confirm)">remove</button>
          </form>
        </td>
      </tr>`);
    }
    medsHtml = `<div class="table-scroll"><table class="plugin-table">
      <thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Today</th><th>Actions</th></tr></thead>
      <tbody>${medRows.join('')}</tbody>
    </table></div>`;
  }

  // --- Dose adherence grid (last 7 days) ---
  let adherenceHtml = '';
  if (meds.length > 0) {
    adherenceHtml = '<div class="section-title">7-Day Adherence</div>';

    // Day-of-week header row
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let headerCells = '';
    for (let i = 6; i >= 0; i--) {
      const dayStart = startOfDay - i * 24 * 60 * 60 * 1000;
      const dayOfWeek = new Date(dayStart).getDay();
      headerCells += `<div class="adherence-header-cell">${dayNames[dayOfWeek]}</div>`;
    }
    adherenceHtml += `<div class="adherence-header">${headerCells}</div>`;

    for (const med of meds) {
      if (med.frequency === 'as-needed') continue;
      const expected = dosesExpectedToday(med.frequency);
      const isWeekly = med.frequency === 'weekly';

      let cells = '';
      for (let i = 6; i >= 0; i--) {
        const dayStart = startOfDay - i * 24 * 60 * 60 * 1000;
        const count = getDoseCountForDay(db, med.id, dayStart);
        const dayLabel = formatDateShort(dayStart);
        let cellClass = 'adherence-gray';

        if (isWeekly) {
          // Weekly: green if dose taken that day, gray otherwise (no red for non-dose days)
          if (count > 0) cellClass = 'adherence-green';
          // else stays gray — missing individual days is expected for weekly meds
        } else {
          if (count >= expected) cellClass = 'adherence-green';
          else if (count > 0) cellClass = 'adherence-yellow';
          else if (i > 0) cellClass = 'adherence-red'; // only mark past days as red
          else cellClass = count > 0 ? 'adherence-yellow' : 'adherence-gray'; // today defaults to gray if 0
        }

        const displayExpected = isWeekly ? (count > 0 ? 1 : 0) : expected;
        cells += `<div class="adherence-cell ${cellClass}" title="${escapeHtml(med.name)} \u2014 ${escapeHtml(formatDateWithDay(dayStart))}: ${count}/${displayExpected}">${escapeHtml(dayLabel.split('/')[1])}</div>`;
      }
      adherenceHtml += `<div style="margin-bottom:8px">
        <span style="font-size:0.85rem;color:var(--text-muted)">${escapeHtml(med.name)}</span>
        <div class="adherence-grid">${cells}</div>
      </div>`;
    }
  }

  // --- Upcoming appointments ---
  const memberAppts = getMemberAppointments(db, userId, member.id, now, 90);
  let apptsHtml = '';
  if (memberAppts.length === 0) {
    apptsHtml = '<p class="empty-state">No upcoming appointments.</p>';
  } else {
    const rows = memberAppts.map(a => {
      const dateStr = formatDateWithDay(a.appointment_date);
      const notes = a.notes ? escapeHtml(a.notes) : '';
      return `<li>
        <span>${escapeHtml(dateStr)} - <strong>${escapeHtml(a.type)}</strong>${notes ? ` - ${notes}` : ''}</span>
        <form method="POST" action="/p/health/appointments/${a.id}/delete" style="display:inline"
              onsubmit="return confirm('Cancel this appointment?')">
          <button type="submit" class="delete-btn">cancel</button>
        </form>
      </li>`;
    });
    apptsHtml = `<ul class="appt-list">${rows.join('')}</ul>`;
  }

  // --- Vaccination records ---
  const vaxes = getVaccinations(db, member.id);
  let vaxHtml = '';
  if (vaxes.length === 0) {
    vaxHtml = '<p class="empty-state">No vaccination records.</p>';
  } else {
    vaxHtml = pluginTable(
      ['Vaccine', 'Date', 'Notes'],
      vaxes.map(v => [
        v.vaccine_name,
        formatDateShort(v.administered_date),
        v.notes || '',
      ])
    );
  }

  // --- Management forms ---
  const addMedForm = `
    <div class="section-title">Add Medication</div>
    <form method="POST" action="/p/health/medications" class="inline-form">
      <input type="hidden" name="memberId" value="${member.id}">
      <label>Medication <input type="text" name="name" required maxlength="100" placeholder="e.g. Amoxicillin"></label>
      <label>Dosage <input type="text" name="dosage" required maxlength="50" placeholder="e.g. 250mg"></label>
      <label>Frequency
        <select name="frequency">
          <option value="daily">daily</option>
          <option value="2x-daily">2x-daily</option>
          <option value="3x-daily">3x-daily</option>
          <option value="weekly">weekly</option>
          <option value="as-needed">as-needed</option>
        </select>
      </label>
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
  `;

  const addApptForm = `
    <div class="section-title">Add Appointment</div>
    <form method="POST" action="/p/health/appointments" class="inline-form">
      <input type="hidden" name="memberId" value="${member.id}">
      <label>Date <input type="date" name="date" required></label>
      <label>Type <input type="text" name="type" required maxlength="100" placeholder="e.g. Dentist"></label>
      <label>Notes <input type="text" name="notes" maxlength="200" placeholder="optional"></label>
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
  `;

  const addVaxForm = `
    <div class="section-title">Log Vaccination</div>
    <form method="POST" action="/p/health/vaccinations" class="inline-form">
      <input type="hidden" name="memberId" value="${member.id}">
      <label>Vaccine <input type="text" name="vaccine" required maxlength="100" placeholder="e.g. Flu Shot"></label>
      <label>Date <input type="date" name="date" value="${localDateISO()}"></label>
      <button type="submit" class="btn btn-primary">Log</button>
    </form>
  `;

  const deleteBtn = `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border)">
      <form method="POST" action="/p/health/members/${member.id}/delete">
        <button type="submit" class="btn btn-danger" data-confirm="Remove ${escapeHtml(member.name)} and ALL their health records? This cannot be undone." onclick="return confirm(this.dataset.confirm)">Remove ${escapeHtml(member.name)}</button>
      </form>
    </div>
  `;

  return navPills('member') +
    `<h2 style="margin-bottom:4px">${escapeHtml(member.name)}</h2>` +
    pluginCard('Medications', medsHtml) +
    adherenceHtml +
    pluginCard('Upcoming Appointments', apptsHtml) +
    pluginCard('Vaccinations', vaxHtml) +
    addMedForm + addApptForm + addVaxForm + deleteBtn;
}

// =============================================================================
// Medications Overview Page
// =============================================================================

function renderMedicationsOverview(db: PluginDatabase, userId: string): string {
  const startOfDay = getStartOfDay(null);
  const statuses = getMedStatusForUser(db, userId, startOfDay);

  if (statuses.length === 0) {
    return navPills('medications') +
      pluginCard('Medications', '<p class="empty-state">No active medications across any family member.</p>');
  }

  const rows = statuses.map(s => {
    const expected = dosesExpectedToday(s.frequency);
    const sClass = statusClass(s.doses_today, expected);
    const statusText = s.frequency === 'as-needed'
      ? `${s.doses_today} taken`
      : `${s.doses_today}/${expected}`;

    const fullyDosed = s.frequency !== 'as-needed' && s.doses_today >= expected;
    const doseBtn = fullyDosed
      ? `<span class="btn-log-dose-done">Logged</span>`
      : `<form method="POST" action="/p/health/dose" style="display:inline">
          <input type="hidden" name="memberId" value="${s.member_id}">
          <input type="hidden" name="medicationId" value="${s.med_id}">
          <button type="submit" class="btn btn-success btn-small">Log Dose</button>
        </form>`;

    return `<tr>
      <td><a href="/p/health/member/${encodeURIComponent(s.member_name)}">${escapeHtml(s.member_name)}</a></td>
      <td>${escapeHtml(s.med_name)}</td>
      <td>${escapeHtml(s.dosage)}</td>
      <td>${escapeHtml(s.frequency)}</td>
      <td class="${sClass}">${statusText}</td>
      <td>${doseBtn}</td>
    </tr>`;
  });

  const tableHtml = `<div class="table-scroll"><table class="plugin-table">
    <thead><tr><th>Member</th><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Today</th><th>Action</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;

  return navPills('medications') + pluginCard('All Medications', tableHtml);
}

// =============================================================================
// Dashboard Widget
// =============================================================================

export function getHealthWidgets(): DashboardWidget[] {
  // Widget is shown to all users — never expose cross-user medical data.
  // Show a simple link instead.
  return [{
    title: 'Health',
    icon: 'heart',
    html: '<p style="font-size:0.875rem;">Family health tracker</p>',
    link: '/p/health/',
    priority: 25,
    size: 'small',
  }];
}

// =============================================================================
// Route Registration
// =============================================================================

export function registerHealthWebRoutes(router: PluginRouter): void {
  const getDb = (ctx: PluginContext): PluginDatabase => ctx.db;
  const getUserId = (res: { locals: Record<string, unknown> }): string =>
    (res.locals.userId as string) || '';

  // --- Page routes ---

  router.get('/', (_req, res, ctx) => {
    const userId = getUserId(res);
    const body = renderDashboard(getDb(ctx), userId);
    res.send(renderPluginPage({
      title: 'Health Dashboard',
      pluginName: 'health',
      body,
      styles: healthCSS,
      scripts: sseScript(),
    }));
  });

  router.get('/medications', (_req, res, ctx) => {
    const userId = getUserId(res);
    const body = renderMedicationsOverview(getDb(ctx), userId);
    res.send(renderPluginPage({
      title: 'Medications - Health',
      pluginName: 'health',
      body,
      styles: healthCSS,
      scripts: sseScript(),
    }));
  });

  router.get('/member/:name', (req, res, ctx) => {
    const userId = getUserId(res);
    const memberName = decodeURIComponent(String(req.params.name));
    const body = renderMemberDetail(getDb(ctx), userId, memberName);
    if (!body) {
      res.status(404).send(renderPluginPage({
        title: 'Member Not Found - Health',
        pluginName: 'health',
        body: pluginCard('Not Found', `<p>Member "${escapeHtml(memberName)}" not found.</p><p><a href="/p/health/">Back to dashboard</a></p>`),
        styles: healthCSS,
      }));
      return;
    }
    res.send(renderPluginPage({
      title: `${escapeHtml(memberName)} - Health`,
      pluginName: 'health',
      body,
      styles: healthCSS,
      scripts: sseScript(),
    }));
  });

  // --- POST: Log dose ---
  router.post('/dose', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const { memberId, medicationId } = req.body as { memberId?: string; medicationId?: string };

    const mId = parseInt(memberId || '', 10);
    const medId = parseInt(medicationId || '', 10);
    if (isNaN(mId) || isNaN(medId)) {
      res.redirect('/p/health/');
      return;
    }

    // Validate member belongs to user
    const member = getMemberById(db, mId, userId);
    if (!member) {
      res.redirect('/p/health/');
      return;
    }

    // Validate medication belongs to this member and is active
    const med = db.prepare(
      `SELECT * FROM plugin_health_medications WHERE id = ? AND member_id = ? AND active = 1`
    ).get(medId, mId) as Medication | undefined;
    if (!med) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
    ).run(userId, medId, now, now);

    // SSE broadcast
    if (sseBroadcast) {
      sseBroadcast.broadcast('dose-logged', {
        memberName: member.name,
        medicationName: med.name,
        timestamp: now,
      });
    }

    // Redirect back to member page (never use Referer header — open redirect risk)
    res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
  });

  // --- POST: Log all remaining doses for a member ---
  router.post('/dose-all/:memberId', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const mId = parseInt(String(req.params.memberId), 10);
    if (isNaN(mId)) {
      res.redirect('/p/health/');
      return;
    }

    const member = getMemberById(db, mId, userId);
    if (!member) {
      res.redirect('/p/health/');
      return;
    }

    const now = Date.now();
    const startOfDay = getStartOfDay(null);
    const meds = getActiveMeds(db, member.id);
    let doseCount = 0;

    for (const med of meds) {
      if (med.frequency === 'as-needed') continue;
      const expected = dosesExpectedToday(med.frequency);
      const taken = getDoseCountForDay(db, med.id, startOfDay);
      const remaining = expected - taken;
      for (let i = 0; i < remaining; i++) {
        const ts = now + doseCount; // space doses 1ms apart to avoid duplicate timestamps
        db.prepare(
          `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
        ).run(userId, med.id, ts, ts);
        doseCount++;
      }
    }

    if (sseBroadcast && doseCount > 0) {
      sseBroadcast.broadcast('dose-logged', {
        memberName: member.name,
        medicationName: `${String(doseCount)} medications (batch)`,
        timestamp: now,
      });
    }

    res.redirect('/p/health/');
  });

  // --- POST: Add member ---
  router.post('/members', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const { name } = req.body as { name?: string };

    const trimmed = (name || '').trim();
    if (!trimmed || trimmed.length > 50) {
      res.redirect('/p/health/');
      return;
    }

    // Check duplicate
    const existing = getMemberByName(db, userId, trimmed);
    if (existing) {
      res.redirect('/p/health/');
      return;
    }

    db.prepare(
      `INSERT INTO plugin_health_members (user_id, name, created_at) VALUES (?, ?, ?)`
    ).run(userId, trimmed, Date.now());

    res.redirect('/p/health/');
  });

  // --- POST: Remove member ---
  router.post('/members/:id/delete', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.redirect('/p/health/');
      return;
    }

    db.prepare(
      `DELETE FROM plugin_health_members WHERE id = ? AND user_id = ?`
    ).run(id, userId);

    res.redirect('/p/health/');
  });

  // --- POST: Add medication ---
  router.post('/medications', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const { memberId, name, dosage, frequency } = req.body as {
      memberId?: string; name?: string; dosage?: string; frequency?: string;
    };

    const mId = parseInt(memberId || '', 10);
    if (isNaN(mId)) {
      res.redirect('/p/health/');
      return;
    }

    const member = getMemberById(db, mId, userId);
    if (!member) {
      res.redirect('/p/health/');
      return;
    }

    const medName = (name || '').trim();
    const medDosage = (dosage || '').trim();
    const freq = parseFrequency((frequency || '').trim());

    if (!medName || medName.length > 100 || !medDosage || medDosage.length > 50 || !freq) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    // Check duplicate
    const existing = db.prepare(
      `SELECT id FROM plugin_health_medications WHERE member_id = ? AND name = ? COLLATE NOCASE AND active = 1`
    ).get(mId, medName);
    if (existing) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    db.prepare(
      `INSERT INTO plugin_health_medications (user_id, member_id, name, dosage, frequency, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(userId, mId, medName, medDosage, freq, Date.now());

    res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
  });

  // --- POST: Deactivate medication ---
  router.post('/medications/:id/delete', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.redirect('/p/health/');
      return;
    }

    // Get member name for redirect (scope by user)
    const med = db.prepare(
      `SELECT med.*, m.name as member_name FROM plugin_health_medications med
       JOIN plugin_health_members m ON med.member_id = m.id
       WHERE med.id = ? AND med.user_id = ?`
    ).get(id, userId) as (Medication & { member_name: string }) | undefined;

    if (med) {
      db.prepare(
        `UPDATE plugin_health_medications SET active = 0 WHERE id = ? AND user_id = ?`
      ).run(id, userId);
      res.redirect(`/p/health/member/${encodeURIComponent(med.member_name)}`);
    } else {
      res.redirect('/p/health/');
    }
  });

  // --- POST: Add appointment ---
  router.post('/appointments', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const { memberId, date, type, notes } = req.body as {
      memberId?: string; date?: string; type?: string; notes?: string;
    };

    const mId = parseInt(memberId || '', 10);
    if (isNaN(mId)) {
      res.redirect('/p/health/');
      return;
    }

    const member = getMemberById(db, mId, userId);
    if (!member) {
      res.redirect('/p/health/');
      return;
    }

    const parsedDate = parseAppointmentDate((date || '').trim());
    const apptType = (type || '').trim();
    let apptNotes: string | null = (notes || '').trim() || null;
    if (apptNotes && apptNotes.length > 200) apptNotes = apptNotes.slice(0, 200);

    if (!parsedDate || !apptType || apptType.length > 100) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    db.prepare(
      `INSERT INTO plugin_health_appointments (user_id, member_id, appointment_date, type, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, mId, parsedDate.getTime(), apptType, apptNotes, Date.now());

    res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
  });

  // --- POST: Remove appointment ---
  router.post('/appointments/:id/delete', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.redirect('/p/health/');
      return;
    }

    // Get member for redirect
    const appt = db.prepare(
      `SELECT a.member_id, m.name as member_name FROM plugin_health_appointments a
       JOIN plugin_health_members m ON a.member_id = m.id
       WHERE a.id = ? AND a.user_id = ?`
    ).get(id, userId) as { member_id: number; member_name: string } | undefined;

    db.prepare(
      `DELETE FROM plugin_health_appointments WHERE id = ? AND user_id = ?`
    ).run(id, userId);

    if (appt) {
      res.redirect(`/p/health/member/${encodeURIComponent(appt.member_name)}`);
    } else {
      res.redirect('/p/health/');
    }
  });

  // --- POST: Log vaccination ---
  router.post('/vaccinations', (req, res, ctx) => {
    const userId = getUserId(res);
    const db = getDb(ctx);
    const { memberId, vaccine, date } = req.body as {
      memberId?: string; vaccine?: string; date?: string;
    };

    const mId = parseInt(memberId || '', 10);
    if (isNaN(mId)) {
      res.redirect('/p/health/');
      return;
    }

    const member = getMemberById(db, mId, userId);
    if (!member) {
      res.redirect('/p/health/');
      return;
    }

    const vaccineName = (vaccine || '').trim();
    if (!vaccineName || vaccineName.length > 100) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    const dateStr = (date || '').trim();
    const parsedDate = dateStr ? parseVaxDate(dateStr) : new Date();
    if (!parsedDate) {
      res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
      return;
    }

    db.prepare(
      `INSERT INTO plugin_health_vaccinations (user_id, member_id, vaccine_name, administered_date, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, mId, vaccineName, parsedDate.getTime(), null, Date.now());

    res.redirect(`/p/health/member/${encodeURIComponent(member.name)}`);
  });
}

// =============================================================================
// SSE client-side script
// =============================================================================

function sseScript(): string {
  return `
<script>
(function() {
  var es = new EventSource('/p/health/stream');
  es.addEventListener('dose-logged', function() {
    // Reload the page to reflect updated dose counts
    window.location.reload();
  });
  es.onerror = function() {
    // Silently reconnect (EventSource handles this automatically)
  };
})();
</script>`;
}

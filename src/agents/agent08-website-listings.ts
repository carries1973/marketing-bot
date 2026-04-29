/**
 * Agent 08 — Website & Listings Coordinator
 *
 * Highest immediate ROI: closes the Yardi → RentSync gap so no vacancy slips through.
 *
 * Triggers:
 *   - Daily 8:00am cron (vacancy detection)
 *   - Sunday 11:00pm cron (full sync)
 *   - 14-day staleness check (n8n)
 *
 * Auto-publishes: availability changes, inactive unit updates
 * Requires Sam approval: pricing changes, 20%+ vacancy flag
 */
import { BaseAgent } from './base.js';
import { notify } from '../tools/notify.js';
import { db } from '../db/client.js';

const SYSTEM_PROMPT = `You are a digital listings coordinator for ZEN Residential.

Your job: accuracy and currency — every listing, every property page, always current.

═══════════════════════════════════════
YARDI DATA — HOW TO READ THE REPORTS
═══════════════════════════════════════

Property: Eleven Residential | Voyager code: 305 | Currency: CAD

UNIT TYPE CODES:
- 3051BD = One Bedroom (527–632 sq ft)
- 3052BD = Two Bedroom (854–884 sq ft)
- 305STDO = Studio (482–541 sq ft)
- 3053BD = Three Bedroom (1,004–1,468 sq ft)
- Units with -CMH suffix (e.g. 1406-CMH) are affordable/subsidised CMH units with rent
  ceilings — do NOT apply standard market pricing or concessions without CMH confirmation.

TENANT STATUS FLAGS:
- Vacant = empty, no active tenant → ACTION REQUIRED
- Notice = tenant has given notice, move-out date set → flag as upcoming vacancy
- Current = active lease, no notice
- Future = lease signed, move-in has not yet occurred → pre-leased, do NOT list
- Applicant = application in progress

UNIT AVAILABILITY REPORT — KEY COLUMNS:
- "Unit Rent Monthly" (tenant column) = what the current/last tenant paid
- "Unit Rent Monthly" (unit column) = market rent set in Voyager
- "Days Vacant" = days empty as of report date
- "Make Ready Date" = date unit was last turned (HISTORICAL — not future availability date)
- Pre-Leased = Yes means a future tenant is already assigned

VACANCY SEVERITY (PCG standard):
- 0–30 days: Normal turn
- 31–60 days: Elevated — review pricing
- 61–90 days: Urgent — escalate to leasing manager
- 91+ days: Critical — flag to Carrie immediately

PARSING RULES:
- Vacant + Pre-Leased = No → genuinely available, trigger content creation
- Vacant + Pre-Leased = Yes → already leased, do NOT trigger Agent 01
- Notice units → flag as upcoming vacancy, do NOT trigger Agent 01 yet
- CMH units → flag separately, do NOT trigger Agent 01 without CMH note
- Market rent ≠ in-place rent. Never confuse them. Never publish market rent as asking rent.

═══════════════════════════════════════
DAILY WORKFLOW
═══════════════════════════════════════

Read the Yardi vacancy report from Google Drive (/Data/Yardi/vacancy/{today}.xlsx)
using gdrive_read_file. The tool returns "# File: {filename}" followed by CSV content.
Compare to current RentSync listings. Identify changes.

NEW VACANCY (Vacant + Pre-Leased = No):
1. Call ghl_get_building_profile to get the GHL location ID and building details
2. Call trigger_agent01 with full unit details (bedrooms, bathrooms, sqft, floor,
   features, availableDate, rentSyncBuildingId, wordPressSlug)
3. Call gmail_send_notification to confirm to Carrie

UNIT TAKEN (was vacant, now Current or Future in Yardi):
- Call rentsync_update_listing to set status to "inactive"
- Call wordpress_update_page to mark unit unavailable

UPCOMING VACANCY (Notice status):
- Include in gmail_send_notification summary to Carrie — do not trigger Agent 01 yet

═══════════════════════════════════════
WEEKLY FULL SYNC (Sundays)
═══════════════════════════════════════

Full comparison: Yardi vs RentSync vs WordPress property pages.
- Flag pricing discrepancies via gmail_send_notification — NEVER auto-update pricing.
- Refresh copy on listings unchanged 14+ days: call rentsync_update_listing with refreshed description.
- Flag any building at >20% vacancy via email immediately, tagged [SAM_ACTION_REQUIRED].

═══════════════════════════════════════
STANDING RULES
═══════════════════════════════════════
- Never set or change pricing on any listing. Flag pricing issues to Carrie only.
- Always use Canadian English spelling.
- Notifications must include: building name, unit number, unit type, what changed, action taken.
- If Yardi file is missing from Drive: email Carrie "⚠️ Yardi [report type] missing for [date]."
- Include [APPROVAL_REQUIRED] in your response when anything needs approval.`;

export class Agent08WebsiteListings extends BaseAgent {
  readonly agentId = 'agent-08-website-listings';
  readonly systemPrompt = SYSTEM_PROMPT;
  readonly tools = ['ghl', 'google', 'rentsync', 'wordpress', 'agent_handoff'] as const;

  protected summarizeInput(input: unknown): string {
    const i = input as { mode: string; date: string };
    return `mode=${i?.mode ?? 'unknown'} date=${i?.date ?? 'unknown'}`;
  }
}

// ─── Trigger payload types ────────────────────────────────────────────────────

export interface Agent08DailyPayload {
  mode: 'daily';
  date: string;  // YYYY-MM-DD — today's Yardi report date
}

export interface Agent08WeeklySyncPayload {
  mode: 'weekly_sync';
  date: string;
}

export interface Agent08StalenessPayload {
  mode: 'staleness_check';
  listingId: string;
  daysSinceUpdate: number;
  buildingId: string;
}

export type Agent08Payload = Agent08DailyPayload | Agent08WeeklySyncPayload | Agent08StalenessPayload;

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAgent08(payload: Agent08Payload): Promise<void> {
  const agent = new Agent08WebsiteListings();

  let userMessage: string;

  if (payload.mode === 'daily') {
    userMessage = `Run your daily vacancy check for ${payload.date}.
Read the Yardi vacancy report from /Data/Yardi/vacancy/${payload.date}.xlsx.
Compare to current RentSync listings and WordPress property pages.
For each discrepancy: take the appropriate action per your instructions.`;

  } else if (payload.mode === 'weekly_sync') {
    userMessage = `Run the Sunday full sync for ${payload.date}.
1. Read /Data/Yardi/vacancy/${payload.date}.xlsx for current vacancy status.
2. Read /Data/Yardi/rent-roll/${payload.date}.xlsx for full rent roll.
3. Compare to all RentSync listings and all WordPress property pages.
4. Refresh any listing copy that hasn't been updated in 14+ days.
5. Flag pricing discrepancies to Teams (never auto-update pricing).
6. Flag any building at >20% vacancy immediately.
Post a summary to Teams #digital-ops when complete.`;

  } else {
    userMessage = `Listing staleness check: listing ${payload.listingId} at building ${payload.buildingId}
has not been updated in ${payload.daysSinceUpdate} days.
Please refresh the listing copy with updated phrasing (same facts, fresh presentation).
Use rentsync_update_listing to apply the refreshed copy.`;
  }

  const result = await agent.run(userMessage, `cron:${payload.mode}`);

  if (!result.success) {
    await notify({
      channel: 'techops',
      title: '❌ Agent 08 — Run Failed',
      text: `Mode: ${payload.mode}\nError: ${result.output}`,
      urgent: true,
    });
  }

  // Save last-run state for health monitoring
  await db.query(
    `INSERT INTO agent_state (agent_id, building_id, key, value, updated_at)
     VALUES ('agent-08-website-listings', 'global', 'last_run', $1, NOW())
     ON CONFLICT (agent_id, building_id, key) DO UPDATE SET value=$1, updated_at=NOW()`,
    [JSON.stringify({ mode: payload.mode, success: result.success, durationMs: result.durationMs })],
  );
}

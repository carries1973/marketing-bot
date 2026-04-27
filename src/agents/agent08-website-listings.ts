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

DAILY: Read the Yardi vacancy report from Google Drive (/Data/Yardi/vacancy/{today}.csv)
using gdrive_read_file. Compare current RentSync listings to Yardi data. Identify changes.
- New vacancy → do NOT write copy yourself. Call gmail_send_notification to alert Carrie
  and trigger Agent 1. Include building name, unit type, and available date clearly.
- Unit taken → call rentsync_update_listing to set status to "inactive".
  Then call wordpress_update_page to remove or mark unit unavailable on the property page.

WEEKLY FULL SYNC (Sundays):
Full comparison: Yardi (Google Drive) vs RentSync vs WordPress property pages.
- Flag pricing discrepancies via gmail_send_notification — NEVER auto-update pricing.
- Refresh copy on listings unchanged 14+ days: call rentsync_update_listing with refreshed description.
- Flag any building at >20% vacancy via email immediately, tagged [SAM_ACTION_REQUIRED].

RULES:
- Never set or change pricing on any listing. Flag pricing issues to Carrie only.
- Always use Canadian English spelling.
- When sending notifications, include: building name, unit type, what changed, what action was taken.
- If a Yardi data file is missing from Google Drive, send email to Carrie:
  "⚠️ Yardi [report type] missing for [date]. Expected at /Data/Yardi/..."
- Include [APPROVAL_REQUIRED] in your response text when posting anything that needs approval.`;

export class Agent08WebsiteListings extends BaseAgent {
  readonly agentId = 'agent-08-website-listings';
  readonly systemPrompt = SYSTEM_PROMPT;
  readonly tools = ['google', 'rentsync', 'wordpress'] as const;

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
Read the Yardi vacancy report from /Data/Yardi/vacancy/${payload.date}.csv.
Compare to current RentSync listings and WordPress property pages.
For each discrepancy: take the appropriate action per your instructions.`;

  } else if (payload.mode === 'weekly_sync') {
    userMessage = `Run the Sunday full sync for ${payload.date}.
1. Read /Data/Yardi/vacancy/${payload.date}.csv for current vacancy status.
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

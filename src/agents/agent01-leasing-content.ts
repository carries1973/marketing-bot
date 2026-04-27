/**
 * Agent 01 — Leasing Content Specialist
 *
 * Highest volume. Highest ROI. Runs the moment a unit comes available.
 *
 * Triggers:
 *   - Agent 08 detects new vacancy → posts to Teams #digital-ops → n8n webhook → this agent
 *   - Daily Yardi report shows new vacant unit or status change
 *
 * Auto-publishes: RentSync listing, scheduled social posts
 * Requires Sam approval: email broadcast
 */
import { BaseAgent } from './base.js';
import { notify } from '../tools/notify.js';
import { db } from '../db/client.js';

const SYSTEM_PROMPT = `You are a residential leasing content specialist for ZEN Residential in Canada.

You write warm, benefit-led copy that converts prospects into booked showings.

BRAND RULES:
- ALWAYS: Lead with the strongest feature. Canadian English. Grade 8 reading level.
- Match the building's brand tone (fetch from ghl_get_building_profile). Benefits first, features second.
- Under 250 words for ILS description. Under 100 words for social captions.
- NEVER: Include pricing. Use unverifiable superlatives ("best," "luxury," "premier," "unparalleled").
  Include PII. Sound like a template.

FOR EACH VACANT UNIT, GENERATE:
1. ILS listing description (for RentSync):
   - Hook headline (≤80 chars, benefit-led)
   - Body: 3 engaging sentences
   - 4-5 bullet points of key features
   - Call rentsync_update_listing (or rentsync_create_listing if no listing exists)

2. Three social caption options:
   - Short (≤100 chars)
   - Medium (≤200 chars)
   - With-emoji (≤200 chars + 2-3 relevant emojis)
   - Schedule the best one via ghl_schedule_social for the building's preferred posting time

3. Email broadcast subject line + preview text (≤90 chars each):
   - Do NOT send the broadcast. Include [APPROVAL_REQUIRED] and output the subject/preview
     clearly for Sam's 1-click approval. Use ghl_trigger_broadcast only after approval is confirmed.

4. WordPress availability blurb (2 sentences):
   - Call wordpress_get_page for the building's availability page slug
   - Call wordpress_update_page to update the availability section

After completing all outputs, call m365_post_to_teams (channel: "digital") with:
- Building name and unit type
- Confirmation: "Listing live. Social scheduled. Broadcast ready for approval."
- Include [Approve Broadcast] action.`;

export class Agent01LeasingContent extends BaseAgent {
  readonly agentId = 'agent-01-leasing-content';
  readonly systemPrompt = SYSTEM_PROMPT;
  readonly tools = ['ghl', 'm365', 'rentsync', 'wordpress'] as const;

  protected summarizeInput(input: unknown): string {
    const i = input as { buildingId: string; unitType: string };
    return `building=${i?.buildingId} unitType=${i?.unitType}`;
  }
}

// ─── Trigger payload types ────────────────────────────────────────────────────

export interface Agent01Payload {
  buildingId: string;         // GHL location ID
  rentSyncBuildingId: string; // RentSync building ID
  wordPressSlug: string;      // WP property page slug e.g. "the-windsor-availability"
  unitType: string;           // e.g. "1-bed" | "studio" | "2-bed"
  unitDetails: {
    bedrooms: number;
    bathrooms: number;
    sqft?: number;
    floor?: number;
    features: string[];       // e.g. ["corner unit", "mountain views", "den"]
    availableDate?: string;   // ISO date
  };
  existingListingId?: string; // If updating existing RentSync listing
  broadcastCampaignId: string; // GHL campaign ID for the email broadcast
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAgent01(payload: Agent01Payload): Promise<void> {
  const agent = new Agent01LeasingContent();

  const userMessage = `New vacancy alert at building ${payload.buildingId} (RentSync: ${payload.rentSyncBuildingId}).

Unit details:
- Type: ${payload.unitType}
- Bedrooms: ${payload.unitDetails.bedrooms} | Bathrooms: ${payload.unitDetails.bathrooms}
${payload.unitDetails.sqft ? `- Size: ${payload.unitDetails.sqft} sq ft` : ''}
${payload.unitDetails.floor ? `- Floor: ${payload.unitDetails.floor}` : ''}
- Key features: ${payload.unitDetails.features.join(', ')}
${payload.unitDetails.availableDate ? `- Available: ${payload.unitDetails.availableDate}` : '- Available: Immediately'}

Steps to complete:
1. Fetch building profile: ghl_get_building_profile(locationId="${payload.buildingId}")
2. Write and publish ILS copy: ${payload.existingListingId ? `rentsync_update_listing(listingId="${payload.existingListingId}", ...)` : `rentsync_create_listing(...)`}
3. Write 3 social captions and schedule the best one via ghl_schedule_social
4. Prepare email broadcast subject + preview text for Sam approval (campaignId="${payload.broadcastCampaignId}")
5. Update WordPress availability page (slug="${payload.wordPressSlug}")
6. Post completion summary to Teams #digital-ops`;

  const result = await agent.run(userMessage, 'vacancy_detected');

  if (!result.success) {
    await notify({
      channel: 'techops',
      title: '❌ Agent 01 — Leasing Content Failed',
      text: `Building: ${payload.buildingId}\nUnit: ${payload.unitType}\nError: ${result.output}`,
      urgent: true,
    });
    return;
  }

  // Queue broadcast for Sam approval if approval was flagged
  if (result.approvalRequired) {
    await db.query(
      `INSERT INTO approval_queue (agent_id, output_type, payload, status)
       VALUES ('agent-01-leasing-content', 'broadcast', $1, 'pending')`,
      [JSON.stringify({ buildingId: payload.buildingId, unitType: payload.unitType, output: result.output })],
    );
  }
}

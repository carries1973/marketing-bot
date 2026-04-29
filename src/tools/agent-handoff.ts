/**
 * Agent handoff tools — direct agent-to-agent triggers.
 * Replaces the n8n bridge: Agent 08 calls trigger_agent01 directly
 * without routing through an external workflow engine.
 */
import { logger } from '../lib/logger.js';
import type { Agent01Payload } from '../agents/agent01-leasing-content.js';

export const AGENT_HANDOFF_TOOL_DEFINITIONS = [
  {
    name: 'trigger_agent01',
    description: 'Trigger Agent 01 (Leasing Content Specialist) for a newly detected vacant unit. Agent 01 will generate ILS copy for all platforms, schedule a social caption via GHL, and draft an email broadcast for approval. Call this instead of writing listing copy yourself.',
    input_schema: {
      type: 'object' as const,
      properties: {
        buildingId: {
          type: 'string',
          description: 'GHL location ID for the building',
        },
        rentSyncBuildingId: {
          type: 'string',
          description: 'RentSync building ID',
        },
        wordPressSlug: {
          type: 'string',
          description: 'WordPress property page slug, e.g. "the-windsor-availability"',
        },
        unitType: {
          type: 'string',
          description: 'Unit type descriptor, e.g. "1-bed", "studio", "2-bed-den"',
        },
        unitDetails: {
          type: 'object',
          properties: {
            bedrooms:      { type: 'number' },
            bathrooms:     { type: 'number' },
            sqft:          { type: 'number' },
            floor:         { type: 'number' },
            features:      { type: 'array', items: { type: 'string' } },
            availableDate: { type: 'string', description: 'ISO date, e.g. 2026-05-01' },
          },
          required: ['bedrooms', 'bathrooms', 'features'],
        },
        existingListingId: {
          type: 'string',
          description: 'RentSync listing ID if this is an update to an existing listing rather than a new one',
        },
        broadcastCampaignId: {
          type: 'string',
          description: 'GHL campaign ID for the email broadcast. If omitted, broadcast step is skipped.',
        },
      },
      required: ['buildingId', 'rentSyncBuildingId', 'wordPressSlug', 'unitType', 'unitDetails'],
    },
  },
] as const;

export async function executeAgentHandoffTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'trigger_agent01') {
    // Dynamic import breaks the potential circular dep:
    // base → agent-handoff → agent01 → base
    // At runtime Node resolves this fine; the dynamic import defers resolution.
    const { runAgent01 } = await import('../agents/agent01-leasing-content.js');
    const payload = input as unknown as Agent01Payload;

    // Fire and forget — Agent 08 continues; Agent 01 runs independently
    // and handles its own notifications and DB logging.
    runAgent01(payload).catch((err) => {
      logger.error('agent-handoff', 'Agent 01 run failed after trigger', err);
    });

    return {
      triggered: true,
      unitType: payload.unitType,
      buildingId: payload.buildingId,
      message: `Agent 01 triggered for ${payload.unitType} at ${payload.buildingId} — content generation running.`,
    };
  }

  throw new Error(`Unknown agent handoff tool: ${name}`);
}

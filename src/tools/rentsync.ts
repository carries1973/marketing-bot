/**
 * RentSync API tool module.
 * Manages ILS listings across Kijiji, Zumper, Rentals.ca, Facebook Marketplace, PadMapper.
 */
import axios from 'axios';
import { config } from '../lib/config.js';

const rs = axios.create({
  baseURL: 'https://api.rentsync.com/v1',
  headers: {
    Authorization: `Bearer ${config.RENTSYNC_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RentSyncListing {
  id: string;
  buildingId: string;
  unitType: 'studio' | '1-bed' | '2-bed' | '3-bed' | 'penthouse';
  status: 'active' | 'inactive' | 'coming_soon';
  headline: string;
  description: string;
  bullets: string[];
  bedrooms: number;
  bathrooms: number;
  sqft?: number;
  availableDate?: string;  // ISO date
  // Pricing intentionally excluded — agents never set pricing
  photos: string[];
  virtualTourUrl?: string;
  updatedAt: string;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export async function rentsync_get_listings(buildingId?: string): Promise<RentSyncListing[]> {
  const params = buildingId ? { buildingId } : {};
  const res = await rs.get('/listings', { params });
  return res.data.listings ?? [];
}

export async function rentsync_get_listing(listingId: string): Promise<RentSyncListing> {
  const res = await rs.get(`/listings/${listingId}`);
  return res.data.listing;
}

export async function rentsync_update_listing(params: {
  listingId: string;
  headline?: string;
  description?: string;
  bullets?: string[];
  status?: RentSyncListing['status'];
  availableDate?: string;
}): Promise<void> {
  const { listingId, ...fields } = params;
  await rs.patch(`/listings/${listingId}`, fields);
}

export async function rentsync_create_listing(params: Omit<RentSyncListing, 'id' | 'updatedAt'>): Promise<{ id: string }> {
  const res = await rs.post('/listings', params);
  return { id: res.data.listing.id };
}

// ─── Anthropic tool definitions ───────────────────────────────────────────────

export const RENTSYNC_TOOL_DEFINITIONS = [
  {
    name: 'rentsync_get_listings',
    description: 'Fetch all active RentSync listings, optionally filtered by buildingId',
    input_schema: {
      type: 'object' as const,
      properties: {
        buildingId: { type: 'string', description: 'Optional RentSync building ID to filter by' },
      },
    },
  },
  {
    name: 'rentsync_update_listing',
    description: 'Update an existing RentSync listing (copy, status, availability). Never set pricing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listingId: { type: 'string' },
        headline: { type: 'string', description: 'ILS headline — hook, benefit-led, ≤80 chars' },
        description: { type: 'string', description: 'ILS body — ≤250 words, Canadian English' },
        bullets: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        status: { type: 'string', enum: ['active', 'inactive', 'coming_soon'] },
        availableDate: { type: 'string', description: 'ISO date e.g. 2026-05-01' },
      },
      required: ['listingId'],
    },
  },
  {
    name: 'rentsync_create_listing',
    description: 'Create a new RentSync listing for a unit',
    input_schema: {
      type: 'object' as const,
      properties: {
        buildingId: { type: 'string' },
        unitType: { type: 'string', enum: ['studio', '1-bed', '2-bed', '3-bed', 'penthouse'] },
        headline: { type: 'string' },
        description: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        bedrooms: { type: 'number' },
        bathrooms: { type: 'number' },
        status: { type: 'string', enum: ['active', 'inactive', 'coming_soon'] },
      },
      required: ['buildingId', 'unitType', 'headline', 'description', 'bedrooms', 'bathrooms', 'status'],
    },
  },
] as const;

export async function executeRentSyncTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'rentsync_get_listings':   return rentsync_get_listings(input.buildingId as string | undefined);
    case 'rentsync_update_listing': return rentsync_update_listing(input as Parameters<typeof rentsync_update_listing>[0]);
    case 'rentsync_create_listing': return rentsync_create_listing(input as Parameters<typeof rentsync_create_listing>[0]);
    default: throw new Error(`Unknown RentSync tool: ${name}`);
  }
}

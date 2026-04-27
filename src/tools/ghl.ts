/**
 * GHL (GoHighLevel) API tool module.
 * All agents call these functions — never hit the GHL API directly.
 * Base URL: https://services.leadconnectorhq.com
 */
import axios from 'axios';
import { config } from '../lib/config.js';

const ghl = axios.create({
  baseURL: 'https://services.leadconnectorhq.com',
  headers: {
    Authorization: `Bearer ${config.GHL_API_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields: Array<{ id: string; value: string }>;
  locationId: string;
}

export interface GHLBuildingProfile {
  locationId: string;
  name: string;
  address?: string;
  brandTones: string[];
  wordsToUse: string[];
  wordsToAvoid: string[];
  primaryResidentGroup: string;
  amenities: string[];
  brandColor?: string;
  // Stored as custom fields on the GHL location
  customFields: Record<string, string>;
}

export interface GHLSocialPost {
  locationId: string;
  body: string;
  scheduleTime?: string;  // ISO datetime
  platforms: ('facebook' | 'instagram' | 'linkedin' | 'gmb')[];
}

// ─── Contact tools ────────────────────────────────────────────────────────────

export async function ghl_get_contact(contactId: string): Promise<GHLContact> {
  const res = await ghl.get(`/contacts/${contactId}`);
  return res.data.contact;
}

export async function ghl_update_contact(
  contactId: string,
  fields: Partial<Pick<GHLContact, 'firstName' | 'lastName' | 'email' | 'phone' | 'tags' | 'customFields'>>,
): Promise<void> {
  // IMPORTANT: tags array REPLACES all existing tags — always fetch first and merge
  if (fields.tags) {
    const existing = await ghl_get_contact(contactId);
    fields.tags = [...new Set([...existing.tags, ...fields.tags])];
  }
  await ghl.put(`/contacts/${contactId}`, fields);
}

export async function ghl_get_contact_by_email(email: string, locationId: string): Promise<GHLContact | null> {
  const res = await ghl.get('/contacts/', { params: { locationId, email } });
  return res.data.contacts?.[0] ?? null;
}

// ─── Messaging tools ──────────────────────────────────────────────────────────

export async function ghl_send_email(params: {
  contactId: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<void> {
  await ghl.post('/conversations/messages', {
    type: 'Email',
    contactId: params.contactId,
    subject: params.subject,
    html: params.body,
    ...(params.fromName ? { fromName: params.fromName } : {}),
  });
}

export async function ghl_send_sms(params: {
  contactId: string;
  message: string;
}): Promise<void> {
  await ghl.post('/conversations/messages', {
    type: 'SMS',
    contactId: params.contactId,
    message: params.message,
  });
}

export async function ghl_get_conversations(contactId: string) {
  const res = await ghl.get('/conversations/search', { params: { contactId } });
  return res.data.conversations ?? [];
}

// ─── Campaign / broadcast tools ───────────────────────────────────────────────

export async function ghl_trigger_broadcast(params: {
  locationId: string;
  campaignId: string;
  subject?: string;
  body?: string;
}): Promise<void> {
  // Broadcasts a scheduled email campaign; body/subject optional if template handles it
  await ghl.post(`/campaigns/${params.campaignId}/schedule`, {
    locationId: params.locationId,
    ...(params.subject ? { subject: params.subject } : {}),
    ...(params.body ? { body: params.body } : {}),
  });
}

export async function ghl_trigger_survey(params: {
  contactId: string;
  surveyId: string;
}): Promise<void> {
  await ghl.post(`/surveys/${params.surveyId}/send`, { contactId: params.contactId });
}

// ─── Social Planner ───────────────────────────────────────────────────────────

export async function ghl_schedule_social(post: GHLSocialPost): Promise<{ postId: string }> {
  const res = await ghl.post('/social-media-posting/post', {
    locationId: post.locationId,
    body: post.body,
    scheduleTime: post.scheduleTime,
    platforms: post.platforms,
  });
  return { postId: res.data.id };
}

// ─── Building profile ─────────────────────────────────────────────────────────

export async function ghl_get_building_profile(locationId: string): Promise<GHLBuildingProfile> {
  const res = await ghl.get(`/locations/${locationId}`);
  const loc = res.data.location;
  // Brand fields stored as custom values on the location
  const cv: Record<string, string> = {};
  for (const field of loc.customValues ?? []) cv[field.id] = field.value;
  return {
    locationId,
    name: loc.name,
    address: loc.address,
    brandTones: (cv['brandTones'] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    wordsToUse: (cv['wordsToUse'] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    wordsToAvoid: (cv['wordsToAvoid'] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    primaryResidentGroup: cv['primaryResidentGroup'] ?? '',
    amenities: (cv['amenities'] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    brandColor: cv['brandColor'],
    customFields: cv,
  };
}

export async function ghl_update_building_profile(
  locationId: string,
  fields: Partial<Omit<GHLBuildingProfile, 'locationId'>>,
): Promise<void> {
  const customValues = [];
  if (fields.brandTones) customValues.push({ id: 'brandTones', value: fields.brandTones.join(', ') });
  if (fields.wordsToUse) customValues.push({ id: 'wordsToUse', value: fields.wordsToUse.join(', ') });
  if (fields.wordsToAvoid) customValues.push({ id: 'wordsToAvoid', value: fields.wordsToAvoid.join(', ') });
  if (fields.primaryResidentGroup) customValues.push({ id: 'primaryResidentGroup', value: fields.primaryResidentGroup });
  if (fields.amenities) customValues.push({ id: 'amenities', value: fields.amenities.join(', ') });
  if (fields.brandColor) customValues.push({ id: 'brandColor', value: fields.brandColor });

  await ghl.put(`/locations/${locationId}`, {
    ...(fields.name ? { name: fields.name } : {}),
    customValues,
  });
}

// ─── Anthropic tool definitions (passed to Claude tool_use) ───────────────────

export const GHL_TOOL_DEFINITIONS = [
  {
    name: 'ghl_get_contact',
    description: 'Fetch a GHL contact by ID',
    input_schema: {
      type: 'object' as const,
      properties: { contactId: { type: 'string' } },
      required: ['contactId'],
    },
  },
  {
    name: 'ghl_get_building_profile',
    description: 'Fetch building brand profile, tone, amenities, and resident mix from GHL location',
    input_schema: {
      type: 'object' as const,
      properties: { locationId: { type: 'string', description: 'GHL location ID for the building' } },
      required: ['locationId'],
    },
  },
  {
    name: 'ghl_send_email',
    description: 'Send an email to a GHL contact',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'HTML email body' },
        fromName: { type: 'string' },
      },
      required: ['contactId', 'subject', 'body'],
    },
  },
  {
    name: 'ghl_send_sms',
    description: 'Send an SMS to a GHL contact (max 160 chars)',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        message: { type: 'string', maxLength: 160 },
      },
      required: ['contactId', 'message'],
    },
  },
  {
    name: 'ghl_schedule_social',
    description: 'Schedule a social media post via GHL Social Planner',
    input_schema: {
      type: 'object' as const,
      properties: {
        locationId: { type: 'string' },
        body: { type: 'string' },
        scheduleTime: { type: 'string', description: 'ISO 8601 datetime' },
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'gmb'] },
        },
      },
      required: ['locationId', 'body', 'platforms'],
    },
  },
  {
    name: 'ghl_trigger_broadcast',
    description: 'Trigger a GHL email broadcast campaign',
    input_schema: {
      type: 'object' as const,
      properties: {
        locationId: { type: 'string' },
        campaignId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['locationId', 'campaignId'],
    },
  },
  {
    name: 'ghl_update_building_profile',
    description: 'Update brand profile fields on a GHL location',
    input_schema: {
      type: 'object' as const,
      properties: {
        locationId: { type: 'string' },
        brandTones: { type: 'array', items: { type: 'string' } },
        wordsToUse: { type: 'array', items: { type: 'string' } },
        wordsToAvoid: { type: 'array', items: { type: 'string' } },
        primaryResidentGroup: { type: 'string' },
        amenities: { type: 'array', items: { type: 'string' } },
        brandColor: { type: 'string' },
      },
      required: ['locationId'],
    },
  },
] as const;

// ─── Tool executor (called by agent base class) ───────────────────────────────

export async function executeGHLTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'ghl_get_contact':           return ghl_get_contact(input.contactId as string);
    case 'ghl_get_building_profile':  return ghl_get_building_profile(input.locationId as string);
    case 'ghl_send_email':            return ghl_send_email(input as Parameters<typeof ghl_send_email>[0]);
    case 'ghl_send_sms':              return ghl_send_sms(input as Parameters<typeof ghl_send_sms>[0]);
    case 'ghl_schedule_social':       return ghl_schedule_social(input as unknown as GHLSocialPost);
    case 'ghl_trigger_broadcast':     return ghl_trigger_broadcast(input as Parameters<typeof ghl_trigger_broadcast>[0]);
    case 'ghl_update_building_profile': return ghl_update_building_profile(input.locationId as string, input as Partial<GHLBuildingProfile>);
    default: throw new Error(`Unknown GHL tool: ${name}`);
  }
}

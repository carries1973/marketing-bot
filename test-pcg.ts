/**
 * PCG Marketing Bot — Local Test
 *
 * Tests Claude → PCG GHL full round-trip:
 *   1. Reads PCG building profile from GHL
 *   2. Generates structured leasing content package (JSON)
 *   3. Schedules the social caption via GHL Social Planner
 *   4. Creates a broadcast approval note in GHL (for Sam/Carrie 1-click approval)
 *
 * Run: ANTHROPIC_API_KEY=sk-ant-... npx tsx test-pcg.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config({ override: true });

// ── Config ────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GHL_API_KEY       = process.env.GHL_API_KEY       || 'pit-07426fcb-2a35-461a-8d8a-019b83bd0756';
const GHL_LOCATION_ID   = process.env.GHL_LOCATION_ID   || 't8XF6CbsKa87yJXHlNFU';
const APPROVAL_EMAIL    = 'carrie@propertyconsultinggroup.ca';

if (!ANTHROPIC_API_KEY) {
  console.error('\n❌ Add ANTHROPIC_API_KEY to your .env file and try again.\n');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const ghl = axios.create({
  baseURL: 'https://services.leadconnectorhq.com',
  headers: {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeasingContent {
  headline: string;
  ilsDescription: string;
  kijijiTitle: string;
  kijijiTitleCharCount: number;
  kijijiDescription: string;
  socialCaptions: {
    short: string;
    medium: string;
    withEmoji: string;
  };
  emailBroadcast: {
    subjectLine: string;
    previewText: string;
    body: string;
  };
}

// ── Step 1: Read PCG building profile from GHL ────────────────────────────────

async function getBuildingProfile() {
  console.log('\n🔍 Reading PCG building profile from GHL...');
  const res = await ghl.get(`/locations/${GHL_LOCATION_ID}`);
  const loc = res.data.location;
  console.log(`✅ Connected to GHL: ${loc.name}`);
  return {
    name:    loc.name,
    address: loc.address,
    city:    loc.city,
    phone:   loc.phone,
    email:   loc.email,
  };
}

// ── Step 2: Generate structured leasing content with Claude ───────────────────

async function generateLeasingContent(building: Awaited<ReturnType<typeof getBuildingProfile>>): Promise<LeasingContent> {
  console.log('\n🤖 Generating leasing content package (ApexCanadianRental™ framework)...\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are a leasing content specialist for ${building.name} in Calgary, Alberta, Canada.
You write ILS advertising copy using the ApexCanadianRental™ framework. Every word serves one purpose:
get a qualified prospect to book a showing.

FIVE-BLOCK STRUCTURE (all ILS descriptions):
BLOCK 1 — HOOK (1 sentence, ≤25 words) — lead with the single most compelling benefit or lifestyle outcome. NEVER start with: "Located at…" / "This unit offers…" / "Welcome to…" / "Discover…"
BLOCK 2 — UNIT SPECS (2-4 lines, factual) — beds/baths/sqft/floor/available date/lease term. State exactly which utilities are included.
BLOCK 3 — IN-SUITE FEATURES (max 5 bullets) — lead with W/D → A/C → Keyless → Balcony → Internet for Young Professional
BLOCK 4 — BUILDING AMENITIES (max 5 bullets) — lead with Parkade → Gym → Package lockers → Bike storage → Dog run for Young Professional
BLOCK 5 — CTA (1-2 sentences max) — clear action with contact method. GOOD: "Book your showing at {RSVP_LINK} or call/text {PHONE}."

KIJIJI TITLE: ≤64 chars HARD LIMIT — format: [Beds] [$/mo] [#1 Feature] [Neighbourhood]

ALBERTA HUMAN RIGHTS ACT — MANDATORY:
NEVER include: age restrictions, "Suits a working person", "No students", "Canadian references required", "Adults preferred/only" (without legal AHR Act s.10 exemption)

BANNED ADJECTIVES: beautiful, stunning, gorgeous, amazing, luxurious, spacious (without sq ft)
BANNED PHRASES: "don't miss out", "won't last", "must see", "act fast"

Return ONLY valid JSON — no markdown, no explanation, just the JSON object.`,
    messages: [
      {
        role: 'user',
        content: `Generate a leasing content package for this available unit at ${building.name} (${building.city}):

Unit: 2-bedroom, 1-bathroom
Size: 850 sq ft
Floor: 4th floor, south-facing
Available: May 1, 2026
Rent: $1,850/month (12-month lease)
Key features: in-suite laundry, stainless appliances, large windows, A/C, underground parking included
Building amenities: secured parkade, gym, package lockers, rooftop patio
Utilities: heat and water included, electricity not included
Pet policy: pet-friendly with $500 pet deposit
Neighbourhood: Beltline, Calgary

Return this exact JSON structure (no other text):
{
  "headline": "string — benefit-led ILS headline, no char limit",
  "ilsDescription": "string — full five-block ILS description (master copy)",
  "kijijiTitle": "string — ≤64 chars HARD LIMIT, count carefully",
  "kijijiTitleCharCount": number,
  "kijijiDescription": "string — full Kijiji description",
  "socialCaptions": {
    "short": "string — ≤100 chars",
    "medium": "string — ≤200 chars",
    "withEmoji": "string — ≤200 chars + 2-3 emojis"
  },
  "emailBroadcast": {
    "subjectLine": "string — ≤60 chars",
    "previewText": "string — ≤90 chars",
    "body": "string — ≤150 words, resident-facing, warm and benefit-led"
  }
}`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(json) as LeasingContent;
}

// ── Step 3a: Schedule social caption via GHL Social Planner ──────────────────

async function scheduleSocialPost(caption: string, buildingName: string): Promise<void> {
  console.log('\n📅 Scheduling social caption via GHL Social Planner...');

  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 1);
  scheduledFor.setHours(10, 0, 0, 0);

  // Try both known GHL social planner endpoint variants
  const endpoints = ['/social-media-posting/posts', '/social-media-posting/post'];
  let posted = false;

  for (const endpoint of endpoints) {
    try {
      const res = await ghl.post(endpoint, {
        locationId: GHL_LOCATION_ID,
        content: caption,
        scheduledDate: scheduledFor.toISOString(),
        status: 'scheduled',
      });
      console.log(`✅ Social post scheduled for ${scheduledFor.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })} 10:00 AM`);
      console.log(`   Post ID: ${res.data?.id || '(see GHL Social Planner)'}`);
      posted = true;
      break;
    } catch (err: any) {
      const status = err.response?.status;
      const msg    = err.response?.data?.message || err.message;
      if (status === 404) continue; // try next endpoint
      if (status === 422 || msg?.toLowerCase().includes('account') || msg?.toLowerCase().includes('social')) {
        console.log('⚠️  Social Planner: no connected accounts — connect Facebook/Instagram in GHL to publish.');
        posted = true;
        break;
      }
      console.log(`⚠️  Social Planner (${endpoint}): ${msg} (status ${status})`);
      posted = true;
      break;
    }
  }

  if (!posted) {
    console.log('⚠️  Social Planner endpoints not available — connect a social account in GHL Social Planner.');
  }
  console.log(`   Caption ready:\n   "${caption}"`);
}

// ── Step 3b: Queue broadcast for approval via GHL contact note ────────────────

async function queueBroadcastApproval(content: LeasingContent, buildingName: string): Promise<void> {
  console.log('\n📬 Queuing email broadcast for approval in GHL...');

  // Find Carrie's contact — GHL v2: search by query then filter by exact email
  let contactId: string | null = null;
  try {
    const search = await ghl.get('/contacts/', {
      params: { locationId: GHL_LOCATION_ID, query: APPROVAL_EMAIL, limit: 20 },
    });
    const match = (search.data?.contacts as any[] || []).find(
      (c: any) => c.email?.toLowerCase() === APPROVAL_EMAIL.toLowerCase()
    );
    contactId = match?.id || null;
  } catch (err: any) {
    console.log(`⚠️  Contact search failed: ${err.response?.data?.message || err.message}`);
    return;
  }

  if (!contactId) {
    console.log(`⚠️  Contact not found for ${APPROVAL_EMAIL} — check GHL contacts.`);
    return;
  }

  if (!contactId) {
    console.log('⚠️  No contact ID — broadcast note not created.');
    return;
  }

  const noteBody =
`[APPROVAL REQUIRED] — Email Broadcast Draft
==========================================
Building: ${buildingName}
Unit: 2BD/1BA | $1,850/mo | Beltline | May 1

SUBJECT LINE (${content.emailBroadcast.subjectLine.length} chars):
${content.emailBroadcast.subjectLine}

PREVIEW TEXT (${content.emailBroadcast.previewText.length} chars):
${content.emailBroadcast.previewText}

BODY:
${content.emailBroadcast.body}

---
✅ Reply APPROVE to send  |  ✏️  Reply EDIT [changes] to revise
Generated by PCG Marketing Bot`;

  try {
    await ghl.post(`/contacts/${contactId}/notes`, { body: noteBody });
    console.log(`✅ Broadcast approval note added to GHL contact (${APPROVAL_EMAIL})`);
    console.log(`   Subject: "${content.emailBroadcast.subjectLine}"`);
  } catch (err: any) {
    console.log(`⚠️  Note creation: ${err.response?.data?.message || err.message}`);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  PCG Marketing Bot — Full Round-Trip Test');
  console.log('  Claude → Content → GHL Write-Back');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const building = await getBuildingProfile();
  const content  = await generateLeasingContent(building);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  GENERATED CONTENT — ${building.name}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('HEADLINE:');
  console.log(content.headline);

  console.log('\nILS DESCRIPTION (Master):');
  console.log(content.ilsDescription);

  console.log(`\nKIJIJI TITLE [${content.kijijiTitleCharCount} chars]:`);
  console.log(content.kijijiTitle);
  if (content.kijijiTitleCharCount > 64) {
    console.log(`⚠️  WARNING: Kijiji title is ${content.kijijiTitleCharCount} chars — OVER 64-char limit`);
  }

  console.log('\nSOCIAL CAPTIONS:');
  console.log(`  Short:      ${content.socialCaptions.short}`);
  console.log(`  Medium:     ${content.socialCaptions.medium}`);
  console.log(`  With emoji: ${content.socialCaptions.withEmoji}`);

  console.log('\nEMAIL BROADCAST:');
  console.log(`  Subject:  ${content.emailBroadcast.subjectLine}`);
  console.log(`  Preview:  ${content.emailBroadcast.previewText}`);

  // GHL write-backs
  await scheduleSocialPost(content.socialCaptions.withEmoji, building.name);
  await queueBroadcastApproval(content, building.name);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ Round-trip complete.');
  console.log('     Social caption → GHL Social Planner');
  console.log('     Broadcast draft → GHL contact note (approval pending)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

run().catch(console.error);

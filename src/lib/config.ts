import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),

  // ── Notification provider ──────────────────────────────────────────────────
  // "google" = Gmail (PCG) | "m365" = Teams (ZEN production)
  NOTIFICATION_PROVIDER: z.enum(['google', 'm365']).default('google'),
  NOTIFY_EMAIL: z.string().email().default('carrie@propertyconsultinggroup.ca'),

  // ── GHL ───────────────────────────────────────────────────────────────────
  GHL_API_KEY: z.string().min(1),
  GHL_LOCATION_ID: z.string().min(1),
  GHL_PIPELINE_ID: z.string().optional(),

  // ── Google Workspace (PCG / google provider) ───────────────────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_YARDI_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_YARDI_VACANCY_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_YARDI_RENTROLL_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_YARDI_FINANCIAL_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_YARDI_LEASING_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_REPORTS_FOLDER_ID: z.string().optional(),

  // ── Microsoft 365 (ZEN production only — not used in PCG environment) ──────
  M365_TENANT_ID: z.string().optional(),
  M365_CLIENT_ID: z.string().optional(),
  M365_CLIENT_SECRET: z.string().optional(),
  M365_SHAREPOINT_SITE_ID: z.string().optional(),
  M365_TEAMS_CHANNEL_MARKET: z.string().url().optional(),
  M365_TEAMS_CHANNEL_DIGITAL: z.string().url().optional(),
  M365_TEAMS_CHANNEL_REPUTATION: z.string().url().optional(),
  M365_TEAMS_CHANNEL_TECHOPS: z.string().url().optional(),
  M365_TEAMS_CHANNEL_ESCALATIONS: z.string().url().optional(),

  // ── RentSync (ZEN production only) ────────────────────────────────────────
  RENTSYNC_API_KEY: z.string().optional(),

  // ── WordPress ─────────────────────────────────────────────────────────────
  WORDPRESS_BASE_URL: z.string().url().optional(),
  WORDPRESS_APP_PASSWORD: z.string().optional(),
  WORDPRESS_USERNAME: z.string().optional(),

  // ── PostgreSQL (optional — used for run logging; skipped if not set) ───────
  DATABASE_URL: z.string().optional(),

  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
}).superRefine((data, ctx) => {
  // Google credentials required when provider is google
  if (data.NOTIFICATION_PROVIDER === 'google') {
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const) {
      if (!data[key]) ctx.addIssue({ code: 'custom', path: [key], message: `Required when NOTIFICATION_PROVIDER=google` });
    }
  }
  // M365 credentials required when provider is m365
  if (data.NOTIFICATION_PROVIDER === 'm365') {
    for (const key of ['M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET'] as const) {
      if (!data[key]) ctx.addIssue({ code: 'custom', path: [key], message: `Required when NOTIFICATION_PROVIDER=m365` });
    }
  }
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Missing required environment variables:');
  result.error.issues.forEach(i => console.error(`  ${i.path.join('.')}: ${i.message}`));
  process.exit(1);
}

export const config = result.data;

// Runtime assertion helper — throws clearly if an optional field is used without being set
export function requireConfig<K extends keyof typeof config>(key: K, provider?: string): NonNullable<(typeof config)[K]> {
  const val = config[key];
  if (val === undefined || val === null) {
    throw new Error(`Config "${key}" is required${provider ? ` when using ${provider}` : ''} but was not set.`);
  }
  return val as NonNullable<(typeof config)[K]>;
}

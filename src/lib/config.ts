import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  GHL_API_KEY: z.string().min(1),
  GHL_LOCATION_ID: z.string().min(1),
  M365_TENANT_ID: z.string().min(1),
  M365_CLIENT_ID: z.string().min(1),
  M365_CLIENT_SECRET: z.string().min(1),
  M365_SHAREPOINT_SITE_ID: z.string().min(1),
  M365_TEAMS_CHANNEL_MARKET: z.string().url(),
  M365_TEAMS_CHANNEL_DIGITAL: z.string().url(),
  M365_TEAMS_CHANNEL_REPUTATION: z.string().url(),
  M365_TEAMS_CHANNEL_TECHOPS: z.string().url(),
  M365_TEAMS_CHANNEL_ESCALATIONS: z.string().url(),
  RENTSYNC_API_KEY: z.string().min(1),
  WORDPRESS_BASE_URL: z.string().url(),
  WORDPRESS_APP_PASSWORD: z.string().min(1),
  WORDPRESS_USERNAME: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    agent: 'config',
    message: 'Environment validation failed — boot aborted',
    issues: result.error.issues.map(i => ({
      var: i.path.join('.'),
      problem: i.message,
    })),
  }));
  process.exit(1);
}

export const config = result.data;

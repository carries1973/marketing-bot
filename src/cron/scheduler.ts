/**
 * Cron scheduler — matches the operating rhythm defined in the framework.
 * All times are Mountain Time (ZEN Residential, Calgary).
 *
 * Cron format: second(opt) minute hour day-of-month month day-of-week
 */
import cron from 'node-cron';
import { runAgent08 } from '../agents/agent08-website-listings.js';
import { logger } from '../lib/logger.js';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function startScheduler() {
  // ─── Agent 08: daily vacancy check — 8:00am MT weekdays ──────────────────
  cron.schedule('0 8 * * 1-5', async () => {
    logger.info('scheduler', 'Triggering Agent 08 — daily vacancy check');
    await runAgent08({ mode: 'daily', date: today() });
  }, { timezone: 'America/Edmonton' });

  // ─── Agent 08: Sunday full sync — 11:00pm MT ──────────────────────────────
  cron.schedule('0 23 * * 0', async () => {
    logger.info('scheduler', 'Triggering Agent 08 — Sunday full sync');
    await runAgent08({ mode: 'weekly_sync', date: today() });
  }, { timezone: 'America/Edmonton' });

  logger.info('scheduler', 'Cron scheduler started', {
    jobs: [
      'Agent 08 daily — 8:00am MT weekdays',
      'Agent 08 weekly sync — Sunday 11:00pm MT',
    ],
  });
}

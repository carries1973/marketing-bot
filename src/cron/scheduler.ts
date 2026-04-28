/**
 * Cron scheduler — matches the operating rhythm defined in the framework.
 * All times are Mountain Time (ZEN Residential, Calgary).
 *
 * Cron format: second(opt) minute hour day-of-month month day-of-week
 */
import cron from 'node-cron';
import { runAgent08 } from '../agents/agent08-website-listings.js';
import { gmail_check_yardi_inbox, gmail_save_yardi_attachments } from '../tools/google.js';
import { notify } from '../tools/notify.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

async function safeRun(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    logger.error('scheduler', `${label} failed`, err);
  }
}

export function startScheduler() {
  // ─── Agent 08: daily vacancy check — 8:00am MT weekdays ──────────────────
  cron.schedule('0 8 * * 1-5', () => safeRun('Agent 08 daily', async () => {
    logger.info('scheduler', 'Triggering Agent 08 — daily vacancy check');
    await runAgent08({ mode: 'daily', date: today() });
  }), { timezone: 'America/Edmonton' });

  // ─── Agent 08: Sunday full sync — 11:00pm MT ──────────────────────────────
  cron.schedule('0 23 * * 0', () => safeRun('Agent 08 weekly sync', async () => {
    logger.info('scheduler', 'Triggering Agent 08 — Sunday full sync');
    await runAgent08({ mode: 'weekly_sync', date: today() });
  }), { timezone: 'America/Edmonton' });

  // ─── PCG: Gmail Yardi inbox poller — 6:30am MT daily ─────────────────────
  // Checks carrie@propertyconsultinggroup.ca for Yardi report emails
  // and saves attachments to Google Drive before Agent 08 runs at 8:00am
  if (config.NOTIFICATION_PROVIDER === 'google') {
    cron.schedule('30 6 * * *', async () => {
      logger.info('scheduler', 'Polling Gmail for Yardi reports');
      try {
        const attachments = await gmail_check_yardi_inbox();
        if (attachments.length === 0) {
          logger.info('scheduler', 'No new Yardi emails found');
          return;
        }
        await gmail_save_yardi_attachments(attachments);
        logger.info('scheduler', `Saved ${attachments.length} Yardi attachment(s) to Google Drive`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error('scheduler', 'Yardi Gmail poller failed', error);
        await notify({
          channel: 'techops',
          title: '⚠️ Yardi Gmail poller failed',
          text: error,
          urgent: true,
        });
      }
    }, { timezone: 'America/Edmonton' });
  }

  logger.info('scheduler', 'Cron scheduler started', {
    jobs: [
      config.NOTIFICATION_PROVIDER === 'google' ? 'Gmail Yardi poller — 6:30am MT daily' : '(M365 Yardi pipeline — Power Automate)',
      'Agent 08 daily — 8:00am MT weekdays',
      'Agent 08 weekly sync — Sunday 11:00pm MT',
    ],
  });
}

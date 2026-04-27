/**
 * Notifications abstraction layer.
 * ZEN → Teams incoming webhooks (m365_post_to_teams)
 * PCG → Gmail to carrie@propertyconsultinggroup.ca
 *
 * Agents call notify() — never the platform-specific functions directly.
 */
import { config } from '../lib/config.js';

export type NotifyChannel = 'market' | 'digital' | 'reputation' | 'techops' | 'escalations' | 'general';

export interface NotifyParams {
  channel: NotifyChannel;
  title: string;
  text: string;
  urgent?: boolean;
}

export async function notify(params: NotifyParams): Promise<void> {
  if (config.NOTIFICATION_PROVIDER === 'google') {
    const { gmail_send_notification } = await import('./google.js');
    const subject = params.urgent
      ? `🚨 [ZEN/PCG ${params.channel.toUpperCase()}] ${params.title}`
      : `[ZEN/PCG ${params.channel.toUpperCase()}] ${params.title}`;
    await gmail_send_notification({
      to: config.NOTIFY_EMAIL,
      subject,
      body: params.text,
    });
  } else {
    const { m365_post_to_teams } = await import('./m365.js');
    await m365_post_to_teams({
      channel: params.channel as Parameters<typeof m365_post_to_teams>[0]['channel'],
      title: params.title,
      text: params.text,
    });
  }
}

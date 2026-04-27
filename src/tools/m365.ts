/**
 * Microsoft 365 / Graph API tool module.
 * Handles SharePoint file read/write, Outlook drafts, Teams webhooks, and Planner tasks.
 */
import axios from 'axios';
import { config } from '../lib/config.js';

// ─── Auth: client credentials flow ───────────────────────────────────────────

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  const res = await axios.post(
    `https://login.microsoftonline.com/${config.M365_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.M365_CLIENT_ID,
      client_secret: config.M365_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }),
  );
  _token = res.data.access_token;
  _tokenExpiry = Date.now() + res.data.expires_in * 1000;
  return _token!;
}

async function graph(method: 'get' | 'post' | 'put' | 'patch', path: string, data?: unknown) {
  const token = await getToken();
  const res = await axios({
    method,
    url: `https://graph.microsoft.com/v1.0${path}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
  return res.data;
}

// ─── SharePoint file tools ────────────────────────────────────────────────────

export async function m365_read_file(sharePointPath: string): Promise<string> {
  // e.g. sharePointPath = "/Data/Yardi/vacancy/2026-04-27.csv"
  const siteId = config.M365_SHAREPOINT_SITE_ID;
  const encoded = encodeURIComponent(sharePointPath);
  const meta = await graph('get', `/sites/${siteId}/drive/root:${encoded}`);
  // Download the actual content
  const contentRes = await axios.get(meta['@microsoft.graph.downloadUrl'], { responseType: 'text' });
  return contentRes.data as string;
}

export async function m365_save_document(params: {
  sharePointPath: string;  // e.g. "/Reports/Owner/BuildingA/2026-04/report.docx"
  content: string;         // text content; binary uploads handled separately
  contentType?: string;
}): Promise<{ webUrl: string }> {
  const siteId = config.M365_SHAREPOINT_SITE_ID;
  const encoded = encodeURIComponent(params.sharePointPath);
  const res = await graph('put', `/sites/${siteId}/drive/root:${encoded}:/content`, params.content);
  return { webUrl: res.webUrl };
}

// ─── Outlook draft ────────────────────────────────────────────────────────────

export async function m365_create_email_draft(params: {
  to: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
}): Promise<{ id: string; webLink: string }> {
  const res = await graph('post', '/me/messages', {
    subject: params.subject,
    body: { contentType: params.isHtml ? 'HTML' : 'Text', content: params.body },
    toRecipients: params.to.map(a => ({ emailAddress: { address: a } })),
    isDraft: true,
  });
  return { id: res.id, webLink: res.webLink };
}

// ─── Teams incoming webhook ───────────────────────────────────────────────────

type TeamsChannel = 'market' | 'digital' | 'reputation' | 'techops' | 'escalations';

const CHANNEL_URLS: Record<TeamsChannel, string> = {
  market:      config.M365_TEAMS_CHANNEL_MARKET,
  digital:     config.M365_TEAMS_CHANNEL_DIGITAL,
  reputation:  config.M365_TEAMS_CHANNEL_REPUTATION,
  techops:     config.M365_TEAMS_CHANNEL_TECHOPS,
  escalations: config.M365_TEAMS_CHANNEL_ESCALATIONS,
};

export async function m365_post_to_teams(params: {
  channel: TeamsChannel;
  title: string;
  text: string;
  // Optional action buttons (adaptive card buttons)
  actions?: Array<{ label: string; url?: string; value?: string }>;
}): Promise<void> {
  const webhookUrl = CHANNEL_URLS[params.channel];

  const card: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: '0076D7',
    summary: params.title,
    sections: [{ activityTitle: params.title, activityText: params.text }],
  };

  if (params.actions?.length) {
    card.potentialAction = params.actions.map(a => ({
      '@type': 'OpenUri',
      name: a.label,
      targets: [{ os: 'default', uri: a.url ?? `https://app.gohighlevel.com` }],
    }));
  }

  await axios.post(webhookUrl, card);
}

// ─── Planner task ─────────────────────────────────────────────────────────────

export async function m365_create_task(params: {
  planId: string;
  title: string;
  notes?: string;
  dueDate?: string;  // ISO date
  assignedToUserId?: string;
}): Promise<{ id: string }> {
  const task = await graph('post', '/planner/tasks', {
    planId: params.planId,
    title: params.title,
    ...(params.dueDate ? { dueDateTime: `${params.dueDate}T00:00:00Z` } : {}),
    ...(params.assignedToUserId ? { assignments: { [params.assignedToUserId]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' } } } : {}),
  });
  if (params.notes) {
    await graph('patch', `/planner/tasks/${task.id}/details`, {
      description: params.notes,
      previewType: 'description',
    });
  }
  return { id: task.id };
}

// ─── Anthropic tool definitions ───────────────────────────────────────────────

export const M365_TOOL_DEFINITIONS = [
  {
    name: 'm365_read_file',
    description: 'Read a file from SharePoint (CSV, XLSX content as text). Use for Yardi data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sharePointPath: { type: 'string', description: 'Absolute path e.g. /Data/Yardi/vacancy/2026-04-27.csv' },
      },
      required: ['sharePointPath'],
    },
  },
  {
    name: 'm365_save_document',
    description: 'Save a document to SharePoint',
    input_schema: {
      type: 'object' as const,
      properties: {
        sharePointPath: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['sharePointPath', 'content'],
    },
  },
  {
    name: 'm365_create_email_draft',
    description: 'Create an Outlook email draft for Sam to review and send',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        isHtml: { type: 'boolean' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'm365_post_to_teams',
    description: 'Post a notification to a Teams channel',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: { type: 'string', enum: ['market', 'digital', 'reputation', 'techops', 'escalations'] },
        title: { type: 'string' },
        text: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, url: { type: 'string' } },
            required: ['label'],
          },
        },
      },
      required: ['channel', 'title', 'text'],
    },
  },
  {
    name: 'm365_create_task',
    description: 'Create a Microsoft Planner task for Sam',
    input_schema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        dueDate: { type: 'string', description: 'ISO date e.g. 2026-05-01' },
      },
      required: ['planId', 'title'],
    },
  },
] as const;

export async function executeM365Tool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'm365_read_file':         return m365_read_file(input.sharePointPath as string);
    case 'm365_save_document':     return m365_save_document(input as Parameters<typeof m365_save_document>[0]);
    case 'm365_create_email_draft':return m365_create_email_draft(input as Parameters<typeof m365_create_email_draft>[0]);
    case 'm365_post_to_teams':     return m365_post_to_teams(input as Parameters<typeof m365_post_to_teams>[0]);
    case 'm365_create_task':       return m365_create_task(input as Parameters<typeof m365_create_task>[0]);
    default: throw new Error(`Unknown M365 tool: ${name}`);
  }
}

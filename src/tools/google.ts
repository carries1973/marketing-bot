/**
 * Google Workspace tool module — PCG test environment.
 * Replaces M365/SharePoint with Google Drive + Gmail.
 *
 * Auth: OAuth2 with offline refresh token (set once, persists).
 * Scopes needed:
 *   https://www.googleapis.com/auth/drive
 *   https://www.googleapis.com/auth/gmail.readonly
 *   https://www.googleapis.com/auth/gmail.send
 */
import { google } from 'googleapis';
import { config, requireConfig } from '../lib/config.js';

// ─── Auth client ──────────────────────────────────────────────────────────────

function getAuth() {
  const auth = new google.auth.OAuth2(
    requireConfig('GOOGLE_CLIENT_ID', 'Google'),
    requireConfig('GOOGLE_CLIENT_SECRET', 'Google'),
  );
  auth.setCredentials({ refresh_token: requireConfig('GOOGLE_REFRESH_TOKEN', 'Google') });
  return auth;
}

// ─── Google Drive — replaces SharePoint file operations ───────────────────────

export async function gdrive_read_file(drivePath: string): Promise<string> {
  // drivePath maps to a file name in the configured Yardi data folder
  // e.g. "/Data/Yardi/vacancy/2026-04-27.csv"
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // Find the file by name in the Yardi data folder
  const filename = drivePath.split('/').pop()!;
  const search = await drive.files.list({
    q: `name='${filename}' and '${requireConfig('GOOGLE_DRIVE_YARDI_FOLDER_ID', 'Google')}' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  const file = search.data.files?.[0];
  if (!file?.id) throw new Error(`File not found in Google Drive: ${filename}`);

  // Download as text via export URL
  const meta = await drive.files.get({ fileId: file.id, fields: 'webContentLink' });
  const { default: axios } = await import('axios');
  const tokenRes = await auth.getAccessToken();
  const contentRes = await axios.get(meta.data.webContentLink!, {
    headers: { Authorization: `Bearer ${tokenRes.token}` },
    responseType: 'text',
  });
  return contentRes.data as string;
}

export async function gdrive_save_document(params: {
  drivePath: string;   // e.g. "/Reports/Owner/BuildingA/2026-04/report.txt"
  content: string;
  mimeType?: string;
}): Promise<{ webViewLink: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const filename = params.drivePath.split('/').pop()!;

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [requireConfig('GOOGLE_DRIVE_REPORTS_FOLDER_ID', 'Google')],
      mimeType: params.mimeType ?? 'text/plain',
    },
    media: {
      mimeType: params.mimeType ?? 'text/plain',
      body: params.content,
    },
    fields: 'webViewLink',
  });

  return { webViewLink: res.data.webViewLink ?? '' };
}

// ─── Gmail — Yardi report inbox watcher ───────────────────────────────────────

export interface YardiEmailAttachment {
  filename: string;
  mimeType: string;
  data: string;  // base64url encoded
  reportType: 'vacancy' | 'rent_roll' | 'financials' | 'leasing' | 'unknown';
  date: string;  // YYYY-MM-DD detected from subject or received date
}

const YARDI_REPORT_PATTERNS: Array<{ pattern: RegExp; type: YardiEmailAttachment['reportType'] }> = [
  { pattern: /vacancy/i,         type: 'vacancy' },
  { pattern: /rent.?roll/i,      type: 'rent_roll' },
  { pattern: /budget|financial/i,type: 'financials' },
  { pattern: /leasing.?summary/i,type: 'leasing' },
];

export async function gmail_check_yardi_inbox(sinceDate?: string): Promise<YardiEmailAttachment[]> {
  const auth = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  // Search for unprocessed Yardi report emails
  const query = [
    'has:attachment',
    'from:yardi',
    sinceDate ? `after:${sinceDate}` : 'newer_than:2d',
    'is:unread',
  ].join(' ');

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
  const messages = list.data.messages ?? [];

  const attachments: YardiEmailAttachment[] = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
    const date = headers.find(h => h.name === 'Date')?.value ?? '';

    // Detect report type from subject
    let reportType: YardiEmailAttachment['reportType'] = 'unknown';
    for (const { pattern, type } of YARDI_REPORT_PATTERNS) {
      if (pattern.test(subject)) { reportType = type; break; }
    }

    // Extract ISO date (YYYY-MM-DD) from the email date header
    const parsedDate = new Date(date);
    const isoDate = isNaN(parsedDate.getTime())
      ? new Date().toISOString().split('T')[0]
      : parsedDate.toISOString().split('T')[0];

    // Get attachments
    const parts = full.data.payload?.parts ?? [];
    for (const part of parts) {
      if (!part.filename || !part.body?.attachmentId) continue;

      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: msg.id!,
        id: part.body.attachmentId,
      });

      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        data: att.data.data ?? '',
        reportType,
        date: isoDate,
      });
    }

    // Mark as read so we don't re-process
    await gmail.users.messages.modify({
      userId: 'me',
      id: msg.id!,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  return attachments;
}

export async function gmail_save_yardi_attachments(attachments: YardiEmailAttachment[]): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const FOLDER_MAP: Record<YardiEmailAttachment['reportType'], string> = {
    vacancy:   requireConfig('GOOGLE_DRIVE_YARDI_VACANCY_FOLDER_ID', 'Google'),
    rent_roll: requireConfig('GOOGLE_DRIVE_YARDI_RENTROLL_FOLDER_ID', 'Google'),
    financials:requireConfig('GOOGLE_DRIVE_YARDI_FINANCIAL_FOLDER_ID', 'Google'),
    leasing:   requireConfig('GOOGLE_DRIVE_YARDI_LEASING_FOLDER_ID', 'Google'),
    unknown:   requireConfig('GOOGLE_DRIVE_YARDI_FOLDER_ID', 'Google'),
  };

  for (const att of attachments) {
    const folderId = FOLDER_MAP[att.reportType];
    const ext = att.filename.split('.').pop() ?? 'csv';
    const filename = `${att.date}.${ext}`;

    // Decode base64url → buffer
    const buffer = Buffer.from(att.data, 'base64url');

    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
        mimeType: att.mimeType,
      },
      media: { mimeType: att.mimeType, body: buffer.toString() },
    });
  }
}

// ─── Gmail send — replaces m365_create_email_draft for PCG notifications ──────

export async function gmail_send_notification(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const auth = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = Buffer.from(
    `To: ${params.to}\r\nSubject: ${params.subject}\r\nContent-Type: text/plain\r\n\r\n${params.body}`,
  ).toString('base64url');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

// ─── Anthropic tool definitions ───────────────────────────────────────────────

export const GOOGLE_TOOL_DEFINITIONS = [
  {
    name: 'gdrive_read_file',
    description: 'Read a file from Google Drive (Yardi data, CSV/XLSX content). Use for vacancy and rent roll data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        drivePath: { type: 'string', description: 'Path e.g. /Data/Yardi/vacancy/2026-04-27.csv' },
      },
      required: ['drivePath'],
    },
  },
  {
    name: 'gdrive_save_document',
    description: 'Save a document to Google Drive',
    input_schema: {
      type: 'object' as const,
      properties: {
        drivePath: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['drivePath', 'content'],
    },
  },
  {
    name: 'gmail_send_notification',
    description: 'Send an email notification to Carrie',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
] as const;

export async function executeGoogleTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'gdrive_read_file':       return gdrive_read_file(input.drivePath as string);
    case 'gdrive_save_document':   return gdrive_save_document(input as Parameters<typeof gdrive_save_document>[0]);
    case 'gmail_send_notification':return gmail_send_notification(input as Parameters<typeof gmail_send_notification>[0]);
    default: throw new Error(`Unknown Google tool: ${name}`);
  }
}

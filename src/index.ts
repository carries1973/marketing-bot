/**
 * ZEN Marketing Agents — webhook server entry point.
 *
 * Receives triggers from n8n and GHL webhooks.
 * Routes to the appropriate agent runner.
 */
import 'dotenv/config';
import http from 'http';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './cron/scheduler.js';
import { runAgent08, type Agent08Payload } from './agents/agent08-website-listings.js';
import { runAgent01, type Agent01Payload } from './agents/agent01-leasing-content.js';

// ─── Webhook routes ────────────────────────────────────────────────────────────

type RouteHandler = (body: unknown) => Promise<void>;

const routes: Record<string, RouteHandler> = {
  // n8n → Agent 08
  '/webhook/agent08/daily':          (b) => runAgent08(b as Agent08Payload),
  '/webhook/agent08/weekly-sync':    (b) => runAgent08(b as Agent08Payload),
  '/webhook/agent08/staleness':      (b) => runAgent08(b as Agent08Payload),

  // n8n / Agent 08 vacancy alert → Agent 01
  '/webhook/agent01/vacancy':        (b) => runAgent01(b as Agent01Payload),

  // Health check
  '/health': async () => { /* handled inline */ },
};

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // Health check
  if (url === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
    return;
  }

  if (method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const handler = routes[url];
  if (!handler) {
    res.writeHead(404);
    res.end(`No route: ${url}`);
    return;
  }

  // Parse body
  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400);
    res.end('Invalid JSON');
    return;
  }

  // Acknowledge immediately — agents run async
  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ accepted: true, route: url }));

  try {
    await handler(body);
  } catch (err) {
    logger.error('server', `Unhandled error on ${url}`, err);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(config.PORT, () => {
  logger.info('server', `ZEN Marketing Agents listening on :${config.PORT}`);
  startScheduler();
});

server.on('error', (err) => {
  logger.error('server', 'Server error', err);
});

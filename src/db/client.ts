import pg from 'pg';
import { config } from '../lib/config.js';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export const db = {
  query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) =>
    pool.query<T>(sql, params),

  async logRun(params: {
    agentId: string;
    trigger: string;
    status: 'success' | 'error' | 'approval_pending';
    inputSummary: string;
    outputSummary: string;
    durationMs: number;
    tokensUsed?: number;
    error?: string;
  }) {
    await pool.query(
      `INSERT INTO agent_runs
         (agent_id, trigger, status, input_summary, output_summary, duration_ms, tokens_used, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        params.agentId,
        params.trigger,
        params.status,
        params.inputSummary,
        params.outputSummary,
        params.durationMs,
        params.tokensUsed ?? null,
        params.error ?? null,
      ],
    );
  },

  async queueJob(agentId: string, payload: unknown, runAt?: Date) {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO job_queue (agent_id, payload, run_at, status)
       VALUES ($1,$2,$3,'pending') RETURNING id`,
      [agentId, JSON.stringify(payload), runAt ?? new Date()],
    );
    return result.rows[0].id;
  },
};

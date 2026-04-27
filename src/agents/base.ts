/**
 * Agent base class.
 * All 14 agents extend this. Handles the Claude tool-use loop,
 * PostgreSQL logging, and Teams notifications.
 */
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS, type AgentModel } from '../lib/anthropic.js';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { executeGHLTool, GHL_TOOL_DEFINITIONS } from '../tools/ghl.js';
import { executeM365Tool, M365_TOOL_DEFINITIONS } from '../tools/m365.js';
import { executeRentSyncTool, RENTSYNC_TOOL_DEFINITIONS } from '../tools/rentsync.js';
import { executeWordPressTool, WORDPRESS_TOOL_DEFINITIONS } from '../tools/wordpress.js';
import { WEB_SEARCH_TOOL_DEFINITION } from '../tools/web-search.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolSet = ReadonlyArray<'ghl' | 'm365' | 'rentsync' | 'wordpress' | 'web_search'>;

export interface AgentRunResult {
  success: boolean;
  output: string;
  tokensUsed: number;
  durationMs: number;
  approvalRequired: boolean;
}

// ─── Base class ───────────────────────────────────────────────────────────────

export abstract class BaseAgent {
  abstract readonly agentId: string;
  abstract readonly systemPrompt: string;
  abstract readonly tools: ToolSet;
  readonly model: AgentModel = MODELS.default;

  // Subclasses override to describe what they're doing (for logging)
  protected summarizeInput(_input: unknown): string { return JSON.stringify(_input).slice(0, 200); }
  protected summarizeOutput(output: string): string { return output.slice(0, 300); }

  async run(userMessage: string, trigger: string): Promise<AgentRunResult> {
    const startMs = Date.now();
    logger.info(this.agentId, `Starting run`, { trigger });

    const toolDefs = this.buildToolDefs();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';
    let approvalRequired = false;

    try {
      // Agentic tool-use loop
      while (true) {
        const response = await anthropic.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: this.systemPrompt,
              // Cache the system prompt — it never changes between runs
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: toolDefs,
          messages,
        });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        // Check for approval flag in text blocks
        for (const block of response.content) {
          if (block.type === 'text') {
            finalText += block.text;
            if (block.text.includes('[APPROVAL_REQUIRED]')) approvalRequired = true;
          }
        }

        if (response.stop_reason === 'end_turn') break;

        if (response.stop_reason === 'tool_use') {
          // Execute all tool calls in this response
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;

            logger.info(this.agentId, `Calling tool: ${block.name}`, block.input);
            let result: unknown;
            try {
              result = await this.executeTool(block.name, block.input as Record<string, unknown>);
            } catch (err) {
              result = { error: err instanceof Error ? err.message : String(err) };
              logger.error(this.agentId, `Tool error: ${block.name}`, err);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }

          // Add assistant response + tool results to message history
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        break; // unexpected stop reason — exit loop
      }

      const durationMs = Date.now() - startMs;
      const tokensUsed = totalInputTokens + totalOutputTokens;

      await db.logRun({
        agentId: this.agentId,
        trigger,
        status: approvalRequired ? 'approval_pending' : 'success',
        inputSummary: this.summarizeInput(userMessage),
        outputSummary: this.summarizeOutput(finalText),
        durationMs,
        tokensUsed,
      });

      logger.info(this.agentId, `Run complete`, { durationMs, tokensUsed, approvalRequired });

      return { success: true, output: finalText, tokensUsed, durationMs, approvalRequired };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);

      await db.logRun({
        agentId: this.agentId,
        trigger,
        status: 'error',
        inputSummary: this.summarizeInput(userMessage),
        outputSummary: '',
        durationMs,
        error,
      });

      logger.error(this.agentId, `Run failed`, { error, durationMs });
      return { success: false, output: error, tokensUsed: totalInputTokens + totalOutputTokens, durationMs, approvalRequired: false };
    }
  }

  private buildToolDefs(): Anthropic.Tool[] {
    const defs: Anthropic.Tool[] = [];
    if (this.tools.includes('ghl'))        defs.push(...(GHL_TOOL_DEFINITIONS as unknown as Anthropic.Tool[]));
    if (this.tools.includes('m365'))       defs.push(...(M365_TOOL_DEFINITIONS as unknown as Anthropic.Tool[]));
    if (this.tools.includes('rentsync'))   defs.push(...(RENTSYNC_TOOL_DEFINITIONS as unknown as Anthropic.Tool[]));
    if (this.tools.includes('wordpress')) defs.push(...(WORDPRESS_TOOL_DEFINITIONS as unknown as Anthropic.Tool[]));
    if (this.tools.includes('web_search')) defs.push(WEB_SEARCH_TOOL_DEFINITION as unknown as Anthropic.Tool);
    return defs;
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    if (name.startsWith('ghl_'))        return executeGHLTool(name, input);
    if (name.startsWith('m365_'))       return executeM365Tool(name, input);
    if (name.startsWith('rentsync_'))   return executeRentSyncTool(name, input);
    if (name.startsWith('wordpress_')) return executeWordPressTool(name, input);
    // web_search is handled natively by Claude — result comes back as tool_result from the API
    throw new Error(`Unknown tool namespace: ${name}`);
  }
}

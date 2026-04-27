import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// claude-sonnet-4-6 for routine agents; upgrade to claude-opus-4-7 for complex reasoning tasks
export const MODELS = {
  default: 'claude-sonnet-4-6',
  heavy: 'claude-opus-4-7',
} as const;

export type AgentModel = (typeof MODELS)[keyof typeof MODELS];

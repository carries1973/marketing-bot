/**
 * Web search tool definition.
 * Claude handles the actual search execution natively — this just defines the tool schema
 * so agents can declare it in their tool list. No HTTP calls here.
 */

export const WEB_SEARCH_TOOL_DEFINITION = {
  name: 'web_search',
  description:
    'Search the web for current information: market data, competitor pricing, news, regulatory changes. ' +
    'Always cite sources. Canadian-context results preferred.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
} as const;

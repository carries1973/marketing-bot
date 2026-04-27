/**
 * WordPress REST API tool module.
 * Manages property pages and blog posts on zenresidential.ca.
 */
import axios from 'axios';
import { config } from '../lib/config.js';

const credentials = Buffer.from(
  `${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD}`,
).toString('base64');

const wp = axios.create({
  baseURL: `${config.WORDPRESS_BASE_URL}/wp-json/wp/v2`,
  headers: {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WPPost {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: 'publish' | 'draft' | 'private';
  link: string;
  modified: string;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export async function wordpress_get_page(slug: string): Promise<WPPost | null> {
  const res = await wp.get('/pages', { params: { slug } });
  return res.data[0] ?? null;
}

export async function wordpress_update_page(params: {
  pageId: number;
  content?: string;
  title?: string;
  status?: WPPost['status'];
}): Promise<{ link: string }> {
  const { pageId, ...fields } = params;
  const res = await wp.post(`/pages/${pageId}`, fields);
  return { link: res.data.link };
}

export async function wordpress_create_post(params: {
  title: string;
  content: string;
  status: WPPost['status'];
  slug?: string;
  categoryIds?: number[];
  tags?: string[];
}): Promise<{ id: number; link: string }> {
  const res = await wp.post('/posts', {
    title: params.title,
    content: params.content,
    status: params.status,
    ...(params.slug ? { slug: params.slug } : {}),
    ...(params.categoryIds ? { categories: params.categoryIds } : {}),
  });
  return { id: res.data.id, link: res.data.link };
}

export async function wordpress_find_page_by_slug(slug: string): Promise<number | null> {
  const page = await wordpress_get_page(slug);
  return page?.id ?? null;
}

// ─── Anthropic tool definitions ───────────────────────────────────────────────

export const WORDPRESS_TOOL_DEFINITIONS = [
  {
    name: 'wordpress_update_page',
    description: 'Update an existing WordPress page (e.g. property availability page)',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageId: { type: 'number' },
        content: { type: 'string', description: 'HTML or block content' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['publish', 'draft', 'private'] },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'wordpress_create_post',
    description: 'Create a new WordPress blog post. Always creates as draft unless explicitly publishing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'HTML content for the post body' },
        status: { type: 'string', enum: ['publish', 'draft', 'private'] },
        slug: { type: 'string' },
        categoryIds: { type: 'array', items: { type: 'number' } },
      },
      required: ['title', 'content', 'status'],
    },
  },
  {
    name: 'wordpress_get_page',
    description: 'Fetch a WordPress page by slug to check current content',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
    },
  },
] as const;

export async function executeWordPressTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'wordpress_update_page':  return wordpress_update_page(input as Parameters<typeof wordpress_update_page>[0]);
    case 'wordpress_create_post':  return wordpress_create_post(input as Parameters<typeof wordpress_create_post>[0]);
    case 'wordpress_get_page':     return wordpress_get_page(input.slug as string);
    default: throw new Error(`Unknown WordPress tool: ${name}`);
  }
}

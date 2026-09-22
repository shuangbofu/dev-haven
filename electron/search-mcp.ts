import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { memoryConfigSchema } from '../src/shared/memory';
import { LocalSearchIndex } from './search-index';
export async function serveSearch(directory: string) {
  const index = new LocalSearchIndex();
  const config = async () => memoryConfigSchema.parse(JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')));
  const server = new McpServer({ name: 'devhaven', version: '1.0.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('devhaven_search', {
    description: 'Search the local DevHaven index for personal documents and projects by body, README, metadata and path. Returns source-relative paths, snippets and index freshness. Does not crawl or upload files.',
    inputSchema: { query: z.string().trim().min(1).max(300), kind: z.enum(['all', 'document', 'project']).default('all'), page: z.number().int().min(1).max(10000).default(1) }, annotations: readOnly,
  }, async input => { const result = await index.search(input, await config()); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; });
  server.registerTool('devhaven_context', { description: 'Read configured source roots, registered metadata and collection purposes; persisted state is not process status.', inputSchema: {}, annotations: readOnly }, async () => {
    const current = await config(); const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    return { content: [{ type: 'text', text: JSON.stringify({ sources: current.sources, entities: state.entities, reportsDirectory: current.reportsDirectory }) }] };
  });
  server.registerTool('devhaven_search_status', { description: 'Read the local search index timestamp, size and diagnostics.', inputSchema: {}, annotations: readOnly }, async () => {
    await index.load(await config()); return { content: [{ type: 'text', text: JSON.stringify(index.status()) }] };
  });
  await server.connect(new StdioServerTransport());
}

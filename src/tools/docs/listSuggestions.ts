import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import { fetchDocSuggestions, toUserError } from '../../suggestions.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'listSuggestions',
    description:
      'Lists pending suggestion threads in a Google Doc, with the suggestion IDs needed for manageSuggestions (accept/reject/delete). Reads with suggestionsViewMode=SUGGESTIONS_INLINE across body, tabs, headers, footers and footnotes.',
    parameters: DocumentIdParameter.extend({}),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing suggestions in doc ${args.documentId}`);
      try {
        const result = await fetchDocSuggestions(docs, args.documentId);
        const link = `https://docs.google.com/document/d/${args.documentId}/edit`;
        if (result.suggestions.size === 0) {
          return `No pending suggestions found in document ${args.documentId}. Link: ${link}`;
        }
        const lines: string[] = [];
        if (result.previewDegraded) {
          lines.push(
            'Note: suggestion-thread metadata unavailable. Showing inline markers only; author/dates unavailable.'
          );
        }
        lines.push(`Pending suggestions in document ${args.documentId}:`);
        for (const [sid, info] of result.suggestions) {
          const types = info.types.join('+') || 'suggestion';
          const tab = info.tabId ? ` (tab: ${info.tabId})` : '';
          const preview = info.textPreview.replace(/\n/g, '\\n');
          const short = preview.length > 80 ? preview.slice(0, 80) + '...' : preview;
          const rendered = short ? `"${short}"` : '(no text preview)';
          const meta: string[] = [];
          if (info.author) meta.push(`author: ${info.author}`);
          if (info.createTime) meta.push(`created: ${info.createTime}`);
          lines.push(
            `  ${sid} | ${types}${tab} | ${rendered}${meta.length ? ` | ${meta.join(', ')}` : ''}`
          );
        }
        lines.push(`Link: ${link}`);
        return lines.join('\n');
      } catch (error: any) {
        log.error(`Error listing suggestions in doc ${args.documentId}: ${error.message || error}`);
        toUserError(error, 'Failed to list suggestions');
      }
    },
  });
}

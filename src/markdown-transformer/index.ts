// src/markdown-transformer/index.ts
//
// Public API for bidirectional markdown <-> Google Docs conversion.
//
// Main methods:
//   extractMarkdown() - Fetch a Google Doc and return its content as markdown
//   insertMarkdown()  - Convert markdown and insert it into a Google Doc
//
// Helper:
//   docsJsonToMarkdown() - Convert already-fetched Docs JSON to markdown
//

import { docs_v1 } from 'googleapis';
import { docsJsonToMarkdown } from './docsToMarkdown.js';
import { convertMarkdownToRequests } from './markdownToDocs.js';
import type { ConversionOptions } from './markdownToDocs.js';
import { executeBatchUpdateWithSplitting, findTabById } from '../googleDocsApiHelpers.js';
import type { BatchUpdateMetadata } from '../googleDocsApiHelpers.js';

export { docsJsonToMarkdown } from './docsToMarkdown.js';
export type { ConversionOptions } from './markdownToDocs.js';

// --- Types ---

interface ExtractOptions {
  /** Target a specific tab by ID. Defaults to the first tab / document body. */
  tabId?: string;
}

interface InsertOptions {
  /** The 1-based document index where content should be inserted. Defaults to 1. */
  startIndex?: number;
  /** Target a specific tab by ID. */
  tabId?: string;
  /** Treat the first H1 (`# ...`) as a Google Docs TITLE instead of HEADING_1. */
  firstHeadingAsTitle?: boolean;
  /** When true, insert as pending suggestions (WriteControl.writeMode=SUGGEST). */
  suggestMode?: boolean;
}

/** Debug metadata returned by insertMarkdown(). */
export interface InsertMarkdownResult {
  /** Total number of Google Docs API requests generated from the markdown. */
  totalRequests: number;
  /** Breakdown of requests by type (e.g. insertText, updateTextStyle, etc.). */
  requestsByType: Record<string, number>;
  /** Time spent parsing markdown and generating requests, in milliseconds. */
  parseElapsedMs: number;
  /** Metadata from the batch update execution (API call counts, per-phase timing). */
  batchUpdate: BatchUpdateMetadata;
  /** Total wall-clock time for the entire insertMarkdown operation, in milliseconds. */
  totalElapsedMs: number;
}

/** Formats InsertMarkdownResult into a concise human-readable debug summary. */
export function formatInsertResult(result: InsertMarkdownResult): string {
  const lines: string[] = [];
  lines.push(`Markdown insert completed in ${result.totalElapsedMs}ms`);
  lines.push(`  Parse: ${result.parseElapsedMs}ms`);
  lines.push(
    `  Requests: ${result.totalRequests} total (${Object.entries(result.requestsByType)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')})`
  );
  lines.push(
    `  API calls: ${result.batchUpdate.totalApiCalls} batchUpdate calls in ${result.batchUpdate.totalElapsedMs}ms`
  );
  const { phases } = result.batchUpdate;
  if (phases.delete.requests > 0) {
    lines.push(
      `    Delete phase: ${phases.delete.requests} requests, ${phases.delete.apiCalls} calls, ${phases.delete.elapsedMs}ms`
    );
  }
  if (phases.insert.requests > 0) {
    lines.push(
      `    Insert phase: ${phases.insert.requests} requests, ${phases.insert.apiCalls} calls, ${phases.insert.elapsedMs}ms`
    );
  }
  if (phases.format.requests > 0) {
    lines.push(
      `    Format phase: ${phases.format.requests} requests, ${phases.format.apiCalls} calls, ${phases.format.elapsedMs}ms`
    );
  }
  return lines.join('\n');
}

// --- extractMarkdown ---

/**
 * Fetches a Google Document and returns its content as a markdown string.
 *
 * @param docs - An authenticated Google Docs API client
 * @param documentId - The document ID (from the URL)
 * @param options - Optional: tabId to target a specific tab
 * @returns The document content as markdown
 */
export async function extractMarkdown(
  docs: docs_v1.Docs,
  documentId: string,
  options?: ExtractOptions
): Promise<string> {
  const tabId = options?.tabId;

  const res = await docs.documents.get({
    documentId,
    includeTabsContent: !!tabId,
    fields: tabId
      ? 'title,documentId,tabs(tabProperties,childTabs,documentTab(body,documentStyle,namedStyles,lists,inlineObjects,positionedObjects))'
      : 'title,documentId,body,documentStyle,namedStyles,lists,inlineObjects,positionedObjects',
  });

  if (tabId) {
    const targetTab = findTabById(res.data, tabId);
    if (!targetTab) {
      throw new Error(`Tab with ID "${tabId}" not found in document.`);
    }
    if (!targetTab.documentTab) {
      throw new Error(`Tab "${tabId}" does not have content (may not be a document tab).`);
    }
    return docsJsonToMarkdown({
      body: targetTab.documentTab.body,
      lists: targetTab.documentTab.lists,
    });
  }

  return docsJsonToMarkdown({
    body: res.data.body,
    lists: res.data.lists,
  });
}

// --- insertMarkdown ---

/**
 * Converts markdown to Google Docs formatting and inserts it into a document.
 *
 * Handles the full pipeline: markdown parsing, request generation, and batch
 * execution against the Docs API. Callers never see raw API requests.
 *
 * @param docs - An authenticated Google Docs API client
 * @param documentId - The document ID
 * @param markdown - The markdown content to insert
 * @param options - Optional: startIndex (default 1), tabId
 * @returns Debug metadata about the operation (request counts, timing, API calls)
 */
export async function insertMarkdown(
  docs: docs_v1.Docs,
  documentId: string,
  markdown: string,
  options?: InsertOptions
): Promise<InsertMarkdownResult> {
  const overallStart = performance.now();
  const startIndex = options?.startIndex ?? 1;
  const tabId = options?.tabId;

  const parseStart = performance.now();
  const conversionOptions: ConversionOptions | undefined = options?.firstHeadingAsTitle
    ? { firstHeadingAsTitle: true }
    : undefined;
  const requests = convertMarkdownToRequests(markdown, startIndex, tabId, conversionOptions);
  const parseElapsedMs = Math.round(performance.now() - parseStart);

  // Count requests by type
  const requestsByType: Record<string, number> = {};
  for (const r of requests) {
    const type = Object.keys(r)[0];
    requestsByType[type] = (requestsByType[type] || 0) + 1;
  }

  if (requests.length === 0) {
    return {
      totalRequests: 0,
      requestsByType,
      parseElapsedMs,
      batchUpdate: {
        totalRequests: 0,
        phases: {
          delete: { requests: 0, apiCalls: 0, elapsedMs: 0 },
          insert: { requests: 0, apiCalls: 0, elapsedMs: 0 },
          format: { requests: 0, apiCalls: 0, elapsedMs: 0 },
        },
        totalApiCalls: 0,
        totalElapsedMs: 0,
      },
      totalElapsedMs: Math.round(performance.now() - overallStart),
    };
  }

  const batchUpdate = await executeBatchUpdateWithSplitting(docs, documentId, requests, {
    suggestMode: options?.suggestMode,
  });

  return {
    totalRequests: requests.length,
    requestsByType,
    parseElapsedMs,
    batchUpdate,
    totalElapsedMs: Math.round(performance.now() - overallStart),
  };
}

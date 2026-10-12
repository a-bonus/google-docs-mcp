// src/suggestions.ts
//
// Suggestion-mode support for Google Docs (generally available).
// Setting WriteControl.writeMode = 'SUGGEST' in a documents.batchUpdate
// request applies the whole batch as pending suggestions instead of direct
// edits. Reading with suggestionsViewMode = 'SUGGESTIONS_INLINE' exposes the
// inline suggestedInsertionIds / suggestedDeletionIds markers, and
// commentsViewMode = 'COMMENTS_VIEW_MODE_INCLUDED' returns the
// SuggestionThread metadata.
//
// Requires googleapis >= 184, which generates these fields natively.
import type { docs_v1 } from 'googleapis';
import { UserError } from 'fastmcp';

type Docs = docs_v1.Docs;

const COMMENTS_VIEW_MODE_INCLUDED = 'COMMENTS_VIEW_MODE_INCLUDED';
const COMMENT_UPDATE_ALL_SAVED = 'ALL_SAVED';
const COMMENT_UPDATE_NONE_REQUESTED = 'NO_UPDATES_REQUESTED';

// Request keys the Docs API rejects when WriteControl.writeMode is SUGGEST.
// Source: "Unsupported requests in suggest mode" in the API how-to guide.
const SUGGEST_MODE_UNSUPPORTED_REQUEST_KEYS = new Set([
  'addDocumentTab',
  'deleteTab',
  'updateDocumentTabProperties',
  'createNamedRange',
  'deleteNamedRange',
  'deleteNamedRangeByName',
  'updateTableColumnProperties',
  'createHeader',
  'createFooter',
]);

function toSnakeKeys(obj: unknown): Set<string> {
  if (!obj || typeof obj !== 'object') return new Set();
  return new Set(Object.keys(obj as Record<string, unknown>));
}

/**
 * Client-side validation for suggest mode. Returns an actionable error
 * message, or null when the batch looks suggestible. This avoids opaque
 * API 400s for operations the API refuses as suggestions.
 */
export function validateSuggestModeRequests(requests: docs_v1.Schema$Request[]): string | null {
  const problems: string[] = [];
  requests.forEach((req, i) => {
    const keys = Object.keys(req);
    for (const key of keys) {
      if (SUGGEST_MODE_UNSUPPORTED_REQUEST_KEYS.has(key)) {
        problems.push(`request ${i} ('${key}') cannot run in suggest mode`);
      }
      if (key === 'updateDocumentStyle') {
        const style = (req as any).updateDocumentStyle?.documentStyle ?? {};
        void [...toSnakeKeys(style)];
        // Direct check on the raw keys (camelCase from googleapis).
        const rawBad = Object.keys(style).filter((k) =>
          ['documentMode', 'useEvenPageHeaderFooter', 'useFirstPageHeaderFooter'].includes(k)
        );
        if (rawBad.length > 0) {
          problems.push(
            `request ${i} ('updateDocumentStyle') sets ${rawBad.join(', ')}, which cannot be suggested`
          );
        }
      }
    }
  });
  if (problems.length === 0) return null;
  return (
    `suggestMode=true but this batch includes operations the Docs API cannot apply as suggestions: ` +
    problems.join('; ') +
    `. Remove them or run with suggestMode=false.`
  );
}

function isCommentsViewModeError(error: any): boolean {
  const status = error?.code ?? error?.response?.status;
  if (status !== 400) return false;
  const text = JSON.stringify(error?.response?.data ?? error?.message ?? '').toLowerCase();
  return text.includes('comments_view_mode') || text.includes('commentsviewmode');
}

/** Render commentUpdateState for a suggest-mode response. Advisory, never a gate. */
export function describeCommentUpdateState(
  commentState: string | undefined | null,
  opts?: { allNoops?: boolean }
): string {
  if (commentState === COMMENT_UPDATE_ALL_SAVED) {
    return ' Applied as suggested edits (comment_update_state: ALL_SAVED).';
  }
  if (commentState === COMMENT_UPDATE_NONE_REQUESTED && opts?.allNoops) {
    return ' No suggestion updates were required (comment_update_state: NO_UPDATES_REQUESTED, nothing matched).';
  }
  const rendered = commentState ?? 'MISSING';
  return (
    ` WARNING: the API did not confirm suggestion threads were saved (comment_update_state: ${rendered}). ` +
    `The edits may be LIVE rather than pending. Verify with listSuggestions, and undo in the Docs UI (Edit > Undo) if they were not meant to be live.`
  );
}

/** Summarize per-request suggestionResponses IDs. */
export function describeSuggestionResponses(responses: any[] | undefined): string {
  if (!responses || responses.length === 0) return '';
  const buckets: Record<string, Set<string>> = {
    created: new Set(),
    updated: new Set(),
    deleted: new Set(),
    accepted: new Set(),
    rejected: new Set(),
  };
  const fields: Record<string, keyof typeof buckets> = {
    createdSuggestionIds: 'created',
    updatedSummarySuggestionIds: 'updated',
    deletedSuggestionIds: 'deleted',
    acceptedSuggestionIds: 'accepted',
    rejectedSuggestionIds: 'rejected',
  };
  for (const r of responses) {
    for (const [field, label] of Object.entries(fields)) {
      for (const id of r?.[field] ?? []) buckets[label].add(id);
    }
  }
  const parts = Object.entries(buckets)
    .filter(([, ids]) => ids.size > 0)
    .map(([label, ids]) => `${label}: ${ids.size}`);
  return parts.length > 0 ? ` Suggestion results: ${parts.join(', ')}.` : '';
}

// --- Suggestion collection (for listSuggestions) ---

export interface CollectedSuggestion {
  types: string[];
  textPreview: string;
  tabId?: string;
}

const CHANGE_MAPS: Record<string, string> = {
  suggestedTextStyleChanges: 'style',
  suggestedParagraphStyleChanges: 'paragraph-style',
  suggestedBulletChanges: 'bullet',
  suggestedPositionedObjectIds: 'positioned-object',
  suggestedTableRowStyleChanges: 'table-row-style',
  suggestedTableCellStyleChanges: 'table-cell-style',
  suggestedDocumentStyleChanges: 'document-style',
  suggestedNamedStylesChanges: 'named-styles',
  suggestedListPropertiesChanges: 'list-properties',
  suggestedInlineObjectPropertiesChanges: 'inline-object-properties',
  suggestedPositionedObjectPropertiesChanges: 'positioned-object-properties',
};

function collectMarkers(
  node: any,
  acc: Map<string, { types: Set<string>; textPreview: string; tabId?: string }>,
  tabId?: string,
  preview = '',
  accumulate = false
): void {
  if (!node || typeof node !== 'object') return;
  const entryFor = (sid: string) => {
    let e = acc.get(sid);
    if (!e) {
      e = { types: new Set(), textPreview: '', tabId };
      acc.set(sid, e);
    }
    return e;
  };
  const contributed = new Set<string>();
  const applyPreview = (sid: string) => {
    if (!preview || contributed.has(sid)) return;
    contributed.add(sid);
    const e = entryFor(sid);
    if (accumulate) e.textPreview += preview;
    else if (!e.textPreview) e.textPreview = preview;
  };
  for (const [field, label] of [
    ['suggestedInsertionIds', 'insertion'],
    ['suggestedDeletionIds', 'deletion'],
  ] as const) {
    for (const sid of node[field] ?? []) {
      entryFor(sid).types.add(label);
      applyPreview(sid);
    }
  }
  const single = node.suggestedInsertionId;
  if (typeof single === 'string' && single) {
    entryFor(single).types.add('insertion');
    applyPreview(single);
  }
  for (const [field, label] of Object.entries(CHANGE_MAPS)) {
    const map = node[field];
    if (map && typeof map === 'object') {
      for (const sid of Object.keys(map)) {
        entryFor(sid).types.add(label);
        applyPreview(sid);
      }
    }
  }
}

function collectFromElements(
  elements: any[],
  acc: Map<string, { types: Set<string>; textPreview: string; tabId?: string }>,
  tabId?: string
): void {
  for (const el of elements ?? []) {
    if (el.sectionBreak) collectMarkers(el.sectionBreak, acc, tabId);
    if (el.tableOfContents) {
      collectMarkers(el.tableOfContents, acc, tabId);
      collectFromElements(el.tableOfContents.content ?? [], acc, tabId);
    }
    if (el.paragraph) {
      const text = (el.paragraph.elements ?? [])
        .map((pe: any) => (Object.values(pe).find((v: any) => v?.content) as any)?.content ?? '')
        .join('');
      collectMarkers(el.paragraph, acc, tabId, text);
      for (const pe of el.paragraph.elements ?? []) {
        for (const sub of Object.values(pe)) {
          if (sub && typeof sub === 'object') {
            collectMarkers(sub, acc, tabId, (sub as Record<string, any>).content ?? '', true);
          }
        }
      }
    }
    if (el.table) {
      collectMarkers(el.table, acc, tabId);
      for (const row of el.table.tableRows ?? []) {
        collectMarkers(row, acc, tabId);
        for (const cell of row.tableCells ?? []) {
          collectMarkers(cell, acc, tabId);
          collectFromElements(cell.content ?? [], acc, tabId);
        }
      }
    }
  }
}

function collectFromSegmentMap(
  map: Record<string, any> | undefined,
  acc: Map<string, { types: Set<string>; textPreview: string; tabId?: string }>,
  tabId?: string
): void {
  for (const seg of Object.values(map ?? {})) {
    collectFromElements(seg?.content ?? [], acc, tabId);
  }
}

/** Fetch open suggestions: inline markers enriched with thread metadata. */
export async function fetchDocSuggestions(
  docs: Docs,
  documentId: string,
  opts?: { includeThreads?: boolean }
): Promise<{
  suggestions: Map<string, CollectedSuggestion & { author?: string; createTime?: string }>;
  previewDegraded: boolean;
}> {
  const includeThreads = opts?.includeThreads ?? true;
  let doc: any;
  try {
    const res = await docs.documents.get({
      documentId,
      includeTabsContent: true,
      suggestionsViewMode: 'SUGGESTIONS_INLINE',
      ...(includeThreads ? { commentsViewMode: COMMENTS_VIEW_MODE_INCLUDED } : {}),
    });
    doc = res.data;
  } catch (error: any) {
    if (includeThreads && isCommentsViewModeError(error)) {
      // Older projects or restricted access: retry without thread metadata.
      const res = await docs.documents.get({
        documentId,
        includeTabsContent: true,
        suggestionsViewMode: 'SUGGESTIONS_INLINE',
      });
      doc = res.data;
      const markersOnly = collectMarkersOnly(doc);
      return { suggestions: markersOnly, previewDegraded: true };
    }
    throw error;
  }

  const markers = new Map<string, { types: Set<string>; textPreview: string; tabId?: string }>();
  const collectContainer = (container: any, tabId?: string) => {
    collectMarkers(container, markers, tabId);
    collectFromElements(container?.body?.content ?? [], markers, tabId);
    for (const seg of ['headers', 'footers', 'footnotes'] as const) {
      collectFromSegmentMap(container?.[seg], markers, tabId);
    }
    for (const rm of ['lists', 'inlineObjects', 'positionedObjects'] as const) {
      for (const res of Object.values((container?.[rm] ?? {}) as Record<string, any>)) {
        collectMarkers(res, markers, tabId);
      }
    }
  };
  collectContainer(doc);
  const walkTabs = (tab: any) => {
    if (tab?.documentTab) collectContainer(tab.documentTab, tab?.tabProperties?.tabId);
    for (const child of tab?.childTabs ?? []) walkTabs(child);
  };
  for (const tab of doc?.tabs ?? []) walkTabs(tab);

  const threads = doc?.suggestions;
  if (!Array.isArray(threads)) {
    // Markers only (threads absent in response).
    const out = new Map();
    for (const [sid, m] of markers) {
      out.set(sid, { types: [...m.types], textPreview: m.textPreview, tabId: m.tabId });
    }
    return { suggestions: out, previewDegraded: true };
  }
  const out = new Map<string, CollectedSuggestion & { author?: string; createTime?: string }>();
  for (const t of threads) {
    if (t?.status !== 'OPEN' || typeof t?.suggestionId !== 'string') continue;
    const m = markers.get(t.suggestionId);
    const author =
      t?.headPost?.author?.displayName ??
      (t?.headPost?.author?.anonymous ? 'Anonymous' : undefined);
    out.set(t.suggestionId, {
      types: m ? [...m.types] : [],
      textPreview: t?.summaryText ?? m?.textPreview ?? '',
      tabId: m?.tabId,
      author,
      createTime: t?.headPost?.createTime,
    });
  }
  return { suggestions: out, previewDegraded: false };
}

function collectMarkersOnly(doc: any) {
  const markers = new Map<string, { types: Set<string>; textPreview: string; tabId?: string }>();
  const collectContainer = (container: any, tabId?: string) => {
    collectMarkers(container, markers, tabId);
    collectFromElements(container?.body?.content ?? [], markers, tabId);
  };
  collectContainer(doc);
  for (const tab of doc?.tabs ?? []) {
    if (tab?.documentTab) collectContainer(tab.documentTab, tab?.tabProperties?.tabId);
  }
  const out = new Map<string, CollectedSuggestion & { author?: string; createTime?: string }>();
  for (const [sid, m] of markers) {
    out.set(sid, { types: [...m.types], textPreview: m.textPreview, tabId: m.tabId });
  }
  return out;
}

/** Wrap a suggest-mode batchUpdate outcome with the advisory state sentence. */
export function suggestModeNote(
  ok: boolean,
  commentState: string | undefined | null,
  suggestionResponses: any[] | undefined,
  opts?: { allNoops?: boolean }
): string {
  void ok;
  return (
    describeCommentUpdateState(commentState, opts) +
    describeSuggestionResponses(suggestionResponses)
  );
}

export function toUserError(error: unknown, fallback: string): never {
  if (error instanceof UserError) throw error;
  throw new UserError(`${fallback}: ${(error as any)?.message ?? 'Unknown error'}`);
}

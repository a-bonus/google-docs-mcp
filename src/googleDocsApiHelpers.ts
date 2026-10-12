// src/googleDocsApiHelpers.ts
import { google, docs_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { UserError } from 'fastmcp';
import { TextStyleArgs, ParagraphStyleArgs, hexToRgbColor, NotImplementedError } from './types.js';
import { logger } from './logger.js';
import { buildTabsFieldMask } from './tools/docs/tabFieldMasks.js';

type Docs = docs_v1.Docs; // Alias for convenience

// --- Constants ---
const MAX_BATCH_UPDATE_REQUESTS = 50; // Google API limits batch size

// --- Core Helper to Execute Batch Updates ---
export interface BatchUpdateOptions {
  /** When true, apply the batch as pending suggestions (WriteControl.writeMode=SUGGEST). */
  suggestMode?: boolean;
}

export async function executeBatchUpdate(
  docs: Docs,
  documentId: string,
  requests: docs_v1.Schema$Request[],
  opts?: BatchUpdateOptions
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (!requests || requests.length === 0) {
    // console.warn("executeBatchUpdate called with no requests.");
    return {}; // Nothing to do
  }

  // TODO: Consider splitting large request arrays into multiple batches if needed
  if (requests.length > MAX_BATCH_UPDATE_REQUESTS) {
    logger.warn(
      `Attempting batch update with ${requests.length} requests, exceeding typical limits. May fail.`
    );
  }

  try {
    const response = await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests,
        // writeMode SUGGEST applies the batch as pending suggestions (GA).
        ...(opts?.suggestMode ? { writeControl: { writeMode: 'SUGGEST' } } : {}),
      },
    });
    return response.data;
  } catch (error: any) {
    logger.error(
      `Google API batchUpdate Error for doc ${documentId}: ${error.message || 'Unknown error'}`
    );
    // Translate common API errors to UserErrors
    if (error.code === 400 && error.message.includes('Invalid requests')) {
      // Try to extract more specific info if available
      const details = error.response?.data?.error?.details;
      let detailMsg = '';
      if (details && Array.isArray(details)) {
        detailMsg = details.map((d) => d.description || JSON.stringify(d)).join('; ');
      }
      throw new UserError(
        `Invalid request sent to Google Docs API. Details: ${detailMsg || error.message}`
      );
    }
    if (error.code === 404)
      throw new UserError(`Document not found (ID: ${documentId}). Check the ID.`);
    if (error.code === 403)
      throw new UserError(
        `Permission denied for document (ID: ${documentId}). Ensure the authenticated user has edit access.`
      );
    // Generic internal error for others
    throw new Error(`Google API Error (${error.code}): ${error.message}`);
  }
}

// --- Batch Update with Automatic Splitting ---

/** Metadata returned by executeBatchUpdateWithSplitting for debugging / observability. */
export interface BatchUpdateMetadata {
  /** Total number of individual requests across all phases. */
  totalRequests: number;
  /** Breakdown of requests by phase. */
  phases: {
    delete: { requests: number; apiCalls: number; elapsedMs: number };
    insert: { requests: number; apiCalls: number; elapsedMs: number };
    format: { requests: number; apiCalls: number; elapsedMs: number };
  };
  /** Total number of HTTP batchUpdate calls made to the Docs API. */
  totalApiCalls: number;
  /** Wall-clock time for the entire operation (all phases), in milliseconds. */
  totalElapsedMs: number;
  /** Raw commentUpdateState from suggest-mode batches. */
  commentUpdateState?: string | null;
  /** Aggregated suggestionResponses across all batches. */
  suggestionResponses?: docs_v1.Schema$SuggestionResponse[];
}

/**
 * Executes batch updates with automatic splitting for large request arrays.
 * Separates insert and format operations, executing inserts first.
 *
 * @param docs - The Google Docs client
 * @param documentId - The document ID
 * @param requests - Array of requests to execute
 * @param log - Optional logger for progress tracking
 * @returns Metadata about the execution (request counts, API calls, timing)
 */
export async function executeBatchUpdateWithSplitting(
  docs: Docs,
  documentId: string,
  requests: docs_v1.Schema$Request[],
  logOrOpts?:
    | { info: (msg: string) => void }
    | (BatchUpdateOptions & { log?: { info: (msg: string) => void } })
): Promise<BatchUpdateMetadata> {
  const overallStart = performance.now();
  const log =
    logOrOpts && 'info' in logOrOpts
      ? (logOrOpts as { info: (msg: string) => void })
      : (logOrOpts as any)?.log;
  const suggestMode = (logOrOpts as any)?.suggestMode === true;

  if (!requests || requests.length === 0) {
    return {
      totalRequests: 0,
      phases: {
        delete: { requests: 0, apiCalls: 0, elapsedMs: 0 },
        insert: { requests: 0, apiCalls: 0, elapsedMs: 0 },
        format: { requests: 0, apiCalls: 0, elapsedMs: 0 },
      },
      totalApiCalls: 0,
      totalElapsedMs: 0,
    };
  }

  const MAX_BATCH = MAX_BATCH_UPDATE_REQUESTS;

  // Separate requests into three categories
  // Order of execution: delete → insert → format
  const deleteRequests = requests.filter((r) => 'deleteContentRange' in r);
  const insertRequests = requests.filter(
    (r) =>
      'insertText' in r ||
      'insertTable' in r ||
      'insertPageBreak' in r ||
      'insertInlineImage' in r ||
      'insertSectionBreak' in r
  );
  const formatRequests = requests.filter(
    (r) =>
      !('deleteContentRange' in r) &&
      !(
        'insertText' in r ||
        'insertTable' in r ||
        'insertPageBreak' in r ||
        'insertInlineImage' in r ||
        'insertSectionBreak' in r
      )
  );

  let totalApiCalls = 0;
  const suggestionResponses: docs_v1.Schema$SuggestionResponse[] = [];
  let commentUpdateState: string | null | undefined;
  const runBatch = async (batch: docs_v1.Schema$Request[]) => {
    const res = await executeBatchUpdate(docs, documentId, batch, { suggestMode });
    const anyRes = res as any;
    if (Array.isArray(anyRes?.suggestionResponses))
      suggestionResponses.push(...anyRes.suggestionResponses);
    if (anyRes?.commentUpdateState) commentUpdateState = anyRes.commentUpdateState;
    totalApiCalls++;
    return res;
  };

  // Execute delete batches first (must happen before inserts)
  const deleteStart = performance.now();
  if (deleteRequests.length > 0) {
    if (log) {
      log.info(`Executing ${deleteRequests.length} delete requests FIRST (in separate API call)`);
    }
    for (let i = 0; i < deleteRequests.length; i += MAX_BATCH) {
      const batch = deleteRequests.slice(i, i + MAX_BATCH);
      if (log) {
        log.info(`Delete batch content: ${JSON.stringify(batch)}`);
      }
      await runBatch(batch);
      if (log) {
        const batchNum = Math.floor(i / MAX_BATCH) + 1;
        const totalBatches = Math.ceil(deleteRequests.length / MAX_BATCH);
        log.info(`Executed delete batch ${batchNum}/${totalBatches} (${batch.length} requests)`);
      }
    }
    if (log) {
      log.info(`Delete batches complete. Document should now be empty (except section break).`);
    }
  }
  const deleteElapsed = performance.now() - deleteStart;

  // Then execute insert batches
  const insertStart = performance.now();
  if (insertRequests.length > 0) {
    for (let i = 0; i < insertRequests.length; i += MAX_BATCH) {
      const batch = insertRequests.slice(i, i + MAX_BATCH);
      await runBatch(batch);
      if (log) {
        const batchNum = Math.floor(i / MAX_BATCH) + 1;
        const totalBatches = Math.ceil(insertRequests.length / MAX_BATCH);
        log.info(`Executed insert batch ${batchNum}/${totalBatches} (${batch.length} requests)`);
      }
    }
  }
  const insertElapsed = performance.now() - insertStart;

  // Finally execute format batches
  const formatStart = performance.now();
  if (formatRequests.length > 0) {
    for (let i = 0; i < formatRequests.length; i += MAX_BATCH) {
      const batch = formatRequests.slice(i, i + MAX_BATCH);
      await runBatch(batch);
      if (log) {
        const batchNum = Math.floor(i / MAX_BATCH) + 1;
        const totalBatches = Math.ceil(formatRequests.length / MAX_BATCH);
        log.info(`Executed format batch ${batchNum}/${totalBatches} (${batch.length} requests)`);
      }
    }
  }
  const formatElapsed = performance.now() - formatStart;

  const totalElapsedMs = performance.now() - overallStart;

  return {
    totalRequests: requests.length,
    phases: {
      delete: {
        requests: deleteRequests.length,
        apiCalls: Math.ceil(deleteRequests.length / MAX_BATCH) || 0,
        elapsedMs: Math.round(deleteElapsed),
      },
      insert: {
        requests: insertRequests.length,
        apiCalls: Math.ceil(insertRequests.length / MAX_BATCH) || 0,
        elapsedMs: Math.round(insertElapsed),
      },
      format: {
        requests: formatRequests.length,
        apiCalls: Math.ceil(formatRequests.length / MAX_BATCH) || 0,
        elapsedMs: Math.round(formatElapsed),
      },
    },
    totalApiCalls,
    totalElapsedMs: Math.round(totalElapsedMs),
    ...(suggestMode ? { commentUpdateState, suggestionResponses } : {}),
  };
}

// --- Text Finding Helper ---
// This improved version is more robust in handling various text structure scenarios
export async function findTextRange(
  docs: Docs,
  documentId: string,
  textToFind: string,
  instance: number = 1,
  tabId?: string
): Promise<{ startIndex: number; endIndex: number } | null> {
  try {
    // Request more detailed information about the document structure
    // When tabId is specified, we need to use includeTabsContent to access tab-specific content
    const needsTabsContent = !!tabId;
    const res = await docs.documents.get({
      documentId,
      ...(needsTabsContent && { includeTabsContent: true }),
      // Request more fields to handle various container types (not just paragraphs)
      fields: needsTabsContent
        ? buildTabsFieldMask(
            'documentTab(body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex)))'
          )
        : 'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))',
    });

    // Get body content from the correct tab or default
    let bodyContent: any[] | undefined;
    if (tabId) {
      const targetTab = findTabById(res.data, tabId);
      if (!targetTab) {
        throw new UserError(`Tab with ID "${tabId}" not found in document.`);
      }
      if (!targetTab.documentTab?.body?.content) {
        throw new UserError(`Tab "${tabId}" does not have content (may not be a document tab).`);
      }
      bodyContent = targetTab.documentTab.body.content;
    } else {
      bodyContent = res.data.body?.content;
    }

    if (!bodyContent) {
      logger.warn(`No content found in document ${documentId}${tabId ? ` (tab: ${tabId})` : ''}`);
      return null;
    }

    // More robust text collection and index tracking
    let fullText = '';
    const segments: { text: string; start: number; end: number }[] = [];

    // Process all content elements, including structural ones
    const collectTextFromContent = (content: any[]) => {
      content.forEach((element) => {
        // Handle paragraph elements
        if (element.paragraph?.elements) {
          element.paragraph.elements.forEach((pe: any) => {
            if (pe.textRun?.content && pe.startIndex !== undefined && pe.endIndex !== undefined) {
              const content = pe.textRun.content;
              fullText += content;
              segments.push({
                text: content,
                start: pe.startIndex,
                end: pe.endIndex,
              });
            }
          });
        }

        // Handle table elements - this is simplified and might need expansion
        if (element.table && element.table.tableRows) {
          element.table.tableRows.forEach((row: any) => {
            if (row.tableCells) {
              row.tableCells.forEach((cell: any) => {
                if (cell.content) {
                  collectTextFromContent(cell.content);
                }
              });
            }
          });
        }

        // Add handling for other structural elements as needed
      });
    };

    collectTextFromContent(bodyContent);

    // Sort segments by starting position to ensure correct ordering
    segments.sort((a, b) => a.start - b.start);

    logger.debug(
      `Document ${documentId} contains ${segments.length} text segments and ${fullText.length} characters in total.`
    );

    // Find the specified instance of the text
    let startIndex = -1;
    let endIndex = -1;
    let foundCount = 0;
    let searchStartIndex = 0;

    while (foundCount < instance) {
      const currentIndex = fullText.indexOf(textToFind, searchStartIndex);
      if (currentIndex === -1) {
        logger.debug(
          `Search text "${textToFind}" not found for instance ${foundCount + 1} (requested: ${instance})`
        );
        break;
      }

      foundCount++;
      logger.debug(
        `Found instance ${foundCount} of "${textToFind}" at position ${currentIndex} in full text`
      );

      if (foundCount === instance) {
        const targetStartInFullText = currentIndex;
        const targetEndInFullText = currentIndex + textToFind.length;
        let currentPosInFullText = 0;

        logger.debug(
          `Target text range in full text: ${targetStartInFullText}-${targetEndInFullText}`
        );

        for (const seg of segments) {
          const segStartInFullText = currentPosInFullText;
          const segTextLength = seg.text.length;
          const segEndInFullText = segStartInFullText + segTextLength;

          // Map from reconstructed text position to actual document indices
          if (
            startIndex === -1 &&
            targetStartInFullText >= segStartInFullText &&
            targetStartInFullText < segEndInFullText
          ) {
            startIndex = seg.start + (targetStartInFullText - segStartInFullText);
            logger.debug(`Mapped start to segment ${seg.start}-${seg.end}, position ${startIndex}`);
          }

          if (targetEndInFullText > segStartInFullText && targetEndInFullText <= segEndInFullText) {
            endIndex = seg.start + (targetEndInFullText - segStartInFullText);
            logger.debug(`Mapped end to segment ${seg.start}-${seg.end}, position ${endIndex}`);
            break;
          }

          currentPosInFullText = segEndInFullText;
        }

        if (startIndex === -1 || endIndex === -1) {
          logger.warn(
            `Failed to map text "${textToFind}" instance ${instance} to actual document indices`
          );
          return { startIndex, endIndex };
        }

        logger.debug(
          `Successfully mapped "${textToFind}" to document range ${startIndex}-${endIndex}`
        );
        return { startIndex, endIndex };
      }

      // Prepare for next search iteration
      searchStartIndex = currentIndex + 1;
    }

    logger.warn(
      `Could not find instance ${instance} of text "${textToFind}" in document ${documentId}`
    );
    return null; // Instance not found or mapping failed for all attempts
  } catch (error: any) {
    logger.error(
      `Error finding text "${textToFind}" in doc ${documentId}: ${error.message || 'Unknown error'}`
    );
    if (error.code === 404)
      throw new UserError(`Document not found while searching text (ID: ${documentId}).`);
    if (error.code === 403)
      throw new UserError(`Permission denied while searching text in doc ${documentId}.`);
    throw new Error(
      `Failed to retrieve doc for text searching: ${error.message || 'Unknown error'}`
    );
  }
}

// --- Element Finder ---
// Locates elements in a document. Supports two modes (combinable):
//  - textQuery: returns the document index range of every non-overlapping
//    occurrence of the text — usable as a deleteRange / buildUpdateTextStyleRequest
//    range, or its startIndex as an insertText location. Searches the
//    first tab only; text inside table cells IS searched.
//  - elementType ('paragraph' | 'table'): lists those top-level structural
//    elements with their ranges and a short text preview. Paragraph listing is
//    top-level body only — it does NOT descend into table cells.
export interface FoundElement {
  type: 'text' | 'paragraph' | 'table';
  startIndex: number;
  endIndex: number;
  instance?: number; // 1-based occurrence number, for text matches
  text?: string; // matched text or a preview of the element
}

export async function findElements(
  docs: Docs,
  documentId: string,
  options: { textQuery?: string; elementType?: 'paragraph' | 'table' | 'list' | 'image' }
): Promise<FoundElement[]> {
  const { textQuery, elementType } = options;
  if (!textQuery && !elementType) {
    throw new UserError('findElement requires at least one of "textQuery" or "elementType".');
  }

  let res;
  try {
    res = await docs.documents.get({
      documentId,
      fields:
        'body(content(startIndex,endIndex,table(rows,columns,tableRows(tableCells(content(paragraph(elements(startIndex,endIndex,textRun(content))))))),paragraph(elements(startIndex,endIndex,textRun(content)))))',
    });
  } catch (error: any) {
    if (error.code === 404) throw new UserError(`Document not found (ID: ${documentId}).`);
    if (error.code === 403) throw new UserError(`Permission denied for document ${documentId}.`);
    throw new Error(
      `Failed to retrieve document for findElement: ${error.message || 'Unknown error'}`
    );
  }

  const content = res.data.body?.content;
  if (!content) return [];

  const results: FoundElement[] = [];

  // --- Structural listing (paragraph / table) ---
  if (elementType === 'paragraph' || elementType === 'table') {
    for (const element of content) {
      if (elementType === 'paragraph' && element.paragraph?.elements) {
        const text = element.paragraph.elements
          .map((pe: any) => pe.textRun?.content || '')
          .join('');
        // Skip empty structural paragraphs unless they carry a real range
        if (element.startIndex == null || element.endIndex == null) continue;
        results.push({
          type: 'paragraph',
          startIndex: element.startIndex,
          endIndex: element.endIndex,
          text: text.replace(/\n$/, '').slice(0, 120),
        });
      } else if (elementType === 'table' && element.table) {
        if (element.startIndex == null || element.endIndex == null) continue;
        results.push({
          type: 'table',
          startIndex: element.startIndex,
          endIndex: element.endIndex,
          text: `table ${element.table.rows ?? '?'}x${element.table.columns ?? '?'}`,
        });
      }
    }
    // If no textQuery, we're done; otherwise fall through and also match text.
    if (!textQuery) return results;
  } else if (elementType === 'list' || elementType === 'image') {
    // Not supported. Reject regardless of textQuery: silently returning plain
    // text matches would mislabel them as if they located a list/image.
    throw new UserError(
      `elementType "${elementType}" is not supported. Omit elementType and pass textQuery to locate content by text.`
    );
  }

  // --- Text matching (all occurrences) ---
  // Each PARAGRAPH (top-level or inside a table cell) is treated as one searchable
  // unit: its text runs are concatenated into a single string, with a parallel
  // index map giving the true document index of every character. We search the
  // concatenated string and map matches back through that map. Building the map
  // per-character (rather than firstRunStart + offset) keeps indices exact even
  // when a run/style boundary splits a word — so a phrase styled mid-way (bold,
  // link, colour) still matches, which per-run searching missed.
  //
  // The paragraph (and table cell) is a HARD boundary: runs are never concatenated
  // across paragraphs or cells. That confines remapping to within a paragraph,
  // where text-run indices are contiguous, and so avoids the mis-indexing that a
  // naive whole-document concatenate-and-remap produces across structural-index
  // gaps (table cells, paragraph boundaries). A phrase spanning two paragraphs, or
  // text inside a table nested within a cell, is therefore not matched.
  if (textQuery) {
    interface ParaUnit {
      text: string;
      map: number[];
      firstIndex: number;
    }
    const units: ParaUnit[] = [];
    const collect = (items: any[]) => {
      items.forEach((element) => {
        if (element.paragraph?.elements) {
          // Build one searchable unit per run of CONTIGUOUS text runs. A unit
          // ends at any document-index discontinuity — a non-text element
          // (inline image, smart chip, page break) or a run whose startIndex
          // isn't exactly the previous run's last index + 1. This is what makes
          // the per-character map safe: every unit's characters are contiguous
          // in document space, so a match's range is exactly its width and can
          // never span (and over-delete) an inline object. Adjacent runs split
          // only by styling ARE contiguous, so cross-run phrases still match.
          let text = '';
          let map: number[] = [];
          const flush = () => {
            if (map.length > 0) units.push({ text, map, firstIndex: map[0] });
            text = '';
            map = [];
          };
          element.paragraph.elements.forEach((pe: any) => {
            const content = pe.textRun?.content;
            if (content && pe.startIndex != null) {
              if (map.length > 0 && pe.startIndex !== map[map.length - 1] + 1) {
                flush(); // gap before this run — start a new unit
              }
              for (let i = 0; i < content.length; i++) {
                text += content[i];
                map.push(pe.startIndex + i);
              }
            } else {
              flush(); // non-text element ends the contiguous span
            }
          });
          flush();
        }
        if (element.table?.tableRows) {
          element.table.tableRows.forEach((row: any) => {
            row.tableCells?.forEach((cell: any) => {
              // Recurses one level into cell content (cell paragraphs).
              // A table nested *inside* a cell is not searched: the
              // documents.get field mask only populates `table` at the
              // top level, so a nested table arrives without its `table`
              // field and is skipped here. Documented as a limitation.
              if (cell.content) collect(cell.content);
            });
          });
        }
      });
    };
    collect(content);
    units.sort((a, b) => a.firstIndex - b.firstIndex);

    let instance = 0;
    for (const unit of units) {
      let from = 0;
      while (true) {
        const at = unit.text.indexOf(textQuery, from);
        if (at === -1) break;
        instance++;
        results.push({
          type: 'text',
          instance,
          startIndex: unit.map[at],
          endIndex: unit.map[at + textQuery.length - 1] + 1,
          text: textQuery,
        });
        from = at + textQuery.length; // non-overlapping matches
      }
    }
  }

  return results;
}

// --- Paragraph Boundary Helper ---
// Enhanced version to handle document structural elements more robustly
export async function getParagraphRange(
  docs: Docs,
  documentId: string,
  indexWithin: number,
  tabId?: string
): Promise<{ startIndex: number; endIndex: number } | null> {
  try {
    logger.debug(
      `Finding paragraph containing index ${indexWithin} in document ${documentId}${tabId ? ` (tab: ${tabId})` : ''}`
    );

    // When tabId is specified, we need to use includeTabsContent to access tab-specific content
    const needsTabsContent = !!tabId;
    // Request more detailed document structure to handle nested elements
    const res = await docs.documents.get({
      documentId,
      ...(needsTabsContent && { includeTabsContent: true }),
      // Request more comprehensive structure information
      fields: needsTabsContent
        ? buildTabsFieldMask(
            'documentTab(body(content(startIndex,endIndex,paragraph,table,sectionBreak,tableOfContents)))'
          )
        : 'body(content(startIndex,endIndex,paragraph,table,sectionBreak,tableOfContents))',
    });

    // Get body content from the correct tab or default
    let bodyContent: any[] | undefined;
    if (tabId) {
      const targetTab = findTabById(res.data, tabId);
      if (!targetTab) {
        throw new UserError(`Tab with ID "${tabId}" not found in document.`);
      }
      if (!targetTab.documentTab?.body?.content) {
        throw new UserError(`Tab "${tabId}" does not have content (may not be a document tab).`);
      }
      bodyContent = targetTab.documentTab.body.content;
    } else {
      bodyContent = res.data.body?.content;
    }

    if (!bodyContent) {
      logger.warn(`No content found in document ${documentId}${tabId ? ` (tab: ${tabId})` : ''}`);
      return null;
    }

    // Find paragraph containing the index
    // We'll look at all structural elements recursively
    const findParagraphInContent = (
      content: any[]
    ): { startIndex: number; endIndex: number } | null => {
      for (const element of content) {
        // Check if we have element boundaries defined
        if (element.startIndex !== undefined && element.endIndex !== undefined) {
          // Check if index is within this element's range first
          if (indexWithin >= element.startIndex && indexWithin < element.endIndex) {
            // If it's a paragraph, we've found our target
            if (element.paragraph) {
              logger.debug(
                `Found paragraph containing index ${indexWithin}, range: ${element.startIndex}-${element.endIndex}`
              );
              return {
                startIndex: element.startIndex,
                endIndex: element.endIndex,
              };
            }

            // If it's a table, we need to check cells recursively
            if (element.table && element.table.tableRows) {
              logger.debug(`Index ${indexWithin} is within a table, searching cells...`);
              for (const row of element.table.tableRows) {
                if (row.tableCells) {
                  for (const cell of row.tableCells) {
                    if (cell.content) {
                      const result = findParagraphInContent(cell.content);
                      if (result) return result;
                    }
                  }
                }
              }
            }
            // For other structural elements, we didn't find a paragraph
            // but we know the index is within this element
            logger.warn(
              `Index ${indexWithin} is within element (${element.startIndex}-${element.endIndex}) but not in a paragraph`
            );
          }
        }
      }

      return null;
    };

    const paragraphRange = findParagraphInContent(bodyContent);

    if (!paragraphRange) {
      logger.warn(`Could not find paragraph containing index ${indexWithin}`);
    } else {
      logger.debug(
        `Returning paragraph range: ${paragraphRange.startIndex}-${paragraphRange.endIndex}`
      );
    }

    return paragraphRange;
  } catch (error: any) {
    logger.error(
      `Error getting paragraph range for index ${indexWithin} in doc ${documentId}: ${error.message || 'Unknown error'}`
    );
    if (error.code === 404)
      throw new UserError(`Document not found while finding paragraph (ID: ${documentId}).`);
    if (error.code === 403)
      throw new UserError(`Permission denied while accessing doc ${documentId}.`);
    throw new Error(`Failed to find paragraph: ${error.message || 'Unknown error'}`);
  }
}

// --- Style Request Builders ---

export function buildUpdateTextStyleRequest(
  startIndex: number,
  endIndex: number,
  style: TextStyleArgs,
  tabId?: string
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  const textStyle: docs_v1.Schema$TextStyle = {};
  const fieldsToUpdate: string[] = [];

  if (style.bold !== undefined) {
    textStyle.bold = style.bold;
    fieldsToUpdate.push('bold');
  }
  if (style.italic !== undefined) {
    textStyle.italic = style.italic;
    fieldsToUpdate.push('italic');
  }
  if (style.underline !== undefined) {
    textStyle.underline = style.underline;
    fieldsToUpdate.push('underline');
  }
  if (style.strikethrough !== undefined) {
    textStyle.strikethrough = style.strikethrough;
    fieldsToUpdate.push('strikethrough');
  }
  if (style.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
    fieldsToUpdate.push('fontSize');
  }
  if (style.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: style.fontFamily };
    fieldsToUpdate.push('weightedFontFamily');
  }
  if (style.foregroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.foregroundColor);
    if (!rgbColor)
      throw new UserError(`Invalid foreground hex color format: ${style.foregroundColor}`);
    textStyle.foregroundColor = { color: { rgbColor: rgbColor } };
    fieldsToUpdate.push('foregroundColor');
  }
  if (style.backgroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.backgroundColor);
    if (!rgbColor)
      throw new UserError(`Invalid background hex color format: ${style.backgroundColor}`);
    textStyle.backgroundColor = { color: { rgbColor: rgbColor } };
    fieldsToUpdate.push('backgroundColor');
  }
  if (style.linkUrl !== undefined) {
    textStyle.link = { url: style.linkUrl };
    fieldsToUpdate.push('link');
  }
  // TODO: Handle clearing formatting

  if (fieldsToUpdate.length === 0) return null; // No styles to apply

  const range: docs_v1.Schema$Range = { startIndex, endIndex };
  if (tabId) {
    range.tabId = tabId;
  }

  const request: docs_v1.Schema$Request = {
    updateTextStyle: {
      range,
      textStyle: textStyle,
      fields: fieldsToUpdate.join(','),
    },
  };
  return { request, fields: fieldsToUpdate };
}

export function buildUpdateParagraphStyleRequest(
  startIndex: number,
  endIndex: number,
  style: ParagraphStyleArgs,
  tabId?: string
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  // Create style object and track which fields to update
  const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
  const fieldsToUpdate: string[] = [];

  logger.debug(
    `Building paragraph style request for range ${startIndex}-${endIndex} with options:`,
    style
  );

  // Process alignment option (LEFT, CENTER, RIGHT, JUSTIFIED)
  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fieldsToUpdate.push('alignment');
    logger.debug(`Setting alignment to ${style.alignment}`);
  }

  // Process indentation options
  if (style.indentStart !== undefined) {
    paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' };
    fieldsToUpdate.push('indentStart');
    logger.debug(`Setting left indent to ${style.indentStart}pt`);
  }

  if (style.indentEnd !== undefined) {
    paragraphStyle.indentEnd = { magnitude: style.indentEnd, unit: 'PT' };
    fieldsToUpdate.push('indentEnd');
    logger.debug(`Setting right indent to ${style.indentEnd}pt`);
  }

  // Process spacing options
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' };
    fieldsToUpdate.push('spaceAbove');
    logger.debug(`Setting space above to ${style.spaceAbove}pt`);
  }

  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' };
    fieldsToUpdate.push('spaceBelow');
    logger.debug(`Setting space below to ${style.spaceBelow}pt`);
  }

  // Process named style types (headings, etc.)
  if (style.namedStyleType !== undefined) {
    paragraphStyle.namedStyleType = style.namedStyleType;
    fieldsToUpdate.push('namedStyleType');
    logger.debug(`Setting named style to ${style.namedStyleType}`);
  }

  // Process page break control
  if (style.keepWithNext !== undefined) {
    paragraphStyle.keepWithNext = style.keepWithNext;
    fieldsToUpdate.push('keepWithNext');
    logger.debug(`Setting keepWithNext to ${style.keepWithNext}`);
  }

  // Verify we have styles to apply
  if (fieldsToUpdate.length === 0) {
    logger.warn('No paragraph styling options were provided');
    return null; // No styles to apply
  }

  // Build the range with optional tabId
  const range: docs_v1.Schema$Range = { startIndex, endIndex };
  if (tabId) {
    range.tabId = tabId;
  }

  // Build the request object
  const request: docs_v1.Schema$Request = {
    updateParagraphStyle: {
      range,
      paragraphStyle: paragraphStyle,
      fields: fieldsToUpdate.join(','),
    },
  };

  logger.debug(`Created paragraph style request with fields: ${fieldsToUpdate.join(', ')}`);
  return { request, fields: fieldsToUpdate };
}

export function buildTableStartLocation(
  tableStartIndex: number,
  tabId?: string
): docs_v1.Schema$Location {
  const location: Record<string, unknown> = { index: tableStartIndex };
  if (tabId) {
    location.tabId = tabId;
  }
  return location as docs_v1.Schema$Location;
}

export function buildInsertTableRowRequest(
  tableStartIndex: number,
  rowIndex: number,
  insertBelow: boolean,
  tabId?: string
): docs_v1.Schema$Request {
  return {
    insertTableRow: {
      tableCellLocation: {
        tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
        rowIndex,
        columnIndex: 0,
      },
      insertBelow,
    },
  };
}

export function buildDeleteTableRowRequest(
  tableStartIndex: number,
  rowIndex: number,
  tabId?: string
): docs_v1.Schema$Request {
  return {
    deleteTableRow: {
      tableCellLocation: {
        tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
        rowIndex,
        columnIndex: 0,
      },
    },
  };
}

type TableCellStyleArgs = {
  backgroundColor?: docs_v1.Schema$RgbColor;
  contentAlignment?: 'CONTENT_ALIGNMENT_UNSPECIFIED' | 'TOP' | 'MIDDLE' | 'BOTTOM';
  rowSpan?: number;
  columnSpan?: number;
  paddingTopPt?: number;
  paddingBottomPt?: number;
  paddingLeftPt?: number;
  paddingRightPt?: number;
  borderTop?: docs_v1.Schema$TableCellBorder;
  borderBottom?: docs_v1.Schema$TableCellBorder;
  borderLeft?: docs_v1.Schema$TableCellBorder;
  borderRight?: docs_v1.Schema$TableCellBorder;
};

function pointDimension(magnitude: number): docs_v1.Schema$Dimension {
  return { magnitude, unit: 'PT' };
}

export function buildTableCellStyleRequest(
  tableStartIndex: number,
  rowIndex: number,
  columnIndex: number,
  style: TableCellStyleArgs,
  tabId?: string
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  const tableCellStyle: Record<string, unknown> = {};
  const fields: string[] = [];

  if (style.backgroundColor) {
    tableCellStyle.backgroundColor = { color: { rgbColor: style.backgroundColor } };
    fields.push('backgroundColor');
  }
  if (style.contentAlignment) {
    tableCellStyle.contentAlignment = style.contentAlignment;
    fields.push('contentAlignment');
  }
  if (style.paddingTopPt !== undefined) {
    tableCellStyle.paddingTop = pointDimension(style.paddingTopPt);
    fields.push('paddingTop');
  }
  if (style.paddingBottomPt !== undefined) {
    tableCellStyle.paddingBottom = pointDimension(style.paddingBottomPt);
    fields.push('paddingBottom');
  }
  if (style.paddingLeftPt !== undefined) {
    tableCellStyle.paddingLeft = pointDimension(style.paddingLeftPt);
    fields.push('paddingLeft');
  }
  if (style.paddingRightPt !== undefined) {
    tableCellStyle.paddingRight = pointDimension(style.paddingRightPt);
    fields.push('paddingRight');
  }
  if (style.borderTop) {
    tableCellStyle.borderTop = style.borderTop;
    fields.push('borderTop');
  }
  if (style.borderBottom) {
    tableCellStyle.borderBottom = style.borderBottom;
    fields.push('borderBottom');
  }
  if (style.borderLeft) {
    tableCellStyle.borderLeft = style.borderLeft;
    fields.push('borderLeft');
  }
  if (style.borderRight) {
    tableCellStyle.borderRight = style.borderRight;
    fields.push('borderRight');
  }

  if (fields.length === 0) return null;

  const rowSpan = style.rowSpan ?? 1;
  const columnSpan = style.columnSpan ?? 1;

  return {
    request: {
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
            rowIndex,
            columnIndex,
          },
          rowSpan,
          columnSpan,
        },
        tableCellStyle: tableCellStyle as docs_v1.Schema$TableCellStyle,
        fields: fields.join(','),
      },
    },
    fields,
  };
}

export function buildTableBorder(
  color: docs_v1.Schema$RgbColor,
  widthPt: number,
  dashStyle: 'SOLID' | 'DASHED' | 'DOTTED'
): docs_v1.Schema$TableCellBorder {
  return {
    color: { color: { rgbColor: color } },
    width: pointDimension(widthPt),
    dashStyle,
  };
}

export function buildTableColumnWidthRequest(
  tableStartIndex: number,
  columnIndices: number[],
  widthPt: number,
  tabId?: string
): docs_v1.Schema$Request {
  const request: any = {
    updateTableColumnProperties: {
      tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
      columnIndices,
      tableColumnProperties: {
        widthType: 'FIXED_WIDTH',
        width: pointDimension(widthPt),
      },
      fields: 'widthType,width',
    },
  };

  return request as docs_v1.Schema$Request;
}

export function buildTableRowStyleRequest(
  tableStartIndex: number,
  rowIndices: number[],
  minRowHeightPt: number | undefined,
  preventOverflow: boolean | undefined,
  tabId?: string
): docs_v1.Schema$Request | null {
  const tableRowStyle: Record<string, unknown> = {};
  const fields: string[] = [];

  if (minRowHeightPt !== undefined) {
    tableRowStyle.minRowHeight = pointDimension(minRowHeightPt);
    fields.push('minRowHeight');
  }
  if (preventOverflow !== undefined) {
    tableRowStyle.preventOverflow = preventOverflow;
    fields.push('preventOverflow');
  }

  if (fields.length === 0) return null;

  const request: any = {
    updateTableRowStyle: {
      tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
      rowIndices,
      tableRowStyle,
      fields: fields.join(','),
    },
  };

  return request as docs_v1.Schema$Request;
}

export function buildPinTableHeaderRowsRequest(
  tableStartIndex: number,
  pinnedHeaderRowsCount: number,
  tabId?: string
): docs_v1.Schema$Request {
  const request: any = {
    pinTableHeaderRows: {
      tableStartLocation: buildTableStartLocation(tableStartIndex, tabId),
      pinnedHeaderRowsCount,
    },
  };

  return request as docs_v1.Schema$Request;
}

// --- Specific Feature Helpers ---

export async function createTable(
  docs: Docs,
  documentId: string,
  rows: number,
  columns: number,
  index: number,
  tabId?: string
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (rows < 1 || columns < 1) {
    throw new UserError('Table must have at least 1 row and 1 column.');
  }
  const location: any = { index };
  if (tabId) {
    location.tabId = tabId;
  }
  const request: docs_v1.Schema$Request = {
    insertTable: {
      location,
      rows: rows,
      columns: columns,
    },
  };
  return executeBatchUpdate(docs, documentId, [request]);
}

export async function insertText(
  docs: Docs,
  documentId: string,
  text: string,
  index: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (!text) return {}; // Nothing to insert
  const request: docs_v1.Schema$Request = {
    insertText: {
      location: { index },
      text: text,
    },
  };
  return executeBatchUpdate(docs, documentId, [request]);
}

// --- Table Cell Helper ---

/**
 * Finds the content range of a specific table cell.
 * Returns the start and end indices of the cell's text content (excluding trailing newline).
 */
export async function getTableCellRange(
  docs: Docs,
  documentId: string,
  tableStartIndex: number,
  rowIndex: number,
  columnIndex: number,
  tabId?: string
): Promise<{ startIndex: number; endIndex: number }> {
  const res = await docs.documents.get({
    documentId,
    ...(tabId && { includeTabsContent: true }),
  });

  // Get body content from the correct tab or default
  let bodyContent: docs_v1.Schema$StructuralElement[] | undefined;
  if (tabId) {
    const allTabs = getAllTabs(res.data);
    const tab = allTabs.find((t) => t.tabProperties?.tabId === tabId);
    if (!tab) throw new UserError(`Tab with ID "${tabId}" not found.`);
    bodyContent = tab.documentTab?.body?.content;
  } else {
    bodyContent = res.data.body?.content;
  }

  if (!bodyContent) {
    throw new UserError(`No content found in document ${documentId}.`);
  }

  // Find the table element matching tableStartIndex
  const tableElement = bodyContent.find((el) => el.table && el.startIndex === tableStartIndex);
  if (!tableElement || !tableElement.table) {
    throw new UserError(
      `No table found at startIndex ${tableStartIndex}. Use readGoogleDoc with format='json' to find the correct table startIndex.`
    );
  }

  const table = tableElement.table;
  const rows = table.tableRows;
  if (!rows || rowIndex < 0 || rowIndex >= rows.length) {
    throw new UserError(
      `Row index ${rowIndex} is out of range. Table has ${rows?.length ?? 0} rows (0-based).`
    );
  }

  const cells = rows[rowIndex].tableCells;
  if (!cells || columnIndex < 0 || columnIndex >= cells.length) {
    throw new UserError(
      `Column index ${columnIndex} is out of range. Row ${rowIndex} has ${cells?.length ?? 0} columns (0-based).`
    );
  }

  const cell = cells[columnIndex];
  const cellContent = cell.content;
  if (!cellContent || cellContent.length === 0) {
    throw new UserError(`Cell (${rowIndex}, ${columnIndex}) has no content elements.`);
  }

  // Cell always has at least one paragraph with a trailing \n.
  // We want the range covering all content *before* that final \n.
  const firstParagraph = cellContent[0];
  const lastParagraph = cellContent[cellContent.length - 1];

  const cellStartIndex = firstParagraph.startIndex;
  // The endIndex of the last paragraph includes the trailing \n.
  // We subtract 1 to exclude it so delete operations don't remove the cell structure.
  const cellEndIndex = lastParagraph.endIndex;

  if (cellStartIndex == null || cellEndIndex == null) {
    throw new UserError(
      `Could not determine content range for cell (${rowIndex}, ${columnIndex}).`
    );
  }

  return { startIndex: cellStartIndex, endIndex: cellEndIndex - 1 };
}

// --- Complex / Stubbed Helpers ---

export async function findParagraphsMatchingStyle(
  docs: Docs,
  documentId: string,
  styleCriteria: any // Define a proper type for criteria (e.g., { fontFamily: 'Arial', bold: true })
): Promise<{ startIndex: number; endIndex: number }[]> {
  // TODO: Implement logic
  // 1. Get document content with paragraph elements and their styles.
  // 2. Iterate through paragraphs.
  // 3. For each paragraph, check if its computed style matches the criteria.
  // 4. Return ranges of matching paragraphs.
  logger.warn('findParagraphsMatchingStyle is not implemented.');
  throw new NotImplementedError('Finding paragraphs by style criteria is not yet implemented.');
  // return [];
}

export async function detectAndFormatLists(
  docs: Docs,
  documentId: string,
  startIndex?: number,
  endIndex?: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  // TODO: Implement complex logic
  // 1. Get document content (paragraphs, text runs) in the specified range (or whole doc).
  // 2. Iterate through paragraphs.
  // 3. Identify sequences of paragraphs starting with list-like markers (e.g., "-", "*", "1.", "a)").
  // 4. Determine nesting levels based on indentation or marker patterns.
  // 5. Generate CreateParagraphBulletsRequests for the identified sequences.
  // 6. Potentially delete the original marker text.
  // 7. Execute the batch update.
  logger.warn('detectAndFormatLists is not implemented.');
  throw new NotImplementedError('Automatic list detection and formatting is not yet implemented.');
  // return {};
}

export async function addCommentHelper(
  docs: Docs,
  documentId: string,
  text: string,
  startIndex: number,
  endIndex: number
): Promise<void> {
  // NOTE: Adding comments typically requires the Google Drive API v3 and different scopes!
  // 'https://www.googleapis.com/auth/drive' or more specific comment scopes.
  // This helper is a placeholder assuming Drive API client (`drive`) is available and authorized.
  /*
const drive = google.drive({version: 'v3', auth: authClient}); // Assuming authClient is available
await drive.comments.create({
fileId: documentId,
requestBody: {
content: text,
anchor: JSON.stringify({ // Anchor format might need verification
'type': 'workbook#textAnchor', // Or appropriate type for Docs
'refs': [{
'docRevisionId': 'head', // Or specific revision
'range': {
'start': startIndex,
'end': endIndex,
}
}]
})
},
fields: 'id'
});
*/
  logger.warn('addCommentHelper requires Google Drive API and is not implemented.');
  throw new NotImplementedError(
    'Adding comments requires Drive API setup and is not yet implemented.'
  );
}

// --- Image Insertion Helpers ---

/**
 * Inserts an inline image into a document from a publicly accessible URL
 * @param docs - Google Docs API client
 * @param documentId - The document ID
 * @param imageUrl - Publicly accessible URL to the image
 * @param index - Position in the document where image should be inserted (1-based)
 * @param width - Optional width in points
 * @param height - Optional height in points
 * @returns Promise with batch update response
 */
export async function insertInlineImage(
  docs: Docs,
  documentId: string,
  imageUrl: string,
  index: number,
  width?: number,
  height?: number,
  tabId?: string
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  // Validate URL format
  try {
    new URL(imageUrl);
  } catch (e) {
    throw new UserError(`Invalid image URL format: ${imageUrl}`);
  }

  // Build the insertInlineImage request
  const location: any = { index };
  if (tabId) {
    location.tabId = tabId;
  }

  const request: docs_v1.Schema$Request = {
    insertInlineImage: {
      location,
      uri: imageUrl,
      ...(width &&
        height && {
          objectSize: {
            height: { magnitude: height, unit: 'PT' },
            width: { magnitude: width, unit: 'PT' },
          },
        }),
    },
  };

  return executeBatchUpdate(docs, documentId, [request]);
}

/**
 * Uploads a local image file to Google Drive.
 *
 * When `skipPublicSharing` is false (default), the file is made publicly
 * readable and its webContentLink is returned — required for the Docs API
 * insertInlineImage approach.
 *
 * When `skipPublicSharing` is true, only the Drive file ID is returned.
 * Use this with the Apps Script insertion path where no public URL is needed.
 */
export async function uploadImageToDrive(
  drive: any, // drive_v3.Drive type
  localFilePath: string,
  parentFolderId?: string,
  skipPublicSharing: boolean = true
): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');

  if (!fs.existsSync(localFilePath)) {
    throw new UserError(`Image file not found: ${localFilePath}`);
  }

  const resolvedPath = path.resolve(localFilePath);
  const cwd = path.resolve(process.cwd());
  if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
    throw new UserError('Image file path must be within the working directory.');
  }

  const fileName = path.basename(localFilePath);
  const mimeTypeMap: { [key: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  const ext = path.extname(localFilePath).toLowerCase();
  const mimeType = mimeTypeMap[ext] || 'application/octet-stream';

  const fileMetadata: any = {
    name: fileName,
    mimeType: mimeType,
  };

  if (parentFolderId) {
    fileMetadata.parents = [parentFolderId];
  }

  const media = {
    mimeType: mimeType,
    body: fs.createReadStream(localFilePath),
  };

  const uploadResponse = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id,webViewLink,webContentLink',
    supportsAllDrives: true,
  });

  const fileId = uploadResponse.data.id;
  if (!fileId) {
    throw new Error('Failed to upload image to Drive - no file ID returned');
  }

  if (skipPublicSharing) {
    return fileId;
  }

  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  });

  const fileInfo = await drive.files.get({
    fileId: fileId,
    fields: 'webContentLink',
    supportsAllDrives: true,
  });

  const webContentLink = fileInfo.data.webContentLink;
  if (!webContentLink) {
    throw new Error('Failed to get public URL for uploaded image');
  }

  return webContentLink;
}

/**
 * Inserts an image into a Google Doc via Apps Script.
 *
 * Flow:
 *   1. Insert a unique marker string at the target index using the Docs API.
 *   2. Call the deployed Apps Script which finds the marker and replaces it
 *      with the actual image blob from Drive (no public sharing needed).
 */
export async function insertImageViaAppsScript(
  docs: Docs,
  scriptClient: any, // script_v1.Script type
  deploymentId: string,
  documentId: string,
  driveFileId: string,
  charIndex: number,
  tabId?: string
): Promise<void> {
  const marker = `[mcp-img-${driveFileId}]`;

  // Step 1: Insert marker at the requested position via Docs API
  const location: any = { index: charIndex };
  if (tabId) {
    location.tabId = tabId;
  }

  await executeBatchUpdate(docs, documentId, [{ insertText: { location, text: marker } }]);

  // Step 2: Call Apps Script to replace the marker with the image
  const response = await scriptClient.scripts.run({
    scriptId: deploymentId,
    requestBody: {
      function: 'insertImageByFileId',
      parameters: [documentId, driveFileId],
    },
  });

  const result = response.data?.response?.result;
  if (!result || !result.success) {
    const msg = result?.message || 'Unknown Apps Script error';
    throw new Error(`Apps Script image insertion failed: ${msg}`);
  }
}

// --- Tab Management Helpers ---

/**
 * Interface for a tab with hierarchy level information
 */
export interface TabWithLevel extends docs_v1.Schema$Tab {
  level: number;
}

/**
 * Recursively collect all tabs from a document in a flat list with hierarchy info
 * @param doc - The Google Doc document object
 * @returns Array of tabs with nesting level information
 */
export function getAllTabs(doc: docs_v1.Schema$Document): TabWithLevel[] {
  const allTabs: TabWithLevel[] = [];
  if (!doc.tabs || doc.tabs.length === 0) {
    return allTabs;
  }

  for (const tab of doc.tabs) {
    addCurrentAndChildTabs(tab, allTabs, 0);
  }
  return allTabs;
}

/**
 * Recursive helper to add tabs with their nesting level
 * @param tab - The tab to add
 * @param allTabs - The accumulator array
 * @param level - Current nesting level (0 for top-level)
 */
function addCurrentAndChildTabs(
  tab: docs_v1.Schema$Tab,
  allTabs: TabWithLevel[],
  level: number
): void {
  allTabs.push({ ...tab, level });
  if (tab.childTabs && tab.childTabs.length > 0) {
    for (const childTab of tab.childTabs) {
      addCurrentAndChildTabs(childTab, allTabs, level + 1);
    }
  }
}

/**
 * Get the text length from a DocumentTab
 * @param documentTab - The DocumentTab object
 * @returns Total character count
 */
export function getTabTextLength(documentTab: docs_v1.Schema$DocumentTab | undefined): number {
  let totalLength = 0;

  if (!documentTab?.body?.content) {
    return 0;
  }

  documentTab.body.content.forEach((element: any) => {
    // Handle paragraphs
    if (element.paragraph?.elements) {
      element.paragraph.elements.forEach((pe: any) => {
        if (pe.textRun?.content) {
          totalLength += pe.textRun.content.length;
        }
      });
    }

    // Handle tables
    if (element.table?.tableRows) {
      element.table.tableRows.forEach((row: any) => {
        row.tableCells?.forEach((cell: any) => {
          cell.content?.forEach((cellElement: any) => {
            cellElement.paragraph?.elements?.forEach((pe: any) => {
              if (pe.textRun?.content) {
                totalLength += pe.textRun.content.length;
              }
            });
          });
        });
      });
    }
  });

  return totalLength;
}

/**
 * Find a specific tab by ID in a document (searches recursively through child tabs)
 * @param doc - The Google Doc document object
 * @param tabId - The tab ID to search for
 * @returns The tab object if found, null otherwise
 */
export function findTabById(
  doc: docs_v1.Schema$Document,
  tabId: string
): docs_v1.Schema$Tab | null {
  if (!doc.tabs || doc.tabs.length === 0) {
    return null;
  }

  // Helper function to search through tabs recursively
  const searchTabs = (tabs: docs_v1.Schema$Tab[]): docs_v1.Schema$Tab | null => {
    for (const tab of tabs) {
      if (tab.tabProperties?.tabId === tabId) {
        return tab;
      }
      // Recursively search child tabs
      if (tab.childTabs && tab.childTabs.length > 0) {
        const found = searchTabs(tab.childTabs);
        if (found) return found;
      }
    }
    return null;
  };

  return searchTabs(doc.tabs);
}

/**
 * Fetches a document with tab content and validates that the given tabId exists and has
 * a documentTab body. Returns the resolved `docs_v1.Schema$Tab`.
 *
 * This replaces the repeated pattern:
 *   docs.documents.get({ includeTabsContent: true, fields: buildTabsFieldMask(...) })
 *   + findTabById() + two UserError throws
 *
 * @param docs     - Authenticated Docs client
 * @param documentId - Target document ID
 * @param tabId    - Tab ID to locate
 * @param documentTabFields - The documentTab subfields needed (passed to buildTabsFieldMask)
 */
export async function getDocumentTab(
  docs: Docs,
  documentId: string,
  tabId: string,
  documentTabFields: string = 'documentTab(body(content(endIndex)))'
): Promise<docs_v1.Schema$Tab> {
  const res = await docs.documents.get({
    documentId,
    includeTabsContent: true,
    suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
    fields: buildTabsFieldMask(documentTabFields),
  });
  const tab = findTabById(res.data, tabId);
  if (!tab) {
    throw new UserError(`Tab with ID "${tabId}" not found in document.`);
  }
  if (!tab.documentTab) {
    throw new UserError(`Tab "${tabId}" does not have content (may not be a document tab).`);
  }
  return tab;
}

/**
 * Returns the 1-based insertion index for appending to a document or tab body —
 * i.e. `endIndex - 1` of the last structural element, which positions content
 * immediately before the document's trailing newline.
 *
 * @param docs        - Authenticated Docs client
 * @param documentId  - Target document ID
 * @param tabId       - Optional tab ID; if omitted uses the root body
 */
export async function getAppendIndex(
  docs: Docs,
  documentId: string,
  tabId?: string
): Promise<number> {
  const needsTabsContent = !!tabId;
  const res = await docs.documents.get({
    documentId,
    ...(needsTabsContent && { includeTabsContent: true }),
    suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
    fields: needsTabsContent
      ? buildTabsFieldMask('documentTab(body(content(endIndex)))')
      : 'body(content(endIndex))',
  });

  let content: docs_v1.Schema$StructuralElement[] | undefined;
  if (tabId) {
    const tab = findTabById(res.data, tabId);
    if (!tab) throw new UserError(`Tab with ID "${tabId}" not found in document.`);
    if (!tab.documentTab) throw new UserError(`Tab "${tabId}" does not have content.`);
    content = tab.documentTab.body?.content;
  } else {
    content = res.data.body?.content;
  }

  if (!content || content.length === 0) return 1;
  const lastEndIndex = content[content.length - 1]?.endIndex;
  return lastEndIndex != null ? lastEndIndex - 1 : 1;
}

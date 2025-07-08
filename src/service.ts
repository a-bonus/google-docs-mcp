import { UserError } from "fastmcp"
import { docs_v1, drive_v3 } from "googleapis"

import * as GDocsHelpers from "./googleDocsApiHelpers.js"
import {
  ApplyParagraphStyleToolArgs,
  ApplyTextStyleToolArgs,
  NotImplementedError,
  SectionFindArgs,
  SectionInfo,
  TextStyleArgs,
} from "./types.js"

export interface ReadGoogleDocArgs {
  documentId: string;
  format?: "text" | "json" | "markdown";
  tabId?: string;
}

export interface ReadGoogleDocResult {
  content:
    | string
    | {
        fullContent: string;
        tabs: Array<{
          tabId: string;
          title: string;
          content: string;
          contentLength: number;
        }>;
      };
  format: "text" | "json" | "markdown";
  truncated?: boolean;
  originalLength?: number;
}

export interface AppendToGoogleDocArgs {
  documentId: string;
  textToAppend: string;
  addNewlineIfNeeded?: boolean;
}

export interface AppendToGoogleDocResult {
  message: string;
  documentId: string;
}

export interface InsertTextArgs {
  documentId: string;
  textToInsert: string;
  index: number;
  tabId?: string;
}

export interface InsertTextResult {
  message: string;
  documentId: string;
  index: number;
}

export interface DeleteRangeArgs {
  documentId: string;
  startIndex: number;
  endIndex: number;
  tabId?: string;
}

export interface DeleteRangeResult {
  message: string;
  documentId: string;
  startIndex: number;
  endIndex: number;
}

export interface ApplyTextStyleArgs {
  documentId: string;
  target:
    | { startIndex: number; endIndex: number }
    | { textToFind: string; matchInstance?: number };
  style: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    fontSize?: number;
    fontFamily?: string;
    foregroundColor?: string;
    backgroundColor?: string;
    linkUrl?: string;
  };
  tabId?: string;
}

export interface ApplyTextStyleResult {
  message: string;
  documentId: string;
  startIndex: number;
  endIndex: number;
  appliedFields: string[];
}

export interface ApplyParagraphStyleArgs {
  documentId: string;
  target:
    | { startIndex: number; endIndex: number }
    | {
        textToFind: string;
        matchInstance?: number;
        applyToContainingParagraph: true;
      }
    | { indexWithinParagraph: number };
  style: {
    alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    indentStart?: number;
    indentEnd?: number;
    spaceAbove?: number;
    spaceBelow?: number;
    namedStyleType?:
      | "NORMAL_TEXT"
      | "TITLE"
      | "SUBTITLE"
      | "HEADING_1"
      | "HEADING_2"
      | "HEADING_3"
      | "HEADING_4"
      | "HEADING_5"
      | "HEADING_6";
    keepWithNext?: boolean;
  };
  tabId?: string;
}

export interface ApplyParagraphStyleResult {
  message: string;
  documentId: string;
  startIndex: number;
  endIndex: number;
  appliedFields: string[];
}

export interface InsertTableArgs {
  documentId: string;
  rows: number;
  columns: number;
  index: number;
  tabId?: string;
}

export interface InsertTableResult {
  message: string;
  documentId: string;
  rows: number;
  columns: number;
  index: number;
}

export interface InsertPageBreakArgs {
  documentId: string;
  index: number;
  tabId?: string;
}

export interface InsertPageBreakResult {
  message: string;
  documentId: string;
  index: number;
}

export interface FixListFormattingArgs {
  documentId: string;
  range?: {
    startIndex?: number;
    endIndex?: number;
  };
}

export interface FixListFormattingResult {
  message: string;
  documentId: string;
}

export interface ReadGoogleDocWithTabsArgs {
  documentId: string;
  includeTabsContent?: boolean;
  page?: number;
  limit?: number;
}

export interface ReadGoogleDocWithTabsResult {
  documentId: string;
  title: string;
  mainContent: string;
  tabs: Array<{
    tabId: string;
    title: string;
    content: string;
    contentLength: number;
  }>;
  summary: {
    mainContentLength: number;
    tabsCount: number;
    totalContentLength: number;
  };
  pagination: {
    currentPage: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    actualContentLength: number;
    truncated: boolean;
  };
}

export interface FindSectionArgs {
  documentId: string;
  sectionTitle: string;
  headingLevel?:
    | "HEADING_1"
    | "HEADING_2"
    | "HEADING_3"
    | "HEADING_4"
    | "HEADING_5"
    | "HEADING_6";
  matchInstance?: number;
  returnContent?: boolean;
  contentEndBoundary?:
    | "next_heading"
    | "next_same_level"
    | "next_higher_level"
    | "document_end";
}

export interface FindSectionResult {
  found: boolean;
  sectionInfo?: SectionInfo;
  message: string;
}

export interface FormatMatchingTextArgs {
  documentId: string;
  textToFind: string;
  matchInstance?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  linkUrl?: string;
}

export interface FormatMatchingTextResult {
  message: string;
  documentId: string;
  textToFind: string;
  matchInstance: number;
  appliedFields: string[];
}

export const GoogleDocService = {
  async readGoogleDoc(
    docs: docs_v1.Docs,
    args: ReadGoogleDocArgs,
  ): Promise<ReadGoogleDocResult> {
    const format = args.format || "text";
    const { tabId } = args;

    try {
      // Always get tabs content for structured output
      const res = await docs.documents.get({
        documentId: args.documentId,
        includeTabsContent: true,
      });

      if (format === "json") {
        return {
          content: JSON.stringify(res.data, null, 2),
          format: "json",
        };
      }

      if (format === "markdown") {
        // TODO: Implement Markdown conversion logic (complex)
        throw new NotImplementedError(
          "Markdown output format is not yet implemented.",
        );
      }

      // Extract main document content
      let mainContent = "";
      res.data.body?.content?.forEach((element) => {
        element.paragraph?.elements?.forEach((pe) => {
          mainContent += pe.textRun?.content || "";
        });
      });

      // Extract tabs content
      const tabs: Array<{
        tabId: string;
        title: string;
        content: string;
        contentLength: number;
      }> = [];

      if (res.data.tabs && Array.isArray(res.data.tabs)) {
        res.data.tabs.forEach((tab: any, index: number) => {
          let tabContent = "";

          // Extract content from each tab
          tab.documentTab?.body?.content?.forEach((element: any) => {
            element.paragraph?.elements?.forEach((pe: any) => {
              tabContent += pe.textRun?.content || "";
            });
          });

          tabs.push({
            tabId: tab.tabId || `tab_${index}`,
            title: tab.documentTab?.title || `Tab ${index + 1}`,
            content: tabContent,
            contentLength: tabContent.length,
          });
        });
      }

      // If tabId is specified, filter to that specific tab
      if (tabId) {
        const targetTab = tabs.find((tab) => tab.tabId === tabId);
        if (!targetTab) {
          throw new UserError(`Tab with ID "${tabId}" not found in document.`);
        }

        // Return only the content from the specified tab
        const maxLength = 4000;
        const originalLength = targetTab.content.length;
        const truncated = targetTab.content.length > maxLength;
        const finalContent = truncated
          ? `${targetTab.content.substring(0, maxLength)}... [truncated ${originalLength} chars]`
          : targetTab.content;

        return {
          content: `Tab "${targetTab.title}" Content:\n---\n${finalContent}`,
          format: "text",
          truncated,
          originalLength: truncated ? originalLength : undefined,
        };
      }

      // If no tabId specified, return structured output with both main content and tabs
      const fullContent = mainContent + tabs.map((tab) => tab.content).join("");
      const maxLength = 4000;
      const originalLength = fullContent.length;
      const truncated = fullContent.length > maxLength;

      const truncatedMainContent =
        truncated && mainContent.length > maxLength
          ? `${mainContent.substring(0, maxLength)}... [truncated ${mainContent.length} chars]`
          : mainContent;

      const truncatedTabs = tabs.map((tab) => ({
        ...tab,
        content:
          truncated && tab.content.length > 1000
            ? `${tab.content.substring(0, 1000)}... [truncated ${tab.content.length} chars]`
            : tab.content,
      }));

      return {
        content: {
          fullContent: truncatedMainContent,
          tabs: truncatedTabs,
        },
        format: "text",
        truncated,
        originalLength: truncated ? originalLength : undefined,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${args.documentId}).`);
      if (apiError.code === 403)
        throw new UserError(
          `Permission denied for doc (ID: ${args.documentId}).`,
        );
      throw new UserError(
        `Failed to read doc: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async appendToGoogleDoc(
    docs: docs_v1.Docs,
    args: AppendToGoogleDocArgs,
  ): Promise<AppendToGoogleDocResult> {
    const { documentId, textToAppend, addNewlineIfNeeded = true } = args;

    try {
      // Get the current end index
      const docInfo = await docs.documents.get({
        documentId,
        fields: "body(content(endIndex)),documentStyle(pageSize)",
      });

      let endIndex = 1;
      if (docInfo.data.body?.content) {
        const lastElement =
          docInfo.data.body.content[docInfo.data.body.content.length - 1];
        if (lastElement?.endIndex) {
          endIndex = lastElement.endIndex - 1; // Insert *before* the final newline of the doc typically
        }
      }

      // Simpler approach: Always assume insertion is needed unless explicitly told not to add newline
      const textToInsert =
        (addNewlineIfNeeded && endIndex > 1 ? "\n" : "") + textToAppend;

      if (!textToInsert) {
        return {
          message: "Nothing to append.",
          documentId,
        };
      }

      const request: docs_v1.Schema$Request = {
        insertText: {
          location: { index: endIndex },
          text: textToInsert,
        },
      };

      await GDocsHelpers.executeBatchUpdate(docs, documentId, [request]);

      return {
        message: `Successfully appended text to document ${documentId}.`,
        documentId,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to append to doc: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async insertText(
    docs: docs_v1.Docs,
    args: InsertTextArgs,
  ): Promise<InsertTextResult> {
    const { documentId, textToInsert, index, tabId } = args;

    try {
      await GDocsHelpers.insertText(
        docs,
        documentId,
        textToInsert,
        index,
        tabId,
      );

      return {
        message: `Successfully inserted text at index ${index}.`,
        documentId,
        index,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to insert text: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async deleteRange(
    docs: docs_v1.Docs,
    args: DeleteRangeArgs,
  ): Promise<DeleteRangeResult> {
    const { documentId, startIndex, endIndex, tabId } = args;

    // Validate range
    if (endIndex <= startIndex) {
      throw new UserError(
        "End index must be greater than start index for deletion.",
      );
    }

    try {
      const range: any = { startIndex, endIndex };
      if (tabId) {
        range.tabId = tabId;
      }

      const request: docs_v1.Schema$Request = {
        deleteContentRange: {
          range: range,
        },
      };

      await GDocsHelpers.executeBatchUpdate(docs, documentId, [request], tabId);

      return {
        message: `Successfully deleted content in range ${startIndex}-${endIndex}.`,
        documentId,
        startIndex,
        endIndex,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to delete range: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async applyTextStyle(
    docs: docs_v1.Docs,
    args: ApplyTextStyleToolArgs,
  ): Promise<ApplyTextStyleResult> {
    const { documentId, target, style, tabId } = args;
    let startIndex: number | undefined =
      "startIndex" in target ? target.startIndex : undefined;
    let endIndex: number | undefined =
      "endIndex" in target ? target.endIndex : undefined;

    try {
      // Determine target range
      if ("textToFind" in target) {
        const range = await GDocsHelpers.findTextRange(
          docs,
          documentId,
          target.textToFind,
          target.matchInstance,
        );
        if (!range) {
          throw new UserError(
            `Could not find instance ${target.matchInstance} of text "${target.textToFind}".`,
          );
        }
        startIndex = range.startIndex;
        endIndex = range.endIndex;
      }

      if (startIndex === undefined || endIndex === undefined) {
        throw new UserError("Target range could not be determined.");
      }
      if (endIndex <= startIndex) {
        throw new UserError(
          "End index must be greater than start index for styling.",
        );
      }

      // Build the request
      const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
        startIndex,
        endIndex,
        style,
        tabId,
      );
      if (!requestInfo) {
        throw new UserError("No valid text styling options were provided.");
      }

      await GDocsHelpers.executeBatchUpdate(
        docs,
        documentId,
        [requestInfo.request],
        tabId,
      );

      return {
        message: `Successfully applied text style (${requestInfo.fields.join(", ")}) to range ${startIndex}-${endIndex}.`,
        documentId,
        startIndex,
        endIndex,
        appliedFields: requestInfo.fields,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to apply text style: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async applyParagraphStyle(
    docs: docs_v1.Docs,
    args: ApplyParagraphStyleToolArgs,
  ): Promise<ApplyParagraphStyleResult> {
    const { documentId, target, style, tabId } = args;
    let startIndex: number | undefined;
    let endIndex: number | undefined;

    try {
      // STEP 1: Determine the target paragraph's range based on the targeting method
      if ("textToFind" in target) {
        // Find the text first
        const textRange = await GDocsHelpers.findTextRange(
          docs,
          documentId,
          target.textToFind,
          target.matchInstance || 1,
        );

        if (!textRange) {
          throw new UserError(
            `Could not find "${target.textToFind}" in the document.`,
          );
        }

        // Then find the paragraph containing this text
        const paragraphRange = await GDocsHelpers.getParagraphRange(
          docs,
          documentId,
          textRange.startIndex,
        );

        if (!paragraphRange) {
          throw new UserError(
            `Found the text but could not determine the paragraph boundaries.`,
          );
        }

        startIndex = paragraphRange.startIndex;
        endIndex = paragraphRange.endIndex;
      } else if ("indexWithinParagraph" in target) {
        // Find paragraph containing the specified index
        const paragraphRange = await GDocsHelpers.getParagraphRange(
          docs,
          documentId,
          target.indexWithinParagraph,
        );

        if (!paragraphRange) {
          throw new UserError(
            `Could not find paragraph containing index ${target.indexWithinParagraph}.`,
          );
        }

        startIndex = paragraphRange.startIndex;
        endIndex = paragraphRange.endIndex;
      } else if ("startIndex" in target && "endIndex" in target) {
        // Use directly provided range
        startIndex = target.startIndex;
        endIndex = target.endIndex;
      }

      // Verify that we have a valid range
      if (startIndex === undefined || endIndex === undefined) {
        throw new UserError(
          "Could not determine target paragraph range from the provided information.",
        );
      }

      if (endIndex <= startIndex) {
        throw new UserError(
          `Invalid paragraph range: end index (${endIndex}) must be greater than start index (${startIndex}).`,
        );
      }

      // STEP 2: Build and apply the paragraph style request
      const requestInfo = GDocsHelpers.buildUpdateParagraphStyleRequest(
        startIndex,
        endIndex,
        style,
        tabId,
      );

      if (!requestInfo) {
        throw new UserError(
          "No valid paragraph styling options were provided.",
        );
      }

      await GDocsHelpers.executeBatchUpdate(
        docs,
        documentId,
        [requestInfo.request],
        tabId,
      );

      return {
        message: `Successfully applied paragraph styles (${requestInfo.fields.join(", ")}) to the paragraph.`,
        documentId,
        startIndex,
        endIndex,
        appliedFields: requestInfo.fields,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to apply paragraph style: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async insertTable(
    docs: docs_v1.Docs,
    args: InsertTableArgs,
  ): Promise<InsertTableResult> {
    const { documentId, rows, columns, index, tabId } = args;

    try {
      await GDocsHelpers.createTable(
        docs,
        documentId,
        rows,
        columns,
        index,
        tabId,
      );

      return {
        message: `Successfully inserted a ${rows}x${columns} table at index ${index}.`,
        documentId,
        rows,
        columns,
        index,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to insert table: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async insertPageBreak(
    docs: docs_v1.Docs,
    args: InsertPageBreakArgs,
  ): Promise<InsertPageBreakResult> {
    const { documentId, index, tabId } = args;

    try {
      const location: any = { index };
      if (tabId) {
        location.tabId = tabId;
      }

      const request: docs_v1.Schema$Request = {
        insertPageBreak: {
          location: location,
        },
      };

      await GDocsHelpers.executeBatchUpdate(docs, documentId, [request], tabId);

      return {
        message: `Successfully inserted page break at index ${index}.`,
        documentId,
        index,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to insert page break: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async fixListFormatting(
    docs: docs_v1.Docs,
    args: FixListFormattingArgs,
  ): Promise<FixListFormattingResult> {
    const { documentId, range } = args;

    try {
      await GDocsHelpers.detectAndFormatLists(
        docs,
        documentId,
        range?.startIndex,
        range?.endIndex,
      );

      return {
        message: `Attempted to fix list formatting. Please review the document for accuracy.`,
        documentId,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error; // Expected if helper not implemented

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to fix list formatting: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async readGoogleDocWithTabs(
    docs: docs_v1.Docs,
    args: ReadGoogleDocWithTabsArgs,
  ): Promise<ReadGoogleDocWithTabsResult> {
    const {
      documentId,
      includeTabsContent = true,
      page = 0,
      limit = 20000,
    } = args;

    try {
      // Use Google Docs service to get document with tabs content
      const result = await docs.documents.get({
        documentId,
        includeTabsContent,
      });

      // Extract all content first (before pagination)
      const fullContent = {
        documentId,
        title: result.data.title || "Untitled Document",
        mainContent: "",
        tabs: [] as Array<{
          tabId: string;
          title: string;
          contentLength: number;
        }>,
      };

      // Extract main document content
      if (result.data.body?.content) {
        result.data.body.content.forEach((element) => {
          element.paragraph?.elements?.forEach((pe) => {
            fullContent.mainContent += pe.textRun?.content || "";
          });
        });
      }

      // Extract tabs content - we'll collect both tab info and content separately
      const tabs = result.data.tabs;
      const tabContents: Array<{
        tabId: string;
        title: string;
        content: string;
      }> = [];

      if (tabs && Array.isArray(tabs)) {
        tabs.forEach((tab: any, index: number) => {
          let tabContent = "";

          // Extract content from each tab
          tab.documentTab?.body?.content?.forEach((element: any) => {
            element.paragraph?.elements?.forEach((pe: any) => {
              tabContent += pe.textRun?.content || "";
            });
          });

          const tabId = tab.tabId || `tab_${index}`;
          const title = tab.documentTab?.title || `Tab ${index + 1}`;

          // Store tab info with content for the response
          fullContent.tabs.push({
            tabId,
            title,
            content: tabContent,
            contentLength: tabContent.length,
          });

          // Store content separately for pagination
          tabContents.push({
            tabId,
            title,
            content: tabContent,
          });
        });
      }

      // Calculate total content length before pagination
      const totalContentLength =
        fullContent.mainContent.length +
        fullContent.tabs.reduce((sum, tab) => sum + tab.contentLength, 0);

      // Calculate pagination
      const totalPages = Math.ceil(totalContentLength / limit);
      const startPos = page * limit;
      const endPos = startPos + limit;

      // Create a single concatenated string for pagination with opinionated formatting
      let allContentString = fullContent.mainContent;
      tabContents.forEach((tabContent) => {
        allContentString += `\n\nTAB: ${tabContent.title}\n${tabContent.content}`;
      });

      // Apply pagination by character position
      const paginatedContent = allContentString.substring(startPos, endPos);
      const actualContentLength = paginatedContent.length;
      const truncated = totalContentLength > limit || page > 0;

      // Parse the paginated content back into structured format
      const finalOutput = {
        documentId: fullContent.documentId,
        title: fullContent.title,
        mainContent: "",
        tabs: [] as Array<{
          tabId: string;
          title: string;
          content: string;
          contentLength: number;
        }>,
        summary: {
          mainContentLength: fullContent.mainContent.length,
          tabsCount: fullContent.tabs.length,
          totalContentLength,
        },
        pagination: {
          currentPage: page,
          limit,
          totalPages,
          hasNextPage: page < totalPages - 1,
          hasPreviousPage: page > 0,
          actualContentLength,
          truncated,
        },
      };

      // For paginated content, we'll put everything in mainContent for simplicity
      // and indicate which tabs are included in the content
      if (page === 0) {
        // First page: try to include main content and as many tabs as fit
        let currentLength = 0;

        // Add main content if it fits
        if (fullContent.mainContent.length <= limit) {
          finalOutput.mainContent = fullContent.mainContent;
          currentLength += fullContent.mainContent.length;
        } else {
          finalOutput.mainContent = fullContent.mainContent.substring(0, limit);
          currentLength = limit;
        }

        // Add tabs that fit within the limit (with content for display)
        for (let i = 0; i < fullContent.tabs.length; i++) {
          const tab = fullContent.tabs[i];
          const tabContent = tabContents[i];
          const tabHeaderLength = `\n\nTAB: ${tab.title}\n`.length;
          const requiredLength = tabHeaderLength + tab.contentLength;

          if (currentLength + requiredLength <= limit) {
            finalOutput.tabs.push({
              ...tab,
              content: tabContent.content,
            });
            currentLength += requiredLength;
          } else if (currentLength + tabHeaderLength < limit) {
            // Partial tab content
            const remainingLength = limit - currentLength - tabHeaderLength;
            finalOutput.tabs.push({
              ...tab,
              content:
                tabContent.content.substring(0, remainingLength) +
                "... [truncated]",
              contentLength: remainingLength,
            });
            break;
          } else {
            break;
          }
        }
      } else {
        // Subsequent pages: put paginated content in mainContent
        finalOutput.mainContent = paginatedContent;
        if (paginatedContent.length < limit && page < totalPages - 1) {
          finalOutput.mainContent += "... [continued on next page]";
        }
      }

      return finalOutput;
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to read doc with tabs: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async findSection(
    docs: docs_v1.Docs,
    args: FindSectionArgs,
  ): Promise<FindSectionResult> {
    const {
      documentId,
      sectionTitle,
      headingLevel,
      matchInstance = 1,
      returnContent = false,
      contentEndBoundary = "next_heading",
    } = args;

    try {
      const sectionInfo = await GDocsHelpers.findSection(docs, documentId, {
        sectionTitle,
        headingLevel,
        matchInstance,
        returnContent,
        contentEndBoundary,
      });

      if (!sectionInfo) {
        return {
          found: false,
          message: `Section "${sectionTitle}" not found in document.`,
        };
      }

      // Format the response message
      let message = `**Section Found:**\n`;
      message += `Title: "${sectionInfo.title}"\n`;
      message += `Heading Level: ${sectionInfo.headingLevel}\n`;
      message += `Location: Index ${sectionInfo.startIndex}-${sectionInfo.endIndex}\n`;

      if (sectionInfo.content) {
        message += `\n**Section Content:**\n---\n${sectionInfo.content}\n---`;
      }

      return {
        found: true,
        sectionInfo,
        message,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to find section: ${apiError.message || "Unknown error"}`,
      );
    }
  },

  async formatMatchingText(
    docs: docs_v1.Docs,
    args: FormatMatchingTextArgs,
  ): Promise<FormatMatchingTextResult> {
    const { documentId, textToFind, matchInstance = 1, ...styleOptions } = args;

    try {
      // Extract the style parameters from the args
      const styleParams: TextStyleArgs = {};
      if (args.bold !== undefined) styleParams.bold = args.bold;
      if (args.italic !== undefined) styleParams.italic = args.italic;
      if (args.underline !== undefined) styleParams.underline = args.underline;
      if (args.strikethrough !== undefined)
        styleParams.strikethrough = args.strikethrough;
      if (args.fontSize !== undefined) styleParams.fontSize = args.fontSize;
      if (args.fontFamily !== undefined)
        styleParams.fontFamily = args.fontFamily;
      if (args.foregroundColor !== undefined)
        styleParams.foregroundColor = args.foregroundColor;
      if (args.backgroundColor !== undefined)
        styleParams.backgroundColor = args.backgroundColor;
      if (args.linkUrl !== undefined) styleParams.linkUrl = args.linkUrl;

      // Find the text range
      const range = await GDocsHelpers.findTextRange(
        docs,
        documentId,
        textToFind,
        matchInstance,
      );

      if (!range) {
        throw new UserError(
          `Could not find instance ${matchInstance} of text "${textToFind}".`,
        );
      }

      // Build and execute the request
      const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
        range.startIndex,
        range.endIndex,
        styleParams,
      );

      if (!requestInfo) {
        throw new UserError("No valid text styling options were provided.");
      }

      await GDocsHelpers.executeBatchUpdate(docs, documentId, [
        requestInfo.request,
      ]);

      return {
        message: `Successfully applied formatting to instance ${matchInstance} of "${textToFind}".`,
        documentId,
        textToFind,
        matchInstance,
        appliedFields: requestInfo.fields,
      };
    } catch (error: unknown) {
      // Handle errors thrown by helpers or API directly
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Generic fallback for API errors not caught by helpers
      const apiError = error as { code?: number; message?: string };
      if (apiError.code === 404)
        throw new UserError(`Doc not found (ID: ${documentId}).`);
      if (apiError.code === 403)
        throw new UserError(`Permission denied for doc (ID: ${documentId}).`);
      throw new UserError(
        `Failed to format text: ${apiError.message || "Unknown error"}`,
      );
    }
  },
};

// === GOOGLE DRIVE SERVICE ===

// --- Google Drive Interface Definitions ---

export interface ListGoogleDocsArgs {
  maxResults?: number;
  query?: string;
  orderBy?: "name" | "modifiedTime" | "createdTime";
}

export interface ListGoogleDocsResult {
  message: string;
  files: Array<{
    id: string;
    name: string;
    modifiedTime?: string;
    createdTime?: string;
    size?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string; emailAddress?: string }>;
  }>;
}

export interface SearchGoogleDocsArgs {
  searchQuery: string;
  searchIn?: "name" | "content" | "both";
  maxResults?: number;
  modifiedAfter?: string;
}

export interface SearchGoogleDocsResult {
  message: string;
  files: Array<{
    id: string;
    name: string;
    modifiedTime?: string;
    createdTime?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string }>;
    parents?: string[];
  }>;
}

export interface GetRecentGoogleDocsArgs {
  maxResults?: number;
  daysBack?: number;
}

export interface GetRecentGoogleDocsResult {
  message: string;
  files: Array<{
    id: string;
    name: string;
    modifiedTime?: string;
    createdTime?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string }>;
    lastModifyingUser?: { displayName?: string };
  }>;
}

export interface GetDocumentInfoArgs {
  documentId: string;
}

export interface GetDocumentInfoResult {
  message: string;
  fileInfo: {
    id: string;
    name: string;
    description?: string;
    mimeType?: string;
    size?: string;
    createdTime?: string;
    modifiedTime?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string; emailAddress?: string }>;
    lastModifyingUser?: { displayName?: string; emailAddress?: string };
    shared?: boolean;
    permissions?: Array<{
      role?: string;
      type?: string;
      emailAddress?: string;
    }>;
    parents?: string[];
    version?: string;
  };
}

export interface CreateFolderArgs {
  name: string;
  parentFolderId?: string;
}

export interface CreateFolderResult {
  message: string;
  folder: {
    id: string;
    name: string;
    webViewLink?: string;
    parents?: string[];
  };
}

export interface ListFolderContentsArgs {
  folderId: string;
  includeSubfolders?: boolean;
  includeFiles?: boolean;
  maxResults?: number;
}

export interface ListFolderContentsResult {
  message: string;
  folders: Array<{
    id: string;
    name: string;
    mimeType: string;
  }>;
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string }>;
  }>;
}

export interface GetFolderInfoArgs {
  folderId: string;
}

export interface GetFolderInfoResult {
  message: string;
  folderInfo: {
    id: string;
    name: string;
    description?: string;
    createdTime?: string;
    modifiedTime?: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string; emailAddress?: string }>;
    lastModifyingUser?: { displayName?: string };
    shared?: boolean;
    parents?: string[];
  };
}

export interface MoveFileArgs {
  fileId: string;
  newParentId: string;
  removeFromAllParents?: boolean;
}

export interface MoveFileResult {
  message: string;
  file: {
    id: string;
    name: string;
    parents?: string[];
  };
}

export interface CopyFileArgs {
  fileId: string;
  newName?: string;
  parentFolderId?: string;
}

export interface CopyFileResult {
  message: string;
  file: {
    id: string;
    name: string;
    webViewLink?: string;
  };
}

export interface RenameFileArgs {
  fileId: string;
  newName: string;
}

export interface RenameFileResult {
  message: string;
  file: {
    id: string;
    name: string;
    webViewLink?: string;
  };
}

export interface DeleteFileArgs {
  fileId: string;
  skipTrash?: boolean;
}

export interface DeleteFileResult {
  message: string;
  fileName: string;
  isFolder: boolean;
  permanent: boolean;
}

export interface CreateDocumentArgs {
  title: string;
  parentFolderId?: string;
  initialContent?: string;
}

export interface CreateDocumentResult {
  message: string;
  document: {
    id: string;
    name: string;
    webViewLink?: string;
  };
}

export interface CreateFromTemplateArgs {
  templateId: string;
  newTitle: string;
  parentFolderId?: string;
  replacements?: Record<string, string>;
}

export interface CreateFromTemplateResult {
  message: string;
  document: {
    id: string;
    name: string;
    webViewLink?: string;
  };
  replacementsApplied: number;
}

// --- Google Drive Service Implementation ---

export const GoogleDriveService = {
  async listGoogleDocs(
    drive: drive_v3.Drive,
    args: ListGoogleDocsArgs,
  ): Promise<ListGoogleDocsResult> {
    const { maxResults = 20, query, orderBy = "modifiedTime" } = args;

    try {
      // Build the query string for Google Drive API
      let queryString =
        "mimeType='application/vnd.google-apps.document' and trashed=false";
      if (query) {
        queryString += ` and (name contains '${query}' or fullText contains '${query}')`;
      }

      const response = await drive.files.list({
        q: queryString,
        pageSize: maxResults,
        orderBy: orderBy === "name" ? "name" : orderBy,
        fields:
          "files(id,name,modifiedTime,createdTime,size,webViewLink,owners(displayName,emailAddress))",
      });

      const files = response.data.files || [];

      if (files.length === 0) {
        return {
          message: "No Google Docs found matching your criteria.",
          files: [],
        };
      }

      let message = `Found ${files.length} Google Document(s):\n\n`;
      files.forEach((file, index) => {
        const modifiedDate = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleDateString()
          : "Unknown";
        const owner = file.owners?.[0]?.displayName || "Unknown";
        message += `${index + 1}. **${file.name}**\n`;
        message += `   ID: ${file.id}\n`;
        message += `   Modified: ${modifiedDate}\n`;
        message += `   Owner: ${owner}\n`;
        message += `   Link: ${file.webViewLink}\n\n`;
      });

      return {
        message,
        files: files.map((file) => ({
          id: file.id!,
          name: file.name!,
          modifiedTime: file.modifiedTime || undefined,
          createdTime: file.createdTime || undefined,
          size: file.size || undefined,
          webViewLink: file.webViewLink || undefined,
          owners:
            file.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
              emailAddress: owner.emailAddress || undefined,
            })) || undefined,
        })),
      };
    } catch (error: any) {
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have granted Google Drive access to the application.",
        );
      throw new UserError(
        `Failed to list documents: ${error.message || "Unknown error"}`,
      );
    }
  },

  async searchGoogleDocs(
    drive: drive_v3.Drive,
    args: SearchGoogleDocsArgs,
  ): Promise<SearchGoogleDocsResult> {
    const {
      searchQuery,
      searchIn = "both",
      maxResults = 10,
      modifiedAfter,
    } = args;

    try {
      let queryString =
        "mimeType='application/vnd.google-apps.document' and trashed=false";

      // Add search criteria
      if (searchIn === "name") {
        queryString += ` and name contains '${searchQuery}'`;
      } else if (searchIn === "content") {
        queryString += ` and fullText contains '${searchQuery}'`;
      } else {
        queryString += ` and (name contains '${searchQuery}' or fullText contains '${searchQuery}')`;
      }

      // Add date filter if provided
      if (modifiedAfter) {
        queryString += ` and modifiedTime > '${modifiedAfter}'`;
      }

      const response = await drive.files.list({
        q: queryString,
        pageSize: maxResults,
        orderBy: "modifiedTime desc",
        fields:
          "files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName),parents)",
      });

      const files = response.data.files || [];

      if (files.length === 0) {
        return {
          message: `No Google Docs found containing "${searchQuery}".`,
          files: [],
        };
      }

      let message = `Found ${files.length} document(s) matching "${searchQuery}":\n\n`;
      files.forEach((file, index) => {
        const modifiedDate = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleDateString()
          : "Unknown";
        const owner = file.owners?.[0]?.displayName || "Unknown";
        message += `${index + 1}. **${file.name}**\n`;
        message += `   ID: ${file.id}\n`;
        message += `   Modified: ${modifiedDate}\n`;
        message += `   Owner: ${owner}\n`;
        message += `   Link: ${file.webViewLink}\n\n`;
      });

      return {
        message,
        files: files.map((file) => ({
          id: file.id!,
          name: file.name!,
          modifiedTime: file.modifiedTime || undefined,
          createdTime: file.createdTime || undefined,
          webViewLink: file.webViewLink || undefined,
          owners:
            file.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
            })) || undefined,
          parents: file.parents || undefined,
        })),
      };
    } catch (error: any) {
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have granted Google Drive access to the application.",
        );
      throw new UserError(
        `Failed to search documents: ${error.message || "Unknown error"}`,
      );
    }
  },

  async getRecentGoogleDocs(
    drive: drive_v3.Drive,
    args: GetRecentGoogleDocsArgs,
  ): Promise<GetRecentGoogleDocsResult> {
    const { maxResults = 10, daysBack = 30 } = args;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      const cutoffDateStr = cutoffDate.toISOString();

      const queryString = `mimeType='application/vnd.google-apps.document' and trashed=false and modifiedTime > '${cutoffDateStr}'`;

      const response = await drive.files.list({
        q: queryString,
        pageSize: maxResults,
        orderBy: "modifiedTime desc",
        fields:
          "files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName),lastModifyingUser(displayName))",
      });

      const files = response.data.files || [];

      if (files.length === 0) {
        return {
          message: `No Google Docs found that were modified in the last ${daysBack} days.`,
          files: [],
        };
      }

      let message = `${files.length} recently modified Google Document(s) (last ${daysBack} days):\n\n`;
      files.forEach((file, index) => {
        const modifiedDate = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleString()
          : "Unknown";
        const lastModifier = file.lastModifyingUser?.displayName || "Unknown";
        const owner = file.owners?.[0]?.displayName || "Unknown";

        message += `${index + 1}. **${file.name}**\n`;
        message += `   ID: ${file.id}\n`;
        message += `   Last Modified: ${modifiedDate} by ${lastModifier}\n`;
        message += `   Owner: ${owner}\n`;
        message += `   Link: ${file.webViewLink}\n\n`;
      });

      return {
        message,
        files: files.map((file) => ({
          id: file.id!,
          name: file.name!,
          modifiedTime: file.modifiedTime || undefined,
          createdTime: file.createdTime || undefined,
          webViewLink: file.webViewLink || undefined,
          owners:
            file.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
            })) || undefined,
          lastModifyingUser: file.lastModifyingUser
            ? {
                displayName: file.lastModifyingUser.displayName || undefined,
              }
            : undefined,
        })),
      };
    } catch (error: any) {
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have granted Google Drive access to the application.",
        );
      throw new UserError(
        `Failed to get recent documents: ${error.message || "Unknown error"}`,
      );
    }
  },

  async getDocumentInfo(
    drive: drive_v3.Drive,
    args: GetDocumentInfoArgs,
  ): Promise<GetDocumentInfoResult> {
    const { documentId } = args;

    try {
      const response = await drive.files.get({
        fileId: documentId,
        fields:
          "id,name,description,mimeType,size,createdTime,modifiedTime,webViewLink,alternateLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),shared,permissions(role,type,emailAddress),parents,version",
      });

      const file = response.data;

      if (!file) {
        throw new UserError(`Document with ID ${documentId} not found.`);
      }

      const createdDate = file.createdTime
        ? new Date(file.createdTime).toLocaleString()
        : "Unknown";
      const modifiedDate = file.modifiedTime
        ? new Date(file.modifiedTime).toLocaleString()
        : "Unknown";
      const owner = file.owners?.[0];
      const lastModifier = file.lastModifyingUser;

      let message = `**Document Information:**\n\n`;
      message += `**Name:** ${file.name}\n`;
      message += `**ID:** ${file.id}\n`;
      message += `**Type:** Google Document\n`;
      message += `**Created:** ${createdDate}\n`;
      message += `**Last Modified:** ${modifiedDate}\n`;

      if (owner) {
        message += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
      }

      if (lastModifier) {
        message += `**Last Modified By:** ${lastModifier.displayName} (${lastModifier.emailAddress})\n`;
      }

      message += `**Shared:** ${file.shared ? "Yes" : "No"}\n`;
      message += `**View Link:** ${file.webViewLink}\n`;

      if (file.description) {
        message += `**Description:** ${file.description}\n`;
      }

      return {
        message,
        fileInfo: {
          id: file.id!,
          name: file.name!,
          description: file.description || undefined,
          mimeType: file.mimeType || undefined,
          size: file.size || undefined,
          createdTime: file.createdTime || undefined,
          modifiedTime: file.modifiedTime || undefined,
          webViewLink: file.webViewLink || undefined,
          owners:
            file.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
              emailAddress: owner.emailAddress || undefined,
            })) || undefined,
          lastModifyingUser: file.lastModifyingUser
            ? {
                displayName: file.lastModifyingUser.displayName || undefined,
                emailAddress: file.lastModifyingUser.emailAddress || undefined,
              }
            : undefined,
          shared: file.shared || undefined,
          permissions:
            file.permissions?.map((permission) => ({
              role: permission.role || undefined,
              type: permission.type || undefined,
              emailAddress: permission.emailAddress || undefined,
            })) || undefined,
          parents: file.parents || undefined,
          version: file.version || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(`Document not found (ID: ${documentId}).`);
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have access to this document.",
        );
      throw new UserError(
        `Failed to get document info: ${error.message || "Unknown error"}`,
      );
    }
  },

  async createFolder(
    drive: drive_v3.Drive,
    args: CreateFolderArgs,
  ): Promise<CreateFolderResult> {
    const { name, parentFolderId } = args;

    try {
      const folderMetadata: drive_v3.Schema$File = {
        name: name,
        mimeType: "application/vnd.google-apps.folder",
      };

      if (parentFolderId) {
        folderMetadata.parents = [parentFolderId];
      }

      const response = await drive.files.create({
        requestBody: folderMetadata,
        fields: "id,name,parents,webViewLink",
      });

      const folder = response.data;
      const message = `Successfully created folder "${folder.name}" (ID: ${folder.id})\nLink: ${folder.webViewLink}`;

      return {
        message,
        folder: {
          id: folder.id!,
          name: folder.name!,
          webViewLink: folder.webViewLink || undefined,
          parents: folder.parents || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(
          "Parent folder not found. Check the parent folder ID.",
        );
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have write access to the parent folder.",
        );
      throw new UserError(
        `Failed to create folder: ${error.message || "Unknown error"}`,
      );
    }
  },

  async listFolderContents(
    drive: drive_v3.Drive,
    args: ListFolderContentsArgs,
  ): Promise<ListFolderContentsResult> {
    const {
      folderId,
      includeSubfolders = true,
      includeFiles = true,
      maxResults = 50,
    } = args;

    try {
      let queryString = `'${folderId}' in parents and trashed=false`;

      // Filter by type if specified
      if (!includeSubfolders && !includeFiles) {
        throw new UserError(
          "At least one of includeSubfolders or includeFiles must be true.",
        );
      }

      if (!includeSubfolders) {
        queryString += ` and mimeType!='application/vnd.google-apps.folder'`;
      } else if (!includeFiles) {
        queryString += ` and mimeType='application/vnd.google-apps.folder'`;
      }

      const response = await drive.files.list({
        q: queryString,
        pageSize: maxResults,
        orderBy: "folder,name",
        fields:
          "files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName))",
      });

      const items = response.data.files || [];

      if (items.length === 0) {
        return {
          message:
            "The folder is empty or you don't have permission to view its contents.",
          folders: [],
          files: [],
        };
      }

      // Separate folders and files
      const folders = items.filter(
        (item) => item.mimeType === "application/vnd.google-apps.folder",
      );
      const files = items.filter(
        (item) => item.mimeType !== "application/vnd.google-apps.folder",
      );

      let message = `Contents of folder (${items.length} item${items.length !== 1 ? "s" : ""}):\n\n`;

      // List folders first
      if (folders.length > 0 && includeSubfolders) {
        message += `**Folders (${folders.length}):**\n`;
        folders.forEach((folder) => {
          message += `📁 ${folder.name} (ID: ${folder.id})\n`;
        });
        message += "\n";
      }

      // Then list files
      if (files.length > 0 && includeFiles) {
        message += `**Files (${files.length}):**\n`;
        files.forEach((file) => {
          const fileType =
            file.mimeType === "application/vnd.google-apps.document"
              ? "📄"
              : file.mimeType === "application/vnd.google-apps.spreadsheet"
                ? "📊"
                : file.mimeType === "application/vnd.google-apps.presentation"
                  ? "📈"
                  : "📎";
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : "Unknown";
          const owner = file.owners?.[0]?.displayName || "Unknown";

          message += `${fileType} ${file.name}\n`;
          message += `   ID: ${file.id}\n`;
          message += `   Modified: ${modifiedDate} by ${owner}\n`;
          message += `   Link: ${file.webViewLink}\n\n`;
        });
      }

      return {
        message,
        folders: folders.map((folder) => ({
          id: folder.id!,
          name: folder.name!,
          mimeType: folder.mimeType!,
        })),
        files: files.map((file) => ({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          size: file.size || undefined,
          modifiedTime: file.modifiedTime || undefined,
          webViewLink: file.webViewLink || undefined,
          owners:
            file.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
            })) || undefined,
        })),
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError("Folder not found. Check the folder ID.");
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have access to this folder.",
        );
      throw new UserError(
        `Failed to list folder contents: ${error.message || "Unknown error"}`,
      );
    }
  },

  async getFolderInfo(
    drive: drive_v3.Drive,
    args: GetFolderInfoArgs,
  ): Promise<GetFolderInfoResult> {
    const { folderId } = args;

    try {
      const response = await drive.files.get({
        fileId: folderId,
        fields:
          "id,name,description,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName),shared,parents",
      });

      const folder = response.data;

      if (folder.mimeType !== "application/vnd.google-apps.folder") {
        throw new UserError("The specified ID does not belong to a folder.");
      }

      const createdDate = folder.createdTime
        ? new Date(folder.createdTime).toLocaleString()
        : "Unknown";
      const modifiedDate = folder.modifiedTime
        ? new Date(folder.modifiedTime).toLocaleString()
        : "Unknown";
      const owner = folder.owners?.[0];
      const lastModifier = folder.lastModifyingUser;

      let message = `**Folder Information:**\n\n`;
      message += `**Name:** ${folder.name}\n`;
      message += `**ID:** ${folder.id}\n`;
      message += `**Created:** ${createdDate}\n`;
      message += `**Last Modified:** ${modifiedDate}\n`;

      if (owner) {
        message += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
      }

      if (lastModifier) {
        message += `**Last Modified By:** ${lastModifier.displayName}\n`;
      }

      message += `**Shared:** ${folder.shared ? "Yes" : "No"}\n`;
      message += `**View Link:** ${folder.webViewLink}\n`;

      if (folder.description) {
        message += `**Description:** ${folder.description}\n`;
      }

      if (folder.parents && folder.parents.length > 0) {
        message += `**Parent Folder ID:** ${folder.parents[0]}\n`;
      }

      return {
        message,
        folderInfo: {
          id: folder.id!,
          name: folder.name!,
          description: folder.description || undefined,
          createdTime: folder.createdTime || undefined,
          modifiedTime: folder.modifiedTime || undefined,
          webViewLink: folder.webViewLink || undefined,
          owners:
            folder.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
              emailAddress: owner.emailAddress || undefined,
            })) || undefined,
          lastModifyingUser: folder.lastModifyingUser
            ? {
                displayName: folder.lastModifyingUser.displayName || undefined,
              }
            : undefined,
          shared: folder.shared || undefined,
          parents: folder.parents || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(`Folder not found (ID: ${folderId}).`);
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have access to this folder.",
        );
      throw new UserError(
        `Failed to get folder info: ${error.message || "Unknown error"}`,
      );
    }
  },

  async moveFile(
    drive: drive_v3.Drive,
    args: MoveFileArgs,
  ): Promise<MoveFileResult> {
    const { fileId, newParentId, removeFromAllParents = false } = args;

    try {
      // First get the current parents
      const fileInfo = await drive.files.get({
        fileId: fileId,
        fields: "name,parents",
      });

      const fileName = fileInfo.data.name;
      const currentParents = fileInfo.data.parents || [];

      let updateParams: any = {
        fileId: fileId,
        addParents: newParentId,
        fields: "id,name,parents",
      };

      if (removeFromAllParents && currentParents.length > 0) {
        updateParams.removeParents = currentParents.join(",");
      }

      const response = await drive.files.update(updateParams);

      const action = removeFromAllParents ? "moved" : "copied";
      const message = `Successfully ${action} "${fileName}" to new location.\nFile ID: ${response.data.id}`;

      return {
        message,
        file: {
          id: response.data.id!,
          name: response.data.name!,
          parents: response.data.parents || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(
          "File or destination folder not found. Check the IDs.",
        );
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have write access to both source and destination.",
        );
      throw new UserError(
        `Failed to move file: ${error.message || "Unknown error"}`,
      );
    }
  },

  async copyFile(
    drive: drive_v3.Drive,
    args: CopyFileArgs,
  ): Promise<CopyFileResult> {
    const { fileId, newName, parentFolderId } = args;

    try {
      // Get original file info
      const originalFile = await drive.files.get({
        fileId: fileId,
        fields: "name,parents",
      });

      const copyMetadata: drive_v3.Schema$File = {
        name: newName || `Copy of ${originalFile.data.name}`,
      };

      if (parentFolderId) {
        copyMetadata.parents = [parentFolderId];
      } else if (originalFile.data.parents) {
        copyMetadata.parents = originalFile.data.parents;
      }

      const response = await drive.files.copy({
        fileId: fileId,
        requestBody: copyMetadata,
        fields: "id,name,webViewLink",
      });

      const copiedFile = response.data;
      const message = `Successfully created copy "${copiedFile.name}" (ID: ${copiedFile.id})\nLink: ${copiedFile.webViewLink}`;

      return {
        message,
        file: {
          id: copiedFile.id!,
          name: copiedFile.name!,
          webViewLink: copiedFile.webViewLink || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(
          "Original file or destination folder not found. Check the IDs.",
        );
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have read access to the original file and write access to the destination.",
        );
      throw new UserError(
        `Failed to copy file: ${error.message || "Unknown error"}`,
      );
    }
  },

  async renameFile(
    drive: drive_v3.Drive,
    args: RenameFileArgs,
  ): Promise<RenameFileResult> {
    const { fileId, newName } = args;

    try {
      const response = await drive.files.update({
        fileId: fileId,
        requestBody: {
          name: newName,
        },
        fields: "id,name,webViewLink",
      });

      const file = response.data;
      const message = `Successfully renamed to "${file.name}" (ID: ${file.id})\nLink: ${file.webViewLink}`;

      return {
        message,
        file: {
          id: file.id!,
          name: file.name!,
          webViewLink: file.webViewLink || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError("File not found. Check the file ID.");
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have write access to this file.",
        );
      throw new UserError(
        `Failed to rename file: ${error.message || "Unknown error"}`,
      );
    }
  },

  async deleteFile(
    drive: drive_v3.Drive,
    args: DeleteFileArgs,
  ): Promise<DeleteFileResult> {
    const { fileId, skipTrash = false } = args;

    try {
      // Get file info before deletion
      const fileInfo = await drive.files.get({
        fileId: fileId,
        fields: "name,mimeType",
      });

      const fileName = fileInfo.data.name!;
      const isFolder =
        fileInfo.data.mimeType === "application/vnd.google-apps.folder";

      let message: string;
      if (skipTrash) {
        await drive.files.delete({
          fileId: fileId,
        });
        message = `Permanently deleted ${isFolder ? "folder" : "file"} "${fileName}".`;
      } else {
        await drive.files.update({
          fileId: fileId,
          requestBody: {
            trashed: true,
          },
        });
        message = `Moved ${isFolder ? "folder" : "file"} "${fileName}" to trash. It can be restored from the trash.`;
      }

      return {
        message,
        fileName,
        isFolder,
        permanent: skipTrash,
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError("File not found. Check the file ID.");
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have delete access to this file.",
        );
      throw new UserError(
        `Failed to delete file: ${error.message || "Unknown error"}`,
      );
    }
  },

  async createDocument(
    drive: drive_v3.Drive,
    args: CreateDocumentArgs,
  ): Promise<CreateDocumentResult> {
    const { title, parentFolderId, initialContent } = args;

    try {
      const documentMetadata: drive_v3.Schema$File = {
        name: title,
        mimeType: "application/vnd.google-apps.document",
      };

      if (parentFolderId) {
        documentMetadata.parents = [parentFolderId];
      }

      const response = await drive.files.create({
        requestBody: documentMetadata,
        fields: "id,name,webViewLink",
      });

      const document = response.data;
      let message = `Successfully created document "${document.name}" (ID: ${document.id})\nView Link: ${document.webViewLink}`;

      // Add initial content if provided
      if (initialContent) {
        try {
          // This would require a docs client, but since we're in the drive service,
          // we'll just note that it would need to be handled at the server level
          message += `\n\nNote: Initial content would be added separately using the Google Docs API.`;
        } catch (contentError: any) {
          message += `\n\nDocument created but failed to add initial content. You can add content manually.`;
        }
      }

      return {
        message,
        document: {
          id: document.id!,
          name: document.name!,
          webViewLink: document.webViewLink || undefined,
        },
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError("Parent folder not found. Check the folder ID.");
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have write access to the destination folder.",
        );
      throw new UserError(
        `Failed to create document: ${error.message || "Unknown error"}`,
      );
    }
  },

  async createFromTemplate(
    drive: drive_v3.Drive,
    args: CreateFromTemplateArgs,
  ): Promise<CreateFromTemplateResult> {
    const { templateId, newTitle, parentFolderId, replacements } = args;

    try {
      // First copy the template
      const copyMetadata: drive_v3.Schema$File = {
        name: newTitle,
      };

      if (parentFolderId) {
        copyMetadata.parents = [parentFolderId];
      }

      const response = await drive.files.copy({
        fileId: templateId,
        requestBody: copyMetadata,
        fields: "id,name,webViewLink",
      });

      const document = response.data;
      let message = `Successfully created document "${document.name}" from template (ID: ${document.id})\nView Link: ${document.webViewLink}`;

      const replacementsCount = replacements
        ? Object.keys(replacements).length
        : 0;

      // Apply text replacements if provided
      if (replacements && replacementsCount > 0) {
        // This would require a docs client, but since we're in the drive service,
        // we'll just note that it would need to be handled at the server level
        message += `\n\nNote: ${replacementsCount} text replacement${replacementsCount !== 1 ? "s" : ""} would be applied separately using the Google Docs API.`;
      }

      return {
        message,
        document: {
          id: document.id!,
          name: document.name!,
          webViewLink: document.webViewLink || undefined,
        },
        replacementsApplied: replacementsCount,
      };
    } catch (error: any) {
      if (error.code === 404)
        throw new UserError(
          "Template document or parent folder not found. Check the IDs.",
        );
      if (error.code === 403)
        throw new UserError(
          "Permission denied. Make sure you have read access to the template and write access to the destination folder.",
        );
      throw new UserError(
        `Failed to create document from template: ${error.message || "Unknown error"}`,
      );
    }
  },
};

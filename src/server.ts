// src/server.ts
import { FastMCP, UserError } from "fastmcp"
import { OAuth2Client } from "google-auth-library"
import { docs_v1, drive_v3, google } from "googleapis"
import { z } from "zod"

import { authorize } from "./auth.js"
import * as GDocsHelpers from "./googleDocsApiHelpers.js"
import { GoogleDocService, GoogleDriveService } from "./service.js"
import {
  ApplyParagraphStyleToolArgs,
  ApplyParagraphStyleToolParameters,
  ApplyTextStyleToolArgs,
  ApplyTextStyleToolParameters,
  DocumentIdParameter,
  NotImplementedError,
  OptionalRangeParameters,
  ParagraphStyleArgs,
  ParagraphStyleParameters,
  RangeParameters,
  SectionFindParameter,
  TextFindParameter,
  TextStyleArgs,
  TextStyleParameters,
} from "./types.js"

// Import types and helpers
let authClient: OAuth2Client | null = null;
let googleDocs: docs_v1.Docs | null = null;
let googleDrive: drive_v3.Drive | null = null;

// --- Initialization ---
async function initializeGoogleClient() {
  if (googleDocs && googleDrive) return { authClient, googleDocs, googleDrive };
  if (!authClient) {
    // Check authClient instead of googleDocs to allow re-attempt
    try {
      console.error("Attempting to authorize Google API client...");
      const client = await authorize();
      authClient = client; // Assign client here
      googleDocs = google.docs({ version: "v1", auth: authClient });
      googleDrive = google.drive({ version: "v3", auth: authClient });
      console.error("Google API client authorized successfully.");
    } catch (error) {
      console.error("FATAL: Failed to initialize Google API client:", error);
      authClient = null; // Reset on failure
      googleDocs = null;
      googleDrive = null;
      // Decide if server should exit or just fail tools
      throw new Error(
        "Google client initialization failed. Cannot start server tools.",
      );
    }
  }
  // Ensure googleDocs and googleDrive are set if authClient is valid
  if (authClient && !googleDocs) {
    googleDocs = google.docs({ version: "v1", auth: authClient });
  }
  if (authClient && !googleDrive) {
    googleDrive = google.drive({ version: "v3", auth: authClient });
  }

  if (!googleDocs || !googleDrive) {
    throw new Error("Google Docs and Drive clients could not be initialized.");
  }

  return { authClient, googleDocs, googleDrive };
}

// Set up process-level unhandled error/rejection handlers to prevent crashes
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit process, just log the error and continue
  // This will catch timeout errors that might otherwise crash the server
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Promise Rejection:", reason);
  // Don't exit process, just log the error and continue
});

const server = new FastMCP({
  name: "Ultimate Google Docs MCP Server",
  version: "1.0.0",
});

// --- Helper to get Docs client within tools ---
async function getDocsClient() {
  const { googleDocs: docs } = await initializeGoogleClient();
  if (!docs) {
    throw new UserError(
      "Google Docs client is not initialized. Authentication might have failed during startup or lost connection.",
    );
  }
  return docs;
}

// --- Helper to get Drive client within tools ---
async function getDriveClient() {
  const { googleDrive: drive } = await initializeGoogleClient();
  if (!drive) {
    throw new UserError(
      "Google Drive client is not initialized. Authentication might have failed during startup or lost connection.",
    );
  }
  return drive;
}

// === TOOL DEFINITIONS ===

// --- Foundational Tools ---

server.addTool({
  name: "readGoogleDoc",
  description:
    "Reads the content of a specific Google Document, optionally returning structured data. Can filter by tab ID or return all content structured by tabs. Supports pagination for large documents.",
  parameters: DocumentIdParameter.extend({
    format: z
      .enum(["text", "json", "markdown"])
      .optional()
      .default("text")
      .describe(
        "Output format: 'text' (plain text, possibly truncated), 'json' (raw API structure, complex), 'markdown' (experimental conversion).",
      ),
    tabId: z
      .string()
      .optional()
      .describe(
        "Optional: Filter to only return content from a specific tab. If not provided, returns structured output with both main content and all tabs.",
      ),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe(
        "Optional: Page number for pagination (0-based). Default is 0.",
      ),
    limit: z
      .number()
      .int()
      .min(1000)
      .max(50000)
      .optional()
      .default(20000)
      .describe(
        "Optional: Maximum number of characters to return per page. Default is 20,000. Range: 1,000-50,000.",
      ),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Reading Google Doc: ${args.documentId}, Format: ${args.format}, Tab ID: ${args.tabId || "none"}, Page: ${args.page}, Limit: ${args.limit}`,
    );

    try {
      // Use the tabs function with pagination parameters
      const result = await GoogleDocService.readGoogleDocWithTabs(docs, {
        documentId: args.documentId,
        includeTabsContent: true,
        page: args.page,
        limit: args.limit,
      });
      
      log.info(`Fetched doc: ${args.documentId} (Page ${result.pagination.currentPage + 1}/${result.pagination.totalPages})`);

      // Handle specific tab filtering if tabId is provided
      if (args.tabId) {
        const targetTab = result.tabs.find(tab => tab.tabId === args.tabId);
        if (!targetTab) {
          throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
        }
        
        let output = `**TAB: ${targetTab.title}**\n\n${targetTab.content}`;
        
        // Add pagination info for tab content
        if (result.pagination.truncated) {
          output += `\n\n**Pagination Info:**\n`;
          output += `- Page: ${result.pagination.currentPage + 1} of ${result.pagination.totalPages}\n`;
          output += `- Content length: ${result.pagination.actualContentLength} characters\n`;
          if (result.pagination.hasNextPage) {
            output += `- Use page=${result.pagination.currentPage + 1} to see more content\n`;
          }
        }
        
        return output;
      }

      // Structure the output for better readability with pagination info
      let output = `**Document: "${result.title}"**\n\n`;
      
      // Add pagination header if applicable
      if (result.pagination.totalPages > 1) {
        output += `**📄 Page ${result.pagination.currentPage + 1} of ${result.pagination.totalPages}**\n`;
        output += `Content: ${result.pagination.actualContentLength}/${result.summary.totalContentLength} characters\n\n`;
      }

      if (result.mainContent.trim()) {
        output += `**Main Content:**\n${result.mainContent}\n\n`;
      }

      if (result.tabs.length > 0) {
        output += `**Tabs (${result.tabs.length} shown):**\n`;
        result.tabs.forEach((tab, index) => {
          output += `\n**TAB: ${tab.title} (${tab.contentLength} chars)**\n`;
          if (tab.content.trim()) {
            output += `${tab.content}\n`;
          } else {
            output += `[Empty tab]\n`;
          }
        });
      }

      // Add pagination footer
      if (result.pagination.totalPages > 1) {
        output += `\n**📖 Navigation:**\n`;
        if (result.pagination.hasPreviousPage) {
          output += `- Previous: Use page=${result.pagination.currentPage - 1}\n`;
        }
        if (result.pagination.hasNextPage) {
          output += `- Next: Use page=${result.pagination.currentPage + 1}\n`;
        }
        output += `- Total pages: ${result.pagination.totalPages}\n`;
        output += `- Document summary: ${result.summary.mainContentLength} main + ${result.summary.tabsCount} tabs = ${result.summary.totalContentLength} total characters\n`;
      }

      return output;
    } catch (error: unknown) {
      const apiError = error as { message?: string };
      log.error(
        `Error reading doc ${args.documentId}: ${apiError.message || error}`,
      );
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "appendToGoogleDoc",
  description: "Appends text to the very end of a specific Google Document.",
  parameters: DocumentIdParameter.extend({
    textToAppend: z.string().min(1).describe("The text to add to the end."),
    addNewlineIfNeeded: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Automatically add a newline before the appended text if the doc doesn't end with one.",
      ),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(`Appending to Google Doc: ${args.documentId}`);

    try {
      const result = await GoogleDocService.appendToGoogleDoc(docs, args);
      log.info(`Successfully appended to doc: ${args.documentId}`);
      return result.message;
    } catch (error: any) {
      log.error(
        `Error appending to doc ${args.documentId}: ${error.message || error}`,
      );
      throw error; // Re-throw errors from service (already properly formatted)
    }
  },
});

server.addTool({
  name: "insertText",
  description: "Inserts text at a specific index within the document body.",
  parameters: DocumentIdParameter.extend({
    textToInsert: z.string().min(1).describe("The text to insert."),
    index: z
      .number()
      .int()
      .min(1)
      .describe("The index (1-based) where the text should be inserted."),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(`Inserting text in doc ${args.documentId} at index ${args.index}`);
    try {
      const result = await GoogleDocService.insertText(docs, args);
      return result.message;
    } catch (error: any) {
      log.error(
        `Error inserting text in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      throw new UserError(
        `Failed to insert text: ${error.message || "Unknown error"}`,
      );
    }
  },
});

server.addTool({
  name: "deleteRange",
  description:
    "Deletes content within a specified range (start index inclusive, end index exclusive).",
  parameters: DocumentIdParameter.extend({
    startIndex: z
      .number()
      .int()
      .min(1)
      .describe(
        "The starting index of the text range (inclusive, starts from 1).",
      ),
    endIndex: z
      .number()
      .int()
      .min(1)
      .describe("The ending index of the text range (exclusive)."),
  }).refine((data) => data.endIndex > data.startIndex, {
    message: "endIndex must be greater than startIndex",
    path: ["endIndex"],
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Deleting range ${args.startIndex}-${args.endIndex} in doc ${args.documentId}`,
    );
    if (args.endIndex <= args.startIndex) {
      throw new UserError(
        "End index must be greater than start index for deletion.",
      );
    }
    try {
      const request: docs_v1.Schema$Request = {
        deleteContentRange: {
          range: { startIndex: args.startIndex, endIndex: args.endIndex },
        },
      };
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
      return `Successfully deleted content in range ${args.startIndex}-${args.endIndex}.`;
    } catch (error: any) {
      log.error(
        `Error deleting range in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      throw new UserError(
        `Failed to delete range: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// --- Advanced Formatting & Styling Tools ---

server.addTool({
  name: "applyTextStyle",
  description:
    "Applies character-level formatting (bold, color, font, etc.) to a specific range or found text.",
  parameters: ApplyTextStyleToolParameters,
  execute: async (args: ApplyTextStyleToolArgs, { log }) => {
    const docs = await getDocsClient();

    log.info(
      `Applying text style in doc ${args.documentId}. Target: ${JSON.stringify(args.target)}, Style: ${JSON.stringify(args.style)}`,
    );

    try {
      const result = await GoogleDocService.applyTextStyle(docs, args);
      log.info(
        `Successfully applied text style to range ${result.startIndex}-${result.endIndex}`,
      );
      return result.message;
    } catch (error: any) {
      log.error(
        `Error applying text style in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;
      throw new UserError(
        `Failed to apply text style: ${error.message || "Unknown error"}`,
      );
    }
  },
});

server.addTool({
  name: "applyParagraphStyle",
  description:
    "Applies paragraph-level formatting (alignment, spacing, named styles like Heading 1) to the paragraph(s) containing specific text, an index, or a range.",
  parameters: ApplyParagraphStyleToolParameters,
  execute: async (args: ApplyParagraphStyleToolArgs, { log }) => {
    const docs = await getDocsClient();
    let startIndex: number | undefined;
    let endIndex: number | undefined;

    log.info(`Applying paragraph style to document ${args.documentId}`);
    log.info(`Style options: ${JSON.stringify(args.style)}`);
    log.info(`Target specification: ${JSON.stringify(args.target)}`);

    try {
      // STEP 1: Determine the target paragraph's range based on the targeting method
      if ("textToFind" in args.target) {
        // Find the text first
        log.info(
          `Finding text "${args.target.textToFind}" (instance ${args.target.matchInstance || 1})`,
        );
        const textRange = await GDocsHelpers.findTextRange(
          docs,
          args.documentId,
          args.target.textToFind,
          args.target.matchInstance || 1,
        );

        if (!textRange) {
          throw new UserError(
            `Could not find "${args.target.textToFind}" in the document.`,
          );
        }

        log.info(
          `Found text at range ${textRange.startIndex}-${textRange.endIndex}, now locating containing paragraph`,
        );

        // Then find the paragraph containing this text
        const paragraphRange = await GDocsHelpers.getParagraphRange(
          docs,
          args.documentId,
          textRange.startIndex,
        );

        if (!paragraphRange) {
          throw new UserError(
            `Found the text but could not determine the paragraph boundaries.`,
          );
        }

        startIndex = paragraphRange.startIndex;
        endIndex = paragraphRange.endIndex;
        log.info(
          `Text is contained within paragraph at range ${startIndex}-${endIndex}`,
        );
      } else if ("indexWithinParagraph" in args.target) {
        // Find paragraph containing the specified index
        log.info(
          `Finding paragraph containing index ${args.target.indexWithinParagraph}`,
        );
        const paragraphRange = await GDocsHelpers.getParagraphRange(
          docs,
          args.documentId,
          args.target.indexWithinParagraph,
        );

        if (!paragraphRange) {
          throw new UserError(
            `Could not find paragraph containing index ${args.target.indexWithinParagraph}.`,
          );
        }

        startIndex = paragraphRange.startIndex;
        endIndex = paragraphRange.endIndex;
        log.info(`Located paragraph at range ${startIndex}-${endIndex}`);
      } else if ("startIndex" in args.target && "endIndex" in args.target) {
        // Use directly provided range
        startIndex = args.target.startIndex;
        endIndex = args.target.endIndex;
        log.info(`Using provided paragraph range ${startIndex}-${endIndex}`);
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
      log.info(
        `Building paragraph style request for range ${startIndex}-${endIndex}`,
      );
      const requestInfo = GDocsHelpers.buildUpdateParagraphStyleRequest(
        startIndex,
        endIndex,
        args.style,
      );

      if (!requestInfo) {
        return "No valid paragraph styling options were provided.";
      }

      log.info(`Applying styles: ${requestInfo.fields.join(", ")}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        requestInfo.request,
      ]);

      return `Successfully applied paragraph styles (${requestInfo.fields.join(", ")}) to the paragraph.`;
    } catch (error: any) {
      // Detailed error logging
      log.error(`Error applying paragraph style in doc ${args.documentId}:`);
      log.error(error.stack || error.message || error);

      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;

      // Provide a more helpful error message
      throw new UserError(
        `Failed to apply paragraph style: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// --- Structure & Content Tools ---

server.addTool({
  name: "insertTable",
  description:
    "Inserts a new table with the specified dimensions at a given index.",
  parameters: DocumentIdParameter.extend({
    rows: z.number().int().min(1).describe("Number of rows for the new table."),
    columns: z
      .number()
      .int()
      .min(1)
      .describe("Number of columns for the new table."),
    index: z
      .number()
      .int()
      .min(1)
      .describe("The index (1-based) where the table should be inserted."),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Inserting ${args.rows}x${args.columns} table in doc ${args.documentId} at index ${args.index}`,
    );
    try {
      await GDocsHelpers.createTable(
        docs,
        args.documentId,
        args.rows,
        args.columns,
        args.index,
      );
      // The API response contains info about the created table, but might be too complex to return here.
      return `Successfully inserted a ${args.rows}x${args.columns} table at index ${args.index}.`;
    } catch (error: any) {
      log.error(
        `Error inserting table in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      throw new UserError(
        `Failed to insert table: ${error.message || "Unknown error"}`,
      );
    }
  },
});

server.addTool({
  name: "editTableCell",
  description:
    "Edits the content and/or basic style of a specific table cell. Requires knowing table start index.",
  parameters: DocumentIdParameter.extend({
    tableStartIndex: z
      .number()
      .int()
      .min(1)
      .describe(
        "The starting index of the TABLE element itself (tricky to find, may require reading structure first).",
      ),
    rowIndex: z.number().int().min(0).describe("Row index (0-based)."),
    columnIndex: z.number().int().min(0).describe("Column index (0-based)."),
    textContent: z
      .string()
      .optional()
      .describe(
        "Optional: New text content for the cell. Replaces existing content.",
      ),
    // Combine basic styles for simplicity here. More advanced cell styling might need separate tools.
    textStyle: TextStyleParameters.optional().describe(
      "Optional: Text styles to apply.",
    ),
    paragraphStyle: ParagraphStyleParameters.optional().describe(
      "Optional: Paragraph styles (like alignment) to apply.",
    ),
    // cellBackgroundColor: z.string().optional()... // Cell-specific styles are complex
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Editing cell (${args.rowIndex}, ${args.columnIndex}) in table starting at ${args.tableStartIndex}, doc ${args.documentId}`,
    );

    // TODO: Implement complex logic
    // 1. Find the cell's content range based on tableStartIndex, rowIndex, columnIndex. This is NON-TRIVIAL.
    //    Requires getting the document, finding the table element, iterating through rows/cells to calculate indices.
    // 2. If textContent is provided, generate a DeleteContentRange request for the cell's current content.
    // 3. Generate an InsertText request for the new textContent at the cell's start index.
    // 4. If textStyle is provided, generate UpdateTextStyle requests for the new text range.
    // 5. If paragraphStyle is provided, generate UpdateParagraphStyle requests for the cell's paragraph range.
    // 6. Execute batch update.

    log.error(
      "editTableCell is not implemented due to complexity of finding cell indices.",
    );
    throw new NotImplementedError(
      "Editing table cells is complex and not yet implemented.",
    );
    // return `Edit request for cell (${args.rowIndex}, ${args.columnIndex}) submitted (Not Implemented).`;
  },
});

server.addTool({
  name: "insertPageBreak",
  description: "Inserts a page break at the specified index.",
  parameters: DocumentIdParameter.extend({
    index: z
      .number()
      .int()
      .min(1)
      .describe("The index (1-based) where the page break should be inserted."),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Inserting page break in doc ${args.documentId} at index ${args.index}`,
    );
    try {
      const request: docs_v1.Schema$Request = {
        insertPageBreak: {
          location: { index: args.index },
        },
      };
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
      return `Successfully inserted page break at index ${args.index}.`;
    } catch (error: any) {
      log.error(
        `Error inserting page break in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      throw new UserError(
        `Failed to insert page break: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// --- Intelligent Assistance Tools (Examples/Stubs) ---

server.addTool({
  name: "fixListFormatting",
  description:
    "EXPERIMENTAL: Attempts to detect paragraphs that look like lists (e.g., starting with -, *, 1.) and convert them to proper Google Docs bulleted or numbered lists. Best used on specific sections.",
  parameters: DocumentIdParameter.extend({
    // Optional range to limit the scope, otherwise scans whole doc (potentially slow/risky)
    range: OptionalRangeParameters.optional().describe(
      "Optional: Limit the fixing process to a specific range.",
    ),
  }),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.warn(
      `Executing EXPERIMENTAL fixListFormatting for doc ${args.documentId}. Range: ${JSON.stringify(args.range)}`,
    );
    try {
      await GDocsHelpers.detectAndFormatLists(
        docs,
        args.documentId,
        args.range?.startIndex,
        args.range?.endIndex,
      );
      return `Attempted to fix list formatting. Please review the document for accuracy.`;
    } catch (error: any) {
      log.error(
        `Error fixing list formatting in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error; // Expected if helper not implemented
      throw new UserError(
        `Failed to fix list formatting: ${error.message || "Unknown error"}`,
      );
    }
  },
});

server.addTool({
  name: "addComment",
  description:
    "Adds a comment anchored to a specific text range. REQUIRES DRIVE API SCOPES/SETUP.",
  parameters: DocumentIdParameter.extend({
    startIndex: z
      .number()
      .int()
      .min(1)
      .describe(
        "The starting index of the text range (inclusive, starts from 1).",
      ),
    endIndex: z
      .number()
      .int()
      .min(1)
      .describe("The ending index of the text range (exclusive)."),
    commentText: z.string().min(1).describe("The content of the comment."),
  }).refine((data) => data.endIndex > data.startIndex, {
    message: "endIndex must be greater than startIndex",
    path: ["endIndex"],
  }),
  execute: async (args, { log }) => {
    log.info(
      `Attempting to add comment "${args.commentText}" to range ${args.startIndex}-${args.endIndex} in doc ${args.documentId}`,
    );
    // Requires Drive API client and appropriate scopes.
    // const { authClient } = await initializeGoogleClient(); // Get auth client if needed
    // if (!authClient) throw new UserError("Authentication client not available for Drive API.");
    try {
      // await GDocsHelpers.addCommentHelper(driveClient, args.documentId, args.commentText, args.startIndex, args.endIndex);
      log.error(
        "addComment requires Drive API setup which is not implemented.",
      );
      throw new NotImplementedError(
        "Adding comments requires Drive API setup and is not yet implemented in this server.",
      );
      // return `Comment added to range ${args.startIndex}-${args.endIndex}.`;
    } catch (error: any) {
      log.error(
        `Error adding comment in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;
      throw new UserError(
        `Failed to add comment: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// --- Add Stubs for other advanced features ---
// (findElement, getDocumentMetadata, replaceText, list management, image handling, section breaks, footnotes, etc.)
// Example Stub:
server.addTool({
  name: "findElement",
  description:
    "Finds elements (paragraphs, tables, etc.) based on various criteria. (Not Implemented)",
  parameters: DocumentIdParameter.extend({
    // Define complex query parameters...
    textQuery: z.string().optional(),
    elementType: z.enum(["paragraph", "table", "list", "image"]).optional(),
    // styleQuery...
  }),
  execute: async (args, { log }) => {
    log.warn("findElement tool called but is not implemented.");
    throw new NotImplementedError(
      "Finding elements by complex criteria is not yet implemented.",
    );
  },
});

server.addTool({
  name: "findSection",
  description:
    "Finds sections in a Google Document based on heading styles (corresponds to document tab navigation). Can return section location and optionally extract section content.",
  parameters: DocumentIdParameter.extend(SectionFindParameter.shape),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Finding section "${args.sectionTitle}" in doc ${args.documentId}`,
    );

    try {
      const result = await GoogleDocService.findSection(docs, args);
      return result.message;
    } catch (error: any) {
      log.error(
        `Error finding section in doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;
      throw new UserError(
        `Failed to find section: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// --- Preserve the existing formatMatchingText tool for backward compatibility ---
server.addTool({
  name: "formatMatchingText",
  description:
    "Finds specific text within a Google Document and applies character formatting (bold, italics, color, etc.) to the specified instance.",
  parameters: z
    .object({
      documentId: z.string().describe("The ID of the Google Document."),
      textToFind: z
        .string()
        .min(1)
        .describe("The exact text string to find and format."),
      matchInstance: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe(
          "Which instance of the text to format (1st, 2nd, etc.). Defaults to 1.",
        ),
      // Re-use optional Formatting Parameters (SHARED)
      bold: z.boolean().optional().describe("Apply bold formatting."),
      italic: z.boolean().optional().describe("Apply italic formatting."),
      underline: z.boolean().optional().describe("Apply underline formatting."),
      strikethrough: z
        .boolean()
        .optional()
        .describe("Apply strikethrough formatting."),
      fontSize: z
        .number()
        .min(1)
        .optional()
        .describe("Set font size (in points, e.g., 12)."),
      fontFamily: z
        .string()
        .optional()
        .describe('Set font family (e.g., "Arial", "Times New Roman").'),
      foregroundColor: z
        .string()
        .refine((color) => /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color), {
          message: "Invalid hex color format (e.g., #FF0000 or #F00)",
        })
        .optional()
        .describe('Set text color using hex format (e.g., "#FF0000").'),
      backgroundColor: z
        .string()
        .refine((color) => /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color), {
          message: "Invalid hex color format (e.g., #00FF00 or #0F0)",
        })
        .optional()
        .describe(
          'Set text background color using hex format (e.g., "#FFFF00").',
        ),
      linkUrl: z
        .string()
        .url()
        .optional()
        .describe("Make the text a hyperlink pointing to this URL."),
    })
    .refine(
      (data) =>
        Object.keys(data).some(
          (key) =>
            !["documentId", "textToFind", "matchInstance"].includes(key) &&
            data[key as keyof typeof data] !== undefined,
        ),
      {
        message:
          "At least one formatting option (bold, italic, fontSize, etc.) must be provided.",
      },
    ),
  execute: async (args, { log }) => {
    const docs = await getDocsClient();
    log.info(
      `Using formatMatchingText (legacy) for doc ${args.documentId}, target: "${args.textToFind}" (instance ${args.matchInstance})`,
    );

    try {
      const result = await GoogleDocService.formatMatchingText(docs, args);
      return result.message;
    } catch (error: any) {
      log.error(
        `Error in formatMatchingText for doc ${args.documentId}: ${error.message || error}`,
      );
      if (error instanceof UserError) throw error;
      if (error instanceof NotImplementedError) throw error;
      throw new UserError(
        `Failed to format text: ${error.message || "Unknown error"}`,
      );
    }
  },
});

// === GOOGLE DRIVE TOOLS ===

server.addTool({
  name: "listGoogleDocs",
  description:
    "Lists Google Documents from your Google Drive with optional filtering.",
  parameters: z.object({
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Maximum number of documents to return (1-100)."),
    query: z
      .string()
      .optional()
      .describe("Search query to filter documents by name or content."),
    orderBy: z
      .enum(["name", "modifiedTime", "createdTime"])
      .optional()
      .default("modifiedTime")
      .describe("Sort order for results."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Listing Google Docs. Query: ${args.query || "none"}, Max: ${args.maxResults}, Order: ${args.orderBy}`,
    );

    try {
      const result = await GoogleDriveService.listGoogleDocs(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error listing Google Docs: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "searchGoogleDocs",
  description:
    "Searches for Google Documents by name, content, or other criteria.",
  parameters: z.object({
    searchQuery: z
      .string()
      .min(1)
      .describe("Search term to find in document names or content."),
    searchIn: z
      .enum(["name", "content", "both"])
      .optional()
      .default("both")
      .describe("Where to search: document names, content, or both."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum number of results to return."),
    modifiedAfter: z
      .string()
      .optional()
      .describe(
        'Only return documents modified after this date (ISO 8601 format, e.g., "2024-01-01").',
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Searching Google Docs for: "${args.searchQuery}" in ${args.searchIn}`,
    );

    try {
      const result = await GoogleDriveService.searchGoogleDocs(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error searching Google Docs: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "getRecentGoogleDocs",
  description: "Gets the most recently modified Google Documents.",
  parameters: z.object({
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum number of recent documents to return."),
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .default(30)
      .describe("Only show documents modified within this many days."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Getting recent Google Docs: ${args.maxResults} results, ${args.daysBack} days back`,
    );

    try {
      const result = await GoogleDriveService.getRecentGoogleDocs(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error getting recent Google Docs: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "getDocumentInfo",
  description: "Gets detailed information about a specific Google Document.",
  parameters: DocumentIdParameter,
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Getting info for document: ${args.documentId}`);

    try {
      const result = await GoogleDriveService.getDocumentInfo(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error getting document info: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

// === GOOGLE DRIVE FILE MANAGEMENT TOOLS ===

// --- Folder Management Tools ---

server.addTool({
  name: "createFolder",
  description: "Creates a new folder in Google Drive.",
  parameters: z.object({
    name: z.string().min(1).describe("Name for the new folder."),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        "Parent folder ID. If not provided, creates folder in Drive root.",
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Creating folder "${args.name}" ${args.parentFolderId ? `in parent ${args.parentFolderId}` : "in root"}`,
    );

    try {
      const result = await GoogleDriveService.createFolder(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error creating folder: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "listFolderContents",
  description: "Lists the contents of a specific folder in Google Drive.",
  parameters: z.object({
    folderId: z
      .string()
      .describe(
        'ID of the folder to list contents of. Use "root" for the root Drive folder.',
      ),
    includeSubfolders: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to include subfolders in results."),
    includeFiles: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to include files in results."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe("Maximum number of items to return."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Listing contents of folder: ${args.folderId}`);

    try {
      const result = await GoogleDriveService.listFolderContents(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error listing folder contents: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "getFolderInfo",
  description:
    "Gets detailed information about a specific folder in Google Drive.",
  parameters: z.object({
    folderId: z.string().describe("ID of the folder to get information about."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Getting folder info: ${args.folderId}`);

    try {
      const result = await GoogleDriveService.getFolderInfo(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error getting folder info: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

// --- File Operation Tools ---

server.addTool({
  name: "moveFile",
  description:
    "Moves a file or folder to a different location in Google Drive.",
  parameters: z.object({
    fileId: z.string().describe("ID of the file or folder to move."),
    newParentId: z
      .string()
      .describe('ID of the destination folder. Use "root" for Drive root.'),
    removeFromAllParents: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, removes from all current parents. If false, adds to new parent while keeping existing parents.",
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Moving file ${args.fileId} to folder ${args.newParentId}`);

    try {
      const result = await GoogleDriveService.moveFile(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error moving file: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "copyFile",
  description: "Creates a copy of a Google Drive file or document.",
  parameters: z.object({
    fileId: z.string().describe("ID of the file to copy."),
    newName: z
      .string()
      .optional()
      .describe(
        'Name for the copied file. If not provided, will use "Copy of [original name]".',
      ),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        "ID of folder where copy should be placed. If not provided, places in same location as original.",
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Copying file ${args.fileId} ${args.newName ? `as "${args.newName}"` : ""}`,
    );

    try {
      const result = await GoogleDriveService.copyFile(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error copying file: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "renameFile",
  description: "Renames a file or folder in Google Drive.",
  parameters: z.object({
    fileId: z.string().describe("ID of the file or folder to rename."),
    newName: z.string().min(1).describe("New name for the file or folder."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Renaming file ${args.fileId} to "${args.newName}"`);

    try {
      const result = await GoogleDriveService.renameFile(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error renaming file: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "deleteFile",
  description: "Permanently deletes a file or folder from Google Drive.",
  parameters: z.object({
    fileId: z.string().describe("ID of the file or folder to delete."),
    skipTrash: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, permanently deletes the file. If false, moves to trash (can be restored).",
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Deleting file ${args.fileId} ${args.skipTrash ? "(permanent)" : "(to trash)"}`,
    );

    try {
      const result = await GoogleDriveService.deleteFile(drive, args);
      return result.message;
    } catch (error: any) {
      log.error(`Error deleting file: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

// --- Document Creation Tools ---

server.addTool({
  name: "createDocument",
  description: "Creates a new Google Document.",
  parameters: z.object({
    title: z.string().min(1).describe("Title for the new document."),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        "ID of folder where document should be created. If not provided, creates in Drive root.",
      ),
    initialContent: z
      .string()
      .optional()
      .describe("Initial text content to add to the document."),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(`Creating new document "${args.title}"`);

    try {
      const result = await GoogleDriveService.createDocument(drive, args);
      
      // Add initial content if provided (this needs to be done at the server level)
      if (args.initialContent) {
        try {
          const docs = await getDocsClient();
          await docs.documents.batchUpdate({
            documentId: result.document.id,
            requestBody: {
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: args.initialContent,
                  },
                },
              ],
            },
          });
          return result.message + `\n\nInitial content added to document.`;
        } catch (contentError: any) {
          log.warn(
            `Document created but failed to add initial content: ${contentError.message}`,
          );
          return result.message + `\n\nDocument created but failed to add initial content. You can add content manually.`;
        }
      }

      return result.message;
    } catch (error: any) {
      log.error(`Error creating document: ${error.message || error}`);
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

server.addTool({
  name: "createFromTemplate",
  description:
    "Creates a new Google Document from an existing document template.",
  parameters: z.object({
    templateId: z
      .string()
      .describe("ID of the template document to copy from."),
    newTitle: z.string().min(1).describe("Title for the new document."),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        "ID of folder where document should be created. If not provided, creates in Drive root.",
      ),
    replacements: z
      .record(z.string())
      .optional()
      .describe(
        'Key-value pairs for text replacements in the template (e.g., {"{{NAME}}": "John Doe", "{{DATE}}": "2024-01-01"}).',
      ),
  }),
  execute: async (args, { log }) => {
    const drive = await getDriveClient();
    log.info(
      `Creating document from template ${args.templateId} with title "${args.newTitle}"`,
    );

    try {
      const result = await GoogleDriveService.createFromTemplate(drive, args);
      
      // Apply text replacements if provided (this needs to be done at the server level)
      if (args.replacements && Object.keys(args.replacements).length > 0) {
        try {
          const docs = await getDocsClient();
          const requests: docs_v1.Schema$Request[] = [];

          // Create replace requests for each replacement
          for (const [searchText, replaceText] of Object.entries(
            args.replacements,
          )) {
            requests.push({
              replaceAllText: {
                containsText: {
                  text: searchText,
                  matchCase: false,
                },
                replaceText: replaceText,
              },
            });
          }

          if (requests.length > 0) {
            await docs.documents.batchUpdate({
              documentId: result.document.id,
              requestBody: { requests },
            });

            const replacementCount = Object.keys(args.replacements).length;
            return result.message + `\n\nApplied ${replacementCount} text replacement${replacementCount !== 1 ? "s" : ""} to the document.`;
          }
        } catch (replacementError: any) {
          log.warn(
            `Document created but failed to apply replacements: ${replacementError.message}`,
          );
          return result.message + `\n\nDocument created but failed to apply text replacements. You can make changes manually.`;
        }
      }

      return result.message;
    } catch (error: any) {
      log.error(
        `Error creating document from template: ${error.message || error}`,
      );
      throw error; // Re-throw as the service already handles error transformation
    }
  },
});

// --- Server Startup ---
async function startServer() {
  try {
    await initializeGoogleClient(); // Authorize BEFORE starting listeners
    console.error("Starting Ultimate Google Docs MCP server...");

    // Using stdio as before
    const configToUse = {
      transportType: "stdio" as const,
    };

    // Start the server with proper error handling
    server.start(configToUse);
    console.error(
      `MCP Server running using ${configToUse.transportType}. Awaiting client connection...`,
    );

    // Log that error handling has been enabled
    console.error(
      "Process-level error handling configured to prevent crashes from timeout errors.",
    );
  } catch (startError: any) {
    console.error(
      "FATAL: Server failed to start:",
      startError.message || startError,
    );
    process.exit(1);
  }
}

startServer(); // Removed .catch here, let errors propagate if startup fails critically

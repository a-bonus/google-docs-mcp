// src/types.ts
import { z } from 'zod';
import { docs_v1 } from 'googleapis';

// --- Helper function for hex color validation ---
export const hexColorRegex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
export const validateHexColor = (color: string) => hexColorRegex.test(color);

// --- Helper function for Hex to RGB conversion ---
export function hexToRgbColor(hex: string): docs_v1.Schema$RgbColor | null {
  if (!hex) return null;
  let hexClean = hex.startsWith('#') ? hex.slice(1) : hex;

  if (hexClean.length === 3) {
    hexClean = hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2];
  }
  if (hexClean.length !== 6) return null;
  const bigint = parseInt(hexClean, 16);
  if (isNaN(bigint)) return null;

  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;

  return { red: r, green: g, blue: b };
}

// --- Zod Schema Fragments for Reusability ---

export const DocumentIdParameter = z.strictObject({
  documentId: z
    .string()
    .describe('The document ID — the long string between /d/ and /edit in a Google Docs URL.'),
});

export const RangeParameters = z
  .object({
    startIndex: z
      .number()
      .int()
      .min(1)
      .describe('The starting index of the text range (inclusive, starts from 1).'),
    endIndex: z.number().int().min(1).describe('The ending index of the text range (exclusive).'),
  })
  .refine((data) => data.endIndex > data.startIndex, {
    message: 'endIndex must be greater than startIndex',
    path: ['endIndex'],
  });

export const OptionalRangeParameters = z
  .object({
    startIndex: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Optional: The starting index of the text range (inclusive, starts from 1). If omitted, might apply to a found element or whole paragraph.'
      ),
    endIndex: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Optional: The ending index of the text range (exclusive). If omitted, might apply to a found element or whole paragraph.'
      ),
  })
  .refine((data) => !data.startIndex || !data.endIndex || data.endIndex > data.startIndex, {
    message:
      'If both startIndex and endIndex are provided, endIndex must be greater than startIndex',
    path: ['endIndex'],
  });

export const TextFindParameter = z.strictObject({
  textToFind: z.string().min(1).describe('The exact text string to locate.'),
  matchInstance: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('Which instance of the text to target (1st, 2nd, etc.). Defaults to 1.'),
});

// --- Style Parameter Schemas ---

export const TextStyleParameters = z
  .object({
    bold: z.boolean().optional().describe('Apply bold formatting.'),
    italic: z.boolean().optional().describe('Apply italic formatting.'),
    underline: z.boolean().optional().describe('Apply underline formatting.'),
    strikethrough: z.boolean().optional().describe('Apply strikethrough formatting.'),
    fontSize: z.number().min(1).optional().describe('Set font size (in points, e.g., 12).'),
    fontFamily: z
      .string()
      .optional()
      .describe('Set font family (e.g., "Arial", "Times New Roman").'),
    foregroundColor: z
      .string()
      .refine(validateHexColor, { message: 'Invalid hex color format (e.g., #FF0000 or #F00)' })
      .optional()
      .describe('Set text color using hex format (e.g., "#FF0000").'),
    backgroundColor: z
      .string()
      .refine(validateHexColor, { message: 'Invalid hex color format (e.g., #00FF00 or #0F0)' })
      .optional()
      .describe('Set text background color using hex format (e.g., "#FFFF00").'),
    linkUrl: z
      .string()
      .url()
      .refine((url) => /^https?:\/\//i.test(url), { message: 'Only http/https URLs are allowed.' })
      .optional()
      .describe('Make the text a hyperlink pointing to this URL (http or https only).'),
    // clearDirectFormatting: z.boolean().optional().describe('If true, attempts to clear all direct text formatting within the range before applying new styles.') // Harder to implement perfectly
  })
  .describe('Parameters for character-level text formatting.');

// Subset of TextStyle used for passing to helpers
export type TextStyleArgs = z.infer<typeof TextStyleParameters>;

export const ParagraphStyleParameters = z
  .object({
    alignment: z
      .enum(['START', 'END', 'CENTER', 'JUSTIFIED'])
      .optional()
      .describe('Paragraph alignment. START=left for LTR languages, END=right for LTR languages.'),
    indentStart: z.number().min(0).optional().describe('Left indentation in points.'),
    indentEnd: z.number().min(0).optional().describe('Right indentation in points.'),
    spaceAbove: z.number().min(0).optional().describe('Space before the paragraph in points.'),
    spaceBelow: z.number().min(0).optional().describe('Space after the paragraph in points.'),
    namedStyleType: z
      .enum([
        'NORMAL_TEXT',
        'TITLE',
        'SUBTITLE',
        'HEADING_1',
        'HEADING_2',
        'HEADING_3',
        'HEADING_4',
        'HEADING_5',
        'HEADING_6',
      ])
      .optional()
      .describe('Apply a built-in named paragraph style (e.g., HEADING_1).'),
    keepWithNext: z
      .boolean()
      .optional()
      .describe('Keep this paragraph together with the next one on the same page.'),
    // Borders are more complex, might need separate objects/tools
    // clearDirectFormatting: z.boolean().optional().describe('If true, attempts to clear all direct paragraph formatting within the range before applying new styles.') // Harder to implement perfectly
  })
  .describe('Parameters for paragraph-level formatting.');

// Subset of ParagraphStyle used for passing to helpers
export type ParagraphStyleArgs = z.infer<typeof ParagraphStyleParameters>;

export const SpreadsheetCellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type SpreadsheetCellValue = z.infer<typeof SpreadsheetCellValueSchema>;

// --- Combination Schemas for Tools ---

export const ApplyTextStyleToolParameters = DocumentIdParameter.extend({
  // Target EITHER by range OR by finding text
  target: z
    .union([RangeParameters, TextFindParameter])
    .describe('Specify the target range either by start/end indices or by finding specific text.'),
  style: TextStyleParameters.refine(
    (styleArgs) => Object.values(styleArgs).some((v) => v !== undefined),
    { message: 'At least one text style option must be provided.' }
  ).describe('The text styling to apply.'),
  tabId: z
    .string()
    .optional()
    .describe(
      'The ID of the specific tab to apply formatting in. Use listDocumentTabs to get tab IDs. If not specified, operates on the first tab.'
    ),
  suggestMode: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, apply as pending suggestions for review instead of direct edits.'),
});
export type ApplyTextStyleToolArgs = z.infer<typeof ApplyTextStyleToolParameters>;

export const BatchApplyTextStyleOperation = z.strictObject({
  target: z
    .union([RangeParameters, TextFindParameter])
    .describe(
      "This operation's target range, either by start/end indices or by finding specific text."
    ),
  style: TextStyleParameters.refine(
    (styleArgs) => Object.values(styleArgs).some((v) => v !== undefined),
    { message: 'At least one text style option must be provided.' }
  ).describe('The text styling to apply for this operation.'),
});
export type BatchApplyTextStyleOperationArgs = z.infer<typeof BatchApplyTextStyleOperation>;

export const BatchApplyTextStyleToolParameters = DocumentIdParameter.extend({
  operations: z
    .array(BatchApplyTextStyleOperation)
    .min(1)
    .max(500)
    .describe(
      'List of {target, style} operations to apply in as few Docs API calls as possible. ' +
        'Prefer startIndex/endIndex ranges (computed once from a single readDocument JSON pass) over textToFind ' +
        '— each textToFind target is resolved with its own document read before the batch write, which adds ' +
        'back the round-trips this tool exists to avoid.'
    ),
  tabId: z
    .string()
    .optional()
    .describe(
      'The ID of the specific tab to apply formatting in. Applies to every operation in this call. If not specified, operates on the first tab.'
    ),
  suggestMode: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, apply as pending suggestions for review instead of direct edits.'),
});
export type BatchApplyTextStyleToolArgs = z.infer<typeof BatchApplyTextStyleToolParameters>;

export const ApplyParagraphStyleToolParameters = DocumentIdParameter.extend({
  // Target EITHER by range OR by finding text (tool logic needs to find paragraph boundaries)
  target: z
    .union([
      RangeParameters, // User provides paragraph start/end (less likely)
      TextFindParameter, // Find text within paragraph to apply style
      z.strictObject({
        // Target by specific index within the paragraph
        indexWithinParagraph: z
          .number()
          .int()
          .min(1)
          .describe('An index located anywhere within the target paragraph.'),
      }),
    ])
    .describe(
      'Specify the target paragraph either by start/end indices, by finding text within it, or by providing an index within it.'
    ),
  style: ParagraphStyleParameters.refine(
    (styleArgs) => Object.values(styleArgs).some((v) => v !== undefined),
    { message: 'At least one paragraph style option must be provided.' }
  ).describe('The paragraph styling to apply.'),
  tabId: z
    .string()
    .optional()
    .describe(
      'The ID of the specific tab to apply formatting in. Use listDocumentTabs to get tab IDs. If not specified, operates on the first tab.'
    ),
  suggestMode: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, apply as pending suggestions for review instead of direct edits.'),
});
export type ApplyParagraphStyleToolArgs = z.infer<typeof ApplyParagraphStyleToolParameters>;

// --- Error Classes ---
// Use FastMCP's UserError for client-facing issues
// Define custom errors for internal issues if needed
export class NotImplementedError extends Error {
  constructor(message = 'This feature is not yet implemented.') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class MarkdownConversionError extends Error {
  constructor(
    message: string,
    public markdownPosition?: number,
    public tokenType?: string
  ) {
    super(message);
    this.name = 'MarkdownConversionError';
  }
}

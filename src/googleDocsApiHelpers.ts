// src/googleDocsApiHelpers.ts
import { google, docs_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { UserError } from 'fastmcp';
import { TextStyleArgs, ParagraphStyleArgs, hexToRgbColor, NotImplementedError, SectionFindArgs, SectionInfo } from './types.js';

type Docs = docs_v1.Docs; // Alias for convenience

// --- Constants ---
const MAX_BATCH_UPDATE_REQUESTS = 50; // Google API limits batch size

// --- Core Helper to Execute Batch Updates ---
export async function executeBatchUpdate(docs: Docs, documentId: string, requests: docs_v1.Schema$Request[], tabId?: string): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
if (!requests || requests.length === 0) {
// console.warn("executeBatchUpdate called with no requests.");
return {}; // Nothing to do
}

    // TODO: Consider splitting large request arrays into multiple batches if needed
    if (requests.length > MAX_BATCH_UPDATE_REQUESTS) {
         console.warn(`Attempting batch update with ${requests.length} requests, exceeding typical limits. May fail.`);
    }

    try {
        const requestBody: any = { requests };
        
        // Add tab criteria if tabId is provided
        if (tabId) {
            requestBody.tabsCriteria = {
                tabIds: [tabId]
            };
        }

        const response = await docs.documents.batchUpdate({
            documentId: documentId,
            requestBody: requestBody,
        });
        return response.data;
    } catch (error: any) {
        console.error(`Google API batchUpdate Error for doc ${documentId}:`, error.response?.data || error.message);
        // Translate common API errors to UserErrors
        if (error.code === 400 && error.message.includes('Invalid requests')) {
             // Try to extract more specific info if available
             const details = error.response?.data?.error?.details;
             let detailMsg = '';
             if (details && Array.isArray(details)) {
                 detailMsg = details.map(d => d.description || JSON.stringify(d)).join('; ');
             }
            throw new UserError(`Invalid request sent to Google Docs API. Details: ${detailMsg || error.message}`);
        }
        if (error.code === 404) throw new UserError(`Document not found (ID: ${documentId}). Check the ID.`);
        if (error.code === 403) throw new UserError(`Permission denied for document (ID: ${documentId}). Ensure the authenticated user has edit access.`);
        // Generic internal error for others
        throw new Error(`Google API Error (${error.code}): ${error.message}`);
    }

}

// --- Text Finding Helper ---
// This improved version is more robust in handling various text structure scenarios
export async function findTextRange(docs: Docs, documentId: string, textToFind: string, instance: number = 1): Promise<{ startIndex: number; endIndex: number } | null> {
try {
    // Request more detailed information about the document structure
    const res = await docs.documents.get({
        documentId,
        // Request more fields to handle various container types (not just paragraphs)
        fields: 'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))',
    });

    if (!res.data.body?.content) {
        console.warn(`No content found in document ${documentId}`);
        return null;
    }

    // More robust text collection and index tracking
    let fullText = '';
    const segments: { text: string, start: number, end: number }[] = [];
    
    // Process all content elements, including structural ones
    const collectTextFromContent = (content: any[]) => {
        content.forEach(element => {
            // Handle paragraph elements
            if (element.paragraph?.elements) {
                element.paragraph.elements.forEach((pe: any) => {
                    if (pe.textRun?.content && pe.startIndex !== undefined && pe.endIndex !== undefined) {
                        const content = pe.textRun.content;
                        fullText += content;
                        segments.push({ 
                            text: content, 
                            start: pe.startIndex, 
                            end: pe.endIndex 
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
    
    collectTextFromContent(res.data.body.content);
    
    // Sort segments by starting position to ensure correct ordering
    segments.sort((a, b) => a.start - b.start);
    
    console.log(`Document ${documentId} contains ${segments.length} text segments and ${fullText.length} characters in total.`);
    
    // Find the specified instance of the text
    let startIndex = -1;
    let endIndex = -1;
    let foundCount = 0;
    let searchStartIndex = 0;

    while (foundCount < instance) {
        const currentIndex = fullText.indexOf(textToFind, searchStartIndex);
        if (currentIndex === -1) {
            console.log(`Search text "${textToFind}" not found for instance ${foundCount + 1} (requested: ${instance})`);
            break;
        }

        foundCount++;
        console.log(`Found instance ${foundCount} of "${textToFind}" at position ${currentIndex} in full text`);
        
        if (foundCount === instance) {
            const targetStartInFullText = currentIndex;
            const targetEndInFullText = currentIndex + textToFind.length;
            let currentPosInFullText = 0;
            
            console.log(`Target text range in full text: ${targetStartInFullText}-${targetEndInFullText}`);

            for (const seg of segments) {
                const segStartInFullText = currentPosInFullText;
                const segTextLength = seg.text.length;
                const segEndInFullText = segStartInFullText + segTextLength;

                // Map from reconstructed text position to actual document indices
                if (startIndex === -1 && targetStartInFullText >= segStartInFullText && targetStartInFullText < segEndInFullText) {
                    startIndex = seg.start + (targetStartInFullText - segStartInFullText);
                    console.log(`Mapped start to segment ${seg.start}-${seg.end}, position ${startIndex}`);
                }
                
                if (targetEndInFullText > segStartInFullText && targetEndInFullText <= segEndInFullText) {
                    endIndex = seg.start + (targetEndInFullText - segStartInFullText);
                    console.log(`Mapped end to segment ${seg.start}-${seg.end}, position ${endIndex}`);
                    break;
                }
                
                currentPosInFullText = segEndInFullText;
            }

            if (startIndex === -1 || endIndex === -1) {
                console.warn(`Failed to map text "${textToFind}" instance ${instance} to actual document indices`);
                // Reset and try next occurrence
                startIndex = -1; 
                endIndex = -1;
                searchStartIndex = currentIndex + 1;
                foundCount--;
                continue;
            }
            
            console.log(`Successfully mapped "${textToFind}" to document range ${startIndex}-${endIndex}`);
            return { startIndex, endIndex };
        }
        
        // Prepare for next search iteration
        searchStartIndex = currentIndex + 1;
    }

    console.warn(`Could not find instance ${instance} of text "${textToFind}" in document ${documentId}`);
    return null; // Instance not found or mapping failed for all attempts
} catch (error: any) {
    console.error(`Error finding text "${textToFind}" in doc ${documentId}: ${error.message || 'Unknown error'}`);
    if (error.code === 404) throw new UserError(`Document not found while searching text (ID: ${documentId}).`);
    if (error.code === 403) throw new UserError(`Permission denied while searching text in doc ${documentId}.`);
    throw new Error(`Failed to retrieve doc for text searching: ${error.message || 'Unknown error'}`);
}
}

// --- Paragraph Boundary Helper ---
// Enhanced version to handle document structural elements more robustly
export async function getParagraphRange(docs: Docs, documentId: string, indexWithin: number): Promise<{ startIndex: number; endIndex: number } | null> {
try {
    console.log(`Finding paragraph containing index ${indexWithin} in document ${documentId}`);
    
    // Request more detailed document structure to handle nested elements
    const res = await docs.documents.get({
        documentId,
        // Request more comprehensive structure information
        fields: 'body(content(startIndex,endIndex,paragraph,table,sectionBreak,tableOfContents))',
    });

    if (!res.data.body?.content) {
        console.warn(`No content found in document ${documentId}`);
        return null;
    }

    // Find paragraph containing the index
    // We'll look at all structural elements recursively
    const findParagraphInContent = (content: any[]): { startIndex: number; endIndex: number } | null => {
        for (const element of content) {
            // Check if we have element boundaries defined
            if (element.startIndex !== undefined && element.endIndex !== undefined) {
                // Check if index is within this element's range first
                if (indexWithin >= element.startIndex && indexWithin < element.endIndex) {
                    // If it's a paragraph, we've found our target
                    if (element.paragraph) {
                        console.log(`Found paragraph containing index ${indexWithin}, range: ${element.startIndex}-${element.endIndex}`);
                        return { 
                            startIndex: element.startIndex, 
                            endIndex: element.endIndex 
                        };
                    }
                    
                    // If it's a table, we need to check cells recursively
                    if (element.table && element.table.tableRows) {
                        console.log(`Index ${indexWithin} is within a table, searching cells...`);
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
                    console.warn(`Index ${indexWithin} is within element (${element.startIndex}-${element.endIndex}) but not in a paragraph`);
                }
            }
        }
        
        return null;
    };

    const paragraphRange = findParagraphInContent(res.data.body.content);
    
    if (!paragraphRange) {
        console.warn(`Could not find paragraph containing index ${indexWithin}`);
    } else {
        console.log(`Returning paragraph range: ${paragraphRange.startIndex}-${paragraphRange.endIndex}`);
    }
    
    return paragraphRange;

} catch (error: any) {
    console.error(`Error getting paragraph range for index ${indexWithin} in doc ${documentId}: ${error.message || 'Unknown error'}`);
    if (error.code === 404) throw new UserError(`Document not found while finding paragraph (ID: ${documentId}).`);
    if (error.code === 403) throw new UserError(`Permission denied while accessing doc ${documentId}.`);
    throw new Error(`Failed to find paragraph: ${error.message || 'Unknown error'}`);
}
}

// --- Style Request Builders ---

export function buildUpdateTextStyleRequest(
startIndex: number,
endIndex: number,
style: TextStyleArgs,
tabId?: string
): { request: docs_v1.Schema$Request, fields: string[] } | null {
    const textStyle: docs_v1.Schema$TextStyle = {};
const fieldsToUpdate: string[] = [];

    if (style.bold !== undefined) { textStyle.bold = style.bold; fieldsToUpdate.push('bold'); }
    if (style.italic !== undefined) { textStyle.italic = style.italic; fieldsToUpdate.push('italic'); }
    if (style.underline !== undefined) { textStyle.underline = style.underline; fieldsToUpdate.push('underline'); }
    if (style.strikethrough !== undefined) { textStyle.strikethrough = style.strikethrough; fieldsToUpdate.push('strikethrough'); }
    if (style.fontSize !== undefined) { textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' }; fieldsToUpdate.push('fontSize'); }
    if (style.fontFamily !== undefined) { textStyle.weightedFontFamily = { fontFamily: style.fontFamily }; fieldsToUpdate.push('weightedFontFamily'); }
    if (style.foregroundColor !== undefined) {
        const rgbColor = hexToRgbColor(style.foregroundColor);
        if (!rgbColor) throw new UserError(`Invalid foreground hex color format: ${style.foregroundColor}`);
        textStyle.foregroundColor = { color: { rgbColor: rgbColor } }; fieldsToUpdate.push('foregroundColor');
    }
     if (style.backgroundColor !== undefined) {
        const rgbColor = hexToRgbColor(style.backgroundColor);
        if (!rgbColor) throw new UserError(`Invalid background hex color format: ${style.backgroundColor}`);
        textStyle.backgroundColor = { color: { rgbColor: rgbColor } }; fieldsToUpdate.push('backgroundColor');
    }
    if (style.linkUrl !== undefined) {
        textStyle.link = { url: style.linkUrl }; fieldsToUpdate.push('link');
    }
    // TODO: Handle clearing formatting

    if (fieldsToUpdate.length === 0) return null; // No styles to apply

    const range: any = { startIndex, endIndex };
    if (tabId) {
        range.tabId = tabId;
    }

    const request: docs_v1.Schema$Request = {
        updateTextStyle: {
            range: range,
            textStyle: textStyle,
            fields: fieldsToUpdate.join(','),
        }
    };
    return { request, fields: fieldsToUpdate };

}

export function buildUpdateParagraphStyleRequest(
startIndex: number,
endIndex: number,
style: ParagraphStyleArgs,
tabId?: string
): { request: docs_v1.Schema$Request, fields: string[] } | null {
    // Create style object and track which fields to update
    const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
    const fieldsToUpdate: string[] = [];

    console.log(`Building paragraph style request for range ${startIndex}-${endIndex} with options:`, style);

    // Process alignment option (LEFT, CENTER, RIGHT, JUSTIFIED)
    if (style.alignment !== undefined) { 
        paragraphStyle.alignment = style.alignment; 
        fieldsToUpdate.push('alignment'); 
        console.log(`Setting alignment to ${style.alignment}`);
    }
    
    // Process indentation options
    if (style.indentStart !== undefined) { 
        paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' }; 
        fieldsToUpdate.push('indentStart'); 
        console.log(`Setting left indent to ${style.indentStart}pt`);
    }
    
    if (style.indentEnd !== undefined) { 
        paragraphStyle.indentEnd = { magnitude: style.indentEnd, unit: 'PT' }; 
        fieldsToUpdate.push('indentEnd'); 
        console.log(`Setting right indent to ${style.indentEnd}pt`);
    }
    
    // Process spacing options
    if (style.spaceAbove !== undefined) { 
        paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' }; 
        fieldsToUpdate.push('spaceAbove'); 
        console.log(`Setting space above to ${style.spaceAbove}pt`);
    }
    
    if (style.spaceBelow !== undefined) { 
        paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' }; 
        fieldsToUpdate.push('spaceBelow'); 
        console.log(`Setting space below to ${style.spaceBelow}pt`);
    }
    
    // Process named style types (headings, etc.)
    if (style.namedStyleType !== undefined) { 
        paragraphStyle.namedStyleType = style.namedStyleType; 
        fieldsToUpdate.push('namedStyleType'); 
        console.log(`Setting named style to ${style.namedStyleType}`);
    }
    
    // Process page break control
    if (style.keepWithNext !== undefined) { 
        paragraphStyle.keepWithNext = style.keepWithNext; 
        fieldsToUpdate.push('keepWithNext'); 
        console.log(`Setting keepWithNext to ${style.keepWithNext}`);
    }

    // Verify we have styles to apply
    if (fieldsToUpdate.length === 0) {
        console.warn("No paragraph styling options were provided");
        return null; // No styles to apply
    }

    const range: any = { startIndex, endIndex };
    if (tabId) {
        range.tabId = tabId;
    }

    // Build the request object
    const request: docs_v1.Schema$Request = {
        updateParagraphStyle: {
            range: range,
            paragraphStyle: paragraphStyle,
            fields: fieldsToUpdate.join(','),
        }
    };
    
    console.log(`Created paragraph style request with fields: ${fieldsToUpdate.join(', ')}`);
    return { request, fields: fieldsToUpdate };
}

// --- Specific Feature Helpers ---

export async function createTable(docs: Docs, documentId: string, rows: number, columns: number, index: number, tabId?: string): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
    if (rows < 1 || columns < 1) {
        throw new UserError("Table must have at least 1 row and 1 column.");
    }
    const location: any = { index };
    if (tabId) {
        location.tabId = tabId;
    }
    
    const request: docs_v1.Schema$Request = {
insertTable: {
location: location,
rows: rows,
columns: columns,
}
};
return executeBatchUpdate(docs, documentId, [request], tabId);
}

export async function insertText(docs: Docs, documentId: string, text: string, index: number, tabId?: string): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
    if (!text) return {}; // Nothing to insert
    const location: any = { index };
    if (tabId) {
        location.tabId = tabId;
    }
    
    const request: docs_v1.Schema$Request = {
insertText: {
location: location,
text: text,
}
};
return executeBatchUpdate(docs, documentId, [request], tabId);
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
console.warn("findParagraphsMatchingStyle is not implemented.");
throw new NotImplementedError("Finding paragraphs by style criteria is not yet implemented.");
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
console.warn("detectAndFormatLists is not implemented.");
throw new NotImplementedError("Automatic list detection and formatting is not yet implemented.");
// return {};
}

export async function addCommentHelper(docs: Docs, documentId: string, text: string, startIndex: number, endIndex: number): Promise<void> {
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
console.warn("addCommentHelper requires Google Drive API and is not implemented.");
throw new NotImplementedError("Adding comments requires Drive API setup and is not yet implemented.");
}

// --- Section Finding Helper ---
// This function finds sections in a document based on heading styles (which correspond to tab navigation)
export async function findSection(docs: Docs, documentId: string, args: SectionFindArgs): Promise<SectionInfo | null> {
    try {
        console.log(`Finding section "${args.sectionTitle}" in document ${documentId}`);
        
        // Get document content with detailed paragraph style information
        const res = await docs.documents.get({
            documentId,
            // Request comprehensive content including paragraph styles
            fields: 'body(content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(content,textStyle)),paragraphStyle(namedStyleType)),table,sectionBreak,tableOfContents))',
        });

        if (!res.data.body?.content) {
            console.warn(`No content found in document ${documentId}`);
            return null;
        }

        // Collect all headings with their levels, positions, and content
        const headings: {
            title: string;
            level: string;
            startIndex: number;
            endIndex: number;
            content: string;
        }[] = [];

        // Helper to extract text content from paragraph elements
        const extractTextFromParagraph = (elements: any[]): string => {
            return elements
                .filter(el => el.textRun?.content)
                .map(el => el.textRun.content)
                .join('');
        };

        // Process all content elements recursively
        const processContent = (content: any[]) => {
            content.forEach(element => {
                // Handle paragraph elements
                if (element.paragraph && element.startIndex !== undefined && element.endIndex !== undefined) {
                    const namedStyle = element.paragraph.paragraphStyle?.namedStyleType;
                    
                    // Check if this is a heading paragraph
                    if (namedStyle && namedStyle.startsWith('HEADING_')) {
                        const text = element.paragraph.elements 
                            ? extractTextFromParagraph(element.paragraph.elements)
                            : '';
                        
                        // Clean up the heading text (remove newlines, trim whitespace)
                        const cleanTitle = text.replace(/\n/g, '').trim();
                        
                        if (cleanTitle) {
                            headings.push({
                                title: cleanTitle,
                                level: namedStyle,
                                startIndex: element.startIndex,
                                endIndex: element.endIndex,
                                content: text
                            });
                            
                            console.log(`Found heading: "${cleanTitle}" (${namedStyle}) at ${element.startIndex}-${element.endIndex}`);
                        }
                    }
                }
                
                // Handle table elements recursively
                if (element.table && element.table.tableRows) {
                    element.table.tableRows.forEach((row: any) => {
                        if (row.tableCells) {
                            row.tableCells.forEach((cell: any) => {
                                if (cell.content) {
                                    processContent(cell.content);
                                }
                            });
                        }
                    });
                }
            });
        };

        processContent(res.data.body.content);

        console.log(`Found ${headings.length} headings in document`);

        // Filter headings based on criteria
        let matchingHeadings = headings;

        // Filter by heading level if specified
        if (args.headingLevel) {
            matchingHeadings = matchingHeadings.filter(h => h.level === args.headingLevel);
            console.log(`After filtering by level ${args.headingLevel}: ${matchingHeadings.length} headings`);
        }

        // Find headings that match the title (case-insensitive partial match)
        const titleMatchingHeadings = matchingHeadings.filter(h => 
            h.title.toLowerCase().includes(args.sectionTitle.toLowerCase())
        );

        console.log(`Found ${titleMatchingHeadings.length} headings matching title "${args.sectionTitle}"`);

        // Check if we have the requested instance
        if (titleMatchingHeadings.length === 0) {
            console.warn(`No headings found matching "${args.sectionTitle}"`);
            return null;
        }

        if (args.matchInstance > titleMatchingHeadings.length) {
            console.warn(`Requested instance ${args.matchInstance} but only found ${titleMatchingHeadings.length} matches`);
            return null;
        }

        // Get the target heading
        const targetHeading = titleMatchingHeadings[args.matchInstance - 1];
        console.log(`Selected heading: "${targetHeading.title}" (${targetHeading.level})`);

        // Create the base section info
        let sectionInfo: SectionInfo = {
            title: targetHeading.title,
            headingLevel: targetHeading.level,
            startIndex: targetHeading.startIndex,
            endIndex: targetHeading.endIndex
        };

        // If content is requested, we need to find the section boundaries
        if (args.returnContent) {
            const sectionEndIndex = findSectionEndIndex(
                headings, 
                targetHeading, 
                args.contentEndBoundary || 'next_heading'
            );
            
            // Update the section info with the extended range
            sectionInfo.endIndex = sectionEndIndex;
            
            // Extract the content from the section
            const sectionContent = await extractSectionContent(docs, documentId, sectionInfo.startIndex, sectionInfo.endIndex);
            sectionInfo.content = sectionContent;
        }

        return sectionInfo;

    } catch (error: any) {
        console.error(`Error finding section "${args.sectionTitle}" in doc ${documentId}: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Document not found while searching for section (ID: ${documentId}).`);
        if (error.code === 403) throw new UserError(`Permission denied while searching for section in doc ${documentId}.`);
        throw new Error(`Failed to find section: ${error.message || 'Unknown error'}`);
    }
}

// Helper function to determine where a section ends based on the boundary rule
function findSectionEndIndex(
    allHeadings: Array<{title: string; level: string; startIndex: number; endIndex: number}>,
    currentHeading: {title: string; level: string; startIndex: number; endIndex: number},
    boundary: 'next_heading' | 'next_same_level' | 'next_higher_level' | 'document_end'
): number {
    // Sort headings by start index to ensure proper ordering
    const sortedHeadings = [...allHeadings].sort((a, b) => a.startIndex - b.startIndex);
    
    // Find the current heading's position in the sorted array
    const currentIndex = sortedHeadings.findIndex(h => h.startIndex === currentHeading.startIndex);
    
    if (currentIndex === -1) {
        console.warn("Could not find current heading in sorted list");
        return currentHeading.endIndex;
    }

    // Get the hierarchy level number (e.g., HEADING_1 -> 1, HEADING_2 -> 2)
    const getCurrentLevel = (levelStr: string): number => {
        const match = levelStr.match(/HEADING_(\d+)/);
        return match ? parseInt(match[1]) : 999;
    };

    const currentLevel = getCurrentLevel(currentHeading.level);
    
    // Look for the next heading that matches our boundary criteria
    for (let i = currentIndex + 1; i < sortedHeadings.length; i++) {
        const nextHeading = sortedHeadings[i];
        const nextLevel = getCurrentLevel(nextHeading.level);
        
        switch (boundary) {
            case 'next_heading':
                // Stop at any heading
                return nextHeading.startIndex;
                
            case 'next_same_level':
                // Stop at a heading of the same level
                if (nextLevel === currentLevel) {
                    return nextHeading.startIndex;
                }
                break;
                
            case 'next_higher_level':
                // Stop at a heading of higher level (lower number)
                if (nextLevel < currentLevel) {
                    return nextHeading.startIndex;
                }
                break;
        }
    }
    
    // If we reach here, we didn't find a boundary heading, so extend to document end
    // We'll use a large number to indicate document end - the actual implementation
    // would need to get the document's actual end index
    return Number.MAX_SAFE_INTEGER;
}

// Helper function to extract content from a section range
async function extractSectionContent(docs: Docs, documentId: string, startIndex: number, endIndex: number): Promise<string> {
    try {
        // For now, we'll use a simple text extraction approach
        // In a more sophisticated implementation, we might want to preserve formatting
        const res = await docs.documents.get({
            documentId,
            fields: 'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),startIndex,endIndex,table,sectionBreak))',
        });

        if (!res.data.body?.content) {
            return '';
        }

        let sectionText = '';
        
        // Process content elements that fall within our range
        const processContentForRange = (content: any[]) => {
            content.forEach(element => {
                // Skip elements that are completely outside our range
                if (element.startIndex >= endIndex || element.endIndex <= startIndex) {
                    return;
                }
                
                // Handle paragraph elements
                if (element.paragraph?.elements) {
                    element.paragraph.elements.forEach((pe: any) => {
                        if (pe.textRun?.content && pe.startIndex !== undefined && pe.endIndex !== undefined) {
                            // Check if this text run overlaps with our range
                            if (pe.startIndex < endIndex && pe.endIndex > startIndex) {
                                sectionText += pe.textRun.content;
                            }
                        }
                    });
                }
                
                // Handle table elements
                if (element.table && element.table.tableRows) {
                    element.table.tableRows.forEach((row: any) => {
                        if (row.tableCells) {
                            row.tableCells.forEach((cell: any) => {
                                if (cell.content) {
                                    processContentForRange(cell.content);
                                }
                            });
                        }
                    });
                }
            });
        };

        processContentForRange(res.data.body.content);
        
        return sectionText.trim();
    } catch (error: any) {
        console.error(`Error extracting section content: ${error.message}`);
        return `[Error extracting content: ${error.message}]`;
    }
}

// Add more helpers as needed...
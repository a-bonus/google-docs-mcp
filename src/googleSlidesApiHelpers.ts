// src/googleSlidesApiHelpers.ts
import { google, slides_v1 } from 'googleapis';
import { UserError } from 'fastmcp';

type Slides = slides_v1.Slides; // Alias for convenience

// --- Constants ---
const MAX_BATCH_UPDATE_REQUESTS = 50; // Google API limits batch size

// --- Core Helper to Execute Batch Updates ---
export async function executeBatchUpdate(
  slides: Slides,
  presentationId: string,
  requests: slides_v1.Schema$Request[]
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  if (!requests || requests.length === 0) {
    return {}; // Nothing to do
  }

  if (requests.length > MAX_BATCH_UPDATE_REQUESTS) {
    console.warn(`Attempting batch update with ${requests.length} requests, exceeding typical limits. May fail.`);
  }

  try {
    const response = await slides.presentations.batchUpdate({
      presentationId: presentationId,
      requestBody: { requests },
    });
    return response.data;
  } catch (error: any) {
    console.error(`Google API batchUpdate Error for presentation ${presentationId}:`, error.response?.data || error.message);

    if (error.code === 400) {
      const details = error.response?.data?.error?.details;
      let detailMsg = '';
      if (details && Array.isArray(details)) {
        detailMsg = details.map((d: any) => d.description || JSON.stringify(d)).join('; ');
      }
      throw new UserError(`Invalid request sent to Google Slides API. Details: ${detailMsg || error.message}`);
    }
    if (error.code === 404) throw new UserError(`Presentation not found (ID: ${presentationId}). Check the ID.`);
    if (error.code === 403) throw new UserError(`Permission denied for presentation (ID: ${presentationId}). Ensure the authenticated user has edit access.`);

    throw new Error(`Google API Error (${error.code}): ${error.message}`);
  }
}

// --- Presentation Management Helpers ---

/**
 * Creates a new Google Slides presentation
 * @param slides - Google Slides API client
 * @param title - Title of the new presentation
 * @returns Promise with the created presentation data
 */
export async function createPresentation(
  slides: Slides,
  title: string
): Promise<slides_v1.Schema$Presentation> {
  try {
    const response = await slides.presentations.create({
      requestBody: {
        title: title,
      },
    });
    return response.data;
  } catch (error: any) {
    console.error(`Error creating presentation: ${error.message}`);
    if (error.code === 403) {
      throw new UserError('Permission denied. Ensure you have permission to create presentations.');
    }
    throw new UserError(`Failed to create presentation: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Gets a presentation by ID
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @returns Promise with the presentation data
 */
export async function getPresentation(
  slides: Slides,
  presentationId: string
): Promise<slides_v1.Schema$Presentation> {
  try {
    const response = await slides.presentations.get({
      presentationId: presentationId,
    });
    return response.data;
  } catch (error: any) {
    console.error(`Error getting presentation ${presentationId}: ${error.message}`);
    if (error.code === 404) {
      throw new UserError(`Presentation not found (ID: ${presentationId}). Check the ID.`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied for presentation (ID: ${presentationId}). Ensure you have read access.`);
    }
    throw new UserError(`Failed to get presentation: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Gets a specific page/slide from a presentation
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param pageObjectId - The page/slide object ID
 * @returns Promise with the page data
 */
export async function getPage(
  slides: Slides,
  presentationId: string,
  pageObjectId: string
): Promise<slides_v1.Schema$Page> {
  try {
    const response = await slides.presentations.pages.get({
      presentationId: presentationId,
      pageObjectId: pageObjectId,
    });
    return response.data;
  } catch (error: any) {
    console.error(`Error getting page ${pageObjectId} from presentation ${presentationId}: ${error.message}`);
    if (error.code === 404) {
      throw new UserError(`Page or presentation not found (Presentation ID: ${presentationId}, Page ID: ${pageObjectId}).`);
    }
    if (error.code === 403) {
      throw new UserError(`Permission denied for presentation (ID: ${presentationId}).`);
    }
    throw new UserError(`Failed to get page: ${error.message || 'Unknown error'}`);
  }
}

// --- Slide Management Helpers ---

/**
 * Adds a new slide to a presentation
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param insertionIndex - Optional index where to insert the slide (0-based). If not specified, adds at the end.
 * @param layoutId - Optional layout ID to use for the new slide
 * @param predefinedLayout - Optional predefined layout type (e.g., 'BLANK', 'TITLE_AND_BODY', 'TITLE_ONLY')
 * @returns Promise with the batch update response
 */
export async function addSlide(
  slides: Slides,
  presentationId: string,
  insertionIndex?: number,
  layoutId?: string,
  predefinedLayout?: string
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  // Generate a unique object ID for the new slide
  const slideObjectId = `slide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const slideProperties: slides_v1.Schema$SlideProperties = {};

  if (layoutId) {
    slideProperties.layoutObjectId = layoutId;
  }

  const request: slides_v1.Schema$Request = {
    createSlide: {
      objectId: slideObjectId,
      insertionIndex: insertionIndex,
      slideLayoutReference: predefinedLayout
        ? { predefinedLayout: predefinedLayout }
        : (layoutId ? { layoutId: layoutId } : { predefinedLayout: 'BLANK' }),
    },
  };

  return executeBatchUpdate(slides, presentationId, [request]);
}

/**
 * Deletes a slide from a presentation
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param slideObjectId - The object ID of the slide to delete
 * @returns Promise with the batch update response
 */
export async function deleteSlide(
  slides: Slides,
  presentationId: string,
  slideObjectId: string
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  const request: slides_v1.Schema$Request = {
    deleteObject: {
      objectId: slideObjectId,
    },
  };

  return executeBatchUpdate(slides, presentationId, [request]);
}

// --- Text Helpers ---

/**
 * Inserts text into a shape on a slide
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param shapeObjectId - The object ID of the shape to insert text into
 * @param text - The text to insert
 * @param insertionIndex - Optional index where to insert the text (0-based). If not specified, appends at the end.
 * @returns Promise with the batch update response
 */
export async function insertText(
  slides: Slides,
  presentationId: string,
  shapeObjectId: string,
  text: string,
  insertionIndex?: number
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  const request: slides_v1.Schema$Request = {
    insertText: {
      objectId: shapeObjectId,
      text: text,
      insertionIndex: insertionIndex,
    },
  };

  return executeBatchUpdate(slides, presentationId, [request]);
}

/**
 * Deletes text from a shape on a slide
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param shapeObjectId - The object ID of the shape to delete text from
 * @param startIndex - Start index of the text range to delete (0-based, inclusive)
 * @param endIndex - End index of the text range to delete (exclusive)
 * @returns Promise with the batch update response
 */
export async function deleteText(
  slides: Slides,
  presentationId: string,
  shapeObjectId: string,
  startIndex: number,
  endIndex: number
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  const request: slides_v1.Schema$Request = {
    deleteText: {
      objectId: shapeObjectId,
      textRange: {
        type: 'FIXED_RANGE',
        startIndex: startIndex,
        endIndex: endIndex,
      },
    },
  };

  return executeBatchUpdate(slides, presentationId, [request]);
}

// --- Shape Helpers ---

/**
 * Creates a shape on a slide
 * @param slides - Google Slides API client
 * @param presentationId - The presentation ID
 * @param pageObjectId - The page/slide object ID to add the shape to
 * @param shapeType - The type of shape (e.g., 'RECTANGLE', 'TEXT_BOX', 'ELLIPSE')
 * @param x - X coordinate in EMU (English Metric Units)
 * @param y - Y coordinate in EMU
 * @param width - Width in EMU
 * @param height - Height in EMU
 * @returns Promise with the batch update response
 */
export async function createShape(
  slides: Slides,
  presentationId: string,
  pageObjectId: string,
  shapeType: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<slides_v1.Schema$BatchUpdatePresentationResponse> {
  const shapeObjectId = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const request: slides_v1.Schema$Request = {
    createShape: {
      objectId: shapeObjectId,
      shapeType: shapeType,
      elementProperties: {
        pageObjectId: pageObjectId,
        size: {
          width: { magnitude: width, unit: 'EMU' },
          height: { magnitude: height, unit: 'EMU' },
        },
        transform: {
          scaleX: 1,
          scaleY: 1,
          translateX: x,
          translateY: y,
          unit: 'EMU',
        },
      },
    },
  };

  return executeBatchUpdate(slides, presentationId, [request]);
}

// --- Utility Helpers ---

/**
 * Converts points to EMU (English Metric Units)
 * 1 point = 12700 EMU
 */
export function pointsToEmu(points: number): number {
  return Math.round(points * 12700);
}

/**
 * Converts EMU to points
 */
export function emuToPoints(emu: number): number {
  return emu / 12700;
}

/**
 * Converts inches to EMU
 * 1 inch = 914400 EMU
 */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * 914400);
}

/**
 * Converts EMU to inches
 */
export function emuToInches(emu: number): number {
  return emu / 914400;
}

/**
 * Gets slide summary information
 * @param presentation - The presentation object
 * @returns Array of slide summaries with objectId and title
 */
export function getSlidesSummary(
  presentation: slides_v1.Schema$Presentation
): Array<{ objectId: string; title: string; index: number }> {
  const slides = presentation.slides || [];

  return slides.map((slide, index) => {
    let title = `Slide ${index + 1}`;

    // Try to extract title from shape elements
    if (slide.pageElements) {
      for (const element of slide.pageElements) {
        if (element.shape?.placeholder?.type === 'TITLE' || element.shape?.placeholder?.type === 'CENTERED_TITLE') {
          const textContent = element.shape?.text?.textElements
            ?.filter(te => te.textRun?.content)
            .map(te => te.textRun?.content?.trim())
            .join('');
          if (textContent) {
            title = textContent;
            break;
          }
        }
      }
    }

    return {
      objectId: slide.objectId || '',
      title: title,
      index: index,
    };
  });
}

/**
 * Gets layout information from a presentation
 * @param presentation - The presentation object
 * @returns Array of layout summaries
 */
export function getLayoutsSummary(
  presentation: slides_v1.Schema$Presentation
): Array<{ objectId: string; name: string; displayName: string }> {
  const layouts = presentation.layouts || [];

  return layouts.map(layout => ({
    objectId: layout.objectId || '',
    name: layout.layoutProperties?.name || 'Unknown',
    displayName: layout.layoutProperties?.displayName || layout.layoutProperties?.name || 'Unknown',
  }));
}

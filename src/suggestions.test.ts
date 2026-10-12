import { describe, it, expect } from 'vitest';
import {
  validateSuggestModeRequests,
  describeCommentUpdateState,
  describeSuggestionResponses,
} from './suggestions.js';

describe('validateSuggestModeRequests', () => {
  it('accepts plain text edits', () => {
    expect(
      validateSuggestModeRequests([{ insertText: { location: { index: 1 }, text: 'hi' } } as any])
    ).toBeNull();
    expect(
      validateSuggestModeRequests([
        { deleteContentRange: { range: { startIndex: 1, endIndex: 2 } } } as any,
      ])
    ).toBeNull();
    expect(
      validateSuggestModeRequests([
        { replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' } } as any,
      ])
    ).toBeNull();
  });

  it('rejects tab and structural ops the API refuses as suggestions', () => {
    expect(validateSuggestModeRequests([{ addDocumentTab: {} } as any])).toMatch(/addDocumentTab/i);
    expect(validateSuggestModeRequests([{ deleteTab: {} } as any])).toMatch(/deleteTab/i);
    expect(validateSuggestModeRequests([{ updateDocumentTabProperties: {} } as any])).toMatch(
      /updateDocumentTabProperties/i
    );
    expect(validateSuggestModeRequests([{ createNamedRange: {} } as any])).toMatch(
      /createNamedRange/i
    );
    expect(validateSuggestModeRequests([{ updateTableColumnProperties: {} } as any])).toMatch(
      /updateTableColumnProperties/i
    );
    expect(validateSuggestModeRequests([{ createHeader: {} } as any])).toMatch(/createHeader/i);
  });

  it('rejects unsupported updateDocumentStyle fields', () => {
    expect(
      validateSuggestModeRequests([
        { updateDocumentStyle: { documentStyle: { useFirstPageHeaderFooter: true } } } as any,
      ])
    ).toMatch(/useFirstPageHeaderFooter|updateDocumentStyle/i);
  });
});

describe('describeCommentUpdateState', () => {
  it('confirms on ALL_SAVED', () => {
    expect(describeCommentUpdateState('ALL_SAVED')).toMatch(/ALL_SAVED/);
  });

  it('warns when state is missing (possible silent direct edit)', () => {
    expect(describeCommentUpdateState(undefined)).toMatch(/WARNING/i);
    expect(describeCommentUpdateState('SOMETHING_ELSE')).toMatch(/WARNING/i);
  });

  it('treats proven no-op find/replace as benign', () => {
    expect(describeCommentUpdateState('NO_UPDATES_REQUESTED', { allNoops: true })).toMatch(
      /zero occurrences|nothing matched/i
    );
    expect(describeCommentUpdateState('NO_UPDATES_REQUESTED')).toMatch(/WARNING/i);
  });
});

describe('describeSuggestionResponses', () => {
  it('summarizes created ids', () => {
    expect(
      describeSuggestionResponses([{ createdSuggestionIds: ['suggest.a', 'suggest.b'] }])
    ).toMatch(/created: 2/);
  });

  it('returns empty string when nothing happened', () => {
    expect(describeSuggestionResponses([])).toBe('');
    expect(describeSuggestionResponses(undefined)).toBe('');
  });
});

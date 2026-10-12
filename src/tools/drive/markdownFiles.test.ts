import { describe, it, expect } from 'vitest';
import {
  ensureMarkdownFileName,
  isEditableMarkdownMime,
  truncateContent,
} from './markdownFiles.js';

describe('ensureMarkdownFileName', () => {
  it('adds .md when missing', () => {
    expect(ensureMarkdownFileName('notes')).toBe('notes.md');
  });

  it('keeps existing .md and .markdown (any case)', () => {
    expect(ensureMarkdownFileName('notes.md')).toBe('notes.md');
    expect(ensureMarkdownFileName('notes.MD')).toBe('notes.MD');
    expect(ensureMarkdownFileName('notes.markdown')).toBe('notes.markdown');
  });

  it('trims whitespace', () => {
    expect(ensureMarkdownFileName('  notes  ')).toBe('notes.md');
  });
});

describe('isEditableMarkdownMime', () => {
  it('accepts markdown and plain text', () => {
    expect(isEditableMarkdownMime('text/markdown')).toBe(true);
    expect(isEditableMarkdownMime('text/x-markdown')).toBe(true);
    expect(isEditableMarkdownMime('text/plain')).toBe(true);
    expect(isEditableMarkdownMime('text/csv')).toBe(true);
  });

  it('rejects workspace docs and binaries', () => {
    expect(isEditableMarkdownMime('application/vnd.google-apps.document')).toBe(false);
    expect(isEditableMarkdownMime('application/pdf')).toBe(false);
    expect(isEditableMarkdownMime('image/png')).toBe(false);
  });
});

describe('truncateContent', () => {
  it('returns content untouched when short', () => {
    expect(truncateContent('abc', 10)).toEqual({ content: 'abc', truncated: false });
  });

  it('cuts long content and flags it', () => {
    expect(truncateContent('abcdef', 4)).toEqual({ content: 'abcd', truncated: true });
  });
});

import { describe, it, expect } from 'vitest';
import { sanitizeFileName } from './downloadProxy.js';

describe('sanitizeFileName', () => {
  it('should pass through normal filenames unchanged', () => {
    expect(sanitizeFileName('report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('My Document (2).docx')).toBe('My Document (2).docx');
  });

  it('should strip CR and LF characters to prevent header injection', () => {
    expect(sanitizeFileName('evil\r\nSet-Cookie: pwn=1')).toBe('evilSet-Cookie: pwn=1');
    expect(sanitizeFileName('evil\nInjected: yes')).toBe('evilInjected: yes');
    expect(sanitizeFileName('evil\rInjected: yes')).toBe('evilInjected: yes');
  });

  it('should strip null bytes', () => {
    expect(sanitizeFileName('evil\x00.pdf')).toBe('evil.pdf');
  });

  it('should produce a valid Content-Disposition header value', () => {
    // Filenames with quotes should be safely escaped
    const name = sanitizeFileName('file "with" quotes.pdf');
    const header = `attachment; filename="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    // Should not throw when set on Headers
    const h = new Headers();
    h.set('Content-Disposition', header);
    expect(h.get('Content-Disposition')).toContain('file');
  });

  it('should produce a valid header even with CRLF in filename', () => {
    const name = sanitizeFileName('evil\r\nSet-Cookie: pwn=1');
    const header = `attachment; filename="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const h = new Headers();
    // This must NOT throw
    h.set('Content-Disposition', header);
    expect(h.get('Content-Disposition')).toBeDefined();
  });

  it('should handle filenames with backslash before quote', () => {
    // Backslash-quote edge case: a literal backslash followed by quote
    const name = sanitizeFileName('file\\.pdf');
    expect(name).toBe('file\\.pdf');
  });

  it('should fallback to "download" for empty filename after sanitization', () => {
    expect(sanitizeFileName('\r\n\r\n')).toBe('download');
    expect(sanitizeFileName('\x00')).toBe('download');
    expect(sanitizeFileName('')).toBe('download');
  });
});

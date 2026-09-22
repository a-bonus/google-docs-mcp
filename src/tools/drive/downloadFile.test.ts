import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  WORKSPACE_EXPORT_DEFAULTS,
  EXPORT_MIME_TO_EXTENSION,
  isTextMimeType,
} from './downloadFile.js';

// ---------------------------------------------------------------------------
// Pure unit tests (no mocks)
// ---------------------------------------------------------------------------

describe('WORKSPACE_EXPORT_DEFAULTS', () => {
  it('should default Google Docs to text/markdown', () => {
    expect(WORKSPACE_EXPORT_DEFAULTS['application/vnd.google-apps.document']).toBe('text/markdown');
  });

  it('should default Google Sheets to text/csv', () => {
    expect(WORKSPACE_EXPORT_DEFAULTS['application/vnd.google-apps.spreadsheet']).toBe('text/csv');
  });

  it('should default Google Slides to text/plain', () => {
    expect(WORKSPACE_EXPORT_DEFAULTS['application/vnd.google-apps.presentation']).toBe(
      'text/plain'
    );
  });

  it('should default Google Drawings to image/png', () => {
    expect(WORKSPACE_EXPORT_DEFAULTS['application/vnd.google-apps.drawing']).toBe('image/png');
  });
});

describe('EXPORT_MIME_TO_EXTENSION', () => {
  it('should map text/markdown to .md', () => {
    expect(EXPORT_MIME_TO_EXTENSION['text/markdown']).toBe('.md');
  });

  it('should map text/csv to .csv', () => {
    expect(EXPORT_MIME_TO_EXTENSION['text/csv']).toBe('.csv');
  });

  it('should map application/pdf to .pdf', () => {
    expect(EXPORT_MIME_TO_EXTENSION['application/pdf']).toBe('.pdf');
  });
});

describe('isTextMimeType', () => {
  it.each([
    ['text/plain', true],
    ['text/csv', true],
    ['text/markdown', true],
    ['text/tab-separated-values', true],
    ['text/html', true],
    ['application/json', true],
    ['application/vnd.google-apps.script+json', true],
  ])('should return true for %s', (mime, expected) => {
    expect(isTextMimeType(mime)).toBe(expected);
  });

  it.each([
    ['application/pdf', false],
    ['image/png', false],
    ['image/jpeg', false],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
    ['application/octet-stream', false],
  ])('should return false for %s', (mime, expected) => {
    expect(isTextMimeType(mime)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Integration tests (mocked Drive client + fs + pipeline)
// ---------------------------------------------------------------------------

vi.mock('../../clients.js', () => ({
  getDriveClient: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(() => 'mock-write-stream'),
      statSync: vi.fn(() => ({ size: 2048 })),
      readFileSync: vi.fn(() => 'mock-text-content'),
      unlinkSync: vi.fn(),
    },
  };
});

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(async () => {}),
}));

import { getDriveClient } from '../../clients.js';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { register } from './downloadFile.js';
import { UserError } from 'fastmcp';

const mockGetDriveClient = vi.mocked(getDriveClient);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockCreateWriteStream = vi.mocked(fs.createWriteStream);
const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockPipeline = vi.mocked(pipeline);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function createMockDrive(metadataOverrides: Record<string, any> = {}) {
  const mockStream = { pipe: vi.fn() };
  const metadata = {
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: '2048',
    ...metadataOverrides,
  };

  const filesGet = vi.fn().mockImplementation((params: any) => {
    if (params?.alt === 'media') {
      return Promise.resolve({ data: mockStream });
    }
    return Promise.resolve({ data: metadata });
  });

  const filesExport = vi.fn().mockResolvedValue({ data: mockStream });

  const drive = {
    files: { get: filesGet, export: filesExport },
  };

  mockGetDriveClient.mockResolvedValue(drive as any);

  return { drive, filesGet, filesExport, mockStream, metadata };
}

describe('downloadFile integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatSync.mockReturnValue({ size: 2048 } as any);
    mockReadFileSync.mockReturnValue('mock-text-content');
    mockCreateWriteStream.mockReturnValue('mock-write-stream' as any);
    mockPipeline.mockResolvedValue(undefined);

    const fakeServer = { addTool: (config: any) => (toolExecute = config.execute) };
    register(fakeServer as any);
  });

  describe('blob download', () => {
    it('should call files.get with correct params and NOT call files.export', async () => {
      const { filesGet, filesExport } = createMockDrive();

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/report.pdf' },
        { log: mockLog }
      );

      // Metadata call includes supportsAllDrives
      expect(filesGet).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'f1',
          fields: 'name,mimeType,size',
          supportsAllDrives: true,
        })
      );

      // Download call has alt: 'media' and supportsAllDrives
      expect(filesGet).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'f1', alt: 'media', supportsAllDrives: true }),
        expect.objectContaining({ responseType: 'stream' })
      );

      // files.export must NOT be called for blob files
      expect(filesExport).not.toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed.savedTo).toBe(path.resolve('./downloads/report.pdf'));
      expect(parsed.fileName).toBe('report.pdf');
      expect(parsed.sizeBytes).toBe(2048);
      expect(parsed.originalMimeType).toBe('application/pdf');
      expect(parsed.exportedAs).toBeUndefined();
    });
  });

  describe('workspace export', () => {
    it('should call files.export with default MIME and NOT call files.get with alt media', async () => {
      const { filesGet, filesExport } = createMockDrive({
        name: 'My Doc',
        mimeType: 'application/vnd.google-apps.document',
      });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/doc.md' },
        { log: mockLog }
      );

      // files.export called with default markdown MIME
      expect(filesExport).toHaveBeenCalledWith(
        { fileId: 'f1', mimeType: 'text/markdown' },
        { responseType: 'stream' }
      );

      // files.get called for metadata only, NOT with alt: 'media'
      const getCalls = filesGet.mock.calls;
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0][0]).not.toHaveProperty('alt');

      const parsed = JSON.parse(result);
      expect(parsed.exportedAs).toBe('text/markdown');
      expect(parsed.originalMimeType).toBe('application/vnd.google-apps.document');
    });

    it('should use custom exportMimeType instead of default', async () => {
      const { filesExport } = createMockDrive({
        name: 'My Doc',
        mimeType: 'application/vnd.google-apps.document',
      });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/doc.pdf', exportMimeType: 'application/pdf' },
        { log: mockLog }
      );

      expect(filesExport).toHaveBeenCalledWith(
        { fileId: 'f1', mimeType: 'application/pdf' },
        expect.anything()
      );

      const parsed = JSON.parse(result);
      expect(parsed.exportedAs).toBe('application/pdf');
    });
  });

  describe('text extraction', () => {
    it('should return exact text content for text-based files', async () => {
      mockReadFileSync.mockReturnValue('col1,col2\na,b\n');
      createMockDrive({ name: 'data.csv', mimeType: 'text/csv' });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/data.csv' },
        { log: mockLog }
      );

      const parsed = JSON.parse(result);
      expect(parsed.textContent).toBe('col1,col2\na,b\n');
    });

    it('should NOT include textContent for binary files', async () => {
      createMockDrive({ name: 'photo.png', mimeType: 'image/png' });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/photo.png' },
        { log: mockLog }
      );

      const parsed = JSON.parse(result);
      expect(parsed.textContent).toBeUndefined();
    });

    it('should truncate text content to 50000 characters', async () => {
      const bigText = 'x'.repeat(80_000);
      mockReadFileSync.mockReturnValue(bigText);
      createMockDrive({ name: 'big.txt', mimeType: 'text/plain' });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/big.txt' },
        { log: mockLog }
      );

      const parsed = JSON.parse(result);
      expect(parsed.textContent.length).toBe(50_000);
    });

    it('should extract text from blob files with text MIME types', async () => {
      mockReadFileSync.mockReturnValue('hello world');
      const { filesGet, filesExport } = createMockDrive({
        name: 'notes.txt',
        mimeType: 'text/plain',
      });

      const result = await toolExecute(
        { fileId: 'f1', savePath: './downloads/notes.txt' },
        { log: mockLog }
      );

      // Downloaded via files.get (not export)
      expect(filesGet).toHaveBeenCalledWith(
        expect.objectContaining({ alt: 'media' }),
        expect.anything()
      );
      expect(filesExport).not.toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed.textContent).toBe('hello world');
    });
  });

  describe('optional savePath', () => {
    it('should default to cwd + filename for blob files', async () => {
      createMockDrive({ name: 'report.pdf', mimeType: 'application/pdf' });

      await toolExecute({ fileId: 'f1' }, { log: mockLog });

      expect(mockMkdirSync).toHaveBeenCalledWith(process.cwd(), { recursive: true });
      expect(mockCreateWriteStream).toHaveBeenCalledWith(path.join(process.cwd(), 'report.pdf'));
    });

    it('should default to cwd + name + .md for workspace docs', async () => {
      createMockDrive({
        name: 'My Notes',
        mimeType: 'application/vnd.google-apps.document',
      });

      const result = await toolExecute({ fileId: 'f1' }, { log: mockLog });

      const parsed = JSON.parse(result);
      expect(parsed.savedTo).toBe(path.join(process.cwd(), 'My Notes.md'));
    });

    it('should use custom export extension when exportMimeType overrides default', async () => {
      createMockDrive({
        name: 'Budget',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      });

      const result = await toolExecute(
        { fileId: 'f1', exportMimeType: 'application/pdf' },
        { log: mockLog }
      );

      const parsed = JSON.parse(result);
      expect(parsed.savedTo).toBe(path.join(process.cwd(), 'Budget.pdf'));
    });
  });

  describe('parent directory creation', () => {
    it('should call mkdirSync with exact dirname and recursive: true', async () => {
      createMockDrive();

      await toolExecute(
        { fileId: 'f1', savePath: './downloads/sub/dir/file.pdf' },
        { log: mockLog }
      );

      expect(mockMkdirSync).toHaveBeenCalledWith(
        path.dirname(path.resolve('./downloads/sub/dir/file.pdf')),
        { recursive: true }
      );
    });
  });

  describe('error cleanup', () => {
    it('should delete partial file and throw UserError on pipeline failure', async () => {
      createMockDrive();
      mockPipeline.mockRejectedValue(new Error('network timeout'));

      await expect(
        toolExecute({ fileId: 'f1', savePath: './downloads/partial.pdf' }, { log: mockLog })
      ).rejects.toThrow(UserError);

      await expect(
        toolExecute({ fileId: 'f1', savePath: './downloads/partial.pdf' }, { log: mockLog })
      ).rejects.toThrow(/network timeout/);

      expect(mockUnlinkSync).toHaveBeenCalledWith(path.resolve('./downloads/partial.pdf'));
    });
  });

  describe('absolute path outside the download roots', () => {
    // `savePath` is chosen by the agent, which routinely reads untrusted
    // content, so an unrestricted absolute path is an arbitrary file write
    // primitive (#146). Writing outside the working directory is still
    // supported, but the operator opts into it rather than the agent.
    afterEach(() => {
      delete process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS;
    });

    it('should refuse an absolute savePath outside the allowed roots', async () => {
      createMockDrive();

      await expect(
        toolExecute({ fileId: 'f1', savePath: '/tmp/test-downloads/report.pdf' }, { log: mockLog })
      ).rejects.toThrow(UserError);

      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockCreateWriteStream).not.toHaveBeenCalled();
    });

    it('should accept the same path when the operator allows that root', async () => {
      process.env.GOOGLE_DOCS_MCP_DOWNLOAD_ROOTS = '/tmp/test-downloads';
      createMockDrive();

      const result = await toolExecute(
        { fileId: 'f1', savePath: '/tmp/test-downloads/report.pdf' },
        { log: mockLog }
      );

      const parsed = JSON.parse(result);
      expect(parsed.savedTo).toBe('/tmp/test-downloads/report.pdf');
      expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/test-downloads', { recursive: true });
    });

    it('should refuse ../ traversal out of the working directory', async () => {
      createMockDrive();

      await expect(
        toolExecute(
          { fileId: 'f1', savePath: '../../../../../../etc/cron.d/pwn' },
          { log: mockLog }
        )
      ).rejects.toThrow(UserError);

      expect(mockCreateWriteStream).not.toHaveBeenCalled();
    });
  });

  describe('unsupported workspace type', () => {
    it('should throw UserError for types without export defaults', async () => {
      createMockDrive({
        name: 'My Form',
        mimeType: 'application/vnd.google-apps.form',
      });

      await expect(
        toolExecute({ fileId: 'f1', savePath: './downloads/form' }, { log: mockLog })
      ).rejects.toThrow(UserError);

      await expect(
        toolExecute({ fileId: 'f1', savePath: './downloads/form' }, { log: mockLog })
      ).rejects.toThrow(/form/);
    });
  });
});

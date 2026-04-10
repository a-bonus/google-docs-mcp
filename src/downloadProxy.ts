import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { stream } from 'hono/streaming';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { FastMCP } from 'fastmcp';

interface PendingDownload {
  fileId: string;
  accessToken: string;
  exportMime?: string;
  fileName: string;
  mimeType: string;
  isWorkspace: boolean;
  expiresAt: number;
}

const pending = new Map<string, PendingDownload>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
}, 60_000).unref();

/**
 * Sanitise a filename for safe use in a Content-Disposition header.
 * Strips CR, LF, and NUL characters that could cause header injection or
 * trigger an error in the `Headers` API. Falls back to "download" when the
 * result would be empty.
 */
export function sanitizeFileName(name: string): string {
  const sanitized = name.replace(/[\r\n\0]/g, '');
  return sanitized || 'download';
}

export function createDownloadToken(opts: Omit<PendingDownload, 'expiresAt'>): string {
  const token = crypto.randomUUID();
  pending.set(token, { ...opts, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

export function registerDownloadRoute(server: FastMCP): void {
  const app = server.getApp();
  app.get('/download/:token', async (c) => {
    const token = c.req.param('token');
    const entry = pending.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      return c.text('Download link expired or invalid.', 410);
    }
    pending.delete(token);

    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: entry.accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const safeName = sanitizeFileName(entry.fileName);
    c.header(
      'Content-Disposition',
      `attachment; filename="${safeName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    );

    if (entry.isWorkspace && entry.exportMime) {
      c.header('Content-Type', entry.exportMime);
      const res = await drive.files.export(
        { fileId: entry.fileId, mimeType: entry.exportMime },
        { responseType: 'stream' }
      );
      const webStream = Readable.toWeb(res.data as Readable) as ReadableStream;
      return stream(c, async (s) => {
        await s.pipe(webStream);
      });
    } else {
      c.header('Content-Type', entry.mimeType);
      const res = await drive.files.get(
        { fileId: entry.fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
      const webStream = Readable.toWeb(res.data as Readable) as ReadableStream;
      return stream(c, async (s) => {
        await s.pipe(webStream);
      });
    }
  });
}

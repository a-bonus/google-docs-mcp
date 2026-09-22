import { describe, it, expect } from 'vitest';
import {
  createStoredTokenPayload,
  describeMissingCredentials,
  extractClientSecrets,
  sanitizeStoredTokenCredentials,
} from './auth.js';

describe('OAuth token storage', () => {
  it('stores only the refresh token after authorization', () => {
    const payload = createStoredTokenPayload({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: 'https://www.googleapis.com/auth/documents',
      token_type: 'Bearer',
      expiry_date: 1234567890,
    });

    expect(payload).toEqual({ refresh_token: 'refresh-token' });
  });

  it('ignores OAuth client metadata from legacy token files', () => {
    const credentials = sanitizeStoredTokenCredentials({
      type: 'authorized_user',
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
      access_token: 'access-token',
      scope: 'scope-a scope-b',
      token_type: 'Bearer',
      expiry_date: 1234567890,
    });

    expect(credentials).toEqual({
      refresh_token: 'refresh-token',
      access_token: 'access-token',
      scope: 'scope-a scope-b',
      token_type: 'Bearer',
      expiry_date: 1234567890,
    });
    expect(credentials).not.toHaveProperty('client_id');
    expect(credentials).not.toHaveProperty('client_secret');
  });

  it('rejects saved tokens without OAuth token credentials', () => {
    expect(() =>
      sanitizeStoredTokenCredentials({
        client_id: 'client-id',
        client_secret: 'client-secret',
      })
    ).toThrow('Saved token does not contain OAuth token credentials');
  });
});

describe('missing OAuth credentials message (issue #57)', () => {
  const CREDS = '/Users/oliver/credentials.json';

  it('names the exact path it looked in', () => {
    const message = describeMissingCredentials(CREDS);
    expect(message).toContain(CREDS);
  });

  it('tells the user how to finish setup', () => {
    expect(describeMissingCredentials(CREDS)).toContain('auth');
  });

  it('calls out a half-configured environment instead of claiming nothing is set', () => {
    const idOnly = describeMissingCredentials(CREDS, 'client-id', undefined);
    expect(idOnly).toContain('GOOGLE_CLIENT_SECRET is not');
    expect(idOnly).not.toContain('No OAuth credentials found');

    const secretOnly = describeMissingCredentials(CREDS, undefined, 'client-secret');
    expect(secretOnly).toContain('GOOGLE_CLIENT_ID is not');
    expect(secretOnly).not.toContain('No OAuth credentials found');
  });

  it('falls back to the generic message when nothing is configured', () => {
    const message = describeMissingCredentials(CREDS);
    expect(message).toContain('No OAuth credentials found');
    expect(message).toContain('GOOGLE_CLIENT_ID');
  });
});

describe('credentials.json shape validation (issue #57)', () => {
  const CREDS = '/Users/oliver/credentials.json';

  it('accepts a normal desktop-app OAuth client', () => {
    expect(
      extractClientSecrets({ installed: { client_id: 'id', client_secret: 'secret' } }, CREDS)
    ).toEqual({ client_id: 'id', client_secret: 'secret' });
  });

  it('accepts a web OAuth client', () => {
    expect(
      extractClientSecrets({ web: { client_id: 'id', client_secret: 'secret' } }, CREDS)
    ).toEqual({ client_id: 'id', client_secret: 'secret' });
  });

  it('explains a service-account key instead of failing later', () => {
    // The file people most often download by mistake.
    expect(() =>
      extractClientSecrets({ type: 'service_account', private_key: 'x' }, CREDS)
    ).toThrow(/no "installed" or "web" section/);
  });

  it('names the missing field rather than throwing a destructuring error', () => {
    // Previously this returned undefined and surfaced as
    // "Cannot destructure property 'client_secret' ... as it is undefined".
    expect(() => extractClientSecrets({ installed: { client_id: 'id' } }, CREDS)).toThrow(
      /missing client_secret/
    );
    expect(() => extractClientSecrets({ installed: { client_secret: 's' } }, CREDS)).toThrow(
      /missing client_id/
    );
    expect(() => extractClientSecrets({ installed: {} }, CREDS)).toThrow(
      /missing client_id and client_secret/
    );
  });

  it('always names the file it is complaining about', () => {
    try {
      extractClientSecrets({}, CREDS);
      throw new Error('expected a rejection');
    } catch (error: any) {
      expect(error.message).toContain(CREDS);
    }
  });

  it('does not crash on null or a non-object', () => {
    expect(() => extractClientSecrets(null, CREDS)).toThrow(/no "installed" or "web" section/);
    expect(() => extractClientSecrets('nonsense', CREDS)).toThrow(/no "installed" or "web"/);
  });
});

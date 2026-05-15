import { describe, it, expect } from 'vitest';
import { createStoredTokenPayload, sanitizeStoredTokenCredentials } from './auth.js';

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

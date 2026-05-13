import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from './listGoogleSheets.js';

const mockList = vi.fn();

vi.mock('../../clients.js', () => ({
  getDriveClient: vi.fn(async () => ({
    files: {
      list: mockList,
    },
  })),
}));

describe('listGoogleSheets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: { files: [] } });
  });

  it('escapes search text before interpolating it into the Drive query', async () => {
    const tools: any[] = [];
    register({ addTool: (tool: any) => tools.push(tool) } as any);

    await tools[0].execute(
      {
        maxResults: 20,
        query: "owner's \\ budget",
        orderBy: 'modifiedTime',
      },
      { log: { info: vi.fn(), error: vi.fn() } }
    );

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        q:
          "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and " +
          "(name contains 'owner\\'s \\\\ budget' or fullText contains 'owner\\'s \\\\ budget')",
      })
    );
  });
});

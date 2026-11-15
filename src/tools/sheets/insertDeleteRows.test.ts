import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserError } from 'fastmcp';
import { getSheetsClient } from '../../clients.js';
import { resolveSheetId } from '../../googleSheetsApiHelpers.js';
import { register as registerInsertRows } from './insertRows.js';
import { register as registerDeleteRows } from './deleteRows.js';

vi.mock('../../clients.js', () => ({
  getSheetsClient: vi.fn(),
}));

vi.mock('../../googleSheetsApiHelpers.js', () => ({
  resolveSheetId: vi.fn(),
}));

const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
let batchUpdate: ReturnType<typeof vi.fn>;

type Tool = { parameters: any; execute: (args: any, context: any) => Promise<string> };

function loadTool(register: (server: any) => void): Tool {
  let tool: Tool | undefined;
  register({ addTool: (config: Tool) => (tool = config) });
  return tool!;
}

/** Validates args with the tool's own Zod schema (applies defaults), then executes. */
async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute(tool.parameters.parse(args), { log: mockLog });
}

function sentRequest() {
  expect(batchUpdate).toHaveBeenCalledOnce();
  const call = batchUpdate.mock.calls[0][0];
  expect(call.spreadsheetId).toBe('sheet-id');
  expect(call.requestBody.requests).toHaveLength(1);
  return call.requestBody.requests[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  batchUpdate = vi.fn(async () => ({ data: { replies: [{}] } }));
  vi.mocked(getSheetsClient).mockResolvedValue({ spreadsheets: { batchUpdate } } as any);
  vi.mocked(resolveSheetId).mockResolvedValue(42);
});

describe('insertRows', () => {
  const tool = loadTool(registerInsertRows);

  it('inserts rows above startRow with 0-based indices and inherits from the row above', async () => {
    const result = await run(tool, { spreadsheetId: 'sheet-id', startRow: 8, count: 9 });

    expect(sentRequest()).toEqual({
      insertDimension: {
        range: { sheetId: 42, dimension: 'ROWS', startIndex: 7, endIndex: 16 },
        inheritFromBefore: true,
      },
    });
    expect(result).toContain('rows 8–16');
  });

  it('defaults count to 1', async () => {
    await run(tool, { spreadsheetId: 'sheet-id', startRow: 3 });
    expect(sentRequest().insertDimension.range).toMatchObject({ startIndex: 2, endIndex: 3 });
  });

  it('does not inherit from before when inserting at row 1', async () => {
    await run(tool, { spreadsheetId: 'sheet-id', startRow: 1, count: 2 });
    expect(sentRequest().insertDimension.inheritFromBefore).toBe(false);
  });

  it('respects an explicit inheritFromBefore: false', async () => {
    await run(tool, { spreadsheetId: 'sheet-id', startRow: 5, inheritFromBefore: false });
    expect(sentRequest().insertDimension.inheritFromBefore).toBe(false);
  });

  it('resolves the sheet by name', async () => {
    await run(tool, { spreadsheetId: 'sheet-id', sheetName: 'Data', startRow: 2 });
    expect(resolveSheetId).toHaveBeenCalledWith(expect.anything(), 'sheet-id', 'Data');
  });

  it('rejects invalid input', () => {
    const base = { spreadsheetId: 'sheet-id' };
    expect(tool.parameters.safeParse({ ...base, startRow: 0 }).success).toBe(false);
    expect(tool.parameters.safeParse({ ...base, startRow: 2, count: 0 }).success).toBe(false);
    expect(
      tool.parameters.safeParse({ ...base, startRow: 1, inheritFromBefore: true }).success
    ).toBe(false);
  });

  it('wraps API errors in a UserError', async () => {
    batchUpdate.mockRejectedValueOnce(new Error('boom'));
    await expect(run(tool, { spreadsheetId: 'sheet-id', startRow: 2 })).rejects.toThrow(UserError);
  });
});

describe('deleteRows', () => {
  const tool = loadTool(registerDeleteRows);

  it('deletes an inclusive 1-based row range', async () => {
    const result = await run(tool, { spreadsheetId: 'sheet-id', startRow: 16, endRow: 18 });

    expect(sentRequest()).toEqual({
      deleteDimension: {
        range: { sheetId: 42, dimension: 'ROWS', startIndex: 15, endIndex: 18 },
      },
    });
    expect(result).toContain('deleted 3 row(s)');
  });

  it('deletes a single row', async () => {
    await run(tool, { spreadsheetId: 'sheet-id', startRow: 4, endRow: 4 });
    expect(sentRequest().deleteDimension.range).toMatchObject({ startIndex: 3, endIndex: 4 });
  });

  it('rejects endRow before startRow', () => {
    expect(
      tool.parameters.safeParse({ spreadsheetId: 'sheet-id', startRow: 5, endRow: 4 }).success
    ).toBe(false);
  });

  it('passes UserErrors through unchanged', async () => {
    vi.mocked(resolveSheetId).mockRejectedValueOnce(new UserError('Sheet "X" not found.'));
    await expect(
      run(tool, { spreadsheetId: 'sheet-id', sheetName: 'X', startRow: 1, endRow: 1 })
    ).rejects.toThrow('Sheet "X" not found.');
  });
});

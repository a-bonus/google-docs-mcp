import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSheetsClientMock } = vi.hoisted(() => ({
  getSheetsClientMock: vi.fn(),
}));

vi.mock('../../clients.js', () => ({
  getSheetsClient: getSheetsClientMock,
}));

import { register as registerExtractSheetHyperlink } from './extractSheetHyperlink.js';
import { register as registerFollowSheetHyperlink } from './followSheetHyperlink.js';

function captureToolConfig(registerTool: (server: any) => void) {
  let config: any;
  registerTool({
    addTool(input: any) {
      config = input;
    },
  });
  return config;
}

function parseToolResult(result: any) {
  const text = typeof result === 'string' ? result : result.content?.[0]?.text;
  const parts = text.split('\n\n');
  return JSON.parse(parts[parts.length - 1]);
}

describe('sheet hyperlink tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extractSheetHyperlink falls back to the HYPERLINK formula when needed', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { title: 'Ops' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { title: 'Ops' },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        {
                          formattedValue: 'Start process',
                          userEnteredValue: {
                            formulaValue:
                              '=HYPERLINK("https://example.com/run?id=42", "Start process")',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

    getSheetsClientMock.mockResolvedValue({
      spreadsheets: { get },
    });

    const tool = captureToolConfig(registerExtractSheetHyperlink);
    const parsed = tool.parameters.parse({
      spreadsheetId: 'spreadsheet-1',
      cell: 'B2',
    });

    const result = await tool.execute(parsed, { log: { info() {}, error() {} } });
    const payload = parseToolResult(result);

    expect(get).toHaveBeenNthCalledWith(1, {
      spreadsheetId: 'spreadsheet-1',
      includeGridData: false,
    });
    expect(get).toHaveBeenNthCalledWith(2, {
      spreadsheetId: 'spreadsheet-1',
      ranges: ['Ops!B2'],
      includeGridData: true,
      fields:
        'sheets.properties.title,sheets.data.rowData.values.formattedValue,sheets.data.rowData.values.hyperlink,sheets.data.rowData.values.textFormatRuns,sheets.data.rowData.values.userEnteredFormat.textFormat.link,sheets.data.rowData.values.userEnteredValue.formulaValue,sheets.data.startRow,sheets.data.startColumn',
    });
    expect(payload).toEqual({
      spreadsheetId: 'spreadsheet-1',
      requestedCell: 'B2',
      cell: 'B2',
      sheetName: 'Ops',
      formattedValue: 'Start process',
      formula: '=HYPERLINK("https://example.com/run?id=42", "Start process")',
      url: 'https://example.com/run?id=42',
      linkSource: 'formula',
    });
  });

  it('followSheetHyperlink resolves the link and performs an HTTP GET', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { title: 'Ops' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { title: 'Ops' },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        {
                          formattedValue: 'Run',
                          hyperlink: 'https://example.com/run',
                          userEnteredValue: {
                            formulaValue: '=HYPERLINK("https://example.com/run", "Run")',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/final',
      headers: {
        get: vi.fn().mockReturnValue('text/html; charset=utf-8'),
      },
      text: vi.fn().mockResolvedValue('  Process started successfully.  '),
    });

    vi.stubGlobal('fetch', fetchMock);
    getSheetsClientMock.mockResolvedValue({
      spreadsheets: { get },
    });

    const tool = captureToolConfig(registerFollowSheetHyperlink);
    const parsed = tool.parameters.parse({
      spreadsheetId: 'spreadsheet-1',
      cell: 'Ops!B2',
    });

    const result = await tool.execute(parsed, { log: { info() {}, error() {} } });
    const payload = parseToolResult(result);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[0] as URL).toString()).toBe('https://example.com/run');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'GET',
        redirect: 'follow',
      })
    );
    expect(payload).toEqual({
      success: true,
      spreadsheetId: 'spreadsheet-1',
      requestedCell: 'Ops!B2',
      cell: 'B2',
      sheetName: 'Ops',
      formattedValue: 'Run',
      formula: '=HYPERLINK("https://example.com/run", "Run")',
      url: 'https://example.com/run',
      linkSource: 'cellHyperlink',
      resolvedUrl: 'https://example.com/run',
      httpStatus: 200,
      statusText: 'OK',
      finalUrl: 'https://example.com/final',
      contentType: 'text/html; charset=utf-8',
      responseSnippet: 'Process started successfully.',
    });
  });

  it('followSheetHyperlink rejects unsupported protocols', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { title: 'Ops' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { title: 'Ops' },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        {
                          formattedValue: 'Mail',
                          hyperlink: 'mailto:test@example.com',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getSheetsClientMock.mockResolvedValue({
      spreadsheets: { get },
    });

    const tool = captureToolConfig(registerFollowSheetHyperlink);
    const parsed = tool.parameters.parse({
      spreadsheetId: 'spreadsheet-1',
      cell: 'A1',
    });

    await expect(tool.execute(parsed, { log: { info() {}, error() {} } })).rejects.toThrow(
      'Unsupported hyperlink protocol "mailto:". Only http and https are supported.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

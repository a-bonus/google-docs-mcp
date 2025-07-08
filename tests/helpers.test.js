// tests/helpers.test.js
import { findTextRange } from '../dist/googleDocsApiHelpers.js';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

describe('Text Range Finding', () => {
  // Test hypothesis 1: Text range finding works correctly
  
  describe('findTextRange', () => {
    it('should find text within a single text run correctly', async () => {
      // Create a mock function that returns the expected structure
      const mockGetFn = async () => ({
        data: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      startIndex: 1,
                      endIndex: 25,
                      textRun: {
                        content: 'This is a test sentence.'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      
      // Track calls manually
      const mockCalls = [];
      const mockGet = async (params) => {
        mockCalls.push({ arguments: [params] });
        return await mockGetFn();
      };
      mockGet.mock = { calls: mockCalls };
      
      const mockDocs = {
        documents: {
          get: mockGet
        }
      };

      // Test finding "test" in the sample text
      const result = await findTextRange(mockDocs, 'doc123', 'test', 1);
      assert.deepStrictEqual(result, { startIndex: 11, endIndex: 15 });
      
      // Verify the docs.documents.get was called with the right parameters
      assert.strictEqual(mockGet.mock.calls.length, 1);
      assert.deepStrictEqual(
        mockGet.mock.calls[0].arguments[0], 
        {
          documentId: 'doc123',
          fields: 'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))'
        }
      );
    });
    
    it('should find the nth instance of text correctly', async () => {
      // Mock with a document that has repeated text
      const mockGetFn2 = async () => ({
        data: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      startIndex: 1,
                      endIndex: 41,
                      textRun: {
                        content: 'Test test test. This is a test sentence.'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      
      const mockCalls2 = [];
      const mockGet2 = async (params) => {
        mockCalls2.push({ arguments: [params] });
        return await mockGetFn2();
      };
      mockGet2.mock = { calls: mockCalls2 };
      
      const mockDocs2 = {
        documents: {
          get: mockGet2
        }
      };

      // Find the 3rd instance of "test"
      const result = await findTextRange(mockDocs2, 'doc123', 'test', 3);
      assert.deepStrictEqual(result, { startIndex: 27, endIndex: 31 });
    });

    it('should return null if text is not found', async () => {
      const mockGetFn3 = async () => ({
        data: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      startIndex: 1,
                      endIndex: 25,
                      textRun: {
                        content: 'This is a sample sentence.'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      
      const mockCalls3 = [];
      const mockGet3 = async (params) => {
        mockCalls3.push({ arguments: [params] });
        return await mockGetFn3();
      };
      mockGet3.mock = { calls: mockCalls3 };
      
      const mockDocs3 = {
        documents: {
          get: mockGet3
        }
      };

      // Try to find text that doesn't exist
      const result = await findTextRange(mockDocs3, 'doc123', 'test', 1);
      assert.strictEqual(result, null);
    });

    it('should handle text spanning multiple text runs', async () => {
      const mockGetFn4 = async () => ({
        data: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      startIndex: 1,
                      endIndex: 6,
                      textRun: {
                        content: 'This '
                      }
                    },
                    {
                      startIndex: 6,
                      endIndex: 11,
                      textRun: {
                        content: 'is a '
                      }
                    },
                    {
                      startIndex: 11,
                      endIndex: 20,
                      textRun: {
                        content: 'test case'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      
      const mockCalls4 = [];
      const mockGet4 = async (params) => {
        mockCalls4.push({ arguments: [params] });
        return await mockGetFn4();
      };
      mockGet4.mock = { calls: mockCalls4 };
      
      const mockDocs4 = {
        documents: {
          get: mockGet4
        }
      };

      // Find text that spans runs: "a test"
      const result = await findTextRange(mockDocs4, 'doc123', 'a test', 1);
      assert.deepStrictEqual(result, { startIndex: 9, endIndex: 15 });
    });
  });
});
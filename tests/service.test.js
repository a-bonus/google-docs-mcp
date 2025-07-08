// tests/readGoogleDoc.test.js
import { docs_v1, google } from "googleapis"
import assert from "node:assert"
import { before, describe, it } from "node:test"

import { authorize } from "../dist/auth.js"
import { GoogleDocService } from "../src/service"

// Test document ID from the user's Google Doc URL
const TEST_DOCUMENT_ID = "17Z9EE_K7K1gkH_hEzfhuhQiYTdT82Eu4_cPOdmVY9QM";

describe("readGoogleDoc Tool", () => {
  let authClient;
  // @ts-ignore
  let googleDocs;

  before(async () => {
    // Initialize Google client for testing
    try {
      authClient = await authorize();
      googleDocs = google.docs({ version: "v1", auth: authClient });

      console.log("Test setup complete - Google client initialized");
    } catch (error) {
      console.error("Failed to initialize Google client for testing:", error);
      throw error;
    }
  });

  describe("readGoogleDoc with real document", () => {
    it("should read document content and extract text", async () => {
      console.log(`Testing with document ID: ${TEST_DOCUMENT_ID}`);

      // Test the readGoogleDoc function with text format
      const result = await googleDocs.documents.get({
        documentId: TEST_DOCUMENT_ID,
        fields: "body(content(paragraph(elements(textRun(content)))))",
      });

      console.log("API call successful - document fetched");

      assert.ok(result.data, "Should return document data");
      assert.ok(result.data.body, "Should have body content");

      // Extract text content similar to the readGoogleDoc function
      let textContent = "";
      result.data.body.content?.forEach((element) => {
        element.paragraph?.elements?.forEach((pe) => {
          textContent += pe.textRun?.content || "";
        });
      });

      assert.ok(
        textContent.trim().length > 0,
        "Document should have text content",
      );

      console.log("=== DOCUMENT CONTENT ===");
      console.log(`Total document length: ${textContent.length}`);
      console.log(`First 200 characters: ${textContent.substring(0, 200)}`);
      console.log(
        `Last 200 characters: ${textContent.substring(Math.max(0, textContent.length - 200))}`,
      );
      console.log("=== END CONTENT ===");

      // Test truncation logic (similar to readGoogleDoc)
      const maxLength = 4000;
      const truncatedContent =
        textContent.length > maxLength
          ? `${textContent.substring(0, maxLength)}... [truncated ${textContent.length} chars]`
          : textContent;

      console.log(`Final content length: ${truncatedContent.length}`);

      if (textContent.length > maxLength) {
        assert.ok(
          truncatedContent.includes("... [truncated"),
          "Should include truncation indicator",
        );
        console.log("✓ Content was truncated as expected");
      } else {
        console.log("✓ Content fits within length limit");
      }
    });
  });

  describe("readGoogleDoc with tabs content using service", () => {
    it("should read document with includeTabsContent enabled and export content via service", async () => {
      console.log(
        `Testing document with tabs content enabled via service: ${TEST_DOCUMENT_ID}`,
      );

      // Use the service method instead of direct API call
      const result = await GoogleDocService.readGoogleDocWithTabs(googleDocs, {
        documentId: TEST_DOCUMENT_ID,
        includeTabsContent: true,
      });

      console.log(
        "Google Docs service method call successful - document processed",
      );

      console.log("=== SERVICE RESULT STRUCTURE ===");
      console.log("Has title:", !!result.title);
      console.log("Has mainContent:", !!result.mainContent);
      console.log("Has tabs:", !!result.tabs);
      console.log("Has summary:", !!result.summary);
      console.log("=== END STRUCTURE ===");

      assert.ok(result.title, "Should return title");
      assert.ok(result.summary, "Should return summary");
      assert.ok(Array.isArray(result.tabs), "Should return tabs array");

      // Log content details
      console.log("=== CONTENT SUMMARY ===");
      console.log(`Document title: ${result.title}`);
      console.log(`Main document length: ${result.summary.mainContentLength}`);
      console.log(`Number of tabs: ${result.summary.tabsCount}`);
      console.log(`Total content length: ${result.summary.totalContentLength}`);

      if (result.mainContent.length > 0) {
        console.log(
          `Main content first 200 chars: ${result.mainContent.substring(0, 200)}`,
        );
        console.log(
          `Main content last 200 chars: ${result.mainContent.substring(Math.max(0, result.mainContent.length - 200))}`,
        );
      }

      result.tabs.forEach((tab, index) => {
        console.log(
          `Tab ${index + 1}: "${tab.title}" (${tab.contentLength} chars)`,
        );
        if (tab.contentLength > 0) {
          console.log(`  First 100 chars: ${tab.content.substring(0, 100)}`);
          console.log(
            `  Last 100 chars: ${tab.content.substring(Math.max(0, tab.content.length - 100))}`,
          );
        }
      });

      console.log("=== END CONTENT SUMMARY ===");

      // Assertions - now using flattened results
      assert.ok(
        result.mainContent.trim().length > 0 ||
          result.tabs.length > 0,
        "Document should have either main content or tabs with content",
      );

      // Verify summary calculations
      assert.strictEqual(
        result.summary.mainContentLength,
        result.mainContent.length,
        "Summary main content length should match actual content length",
      );
      assert.strictEqual(
        result.summary.tabsCount,
        result.tabs.length,
        "Summary tabs count should match actual tabs count",
      );

      const calculatedTotalLength =
        result.mainContent.length +
        result.tabs.reduce((sum, tab) => sum + tab.contentLength, 0);
      assert.strictEqual(
        result.summary.totalContentLength,
        calculatedTotalLength,
        "Summary total content length should be calculated correctly",
      );

      // Log final structure for debugging
      console.log("=== FINAL STRUCTURE ===");
      console.log(JSON.stringify({
        title: result.title,
        mainContentLength: result.mainContent.length,
        tabsCount: result.tabs.length,
        summary: result.summary,
        pagination: result.pagination
      }, null, 2));
      console.log("=== END STRUCTURE ===");
    });

    it("should handle pagination, truncation, and tab-based fetching", async () => {
      console.log(
        `Testing pagination and truncation with small limit: ${TEST_DOCUMENT_ID}`,
      );

      // Test with very small limit to force pagination
      const smallLimit = 300; // Small limit to test pagination

      // TEST 1: First page with small limit
      const page0Result = await GoogleDocService.readGoogleDocWithTabs(
        googleDocs,
        {
          documentId: TEST_DOCUMENT_ID,
          includeTabsContent: true,
          page: 0,
          limit: smallLimit,
        },
      );

      console.log("=== PAGE 0 PAGINATION TEST ===");
      console.log(
        "Pagination info:",
        JSON.stringify(page0Result.pagination, null, 2),
      );
      console.log(
        "Content length:",
        page0Result.pagination.actualContentLength,
      );
      console.log("Truncated:", page0Result.pagination.truncated);
      console.log("Total pages:", page0Result.pagination.totalPages);
      console.log("Has next page:", page0Result.pagination.hasNextPage);
      console.log("=== END PAGE 0 TEST ===");

      // Assertions for pagination
      assert.ok(page0Result.pagination, "Should have pagination info");
      assert.strictEqual(
        page0Result.pagination.currentPage,
        0,
        "Should be on page 0",
      );
      assert.strictEqual(
        page0Result.pagination.limit,
        smallLimit,
        "Should have correct limit",
      );
      assert.ok(
        page0Result.pagination.actualContentLength <= smallLimit,
        "Should not exceed limit",
      );

      // If document is large enough, test truncation
      if (page0Result.summary.totalContentLength > smallLimit) {
        assert.ok(
          page0Result.pagination.truncated,
          "Should be truncated when content exceeds limit",
        );
        assert.ok(
          page0Result.pagination.totalPages > 1,
          "Should have multiple pages",
        );
        assert.ok(page0Result.pagination.hasNextPage, "Should have next page");
        assert.ok(
          !page0Result.pagination.hasPreviousPage,
          "Should not have previous page on page 0",
        );

        // TEST 2: Second page
        const page1Result = await GoogleDocService.readGoogleDocWithTabs(
          googleDocs,
          {
            documentId: TEST_DOCUMENT_ID,
            includeTabsContent: true,
            page: 1,
            limit: smallLimit,
          },
        );

        console.log("=== PAGE 1 PAGINATION TEST ===");
        console.log(
          "Page 1 pagination info:",
          JSON.stringify(page1Result.pagination, null, 2),
        );
        console.log(
          "Page 1 content length:",
          page1Result.pagination.actualContentLength,
        );
        console.log("=== END PAGE 1 TEST ===");

        assert.strictEqual(
          page1Result.pagination.currentPage,
          1,
          "Should be on page 1",
        );
        assert.ok(
          page1Result.pagination.hasPreviousPage,
          "Should have previous page on page 1",
        );
        assert.ok(
          page1Result.pagination.actualContentLength <= smallLimit,
          "Page 1 should not exceed limit",
        );
      }

      // TEST 3: Tab-based fetching (if tabs exist)
      if (page0Result.tabs.length > 0) {
        console.log("Available tabs:", page0Result.tabs.map(tab => ({ title: tab.title, tabId: tab.tabId, contentLength: tab.contentLength })));
        const targetTab = page0Result.tabs.length > 1 ? page0Result.tabs[1] : page0Result.tabs[0];
        console.log(`=== TAB FETCHING TEST: ${targetTab.title} ===`);

        // This test uses the readGoogleDoc method with tabId (different from readGoogleDocWithTabs)
        const tabResult = await GoogleDocService.readGoogleDoc(googleDocs, {
          documentId: TEST_DOCUMENT_ID,
          tabId: targetTab.tabId,
        });

        console.log("Tab result type:", typeof tabResult.content);
        console.log("Tab result format:", tabResult.format);
        console.log("Tab result truncated:", tabResult.truncated);
        console.log("=== END TAB FETCHING TEST ===");

        assert.ok(tabResult.content, "Should have tab content");
        assert.strictEqual(tabResult.format, "text", "Should be text format");
        assert.strictEqual(
          typeof tabResult.content,
          "string",
          "Tab content should be string",
        );

        // Test invalid tab ID
        try {
          await GoogleDocService.readGoogleDoc(googleDocs, {
            documentId: TEST_DOCUMENT_ID,
            tabId: "invalid-tab-id",
          });
          assert.fail("Should have thrown error for invalid tab ID");
        } catch (error) {
          assert.ok(
            error.message.includes("Tab with ID"),
            "Should throw error for invalid tab ID",
          );
        }
      }

      // TEST 4: Edge cases
      // Test with limit smaller than any content
      const tinyLimit = 10;
      const tinyResult = await GoogleDocService.readGoogleDocWithTabs(
        googleDocs,
        {
          documentId: TEST_DOCUMENT_ID,
          includeTabsContent: true,
          page: 0,
          limit: tinyLimit,
        },
      );

      console.log("=== TINY LIMIT TEST ===");
      console.log("Tiny limit result pages:", tinyResult.pagination.totalPages);
      console.log(
        "Tiny limit actual content:",
        tinyResult.pagination.actualContentLength,
      );
      console.log("=== END TINY LIMIT TEST ===");

      assert.ok(
        tinyResult.pagination.actualContentLength <= tinyLimit,
        "Should respect tiny limit",
      );
      assert.ok(
        tinyResult.pagination.totalPages >= 1,
        "Should have at least one page",
      );

      // TEST 5: Large limit (should fit everything)
      const largeLimit = 100000;
      const largeResult = await GoogleDocService.readGoogleDocWithTabs(
        googleDocs,
        {
          documentId: TEST_DOCUMENT_ID,
          includeTabsContent: true,
          page: 0,
          limit: largeLimit,
        },
      );

      console.log("=== LARGE LIMIT TEST ===");
      console.log("Large limit pages:", largeResult.pagination.totalPages);
      console.log("Large limit truncated:", largeResult.pagination.truncated);
      console.log("=== END LARGE LIMIT TEST ===");

      if (largeResult.summary.totalContentLength <= largeLimit) {
        assert.strictEqual(
          largeResult.pagination.totalPages,
          1,
          "Should have only one page with large limit",
        );
        assert.ok(
          !largeResult.pagination.truncated,
          "Should not be truncated with large limit",
        );
        assert.ok(
          !largeResult.pagination.hasNextPage,
          "Should not have next page with large limit",
        );
      }

      console.log("=== ALL PAGINATION TESTS COMPLETED ===");
    });
  });
});

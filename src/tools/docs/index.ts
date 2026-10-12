import type { FastMCP } from 'fastmcp';

// Core read/write
import { register as readGoogleDoc } from './readGoogleDoc.js';
import { register as listDocumentTabs } from './listDocumentTabs.js';
import { register as renameTab } from './renameTab.js';
import { register as addTab } from './addTab.js';
import { register as appendToGoogleDoc } from './appendToGoogleDoc.js';
import { register as insertText } from './insertText.js';
import { register as deleteRange } from './deleteRange.js';
import { register as modifyText } from './modifyText.js';
import { register as findAndReplace } from './findAndReplace.js';
import { register as findElement } from './findElement.js';
import { register as listSuggestions } from './listSuggestions.js';
import { register as manageSuggestions } from './manageSuggestions.js';

// Structure
import { register as insertTable } from './insertTable.js';
import { register as insertTableWithData } from './insertTableWithData.js';
import { register as insertPageBreak } from './insertPageBreak.js';
import { register as insertSectionBreak } from './insertSectionBreak.js';
import { register as updateSectionStyle } from './updateSectionStyle.js';
import { register as insertImage } from './insertImage.js';
import { register as insertDateChip } from './insertDateChip.js';
import { register as insertPerson } from './insertPerson.js';
import { register as insertRichLink } from './insertRichLink.js';
import { register as listSmartChips } from './listSmartChips.js';
import { register as cloneTable } from './cloneTable.js';
import { register as listDocumentTables } from './listDocumentTables.js';
import { register as getTableStructure } from './getTableStructure.js';
import { register as findSectionsByHeading } from './findSectionsByHeading.js';
import { register as replaceTableRowData } from './replaceTableRowData.js';
import { register as appendTableRows } from './appendTableRows.js';
import { register as deleteTableRows } from './deleteTableRows.js';

// Sub-domains
import { registerCommentTools } from './comments/index.js';
import { registerFormattingTools } from './formatting/index.js';

export function registerDocsTools(server: FastMCP) {
  // Core read/write
  readGoogleDoc(server);
  listDocumentTabs(server);
  renameTab(server);
  addTab(server);
  appendToGoogleDoc(server);
  insertText(server);
  deleteRange(server);
  modifyText(server);
  findAndReplace(server);
  findElement(server);
  listSuggestions(server);
  manageSuggestions(server);

  // Structure
  insertTable(server);
  insertTableWithData(server);
  insertPageBreak(server);
  insertSectionBreak(server);
  updateSectionStyle(server);
  insertImage(server);
  insertDateChip(server);
  insertPerson(server);
  insertRichLink(server);
  listSmartChips(server);
  cloneTable(server);
  listDocumentTables(server);
  getTableStructure(server);
  findSectionsByHeading(server);
  replaceTableRowData(server);
  appendTableRows(server);
  deleteTableRows(server);

  // Sub-domains
  registerFormattingTools(server);
  registerCommentTools(server);
}

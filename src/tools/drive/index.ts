import type { FastMCP } from 'fastmcp';
import { register as listGoogleDocs } from './listGoogleDocs.js';
import { register as searchGoogleDocs } from './searchGoogleDocs.js';
import { register as listDriveFiles } from './listDriveFiles.js';
import { register as searchDriveFiles } from './searchDriveFiles.js';
import { register as getDocumentInfo } from './getDocumentInfo.js';
import { register as createFolder } from './createFolder.js';
import { register as listFolderContents } from './listFolderContents.js';
import { register as getFolderInfo } from './getFolderInfo.js';
import { register as moveFile } from './moveFile.js';
import { register as copyFile } from './copyFile.js';
import { register as renameFile } from './renameFile.js';
import { register as deleteFile } from './deleteFile.js';
import { register as createDocument } from './createDocument.js';
import { register as markdownFiles } from './markdownFiles.js';
import { register as createFromTemplate } from './createFromTemplate.js';
import { register as downloadFile } from './downloadFile.js';
import { register as setFilePermission } from './setFilePermission.js';

export function registerDriveTools(server: FastMCP) {
  listGoogleDocs(server);
  searchGoogleDocs(server);
  listDriveFiles(server);
  searchDriveFiles(server);
  getDocumentInfo(server);
  createFolder(server);
  listFolderContents(server);
  getFolderInfo(server);
  moveFile(server);
  copyFile(server);
  renameFile(server);
  deleteFile(server);
  createDocument(server);
  markdownFiles(server);
  createFromTemplate(server);
  downloadFile(server);
  setFilePermission(server);
}

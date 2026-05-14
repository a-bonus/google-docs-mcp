export const TAB_ID_PROPERTIES = 'tabProperties(tabId)';
export const TAB_LIST_PROPERTIES = 'tabProperties(tabId,title,index,parentTabId)';

export const TAB_BODY_RANGE_FIELDS = `tabs(${TAB_ID_PROPERTIES},documentTab(body(content(startIndex,endIndex))))`;
export const TAB_BODY_END_INDEX_FIELDS = `tabs(${TAB_ID_PROPERTIES},documentTab(body(content(endIndex))))`;

const TAB_LIST_CHILD_FIELDS = `childTabs(${TAB_LIST_PROPERTIES},childTabs(${TAB_LIST_PROPERTIES},childTabs(${TAB_LIST_PROPERTIES})))`;

export const TAB_LIST_FIELDS = `title,tabs(${TAB_LIST_PROPERTIES},${TAB_LIST_CHILD_FIELDS})`;
export const TAB_LIST_WITH_CONTENT_FIELDS = `title,tabs(${TAB_LIST_PROPERTIES},${TAB_LIST_CHILD_FIELDS},documentTab(body(content(endIndex))))`;

export const TAB_FIELD_MASKS = {
  TAB_BODY_RANGE_FIELDS,
  TAB_BODY_END_INDEX_FIELDS,
  TAB_LIST_FIELDS,
  TAB_LIST_WITH_CONTENT_FIELDS,
} as const;

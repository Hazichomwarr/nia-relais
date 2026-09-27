export const HISTORY_PREVIEW_COUNT = 5;

export function getHistoryDisclosure<T>(records: readonly T[], expanded: boolean) {
  const hasHiddenRecords = records.length > HISTORY_PREVIEW_COUNT;
  const visibleRecords = expanded || !hasHiddenRecords ? records : records.slice(0, HISTORY_PREVIEW_COUNT);

  return {
    visibleRecords,
    hiddenCount: records.length - HISTORY_PREVIEW_COUNT,
    hasHiddenRecords,
  };
}

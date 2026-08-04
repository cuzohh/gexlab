export function indexLevelToFutures(
  level: number | null | undefined,
  indexSnapshotSpot: number,
  futuresSettlement: number,
) {
  if (
    level === null ||
    level === undefined ||
    !Number.isFinite(level) ||
    !(indexSnapshotSpot > 0) ||
    !(futuresSettlement > 0)
  ) return null;
  return Math.round(((level / indexSnapshotSpot) * futuresSettlement) / 0.25) * 0.25;
}

export function futuresRatio(indexSnapshotSpot: number, futuresSettlement: number) {
  return indexSnapshotSpot > 0 && futuresSettlement > 0
    ? futuresSettlement / indexSnapshotSpot
    : null;
}

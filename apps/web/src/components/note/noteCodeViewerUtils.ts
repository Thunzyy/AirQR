export const NOTE_LINE_HEIGHT_PX = 24;

export function resolveVisualNoteLineCount(
  logicalLineCount: number,
  contentScrollHeight: number,
  lineHeight = NOTE_LINE_HEIGHT_PX
): number {
  const measuredLineCount =
    lineHeight > 0 ? Math.ceil(contentScrollHeight / lineHeight) : 0;
  return Math.max(1, logicalLineCount, measuredLineCount);
}

export const NOTE_GROUP_GAP = 2 * 60 * 1000;

export function noteGrouping(createdAt: string, previousCreatedAt?: string) {
  const date = new Date(createdAt);
  const previous = previousCreatedAt ? new Date(previousCreatedAt) : null;
  const startsNewDay = !previous || date.toDateString() !== previous.toDateString();
  const elapsed = previous ? date.getTime() - previous.getTime() : Infinity;
  const startsGroup = startsNewDay || elapsed > NOTE_GROUP_GAP || elapsed < 0;
  const startsMinute = startsGroup || (
    previous !== null &&
    Math.floor(date.getTime() / 60000) !== Math.floor(previous.getTime() / 60000)
  );
  return { startsNewDay, startsGroup, startsMinute };
}

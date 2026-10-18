export function noteGrouping(
  createdAt: string,
  previousCreatedAt?: string,
  groupMinutes = 2,
) {
  const date = new Date(createdAt);
  const previous = previousCreatedAt ? new Date(previousCreatedAt) : null;
  const startsNewDay = !previous || date.toDateString() !== previous.toDateString();
  const elapsed = previous ? date.getTime() - previous.getTime() : Infinity;
  const startsGroup = startsNewDay || elapsed > groupMinutes * 60000 || elapsed < 0;
  return { startsNewDay, startsGroup };
}

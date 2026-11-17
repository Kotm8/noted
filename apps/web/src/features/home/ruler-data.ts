import { wallTime, zonedParts } from "../schedule/dates";

export function daySegment(
  start: string,
  end: string,
  day: string,
  timezone: string,
) {
  const first = zonedParts(start, timezone);
  const last = zonedParts(end, timezone);
  if (
    first.date > day ||
    last.date < day ||
    (last.date === day && last.minute === 0)
  )
    return null;
  const segment = {
    start: first.date < day ? 0 : first.minute,
    end: last.date > day ? 1440 : last.minute,
  };
  return segment.end > segment.start ? segment : null;
}

export function occupiedMinutes(
  ranges: { start: number; end: number }[],
  start = 0,
  end = 1440,
) {
  const sorted = ranges
    .map((range) => ({
      start: Math.max(start, range.start),
      end: Math.min(end, range.end),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let until = start;
  for (const range of sorted) {
    total += Math.max(0, range.end - Math.max(until, range.start));
    until = Math.max(until, range.end);
  }
  return total;
}

export function trackedSeconds(
  sessions: { started_at: string; ended_at: string | null }[],
  day: string,
  timezone: string,
  now: number,
) {
  const start = Date.parse(wallTime(day, 0, timezone));
  const end = Date.parse(wallTime(day, 1440, timezone));
  return sessions.reduce(
    (sum, session) =>
      sum +
      Math.max(
        0,
        Math.min(
          Date.parse(session.ended_at ?? new Date(now).toISOString()),
          end,
          now,
        ) - Math.max(Date.parse(session.started_at), start),
      ) /
        1000,
    0,
  );
}

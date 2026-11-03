import { scheduleApi } from "./api";
import { addDays, wallTime, weekDays } from "./dates";

/**
 * The calendar loads fixed four-week blocks instead of single weeks: one request covers a
 * month of scrolling, and blocks always start on the same Mondays, so every view and the
 * startup preload share cached blocks. Four weeks stays inside the server's 35-day limit.
 */
export const BLOCK_WEEKS = 4;
const BLOCK_DAYS = BLOCK_WEEKS * 7;
const EPOCH = "2024-01-01";

export function blockStart(day: string): string {
  const monday = weekDays(day)[0];
  const days = Math.round(
    (Date.parse(`${monday}T12:00:00Z`) - Date.parse(`${EPOCH}T12:00:00Z`)) /
      86400000,
  );
  return addDays(EPOCH, Math.floor(days / BLOCK_DAYS) * BLOCK_DAYS);
}

export function blockQuery(first: string, timezone: string) {
  const start = wallTime(first, 0, timezone);
  const end = wallTime(addDays(first, BLOCK_DAYS), 0, timezone);
  return {
    queryKey: ["schedule", start, end],
    queryFn: () => scheduleApi.board(start, end),
  };
}

/** The block holding `day`, with one block before and after it already on screen. */
export function blocksAround(day: string) {
  return {
    first: addDays(blockStart(day), -BLOCK_DAYS),
    weeks: BLOCK_WEEKS * 3,
  };
}

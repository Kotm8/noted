export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function weekDays(day: string): string[] {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => addDays(day, index - weekday));
}
export function zonedParts(value: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}
export function wallTime(
  day: string,
  minute: number,
  timezone: string,
): string {
  const target = new Date(`${day}T00:00:00Z`).getTime() + minute * 60000;
  let guess = target;
  for (let index = 0; index < 4; index++) {
    const local = zonedParts(guess, timezone);
    const represented =
      Date.parse(`${local.date}T00:00:00Z`) + local.minute * 60000;
    const delta = target - represented;
    if (!delta) return new Date(guess).toISOString();
    guess += delta;
  }
  throw new Error("This time does not exist in the selected timezone.");
}
export function defaultPlanTimes(timezone: string, now = Date.now()) {
  const { minute } = zonedParts(now, timezone);
  const start = Math.min(1425, Math.round(minute / 15) * 15);
  return { start_minute: start, end_minute: Math.min(1440, start + 60) };
}
export function dayLabel(
  day: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  },
): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}
export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
export function duration(seconds: number): string {
  const minute = Math.max(0, Math.floor(seconds / 60));
  return minute < 60
    ? `${minute}m`
    : `${Math.floor(minute / 60)}h${minute % 60 ? ` ${minute % 60}m` : ""}`;
}

export function dateRangeLabel(first: string, last: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(new Date(`${first}T12:00:00Z`), new Date(`${last}T12:00:00Z`));
}

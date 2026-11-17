export function money(amount: number, currency: string, compact = false) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: compact && amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function minor(value: string): number {
  const text = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text))
    throw new Error("Enter an amount with up to two decimal places.");
  const [whole, decimal = ""] = text.replace("-", "").split(".");
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 9_000_000_000_000)
    throw new Error("This amount is too large.");
  return text.startsWith("-") ? -amount : amount;
}

export function dateLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function shiftMonth(day: string, offset: number) {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

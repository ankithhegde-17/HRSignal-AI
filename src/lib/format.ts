import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy") : fallback;
}

export function formatDateShort(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "d MMM") : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy, HH:mm") : fallback;
}

export function formatTime(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "HH:mm") : fallback;
}

export function formatRelative(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? `${formatDistanceToNowStrict(date)} ago` : fallback;
}

export function formatPercent(value: number | null | undefined, digits = 1, fallback = "—") {
  if (value == null || Number.isNaN(value)) return fallback;
  return `${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, fallback = "—") {
  if (value == null || Number.isNaN(value)) return fallback;
  return Number(value).toFixed(1);
}

export function formatNumber(value: number | null | undefined, fallback = "—") {
  if (value == null || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Builds an inclusive ISO date range ending today, for the supplied day count. */
export function dateRangeForDays(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

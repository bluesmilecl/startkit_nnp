let currentLocale = 'es-CL';
let currentTimeZone: string | undefined;
/** Same locale/time zone on server and client to keep SSR hydration stable. */
export function setFormatLocale(locale: string, timeZone?: string): void {
  currentLocale = locale || 'es-CL';
  currentTimeZone = timeZone;
}
const locale = () => currentLocale;

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale(), { timeZone: currentTimeZone, ...opts }).format(d);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Formats a decimal USD string without converting through binary floats for display rounding. */
export function formatUsd(value: string | null | undefined, digits = 4): string {
  if (value === null || value === undefined) return 'desconocido';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'desconocido';
  return `US$ ${n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString(locale());
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

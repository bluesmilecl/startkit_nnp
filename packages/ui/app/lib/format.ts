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
  // Sub-cent amounts (single AI calls) keep three significant digits instead of rounding to 0.00.
  if (n !== 0 && Math.abs(n) < 0.01) return `US$ ${n.toLocaleString(locale(), { maximumSignificantDigits: 3 })}`;
  const max = Math.max(0, Math.min(20, digits));
  return `US$ ${n.toLocaleString(locale(), { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max })}`;
}

/** Visual CLP conversion of a USD amount with a dated rate (never used for accounting). */
export function formatClp(usd: string | null | undefined, rate: string | number): string {
  if (usd === null || usd === undefined) return 'desconocido';
  const n = Number(usd) * Number(rate);
  if (!Number.isFinite(n)) return 'desconocido';
  const digits = Math.abs(n) < 10 ? 2 : 0;
  return `CLP$ ${n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Price per million units, e.g. "US$ 0.15 / 1M". */
export function formatPerMillion(price: string, unitQuantity: number): string {
  const n = (Number(price) * 1_000_000) / unitQuantity;
  return `US$ ${n.toLocaleString(locale(), { maximumFractionDigits: 4 })} / 1M`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString(locale());
}

/** Relative change as a signed percentage: 0.124 → "+12,4 %". */
export function formatPercentChange(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  const text = new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits, signDisplay: 'exceptZero' }).format(ratio);
  return text;
}

/** Share as a percentage: 0.62 → "62 %". */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits }).format(ratio);
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

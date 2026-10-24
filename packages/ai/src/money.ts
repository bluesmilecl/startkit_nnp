/**
 * Exact decimal arithmetic for USD amounts using bigint with 12 fractional digits (pico-dollars).
 * Prices like "0.075" per 1M tokens and costs of single tokens are represented without rounding
 * drift; nothing is ever accumulated in binary floating point.
 */
export const SCALE = 12;
const FACTOR = 10n ** BigInt(SCALE);

export type Micro = bigint;

export function toUnits(value: string | number): bigint {
  const s = typeof value === 'number' ? value.toFixed(SCALE) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal amount: ${value}`);
  const negative = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  const fracPadded = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const v = BigInt(int!) * FACTOR + BigInt(fracPadded);
  return negative ? -v : v;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

export function add(...values: (string | null | undefined)[]): string {
  return fromUnits(values.reduce<bigint>((acc, v) => acc + (v ? toUnits(v) : 0n), 0n));
}

export function sub(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function compare(a: string, b: string): number {
  const d = toUnits(a) - toUnits(b);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

/** cost = quantity × price / unitQuantity, rounded half-up at 12 decimals. */
export function costOf(quantity: number, price: string, unitQuantity: number): string {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Invalid quantity');
  const numerator = BigInt(Math.round(quantity)) * toUnits(price);
  const q = BigInt(unitQuantity);
  return fromUnits((numerator + q / 2n) / q);
}

export function percent(part: string, whole: string): number {
  const w = toUnits(whole);
  if (w === 0n) return 0;
  return Number((toUnits(part) * 10000n) / w) / 100;
}

export const ZERO = fromUnits(0n);

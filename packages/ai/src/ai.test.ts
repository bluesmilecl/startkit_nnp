import { describe, expect, it } from 'vitest';
import { assertAllowedEndpoint, isPublicAddress } from './endpoint-policy.js';
import { classifyAiError } from './errors.js';
import { add, compare, costOf, displayUsd, fromUnits, percent, sub, toUnits } from './money.js';
import { unitsFromUsage } from './services/ledger.js';

describe('money (exact decimals)', () => {
  it('adds without floating point drift', () => {
    expect(add('0.1', '0.2')).toBe('0.300000000000');
    let acc = '0';
    for (let i = 0; i < 1000; i++) acc = add(acc, '0.000000150000');
    expect(acc).toBe('0.000150000000');
  });

  it('computes per-token costs from per-million prices', () => {
    // 1 token at US$0.075 / 1M
    expect(costOf(1, '0.075', 1_000_000)).toBe('0.000000075000');
    expect(costOf(1234, '2.5', 1_000_000)).toBe('0.003085000000');
    expect(() => costOf(-1, '1', 1)).toThrow();
  });

  it('rounds half-up at 12 decimals', () => {
    expect(costOf(1, '0.0000005', 1_000_000)).toBe('0.000000000001');
    expect(costOf(1, '0.0000004', 1_000_000)).toBe('0.000000000000');
  });

  it('compares, subtracts and computes percentages', () => {
    expect(compare('1.0', '1')).toBe(0);
    expect(compare('0.000000000001', '0')).toBe(1);
    expect(sub('1', '1.5')).toBe('-0.500000000000');
    expect(percent('2.5', '10')).toBe(25);
    expect(percent('1', '0')).toBe(0);
    expect(fromUnits(toUnits('-3.25'))).toBe('-3.250000000000');
    expect(() => toUnits('1e5')).toThrow();
  });

  it('displays sub-cent amounts with significant digits', () => {
    expect(displayUsd('12.345')).toBe('US$12.35');
    expect(displayUsd('0.0000371')).toBe('US$0.0000371');
    expect(displayUsd(null)).toBe('desconocido');
  });
});

describe('usage normalization', () => {
  it('separates cached input and keeps reasoning informational', () => {
    const { units, known } = unitsFromUsage({ inputTokens: { total: 100, noCache: 70, cacheRead: 30 }, outputTokens: { total: 50, reasoning: 20 } });
    expect(known).toBe(true);
    expect(units).toEqual({ input_tokens: 70, cached_input_tokens: 30, output_tokens: 50, reasoning_tokens: 20 });
  });

  it('marks missing usage as unknown, never zero', () => {
    expect(unitsFromUsage(undefined)).toEqual({ units: {}, known: false });
    expect(unitsFromUsage({}).known).toBe(false);
  });
});

describe('provider error classification', () => {
  it('distinguishes auth, quota, missing model and network errors', () => {
    expect(classifyAiError({ statusCode: 401, message: 'Incorrect API key' }).kind).toBe('auth');
    expect(classifyAiError({ statusCode: 429, message: 'Rate limit reached' })).toMatchObject({ kind: 'quota', retryable: true });
    expect(classifyAiError({ statusCode: 404, message: 'The model gpt-x does not exist' }).kind).toBe('model_not_found');
    expect(classifyAiError(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })).kind).toBe('network');
    expect(classifyAiError({ statusCode: 400, message: 'maximum context length exceeded' }).kind).toBe('invalid_request');
  });
});

describe('custom endpoint policy (SSRF)', () => {
  it('classifies private and metadata addresses as non-public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.4.4', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });

  it('rejects credentials, plain http, private and metadata endpoints', async () => {
    await expect(assertAllowedEndpoint('https://user:pass@8.8.8.8/v1', { allowPrivate: false })).rejects.toThrow(/credenciales/);
    await expect(assertAllowedEndpoint('http://8.8.8.8/v1', { allowPrivate: false })).rejects.toThrow(/HTTPS/);
    await expect(assertAllowedEndpoint('https://10.0.0.5/v1', { allowPrivate: false })).rejects.toThrow(/red privada/);
    await expect(assertAllowedEndpoint('http://169.254.169.254/latest', { allowPrivate: true })).rejects.toThrow(/no permitido/);
    await expect(assertAllowedEndpoint('http://10.0.0.5:11434/v1', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
    await expect(assertAllowedEndpoint('https://8.8.8.8/v1', { allowPrivate: false })).resolves.toBeInstanceOf(URL);
  });
});

import { describe, expect, it } from 'vitest';
import * as lucide from '@lucide/vue';
import { ICON_GROUPS, ICON_KEYWORDS, ICON_LUCIDE, ICONS, searchIcons, type IconName } from '#ui/lib/icons';
import { changedFilterKeys, listQueryParams, parseListQuery, serializeListQuery } from '#ui/lib/list-query';
import { ApiError, describeError, isApiError, normalizeError, toApiError } from '#ui/lib/errors';
import { formatPercent, formatPercentChange, formatUsd, setFormatLocale } from '#ui/lib/format';
import { useWizard } from '#ui/composables/useWizard';

describe('icon registry', () => {
  const names = Object.keys(ICONS) as IconName[];
  it('maps every semantic name to the Lucide component it claims', () => {
    for (const n of names) expect(ICONS[n], n).toBe((lucide as Record<string, unknown>)[ICON_LUCIDE[n]]);
  });
  it('puts every icon in exactly one catalog group and gives it Spanish keywords', () => {
    const grouped = ICON_GROUPS.flatMap((g) => g.names);
    expect([...grouped].sort()).toEqual([...names].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const n of names) expect(ICON_KEYWORDS[n].length, n).toBeGreaterThan(2);
  });
  it('searches semantic names, Lucide names and Spanish keywords, ignoring accents', () => {
    expect(searchIcons('eliminar')).toContain('delete');
    expect(searchIcons('Trash')).toContain('delete');
    expect(searchIcons('organizacion')).toContain('organization');
    expect(searchIcons('')).toHaveLength(names.length);
    expect(searchIcons('zzz-nada')).toEqual([]);
  });
});

describe('list query <-> URL', () => {
  const defaults = { page: 1, pageSize: 20, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc', archived: false };
  it('types values from their defaults and ignores unknown keys', () => {
    const q = parseListQuery({ page: '3', pageSize: '50', search: 'abc', status: 'active', archived: 'true', other: 'x' }, defaults);
    expect(q).toEqual({ page: 3, pageSize: 50, search: 'abc', status: 'active', sort: 'updatedAt', direction: 'desc', archived: true });
  });
  it('falls back to defaults on invalid or empty values and clamps page sizes', () => {
    const q = parseListQuery({ page: 'abc', pageSize: '100000', search: '', status: ['pending', 'x'] }, defaults);
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(200);
    expect(q.search).toBe('');
    expect(q.status).toBe('pending');
    expect(parseListQuery({ page: '-4' }, defaults).page).toBe(1);
  });
  it('writes only non-default values to the URL and drops empty API params', () => {
    const state = { ...defaults, page: 2, search: 'x' };
    expect(serializeListQuery(state, defaults)).toEqual({ page: '2', pageSize: undefined, search: 'x', status: undefined, sort: undefined, direction: undefined, archived: undefined });
    expect(listQueryParams({ ...defaults, search: '' })).toEqual({ page: 1, pageSize: 20, sort: 'updatedAt', direction: 'desc', archived: false });
  });
  it('detects filter changes that must reset the page', () => {
    expect(changedFilterKeys({ ...defaults, page: 4 }, { ...defaults, page: 3 })).toEqual([]);
    expect(changedFilterKeys({ ...defaults, status: 'active' }, defaults)).toEqual(['status']);
  });
});

describe('useWizard', () => {
  const steps = [
    { id: 'a', title: 'A', fields: ['name'] },
    { id: 'b', title: 'B', fields: ['plan'] },
    { id: 'c', title: 'C' },
  ];
  it('validates the step fields before advancing and only revisits reached steps', async () => {
    let valid = false;
    const checked: string[][] = [];
    const w = useWizard(steps, { validate: (f) => (checked.push(f), valid) });
    expect(await w.next()).toBe(false);
    expect(w.index.value).toBe(0);
    expect(checked).toEqual([['name']]);
    valid = true;
    expect(await w.next()).toBe(true);
    expect(w.index.value).toBe(1);
    expect(w.canGoTo(2)).toBe(false);
    expect(w.goTo(2)).toBe(false);
    expect(w.back()).toBe(true);
    expect(w.goTo(1)).toBe(true);
    expect(w.progress.value).toBeCloseTo(2 / 3);
  });
  it('runs beforeNext, keeps the step on false or errors and completes on the last step', async () => {
    let completed = 0;
    let saveFails = true;
    const w = useWizard(steps, {
      beforeNext: (s) => {
        if (s.id === 'b' && saveFails) throw new Error('No se pudo guardar');
        return s.id === 'a' ? undefined : true;
      },
      onComplete: () => void completed++,
    });
    await w.next();
    expect(await w.next()).toBe(false);
    expect(w.error.value).toBe('No se pudo guardar');
    expect(w.index.value).toBe(1);
    saveFails = false;
    await w.next();
    expect(w.isLast.value).toBe(true);
    await w.next();
    expect(completed).toBe(1);
    expect(w.stepOfField('plan')).toBe(1);
    expect(w.stepOfField('plan.items.0')).toBe(1);
    w.reset();
    expect([w.index.value, w.furthest.value]).toEqual([0, 0]);
  });
});

describe('error normalization (web)', () => {
  const body = { code: 'VALIDATION_FAILED', message: 'Algunos datos no son válidos', requestId: 'req-1', details: [{ path: 'name', message: 'Mínimo 2 caracteres' }, { path: 'name', message: 'otro' }, { path: 'email', message: 'Correo inválido' }] };

  it('reads the API problem from every shape it travels in', () => {
    const fromClient = normalizeError(new ApiError(422, body));
    expect(fromClient).toMatchObject({ code: 'VALIDATION_FAILED', status: 422, title: 'Revisa los datos', message: 'Algunos datos no son válidos', requestId: 'req-1', retryable: false });
    expect(fromClient.fieldErrors).toEqual({ name: 'Mínimo 2 caracteres', email: 'Correo inválido' });
    // Raw body, $fetch error, NuxtError after SSR (`error: true` + data) and a cause chain.
    expect(normalizeError({ error: body }).code).toBe('VALIDATION_FAILED');
    expect(normalizeError({ statusCode: 404, data: { error: { code: 'NOT_FOUND', message: 'Usuario no encontrado', requestId: 'r' } } }).message).toBe('Usuario no encontrado');
    expect(normalizeError({ error: true, statusCode: 404, message: 'x', data: { error: { code: 'NOT_FOUND', message: 'Rol no encontrado' } } })).toMatchObject({ status: 404, message: 'Rol no encontrado', title: 'No encontrado' });
    expect(normalizeError({ message: 'wrapper', cause: new ApiError(403, { code: 'FORBIDDEN', message: 'Permiso requerido' }) })).toMatchObject({ status: 403, title: 'Sin permiso' });
    // An AppError raised by the page itself.
    expect(normalizeError({ name: 'AppError', code: 'CONFLICT', message: 'Ya existe' })).toMatchObject({ code: 'CONFLICT', status: 409, message: 'Ya existe' });
  });

  it('keeps transient hints: retryable and Retry-After', () => {
    const p = normalizeError(new ApiError(503, { code: 'UNAVAILABLE', message: 'Base de datos caída', details: { retryAfterSeconds: 5 } }));
    expect(p).toMatchObject({ title: 'Servicio no disponible', retryable: true, retryAfterSeconds: 5 });
  });

  it('never shows browser or JavaScript text', () => {
    expect(normalizeError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'NETWORK', status: 0, title: 'Sin conexión', retryable: true });
    expect(normalizeError(new DOMException('aborted', 'AbortError')).code).toBe('ABORTED');
    expect(normalizeError(new TypeError("Cannot read properties of undefined (reading 'x')")).message).not.toContain('undefined');
    expect(normalizeError(new Error('boom'), 'No se pudo guardar').message).toBe('No se pudo guardar');
    expect(normalizeError({ statusCode: 404, message: 'Page not found: /x' })).toMatchObject({ code: 'NOT_FOUND', message: 'Lo que buscas no existe o ya no está disponible.' });
    expect(normalizeError('<html>Bad gateway</html>', 'Falló').message).toBe('Falló');
    expect(normalizeError('No se pudo copiar').message).toBe('No se pudo copiar');
  });

  it('turns what the generated client caught into ApiError', () => {
    const json = toApiError({ error: { code: 'FORBIDDEN', message: 'Permiso requerido' } }, new Response(null, { status: 403, headers: { 'x-request-id': 'req-9' } }));
    expect(isApiError(json) && json.status === 403 && json.error.requestId === 'req-9').toBe(true);
    // A proxy's HTML 502 becomes the catalog message for its status.
    const html = toApiError('<html><body>502 Bad Gateway</body></html>', new Response(null, { status: 502 }));
    expect(isApiError(html) && html.error).toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Un servicio externo no respondió correctamente.' });
    const offline = toApiError(new TypeError('Failed to fetch'));
    expect(isApiError(offline) && offline.error.code).toBe('NETWORK');
    // Bugs in request interceptors keep propagating untouched.
    const bug = new RangeError('bad');
    expect(toApiError(bug)).toBe(bug);
    // Nuxt serializes errors as { message, statusCode, data }: the problem survives SSR.
    expect(new ApiError(404, { code: 'NOT_FOUND', message: 'x' })).toMatchObject({ statusCode: 404, data: { error: { code: 'NOT_FOUND' } } });
  });

  it('describeError stays compatible for toasts', () => {
    expect(describeError({ error: { code: 'BUDGET_EXCEEDED', message: 'Presupuesto agotado', requestId: 'r1' } })).toEqual({ message: 'Presupuesto agotado', requestId: 'r1', code: 'BUDGET_EXCEEDED' });
    expect(describeError(null, 'Sin conexión').message).toBe('Sin conexión');
  });
});

describe('format', () => {
  it('formats USD with any number of digits and percentages with the locale', () => {
    setFormatLocale('es-CL');
    expect(formatUsd('48210', 0)).toBe('US$ 48.210');
    expect(formatUsd('18.4231')).toBe('US$ 18,4231');
    expect(formatUsd('12', 2)).toBe('US$ 12,00');
    expect(formatPercentChange(0.124)).toMatch(/^\+12,4\s?%$/);
    expect(formatPercentChange(-0.3)).toMatch(/^-30\s?%$/);
    expect(formatPercentChange(0)).toMatch(/^0\s?%$/);
    expect(formatPercent(0.62)).toMatch(/^62\s?%$/);
  });
});

describe('useZodForm partial validation', () => {
  it('validates only the given fields and finds the first invalid one in step order', async () => {
    const { z } = await import('zod');
    const { useZodForm } = await import('#ui/composables/useZodForm');
    const form = useZodForm(z.object({ name: z.string().min(2, 'Corto'), email: z.email('Correo inválido'), plan: z.enum(['a', 'b']) }), { name: '', email: 'x', plan: 'a' });
    expect(form.validateFields(['plan'])).toBe(true);
    expect(form.errors.email).toBeUndefined();
    expect(form.validateFields(['name'])).toBe(false);
    expect(form.errors).toEqual({ name: 'Corto' });
    form.setValues({ name: 'Ana' });
    expect(form.validateFields(['name'])).toBe(true);
    expect(form.errors.name).toBeUndefined();
    expect(form.validate()).toBeNull();
    expect(form.firstErrorField(['name', 'email', 'plan'])).toBe('email');
  });
});

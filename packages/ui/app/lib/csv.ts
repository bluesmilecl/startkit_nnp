/** Client-side CSV export with formula-injection protection. */
export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }));
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(','))].join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): void {
  const blob = new Blob([`\uFEFF${toCsv(rows, columns)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

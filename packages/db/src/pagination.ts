export interface PageParams {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export function normalizePage(input: Partial<PageParams> | undefined, maxPageSize = 100): PageParams {
  const page = Math.max(1, Math.floor(Number(input?.page ?? 1)) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(input?.pageSize ?? 20)) || 20));
  return { page, pageSize };
}

export function toPage<T>(items: T[], total: number, params: PageParams): Page<T> {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

export function offsetOf(params: PageParams): number {
  return (params.page - 1) * params.pageSize;
}

/** Escapes LIKE wildcards in user-provided search terms. */
export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

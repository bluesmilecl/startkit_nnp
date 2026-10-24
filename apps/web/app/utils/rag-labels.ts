export const JOB_KIND_LABELS: Record<string, string> = {
  'ingest-source': 'Sincronizar fuente',
  'ingest-document': 'Indexar documento',
  reindex: 'Reindexar colección',
  'delete-document': 'Eliminar documento',
  'purge-collection': 'Purgar colección',
};

export const SEARCH_METHOD_LABELS: Record<string, string> = {
  vector: 'Vectorial',
  fulltext: 'Texto completo',
  hybrid: 'Híbrida (RRF)',
};

export const SCORE_TYPE_LABELS: Record<string, string> = {
  cosine_similarity: 'similitud coseno',
  ts_rank: 'rango de texto',
  rrf: 'fusión RRF',
  external: 'puntaje externo',
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] ?? kind;
}

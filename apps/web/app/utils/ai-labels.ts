/** Spanish labels for AI catalog values (shared by models, lab and agents pages). */
export const CAPABILITY_LABELS: Record<string, string> = {
  tools: 'Herramientas',
  streaming: 'Streaming',
  structured_output: 'Salida estructurada',
  attachments_image: 'Imágenes',
  attachments_pdf: 'PDF',
  audio_input: 'Entrada de audio',
  reasoning: 'Razonamiento',
  temperature: 'Temperatura',
};

export const FUNCTION_LABELS: Record<string, string> = {
  chat: 'Chat',
  embedding: 'Embeddings',
  transcription: 'Transcripción',
  speech: 'Voz',
  image: 'Imagen',
  moderation: 'Moderación',
  other: 'Otro',
};

export const UNIT_LABELS: Record<string, string> = {
  input_tokens: 'Tokens de entrada',
  output_tokens: 'Tokens de salida',
  cached_input_tokens: 'Entrada en caché',
  cache_write_tokens: 'Escritura de caché',
  reasoning_tokens: 'Tokens de razonamiento',
  audio_input_tokens: 'Tokens de audio',
  audio_seconds: 'Segundos de audio',
  images: 'Imágenes',
  requests: 'Solicitudes',
  embedding_tokens: 'Tokens de embedding',
};

export const FEATURE_LABELS: Record<string, string> = {
  chat: 'Chat',
  recommendation: 'Recomendación',
  lab: 'Laboratorio',
  embedding: 'Embeddings',
  rag_query: 'Consulta RAG',
  transcription: 'Transcripción',
  tool: 'Herramientas',
  connection_test: 'Prueba de conexión',
  evaluation: 'Evaluación',
  summary: 'Resumen',
  mail_template: 'Plantillas de correo',
};

export const COST_STATUS_LABELS: Record<string, string> = {
  calculated: 'Calculado',
  estimated: 'Estimado',
  reconciled: 'Conciliado',
  unknown: 'Desconocido',
};

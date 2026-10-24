import type { ParsedSection } from './parse.js';

export interface ChunkingOptions {
  /** Target characters per chunk. */
  size: number;
  /** Characters repeated between consecutive chunks of the same section. */
  overlap: number;
}

export const DEFAULT_CHUNKING: ChunkingOptions = { size: 1200, overlap: 150 };

export interface TextChunk {
  ordinal: number;
  text: string;
  heading: string | null;
  page: number | null;
  tokenCount: number;
}

export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/**
 * Structure-aware chunking: sections (headings, PDF pages) are never merged; within a section
 * paragraphs are packed up to `size`, long paragraphs are split at sentence boundaries, and an
 * overlap tail keeps context across consecutive chunks.
 */
export function chunkSections(sections: ParsedSection[], opts: ChunkingOptions = DEFAULT_CHUNKING): TextChunk[] {
  const size = Math.max(200, opts.size);
  const overlap = Math.min(Math.max(0, opts.overlap), Math.floor(size / 3));
  const out: TextChunk[] = [];
  const emit = (text: string, s: ParsedSection) => {
    const t = text.trim();
    if (t.length < 2) return;
    out.push({ ordinal: out.length, text: t, heading: s.heading, page: s.page, tokenCount: estimateTokens(t) });
  };
  for (const section of sections) {
    const units: string[] = [];
    for (const para of section.text.split(/\n{2,}/)) {
      if (para.length <= size) units.push(para);
      else {
        let cur = '';
        for (const sentence of para.split(/(?<=[.!?…])\s+/)) {
          if (sentence.length > size) {
            for (let i = 0; i < sentence.length; i += size - overlap) units.push(sentence.slice(i, i + size));
            continue;
          }
          if ((cur + ' ' + sentence).length > size && cur) {
            units.push(cur);
            cur = sentence;
          } else cur = cur ? `${cur} ${sentence}` : sentence;
        }
        if (cur) units.push(cur);
      }
    }
    let buf = '';
    for (const u of units) {
      if (buf && buf.length + u.length + 2 > size) {
        emit(buf, section);
        const tail = overlap ? buf.slice(-overlap).replace(/^\S*\s/, '') : '';
        buf = tail ? `${tail}\n\n${u}` : u;
      } else buf = buf ? `${buf}\n\n${u}` : u;
    }
    if (buf) emit(buf, section);
  }
  return out;
}

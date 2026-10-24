import { AppError } from '@starter/contracts';
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';

export interface ParsedSection {
  heading: string | null;
  page: number | null;
  text: string;
}

export interface ParsedDocument {
  title: string | null;
  mediaType: string;
  language: string | null;
  sections: ParsedSection[];
  /** Links found in the document (HTML), used by crawlers of the same site. */
  links: string[];
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function detectType(body: Buffer, declared: string, name: string): 'pdf' | 'html' | 'markdown' | 'text' {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const ext = name.toLowerCase().split(/[?#]/)[0]!.split('.').pop() ?? '';
  const head = body.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (declared.includes('html') || ext === 'html' || ext === 'htm' || head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  if (declared.includes('markdown') || ext === 'md' || ext === 'markdown') return 'markdown';
  if (body.includes(0)) throw AppError.validation('Formato binario no soportado (se admiten PDF, HTML, Markdown y texto)');
  return 'text';
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Markdown/plain text: sections split at headings (# …), heading path kept for citations. */
export function parseMarkdown(text: string): ParsedSection[] {
  const lines = normalize(text).split('\n');
  const sections: ParsedSection[] = [];
  const path: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join('\n').trim();
    if (t) sections.push({ heading: path.filter(Boolean).join(' › ') || null, page: null, text: t });
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) {
      flush();
      const level = m[1]!.length;
      path.splice(level - 1, path.length, m[2]!.trim());
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections;
}

const DROP = 'script,style,noscript,template,svg,nav,footer,header,aside,form,iframe,[aria-hidden=true],[hidden]';

export function parseHtmlDocument(html: string, baseUrl: string | null): ParsedDocument {
  const root = parseHtml(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title = root.querySelector('title')?.textContent.trim() || root.querySelector('h1')?.textContent.trim() || null;
  const lang = root.querySelector('html')?.getAttribute('lang') ?? null;
  const links: string[] = [];
  if (baseUrl) {
    for (const a of root.querySelectorAll('a[href]')) {
      try {
        const u = new URL(a.getAttribute('href')!, baseUrl);
        u.hash = '';
        if (u.protocol.startsWith('http')) links.push(u.toString());
      } catch {
        /* ignore invalid links */
      }
    }
  }
  for (const el of root.querySelectorAll(DROP)) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;
  // Convert to Markdown-like text so heading structure survives into sections.
  const out: string[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, ' ');
        if (t.trim()) out.push(t);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as HTMLElement;
      const tag = c.tagName?.toLowerCase();
      const h = tag?.match(/^h([1-6])$/);
      if (h) out.push(`\n\n${'#'.repeat(Number(h[1]))} ${c.textContent.replace(/\s+/g, ' ').trim()}\n\n`);
      else if (tag === 'li') out.push(`\n- ${c.textContent.replace(/\s+/g, ' ').trim()}`);
      else if (tag === 'br') out.push('\n');
      else if (tag === 'pre') out.push(`\n\n${c.textContent}\n\n`);
      else if (['p', 'div', 'section', 'tr', 'table', 'blockquote', 'dd', 'dt'].includes(tag ?? '')) {
        out.push('\n\n');
        walk(c);
        out.push('\n\n');
      } else walk(c);
    }
  };
  walk(main);
  return { title, mediaType: 'text/html', language: lang, sections: parseMarkdown(out.join('')), links: [...new Set(links)] };
}

export async function parsePdf(body: Buffer): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]) as string[];
  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string };
  const sections = pages
    .map((t, i) => ({ heading: null, page: i + 1, text: normalize(t) }))
    .filter((s) => s.text.length > 0);
  if (!sections.length) throw AppError.validation('El PDF no contiene texto extraíble (¿es una imagen escaneada?)');
  return { title: info.Title?.trim() || null, mediaType: 'application/pdf', language: null, sections, links: [] };
}

export async function parseDocument(body: Buffer, declaredType: string, name: string, baseUrl: string | null = null): Promise<ParsedDocument> {
  const kind = detectType(body, declaredType, name);
  if (kind === 'pdf') return parsePdf(body);
  const text = textDecoder.decode(body);
  if (kind === 'html') return parseHtmlDocument(text, baseUrl);
  const sections = parseMarkdown(text);
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  return { title: firstHeading, mediaType: kind === 'markdown' ? 'text/markdown' : 'text/plain', language: null, sections, links: [] };
}

/** <loc> entries of a sitemap (or sitemap index). */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>[\\s\\S]*?</${tag}>`, 'gi'))].map((m) => m[1]!.replace(/&amp;/g, '&'));
  return { urls: locs('url'), sitemaps: locs('sitemap') };
}

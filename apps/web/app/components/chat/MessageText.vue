<script setup lang="ts">
/**
 * Minimal, safe rendering of model text: everything is HTML-escaped first, then a small subset
 * (bold, inline code, bullet lists, paragraphs) and citation markers [f1] are formatted.
 */
const props = defineProps<{ text: string; citations?: { id: string; title: string | null; sourceUrl: string | null }[] }>();
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function inline(s: string): string {
  let out = escape(s)
    .replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 py-0.5 text-[0.85em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const cites = props.citations ?? [];
  out = out.replace(/\[([a-z]?\d+|[0-9a-f-]{8,})\]/gi, (m, id: string) => {
    const i = cites.findIndex((c) => c.id === id);
    if (i < 0) return m;
    const c = cites[i]!;
    const title = escape(c.title ?? 'Fuente');
    return `<sup class="text-primary font-medium" title="${title}" data-citation="${escape(id)}">[${i + 1}]</sup>`;
  });
  return out;
}
const html = computed(() => {
  const blocks = props.text.split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return `<ul class="list-disc space-y-0.5 pl-5">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- content is escaped before formatting -->
  <div class="space-y-2 break-words" v-html="html" />
</template>

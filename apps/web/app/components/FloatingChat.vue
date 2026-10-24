<script setup lang="ts">
import { useChat } from '@ai-sdk/vue';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  aiAttachmentsDelete,
  aiAttachmentsUpload,
  aiChatAgent,
  aiConversationsDelete,
  aiConversationsGet,
  aiConversationsList,
  aiTranscriptionsCreate,
  type ActionProposal,
  type AttachmentInfo,
  type ChatAgentInfo,
  type ConversationSummary,
} from '@starter/api-client';
import { Bot, FileText, History, Loader2, MessageCircle, Mic, Paperclip, Plus, Send, Square, Trash2, X } from '@lucide/vue';
import { useLocalStorage } from '@vueuse/core';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { formatBytes, formatNumber, formatUsd } from '#ui/lib/format';
import ProposalCard from '~/components/chat/ProposalCard.vue';
import MessageText from '~/components/chat/MessageText.vue';

interface Details {
  model: string | null;
  costUsd: string | null;
  costStatus: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  attempts: number;
}
interface Meta {
  conversationId?: string;
  cancelled?: boolean;
  details?: Details;
  citations?: { id: string; title: string | null; sourceUrl: string | null; documentId: string; collectionId: string }[];
}
type ChatMessage = UIMessage<Meta>;

const api = useApi();
const me = useMe();
const can = useCan();
const open = useLocalStorage('starter.chat.open', false);
const conversationKey = computed(() => `starter.chat.conversation.${me.value?.user.id ?? 'anon'}`);
const conversationId = useLocalStorage<string | null>(conversationKey, null);

const info = ref<ChatAgentInfo | null>(null);
const notConfigured = ref<string | null>(null);
async function loadInfo() {
  try {
    info.value = await unwrap(aiChatAgent({ client: api }));
    notConfigured.value = null;
  } catch (err) {
    info.value = null;
    notConfigured.value = apiError(err).message;
  }
}
const visible = computed(() => can('ai.chat') && (!!info.value || (!!notConfigured.value && can('ai.agents.manage'))));

// ── chat ──────────────────────────────────────────────────────────────────
const pending = ref<AttachmentInfo[]>([]);
const transport = new DefaultChatTransport<ChatMessage>({
  api: '/api/ai/chat',
  credentials: 'include',
  // Only the new text and attachment ids are sent; the server owns history and configuration.
  prepareSendMessagesRequest: ({ id, messages, body }) => {
    const last = messages[messages.length - 1]!;
    const parts = last.parts.filter((p) => p.type === 'text').map((p) => ({ type: 'text' as const, text: (p as { text: string }).text }));
    return {
      body: {
        id,
        conversationId: conversationId.value ?? null,
        agentId: info.value?.agentId,
        attachmentIds: (body?.attachmentIds as string[] | undefined) ?? [],
        message: { id: last.id, role: 'user', parts: parts.length ? parts : [{ type: 'text', text: '' }] },
      },
    };
  },
});
const { messages, status, error, sendMessage, stop, clearError } = useChat<ChatMessage>({ id: 'floating-chat', transport });
const busy = computed(() => status.value === 'submitted' || status.value === 'streaming');

watch(
  messages,
  (list) => {
    const id = [...list].reverse().find((m) => m.metadata?.conversationId)?.metadata?.conversationId;
    if (id && id !== conversationId.value) conversationId.value = id;
  },
  { deep: false },
);

const errorText = computed(() => {
  const raw = error.value?.message;
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
  } catch {
    return raw;
  }
});

const input = ref('');
const textarea = ref<InstanceType<typeof Textarea> | null>(null);
async function send(text = input.value) {
  const t = text.trim();
  if ((!t && !pending.value.length) || busy.value) return;
  clearError();
  const files = pending.value.map((a) => ({ type: 'file' as const, mediaType: a.mediaType, filename: a.filename, url: a.url }));
  const attachmentIds = pending.value.map((a) => a.id);
  input.value = '';
  pending.value = [];
  await sendMessage({ text: t, files }, { body: { attachmentIds } });
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}
function retry() {
  const lastUser = [...messages.value].reverse().find((m) => m.role === 'user');
  const text = lastUser?.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n') ?? '';
  clearError();
  if (text) void send(text);
}

// ── conversations ─────────────────────────────────────────────────────────
const history = ref<ConversationSummary[]>([]);
async function loadHistory() {
  history.value = await unwrap(aiConversationsList({ client: api, query: { agentId: info.value?.agentId } })).catch(() => []);
}
async function loadConversation(id: string) {
  if (busy.value) stop();
  try {
    const r = await unwrap(aiConversationsGet({ client: api, path: { id } }));
    messages.value = r.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts as ChatMessage['parts'], metadata: (m.metadata ?? undefined) as Meta | undefined }));
    conversationId.value = id;
  } catch {
    conversationId.value = null;
    messages.value = [];
  }
}
function newConversation() {
  if (busy.value) stop();
  conversationId.value = null;
  messages.value = [];
  clearError();
}
async function deleteConversation(c: ConversationSummary) {
  await aiConversationsDelete({ client: api, path: { id: c.id } });
  if (c.id === conversationId.value) newConversation();
  await loadHistory();
}

// ── attachments ───────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const accept = computed(() => {
  const t = info.value?.attachments.allowedTypes ?? [];
  return [t.includes('image') && 'image/png,image/jpeg,image/webp,image/gif', t.includes('pdf') && 'application/pdf', t.includes('text') && '.txt,.md,.csv,.json,text/plain,text/markdown'].filter(Boolean).join(',');
});
async function onFiles(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  const a = info.value?.attachments;
  if (!a) return;
  uploading.value = true;
  try {
    for (const f of files) {
      if (pending.value.length >= a.maxFiles) {
        toast.error(`Máximo ${a.maxFiles} archivo(s) por mensaje`);
        break;
      }
      if (f.size > a.maxFileBytes) {
        toast.error(`«${f.name}» supera ${formatBytes(a.maxFileBytes)}`);
        continue;
      }
      try {
        pending.value.push(await unwrap(aiAttachmentsUpload({ client: api, body: { file: f } })));
      } catch (err) {
        toast.error(`«${f.name}»: ${apiError(err).message}`);
      }
    }
  } finally {
    uploading.value = false;
  }
}
async function removePending(a: AttachmentInfo) {
  pending.value = pending.value.filter((x) => x.id !== a.id);
  await aiAttachmentsDelete({ client: api, path: { id: a.id } }).catch(() => {});
}

// ── microphone ────────────────────────────────────────────────────────────
const recorder = useRecorder();
async function toggleMic() {
  if (recorder.state.value === 'recording') {
    const blob = await recorder.stop();
    if (!blob) {
      recorder.state.value = 'idle';
      return;
    }
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `grabacion.${ext}`, { type: blob.type });
      const r = await unwrap(aiTranscriptionsCreate({ client: api, body: { audio: file, agentId: info.value?.agentId } }));
      // The transcript goes to the input for review; it is never sent automatically.
      input.value = input.value ? `${input.value} ${r.text}` : r.text;
      await nextTick();
      (textarea.value?.$el as HTMLTextAreaElement | undefined)?.focus();
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      recorder.state.value = 'idle';
    }
    return;
  }
  if (!(await recorder.start(info.value?.audioInput.maxSeconds ?? 60))) toast.error(recorder.error.value ?? 'No se pudo grabar');
}

// ── rendering helpers ─────────────────────────────────────────────────────
const toolLabel = (type: string) => {
  const key = type.replace(/^tool-/, '');
  return info.value?.tools.find((t) => t.key === key)?.label ?? (key === 'knowledge_search' ? 'Buscar en el conocimiento' : key);
};
type ToolPart = { type: string; state: string; toolCallId: string; output?: Record<string, unknown>; errorText?: string };
const isTool = (p: { type: string }) => p.type.startsWith('tool-') || p.type === 'dynamic-tool';
const tp = (p: unknown) => p as ToolPart;
const proposalOf = (p: unknown) => (tp(p).output?.status === 'needs_confirmation' ? (tp(p).output!.proposal as ActionProposal) : null);
const outputError = (p: unknown) => (tp(p).output?.error as { message?: string } | undefined)?.message ?? tp(p).errorText ?? null;
const outputHref = (p: unknown) => (typeof tp(p).output?.href === 'string' ? (tp(p).output!.href as string) : null);
const toolRunning = (p: unknown) => tp(p).state === 'input-streaming' || tp(p).state === 'input-available';
const textOf = (p: unknown) => ((p as { type: string }).type === 'text' ? (p as { text: string }).text : '');
const COST: Record<string, string> = { calculated: 'calculado', estimated: 'estimado', unknown: 'desconocido', reconciled: 'conciliado' };

const scroller = ref<HTMLElement | null>(null);
watch(
  () => [messages.value.length, status.value, messages.value.at(-1)?.parts.length],
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
  },
);
watch(open, async (v) => {
  if (!v) return;
  await nextTick();
  (textarea.value?.$el as HTMLTextAreaElement | undefined)?.focus();
});

onMounted(async () => {
  await loadInfo();
  if (info.value && conversationId.value) await loadConversation(conversationId.value);
});
function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false;
}
onMounted(() => window.addEventListener('keydown', onEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape));
</script>

<template>
  <div v-if="visible">
    <Button
      v-show="!open"
      class="fixed right-5 bottom-5 z-40 size-12 rounded-full shadow-lg"
      :aria-label="`Abrir ${info?.title ?? 'asistente'}`"
      data-testid="chat-launcher"
      @click="open = true"
    >
      <MessageCircle class="size-5" />
    </Button>

    <section
      v-if="open"
      class="bg-background fixed inset-0 z-50 flex flex-col sm:inset-auto sm:right-5 sm:bottom-5 sm:h-[min(680px,calc(100dvh-2.5rem))] sm:w-[420px] sm:rounded-xl sm:border sm:shadow-2xl"
      role="dialog"
      :aria-label="info?.title ?? 'Asistente'"
      data-testid="chat-panel"
    >
      <header class="flex items-center gap-2 border-b px-3 py-2">
        <Bot class="text-muted-foreground size-5" aria-hidden="true" />
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold">{{ info?.title ?? 'Asistente' }}</h2>
        <DropdownMenu v-if="info" @update:open="(v: boolean) => v && loadHistory()">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="Conversaciones anteriores" data-testid="chat-history"><History class="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-72">
            <DropdownMenuLabel>Conversaciones</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem v-for="c in history" :key="c.id" class="flex items-center justify-between gap-2" @select="loadConversation(c.id)">
              <span class="truncate">{{ c.title || 'Sin título' }}</span>
              <Button variant="ghost" size="icon" class="size-6" :aria-label="`Eliminar ${c.title}`" @click.stop="deleteConversation(c)"><Trash2 class="size-3" /></Button>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="!history.length" disabled>Sin conversaciones</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button v-if="info" variant="ghost" size="icon" aria-label="Nueva conversación" data-testid="chat-new" @click="newConversation"><Plus class="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="Cerrar" data-testid="chat-close" @click="open = false"><X class="size-4" /></Button>
      </header>

      <div v-if="!info" class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p>{{ notConfigured }}</p>
        <Button as-child size="sm" variant="outline"><NuxtLink to="/admin/ai/agents">Configurar agentes</NuxtLink></Button>
      </div>

      <template v-else>
        <div ref="scroller" class="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-live="polite" data-testid="chat-messages">
          <div v-if="!messages.length" class="space-y-3">
            <p class="bg-muted/60 rounded-lg px-3 py-2 text-sm">{{ info.greeting }}</p>
            <div v-if="info.suggestions.length" class="flex flex-wrap gap-2">
              <Button v-for="s in info.suggestions" :key="s" size="sm" variant="outline" class="h-auto py-1.5 text-left whitespace-normal" @click="send(s)">{{ s }}</Button>
            </div>
          </div>

          <div v-for="m in messages" :key="m.id" class="flex flex-col gap-1.5" :class="m.role === 'user' ? 'items-end' : 'items-start'" :data-role="m.role" data-testid="chat-message">
            <template v-for="(p, i) in m.parts" :key="i">
              <div v-if="p.type === 'text' && textOf(p)" class="max-w-[90%] rounded-lg px-3 py-2 text-sm" :class="m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/60'">
                <MessageText v-if="m.role === 'assistant'" :text="textOf(p)" :citations="m.metadata?.citations" />
                <span v-else class="whitespace-pre-wrap">{{ textOf(p) }}</span>
              </div>
              <template v-else-if="p.type === 'file'">
                <img v-if="(p as { mediaType: string }).mediaType.startsWith('image/')" :src="(p as { url: string }).url" :alt="(p as { filename?: string }).filename ?? 'imagen'" class="max-h-40 max-w-[70%] rounded-md border object-contain" />
                <a v-else :href="(p as { url: string }).url" target="_blank" rel="noopener" class="bg-muted/60 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"><FileText class="size-3.5" />{{ (p as { filename?: string }).filename ?? 'archivo' }}</a>
              </template>
              <div v-else-if="isTool(p)" class="w-full max-w-[90%]" :data-tool="p.type" data-testid="chat-tool">
                <ProposalCard v-if="proposalOf(p)" :proposal="proposalOf(p)!" />
                <div v-else class="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Loader2 v-if="toolRunning(p)" class="size-3 animate-spin" aria-hidden="true" />
                  <span>{{ toolLabel(p.type) }}</span>
                  <span v-if="outputError(p)" class="text-destructive">· {{ outputError(p) }}</span>
                  <NuxtLink v-else-if="outputHref(p)" :to="outputHref(p)!" class="underline-offset-4 hover:underline">· ver en el panel</NuxtLink>
                </div>
              </div>
            </template>
            <ul v-if="m.metadata?.citations?.length" class="text-muted-foreground max-w-[90%] space-y-0.5 text-xs" data-testid="chat-citations">
              <li v-for="(c, i) in m.metadata.citations" :key="c.id">
                [{{ i + 1 }}]
                <a v-if="c.sourceUrl" :href="c.sourceUrl" target="_blank" rel="noopener noreferrer" class="underline-offset-4 hover:underline">{{ c.title ?? 'Fuente' }}</a>
                <span v-else>{{ c.title ?? 'Fuente' }}</span>
              </li>
            </ul>
            <p v-if="m.metadata?.cancelled" class="text-muted-foreground text-xs">Respuesta detenida</p>
            <p v-if="info.showDetails && m.metadata?.details" class="text-muted-foreground text-[11px] tabular-nums" data-testid="chat-details">
              {{ m.metadata.details.model }} · {{ formatNumber(m.metadata.details.inputTokens) }}↑ {{ formatNumber(m.metadata.details.outputTokens) }}↓ · {{ formatNumber(m.metadata.details.latencyMs) }} ms ·
              {{ m.metadata.details.costStatus === 'unknown' ? 'costo desconocido' : `${formatUsd(m.metadata.details.costUsd)} (${COST[m.metadata.details.costStatus]})` }}
              <template v-if="m.metadata.details.attempts > 1"> · {{ m.metadata.details.attempts }} llamadas</template>
            </p>
          </div>

          <div v-if="status === 'submitted'" class="text-muted-foreground flex items-center gap-2 text-xs"><Loader2 class="size-3 animate-spin" /> Pensando…</div>
          <div v-if="errorText" class="border-destructive/40 bg-destructive/5 space-y-2 rounded-lg border px-3 py-2 text-sm" role="alert" data-testid="chat-error">
            <p>{{ errorText }}</p>
            <Button size="sm" variant="outline" @click="retry">Reintentar</Button>
          </div>
        </div>

        <form class="space-y-2 border-t p-3" @submit.prevent="send()">
          <ul v-if="pending.length" class="flex flex-wrap gap-1.5" aria-label="Archivos adjuntos">
            <li v-for="a in pending" :key="a.id">
              <Badge variant="secondary" class="gap-1 pr-1" data-testid="chat-attachment">
                {{ a.filename }}
                <button type="button" class="hover:bg-muted rounded p-0.5" :aria-label="`Quitar ${a.filename}`" @click="removePending(a)"><X class="size-3" /></button>
              </Badge>
            </li>
          </ul>
          <Textarea
            ref="textarea"
            v-model="input"
            :placeholder="recorder.state.value === 'recording' ? `Grabando… ${recorder.elapsed.value}s (máx. ${info.audioInput.maxSeconds}s)` : info.placeholder"
            rows="2"
            class="max-h-40 min-h-12 resize-none"
            aria-label="Mensaje"
            data-testid="chat-input"
            @keydown="onKeydown"
          />
          <div class="flex items-center gap-1">
            <template v-if="info.attachments.enabled">
              <input ref="fileInput" type="file" class="sr-only" multiple :accept="accept" data-testid="chat-file" @change="onFiles" />
              <Button type="button" variant="ghost" size="icon" :disabled="uploading || busy" aria-label="Adjuntar archivo" @click="fileInput?.click()">
                <Loader2 v-if="uploading" class="size-4 animate-spin" /><Paperclip v-else class="size-4" />
              </Button>
            </template>
            <Button
              v-if="info.audioInput.enabled"
              type="button"
              variant="ghost"
              size="icon"
              :disabled="busy || recorder.state.value === 'processing'"
              :aria-label="recorder.state.value === 'recording' ? 'Detener y transcribir' : 'Dictar con el micrófono'"
              :aria-pressed="recorder.state.value === 'recording'"
              data-testid="chat-mic"
              :class="{ 'text-destructive animate-pulse': recorder.state.value === 'recording' }"
              @click="toggleMic"
            >
              <Loader2 v-if="recorder.state.value === 'processing'" class="size-4 animate-spin" /><Mic v-else class="size-4" />
            </Button>
            <span class="flex-1" />
            <Button v-if="busy" type="button" size="sm" variant="outline" data-testid="chat-stop" @click="stop()"><Square class="size-3.5" /> Detener</Button>
            <Button v-else type="submit" size="sm" :disabled="!input.trim() && !pending.length" data-testid="chat-send"><Send class="size-3.5" /> Enviar</Button>
          </div>
        </form>
      </template>
    </section>
  </div>
</template>

/**
 * Microphone recording with MediaRecorder. The recording is kept in memory only until it is
 * sent for transcription; nothing is uploaded while recording.
 */
export function useRecorder() {
  const state = ref<'idle' | 'recording' | 'processing'>('idle');
  const elapsed = ref(0);
  const error = ref<string | null>(null);
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let resolveStop: ((b: Blob | null) => void) | null = null;

  const supported = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  function cleanup() {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  async function start(maxSeconds: number): Promise<boolean> {
    error.value = null;
    if (!supported()) {
      error.value = 'Este navegador no permite grabar audio';
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException).name;
      error.value =
        name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilítalo en la configuración del navegador.' : name === 'NotFoundError' ? 'No se encontró un micrófono' : 'No se pudo acceder al micrófono';
      return false;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : null;
      cleanup();
      resolveStop?.(blob);
      resolveStop = null;
    };
    recorder.start(250);
    state.value = 'recording';
    elapsed.value = 0;
    timer = setInterval(() => {
      elapsed.value++;
      if (elapsed.value >= maxSeconds) void stop();
    }, 1000);
    return true;
  }

  function stop(): Promise<Blob | null> {
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
    state.value = 'processing';
    return new Promise((resolve) => {
      resolveStop = resolve;
      recorder!.stop();
    });
  }

  function cancel() {
    resolveStop = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanup();
    state.value = 'idle';
  }

  onBeforeUnmount(cancel);
  return { state, elapsed, error, supported, start, stop, cancel };
}

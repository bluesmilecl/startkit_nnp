<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ChevronLeft, ChevronRight, Pause, Play } from '@lucide/vue';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '#ui/components/ui/carousel';
import { Button } from '#ui/components/ui/button';
import { cn } from '#ui/lib/utils';

type PerView = 1 | 2 | 3 | 4;

/**
 * Carousel of any content (cards, images, announcements) with arrows, dots, keyboard (← →) and
 * optional autoplay. Autoplay pauses on hover and focus, can be paused with its button and never
 * starts when the person prefers reduced motion.
 *
 *   <ContentCarousel :items="news" label="Novedades" :per-view="{ base: 1, md: 2, xl: 3 }" loop>
 *     <template #item="{ item }"><Card>…{{ item.title }}…</Card></template>
 *   </ContentCarousel>
 */
const props = withDefaults(
  defineProps<{
    items: T[];
    /** Accessible name of the carousel region, e.g. "Novedades". */
    label: string;
    itemKey?: (item: T, index: number) => string | number;
    perView?: { base?: PerView; sm?: PerView; md?: PerView; lg?: PerView; xl?: PerView };
    loop?: boolean;
    /** Milliseconds between slides; 0 disables autoplay. */
    autoplay?: number;
    dots?: boolean;
    arrows?: boolean;
    align?: 'start' | 'center';
    testid?: string;
  }>(),
  { perView: () => ({ base: 1 }), loop: false, autoplay: 0, dots: true, arrows: true, align: 'start', testid: 'carousel' },
);
defineSlots<{ item(props: { item: T; index: number }): unknown }>();

// Static class names so Tailwind generates them.
const BASIS = {
  base: { 1: 'basis-full', 2: 'basis-1/2', 3: 'basis-1/3', 4: 'basis-1/4' },
  sm: { 1: 'sm:basis-full', 2: 'sm:basis-1/2', 3: 'sm:basis-1/3', 4: 'sm:basis-1/4' },
  md: { 1: 'md:basis-full', 2: 'md:basis-1/2', 3: 'md:basis-1/3', 4: 'md:basis-1/4' },
  lg: { 1: 'lg:basis-full', 2: 'lg:basis-1/2', 3: 'lg:basis-1/3', 4: 'lg:basis-1/4' },
  xl: { 1: 'xl:basis-full', 2: 'xl:basis-1/2', 3: 'xl:basis-1/3', 4: 'xl:basis-1/4' },
} as const;
const itemClass = computed(() =>
  cn(...(Object.keys(BASIS) as (keyof typeof BASIS)[]).map((bp) => (props.perView[bp] ? BASIS[bp][props.perView[bp]!] : bp === 'base' ? BASIS.base[1] : ''))),
);

const api = shallowRef<CarouselApi>();
const selected = ref(0);
const snaps = ref(0);
const canPrev = ref(false);
const canNext = ref(false);
function sync() {
  const a = api.value;
  if (!a) return;
  selected.value = a.selectedScrollSnap();
  snaps.value = a.scrollSnapList().length;
  canPrev.value = a.canScrollPrev();
  canNext.value = a.canScrollNext();
}
function onInit(a: CarouselApi) {
  api.value = a;
  if (!a) return;
  sync();
  a.on('select', sync);
  a.on('reInit', sync);
}

// ── autoplay ─────────────────────────────────────────────────────────────
const paused = ref(false);
const hovering = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const reducedMotion = ref(false);
function tick() {
  const a = api.value;
  if (!a || paused.value || hovering.value) return;
  if (a.canScrollNext()) a.scrollNext();
  else a.scrollTo(0);
}
onMounted(() => {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (props.autoplay > 0 && !reducedMotion.value) timer = setInterval(tick, props.autoplay);
  else if (props.autoplay > 0) paused.value = true;
});
onBeforeUnmount(() => clearInterval(timer));
const keyOf = (item: T, i: number) => props.itemKey?.(item, i) ?? i;
</script>

<template>
  <div class="space-y-3" :data-testid="testid" @mouseenter="hovering = true" @mouseleave="hovering = false" @focusin="hovering = true" @focusout="hovering = false">
    <Carousel :opts="{ loop, align }" class="w-full" :aria-label="label" @init-api="onInit">
      <CarouselContent>
        <CarouselItem v-for="(item, i) in items" :key="keyOf(item, i)" :class="itemClass" :aria-label="`${i + 1} de ${items.length}`">
          <slot name="item" :item="item" :index="i" />
        </CarouselItem>
      </CarouselContent>
    </Carousel>
    <div v-if="(arrows || dots || autoplay) && snaps > 1" class="flex items-center justify-center gap-2">
      <Button v-if="arrows" variant="outline" size="icon-sm" class="rounded-full" :disabled="!canPrev" aria-label="Anterior" :data-testid="`${testid}-prev`" @click="api?.scrollPrev()">
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div v-if="dots" class="flex items-center gap-1.5" role="group" aria-label="Elegir diapositiva">
        <button
          v-for="n in snaps"
          :key="n"
          type="button"
          :class="cn('size-2 rounded-full transition-all', n - 1 === selected ? 'bg-primary w-5' : 'bg-muted-foreground/30 hover:bg-muted-foreground/60')"
          :aria-label="`Ir a la diapositiva ${n}`"
          :aria-current="n - 1 === selected ? 'true' : undefined"
          @click="api?.scrollTo(n - 1)"
        />
      </div>
      <Button v-if="arrows" variant="outline" size="icon-sm" class="rounded-full" :disabled="!canNext" aria-label="Siguiente" :data-testid="`${testid}-next`" @click="api?.scrollNext()">
        <ChevronRight aria-hidden="true" />
      </Button>
      <Button v-if="autoplay > 0" variant="ghost" size="icon-sm" :aria-label="paused ? 'Reanudar avance automático' : 'Pausar avance automático'" :aria-pressed="paused" @click="paused = !paused">
        <Play v-if="paused" aria-hidden="true" /><Pause v-else aria-hidden="true" />
      </Button>
      <span class="sr-only" aria-live="polite" :data-testid="`${testid}-status`">Diapositiva {{ selected + 1 }} de {{ snaps }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';

type Size = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Modal with header, scrollable body and footer, as a centered dialog or a side sheet (better for
 * long forms and details). Controlled with `v-model:open`.
 *
 *   <AppModal v-model:open="open" title="Detalle del pedido" size="lg">
 *     …contenido…
 *     <template #footer><Button @click="open = false">Listo</Button></template>
 *   </AppModal>
 */
const props = withDefaults(
  defineProps<{ title: string; description?: string; size?: Size; variant?: 'dialog' | 'sheet'; side?: 'right' | 'left' | 'bottom'; testid?: string }>(),
  { size: 'md', variant: 'dialog', side: 'right' },
);
const open = defineModel<boolean>('open', { default: false });
const DIALOG: Record<Size, string> = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
const SHEET: Record<Size, string> = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' };
const dialogClass = computed(() => `flex max-h-[90vh] flex-col gap-0 p-0 ${DIALOG[props.size]}`);
const sheetClass = computed(() => `flex flex-col gap-0 ${props.side === 'bottom' ? 'max-h-[90vh]' : SHEET[props.size]}`);
</script>

<template>
  <Dialog v-if="variant === 'dialog'" v-model:open="open">
    <DialogContent :class="dialogClass" :data-testid="testid">
      <DialogHeader class="p-6 pb-4">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-4"><slot /></div>
      <DialogFooter v-if="$slots.footer" class="border-t px-6 py-4"><slot name="footer" /></DialogFooter>
    </DialogContent>
  </Dialog>
  <Sheet v-else v-model:open="open">
    <SheetContent :side="side" :class="sheetClass" :data-testid="testid">
      <SheetHeader>
        <SheetTitle>{{ title }}</SheetTitle>
        <SheetDescription v-if="description">{{ description }}</SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 pt-0"><slot /></div>
      <SheetFooter v-if="$slots.footer" class="border-t"><slot name="footer" /></SheetFooter>
    </SheetContent>
  </Sheet>
</template>

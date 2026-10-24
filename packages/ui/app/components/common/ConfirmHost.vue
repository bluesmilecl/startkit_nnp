<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#ui/components/ui/alert-dialog';
import { Input } from '#ui/components/ui/input';
import { buttonVariants } from '#ui/components/ui/button';
import { useConfirm } from '#ui/composables/useConfirm';

const { pending, settle } = useConfirm();
const typed = ref('');
watch(pending, () => (typed.value = ''));
const open = computed({
  get: () => !!pending.value,
  set: (v) => {
    if (!v) settle(false);
  },
});
const canConfirm = computed(() => !pending.value?.typeToConfirm || typed.value.trim() === pending.value.typeToConfirm);
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent v-if="pending" data-testid="confirm-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ pending.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="pending.description">{{ pending.description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <div v-if="pending.typeToConfirm" class="space-y-2">
        <p class="text-sm">
          Escribe <strong class="font-mono">{{ pending.typeToConfirm }}</strong> para confirmar.
        </p>
        <Input v-model="typed" aria-label="Texto de confirmación" data-testid="confirm-type" />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="confirm-cancel" @click="settle(false)">{{ pending.cancelLabel ?? 'Cancelar' }}</AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-accept"
          :disabled="!canConfirm"
          :class="pending.destructive ? buttonVariants({ variant: 'destructive' }) : undefined"
          @click="settle(true)"
        >
          {{ pending.confirmLabel ?? 'Confirmar' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

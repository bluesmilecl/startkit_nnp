<script setup lang="ts">
import { Card, CardContent, CardFooter } from '#ui/components/ui/card';

/**
 * A titled block of a long form or settings page: title and description on the left (on top in
 * phones), fields in a card on the right, optional footer with actions.
 *
 *   <FormSection title="Datos de facturación" description="Aparecen en las boletas.">
 *     <FormFields :form="form" :fields="billing" :columns="2" />
 *     <template #footer><FormActions :loading="form.submitting.value" /></template>
 *   </FormSection>
 */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
    <header class="space-y-1">
      <h2 class="text-base font-semibold">{{ title }}</h2>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </header>
    <Card class="min-w-0">
      <CardContent class="space-y-4"><slot /></CardContent>
      <CardFooter v-if="$slots.footer" class="border-t pt-4"><slot name="footer" /></CardFooter>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatDate, formatRelative } from '#ui/lib/format';

/** Absolute date on the server, relative ("hace 5 min") after hydration to avoid mismatches. */
const props = defineProps<{ value: string | Date | null | undefined }>();
const mounted = ref(false);
onMounted(() => (mounted.value = true));
</script>

<template>
  <time :datetime="value ? new Date(value).toISOString() : undefined" :title="formatDate(value)">{{ mounted ? formatRelative(props.value) : formatDate(props.value) }}</time>
</template>

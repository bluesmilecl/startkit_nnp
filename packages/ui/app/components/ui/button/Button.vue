<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "."
import { Loader2Icon } from "@lucide/vue"
import { cn } from "#ui/lib/utils"
import { Primitive } from "reka-ui"
import { buttonVariants } from "."

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  // starter: `loading` disables the button, marks it busy and shows a spinner before the label.
  // `disabled` is a prop (not a fallthrough attr) so `:disabled="false"` cannot override loading.
  loading?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
})
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <Loader2Icon v-if="loading && !asChild" class="animate-spin" aria-hidden="true" />
    <slot />
  </Primitive>
</template>

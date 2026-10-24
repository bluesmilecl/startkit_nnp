import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Alert } from "./Alert.vue"
export { default as AlertDescription } from "./AlertDescription.vue"
export { default as AlertTitle } from "./AlertTitle.vue"

export const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
        // starter: semantic variants used by AppAlert (info, success, warning).
        info:
          "border-sky-500/30 bg-sky-500/5 text-sky-950 dark:text-sky-100 [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400 *:data-[slot=alert-description]:text-sky-900/90 dark:*:data-[slot=alert-description]:text-sky-100/80",
        success:
          "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-100 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400 *:data-[slot=alert-description]:text-emerald-900/90 dark:*:data-[slot=alert-description]:text-emerald-100/80",
        warning:
          "border-amber-500/40 bg-amber-500/5 text-amber-950 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400 *:data-[slot=alert-description]:text-amber-900/90 dark:*:data-[slot=alert-description]:text-amber-100/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>

import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('./app', import.meta.url));

/**
 * @starter/ui Nuxt layer: shadcn-vue components (copied source, see docs/frontend-components.md),
 * Unovis charts, Tailwind v4 theme tokens and form helpers. Apps consume it with `extends`.
 */
export default defineNuxtConfig({
  modules: ['shadcn-nuxt'],
  alias: { '#ui': app },
  css: [`${app}/assets/css/main.css`],
  shadcn: {
    prefix: '',
    componentDir: `${app}/components/ui`,
  },
  components: [
    { path: `${app}/components/common`, pathPrefix: false },
    { path: `${app}/components/charts`, pathPrefix: false },
  ],
  vite: {
    plugins: [tailwindcss() as never],
    optimizeDeps: {
      include: ['@unovis/vue', '@unovis/ts', 'reka-ui', 'vue-sonner', 'class-variance-authority', 'cn'],
    },
  },
});

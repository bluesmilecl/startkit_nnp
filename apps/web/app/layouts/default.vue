<script setup lang="ts">
import { SidebarInset, SidebarProvider, SidebarTrigger } from '#ui/components/ui/sidebar';
import { Separator } from '#ui/components/ui/separator';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#ui/components/ui/breadcrumb';

const route = useRoute();
const crumbs = computed(() => {
  const base = breadcrumbFor(route.path);
  const extra = route.meta.breadcrumb as string | undefined;
  return extra ? [...base, { title: extra, to: route.path }] : base;
});
</script>

<template>
  <SidebarProvider>
    <a href="#main" class="bg-background sr-only z-50 rounded p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Saltar al contenido</a>
    <AppSidebar />
    <SidebarInset>
      <header class="bg-background/95 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
        <SidebarTrigger class="-ml-1" aria-label="Mostrar u ocultar navegación" />
        <Separator orientation="vertical" class="mr-2 h-4" />
        <Breadcrumb class="min-w-0 flex-1">
          <BreadcrumbList>
            <template v-for="(c, i) in crumbs" :key="c.to + i">
              <BreadcrumbItem class="truncate">
                <BreadcrumbPage v-if="i === crumbs.length - 1">{{ c.title }}</BreadcrumbPage>
                <BreadcrumbLink v-else as-child><NuxtLink :to="c.to">{{ c.title }}</NuxtLink></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator v-if="i < crumbs.length - 1" />
            </template>
          </BreadcrumbList>
        </Breadcrumb>
        <ThemeToggle />
      </header>
      <main id="main" class="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6" tabindex="-1">
        <slot />
      </main>
    </SidebarInset>
    <ClientOnly><FloatingChat v-if="useMe().value?.features.ai" /></ClientOnly>
  </SidebarProvider>
</template>

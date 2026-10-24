<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Badge } from '#ui/components/ui/badge';
import { Button } from '#ui/components/ui/button';
import type { IconName } from '#ui/lib/icons';
import CatalogExample from './CatalogExample.vue';

/** Carousels: several cards per view (responsive) and an announcement banner with autoplay. */
const products: { id: string; name: string; price: string; tag: string; icon: IconName }[] = [
  { id: 'p1', name: 'Plan Básico', price: 'US$ 9', tag: 'Pymes', icon: 'product' },
  { id: 'p2', name: 'Plan Profesional', price: 'US$ 19', tag: 'Más elegido', icon: 'launch' },
  { id: 'p3', name: 'Plan Empresa', price: 'US$ 39', tag: 'Soporte 24/7', icon: 'organization' },
  { id: 'p4', name: 'Asistente IA', price: 'US$ 5', tag: 'Complemento', icon: 'ai' },
  { id: 'p5', name: 'Conocimiento', price: 'US$ 7', tag: 'Complemento', icon: 'knowledge' },
  { id: 'p6', name: 'Facturación', price: 'US$ 4', tag: 'Complemento', icon: 'invoice' },
];
const news = [
  { id: 'n1', title: 'Nuevo panel de costos', text: 'Gráficos por modelo y exportación CSV.', tone: 'from-sky-500/15' },
  { id: 'n2', title: 'Asistente por pasos', text: 'FormWizard para altas y configuraciones largas.', tone: 'from-emerald-500/15' },
  { id: 'n3', title: 'Tablas en tarjetas', text: 'La misma lista como tabla o tarjetas, también en teléfono.', tone: 'from-amber-500/15' },
];
const cardsCode = `<ContentCarousel :items="products" label="Planes" :per-view="{ base: 1, sm: 2, lg: 3 }" :item-key="(p) => p.id">
  <template #item="{ item }">
    <Card>…{{ item.name }}…</Card>
  </template>
</ContentCarousel>`;
const bannerCode = `<ContentCarousel :items="news" label="Novedades" loop :autoplay="5000">
  <template #item="{ item }"><div class="rounded-xl border p-6">…</div></template>
</ContentCarousel>
// Autoplay se pausa con el mouse o el foco encima, tiene botón de pausa y no corre con «reducir movimiento».`;
</script>

<template>
  <div class="grid gap-6">
    <CatalogExample title="ContentCarousel: tarjetas" description="Una, dos o tres tarjetas por vista según el ancho; flechas, puntos y teclado (← →)." :code="cardsCode">
      <ContentCarousel :items="products" label="Planes y complementos" :per-view="{ base: 1, sm: 2, lg: 3 }" :item-key="(p) => p.id" testid="demo-carousel">
        <template #item="{ item }">
          <Card class="h-full">
            <CardHeader class="flex flex-row items-start justify-between gap-2">
              <div class="space-y-1">
                <CardTitle class="text-base">{{ item.name }}</CardTitle>
                <CardDescription>{{ item.price }} por usuario al mes</CardDescription>
              </div>
              <AppIcon :name="item.icon" class="text-muted-foreground size-5" />
            </CardHeader>
            <CardContent class="flex items-center justify-between gap-2">
              <Badge variant="secondary">{{ item.tag }}</Badge>
              <Button size="sm" variant="outline">Elegir</Button>
            </CardContent>
          </Card>
        </template>
      </ContentCarousel>
    </CatalogExample>
    <CatalogExample title="ContentCarousel: anuncios" description="Una diapositiva por vista, en bucle y con avance automático accesible." :code="bannerCode">
      <ContentCarousel :items="news" label="Novedades" loop :autoplay="5000" :item-key="(n) => n.id" testid="news-carousel">
        <template #item="{ item }">
          <div class="bg-gradient-to-r to-transparent rounded-xl border p-6 sm:p-8" :class="item.tone">
            <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Novedad</p>
            <h3 class="mt-1 text-lg font-semibold">{{ item.title }}</h3>
            <p class="text-muted-foreground mt-1 text-sm">{{ item.text }}</p>
          </div>
        </template>
      </ContentCarousel>
    </CatalogExample>
  </div>
</template>

<script setup lang="ts">
import { ShieldX } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Acceso denegado' });
const route = useRoute();
const me = useMe();
const isFeature = computed(() => route.query.reason === 'feature');
</script>

<template>
  <Card data-testid="forbidden">
    <CardHeader class="items-center text-center">
      <ShieldX class="text-destructive mx-auto size-10" aria-hidden="true" />
      <CardTitle class="text-xl">{{ isFeature ? 'Módulo no disponible' : 'Acceso denegado' }}</CardTitle>
      <CardDescription>
        {{ isFeature ? 'Este módulo está desactivado en la instalación.' : 'No tienes permiso para ver esta sección. Si crees que es un error, contacta a un administrador.' }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-2">
      <Button as-child><NuxtLink to="/admin">Ir al inicio</NuxtLink></Button>
      <Button v-if="!me" variant="outline" as-child><NuxtLink to="/login">Ingresar</NuxtLink></Button>
    </CardContent>
  </Card>
</template>

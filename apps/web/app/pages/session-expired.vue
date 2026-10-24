<script setup lang="ts">
import { Clock } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Sesión vencida' });
const route = useRoute();
</script>

<template>
  <Card data-testid="session-expired">
    <CardHeader class="items-center text-center">
      <Clock class="text-muted-foreground mx-auto size-10" aria-hidden="true" />
      <CardTitle class="text-xl">Tu sesión venció</CardTitle>
      <CardDescription>Por seguridad cerramos tu sesión. Vuelve a ingresar con un código de acceso.</CardDescription>
    </CardHeader>
    <CardContent>
      <Button class="w-full" as-child><NuxtLink :to="{ path: '/login', query: { redirect: route.query.redirect } }">Ingresar nuevamente</NuxtLink></Button>
    </CardContent>
  </Card>
</template>

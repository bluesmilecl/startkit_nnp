<script setup lang="ts">
import { meSessionsList, meSessionsRevoke, meSessionsRevokeOthers, meUpdate } from '@starter/api-client';
import { UpdateProfileInput } from '@starter/contracts';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Input } from '#ui/components/ui/input';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { formatDate } from '#ui/lib/format';

definePageMeta({ breadcrumb: 'Perfil' });
useHead({ title: 'Perfil' });
const api = useApi();
const me = useMe();
const { confirm } = useConfirm();
const { data: sessions, refresh } = await useAsyncData('my-sessions', () => unwrap(meSessionsList({ client: api })));
const form = useZodForm(UpdateProfileInput, { name: me.value?.user.name ?? '', locale: me.value?.user.locale ?? null, timezone: me.value?.user.timezone ?? null });
const locale = nullableModel(form.values, 'locale');
const timezone = nullableModel(form.values, 'timezone');
const save = form.handleSubmit(async (values) => {
  await meUpdate({ client: api, body: values });
  await refreshMe();
  toast.success('Perfil actualizado');
});
async function revoke(id: string, current: boolean) {
  if (current && !(await confirm({ title: '¿Cerrar la sesión actual?', confirmLabel: 'Cerrar sesión' }))) return;
  await meSessionsRevoke({ client: api, path: { id } });
  if (current) return signOut();
  toast.success('Sesión cerrada');
  await refresh();
}
async function revokeOthers() {
  if (!(await confirm({ title: '¿Cerrar todas las demás sesiones?', confirmLabel: 'Cerrar sesiones' }))) return;
  const r = await unwrap(meSessionsRevokeOthers({ client: api }));
  toast.success(`${r.revoked} sesión(es) cerrada(s)`);
  await refresh();
}
</script>

<template>
  <PageHeader title="Perfil" :description="me?.user.email" />
  <div class="grid gap-6 lg:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>Datos personales</CardTitle></CardHeader>
      <CardContent>
        <form class="space-y-4" novalidate data-testid="profile-form" @submit="save">
          <Field :data-invalid="!!form.errors.name"><FieldLabel for="pf-name">Nombre</FieldLabel><Input id="pf-name" v-model="form.values.name" data-testid="profile-name" /><FieldError :errors="[form.errors.name]" /></Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel for="pf-locale">Idioma</FieldLabel><Input id="pf-locale" v-model="locale" placeholder="es-CL" /></Field>
            <Field><FieldLabel for="pf-tz">Zona horaria</FieldLabel><Input id="pf-tz" v-model="timezone" placeholder="America/Santiago" /></Field>
          </div>
          <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
          <Button type="submit" :disabled="form.submitting.value" data-testid="profile-save">Guardar</Button>
        </form>
      </CardContent>
    </Card>
    <Card>
      <CardHeader class="flex flex-row items-start justify-between gap-2">
        <div><CardTitle>Sesiones activas</CardTitle><CardDescription>Dispositivos con acceso a tu cuenta.</CardDescription></div>
        <Button variant="outline" size="sm" :disabled="(sessions?.length ?? 0) < 2" @click="revokeOthers">Cerrar las demás</Button>
      </CardHeader>
      <CardContent>
        <ul class="divide-y" data-testid="my-sessions">
          <li v-for="s in sessions" :key="s.id" class="flex items-center justify-between gap-2 py-3 text-sm">
            <div class="min-w-0">
              <div class="truncate">{{ s.userAgent ?? 'Dispositivo desconocido' }} <Badge v-if="s.current" class="ml-1">Actual</Badge></div>
              <p class="text-muted-foreground text-xs">{{ s.ipAddress ?? '—' }} · desde {{ formatDate(s.createdAt) }} · vence {{ formatDate(s.expiresAt) }}</p>
            </div>
            <Button variant="ghost" size="sm" @click="revoke(s.id, s.current)">Cerrar</Button>
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>

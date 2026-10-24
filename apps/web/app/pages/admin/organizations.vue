<script setup lang="ts">
import { adminOrgsAddMember, adminOrgsCreate, adminOrgsList, adminOrgsMembers, adminOrgsRemoveMember, type OrganizationSummary, type UserSummary } from '@starter/api-client';
import { CreateOrganizationInput } from '@starter/contracts';
import { Building2, Plus } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';

definePageMeta({ permission: 'organizations.read', feature: 'organizations' });
useHead({ title: 'Organizaciones' });
const api = useApi();
const notify = useNotify();
const can = useCan();
const { confirm } = useConfirm();
const { data: orgs, refresh } = await useAsyncData('orgs', () => unwrap(adminOrgsList({ client: api })));
const selected = ref<OrganizationSummary | null>(null);
const { data: members, refresh: refreshMembers } = await useAsyncData(
  'org-members',
  async () => (selected.value ? unwrap(adminOrgsMembers({ client: api, path: { id: selected.value.id } })) : []),
  { watch: [selected] },
);
const open = ref(false);
const form = useZodForm(CreateOrganizationInput, { name: '', slug: '' });
const create = form.handleSubmit(async (values) => {
  await adminOrgsCreate({ client: api, body: values });
  toast.success('Organización creada');
  open.value = false;
  form.reset();
  await refresh();
  await refreshMe();
});
const newMember = ref<UserSummary | null>(null);
async function addMember() {
  if (!selected.value || !newMember.value) return;
  try {
    await adminOrgsAddMember({ client: api, path: { id: selected.value.id }, body: { userId: newMember.value.id } });
    newMember.value = null;
    await refreshMembers();
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
async function removeMember(userId: string, email: string) {
  if (!selected.value || !(await confirm({ title: `¿Quitar a ${email} de ${selected.value.name}?`, description: 'Pierde acceso a los datos de la organización y sus roles en ella.', destructive: true, confirmLabel: 'Quitar' }))) return;
  try {
    await adminOrgsRemoveMember({ client: api, path: { id: selected.value.id, userId } });
    await refreshMembers();
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <PageHeader title="Organizaciones" description="Cada organización aísla sus datos: conversaciones, conocimiento, costos y configuraciones.">
    <template #actions><Button v-if="can('organizations.manage')" @click="open = true"><Plus class="size-4" /> Nueva organización</Button></template>
  </PageHeader>
  <div class="grid gap-6 lg:grid-cols-3">
    <Card>
      <CardHeader><CardTitle>Organizaciones</CardTitle></CardHeader>
      <CardContent>
        <ul class="space-y-1">
          <li v-for="o in orgs" :key="o.id">
            <button type="button" class="hover:bg-accent flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm" :class="selected?.id === o.id && 'bg-accent'" @click="selected = o">
              <span class="flex items-center gap-2"><Building2 class="size-4" /> {{ o.name }} <Badge v-if="o.isDefault" variant="secondary">principal</Badge></span>
              <span class="text-muted-foreground text-xs">{{ o.memberCount }} miembros</span>
            </button>
          </li>
        </ul>
      </CardContent>
    </Card>
    <Card class="lg:col-span-2">
      <CardHeader><CardTitle>{{ selected ? `Miembros de ${selected.name}` : 'Selecciona una organización' }}</CardTitle></CardHeader>
      <CardContent v-if="selected" class="space-y-4">
        <div v-if="can('organizations.manage')" class="flex gap-2"><div class="min-w-0 flex-1"><UserPicker v-model="newMember" /></div><Button :disabled="!newMember" @click="addMember">Agregar</Button></div>
        <ul class="divide-y text-sm">
          <li v-for="m in members" :key="m.id" class="flex items-center justify-between py-2">
            <span>{{ m.name || '—' }} <span class="text-muted-foreground">{{ m.email }}</span></span>
            <Button v-if="can('organizations.manage') && !selected.isDefault" variant="ghost" size="sm" class="text-destructive" @click="removeMember(m.id, m.email)">Quitar</Button>
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader><DialogTitle>Nueva organización</DialogTitle></DialogHeader>
      <form id="org-create" class="space-y-4" novalidate @submit="create">
        <Field :data-invalid="!!form.errors.name"><FieldLabel for="o-name">Nombre</FieldLabel><Input id="o-name" v-model="form.values.name" /><FieldError :errors="[form.errors.name]" /></Field>
        <Field :data-invalid="!!form.errors.slug"><FieldLabel for="o-slug">Identificador</FieldLabel><Input id="o-slug" v-model="form.values.slug" placeholder="mi-organizacion" /><FieldError :errors="[form.errors.slug]" /></Field>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="org-create" :disabled="form.submitting.value">Crear</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { adminInvitationsCreate, adminInvitationsList, adminInvitationsResend, adminInvitationsRevoke } from '@starter/api-client';
import { CreateInvitationInput } from '@starter/contracts';
import { Mail, Plus } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Pagination, PaginationContent, PaginationNext, PaginationPrevious } from '#ui/components/ui/pagination';
import { formatDate } from '#ui/lib/format';

definePageMeta({ permission: 'users.invite' });
useHead({ title: 'Invitaciones' });
const api = useApi();
const notify = useNotify();
const can = useCan();
const { confirm } = useConfirm();
const page = ref(1);
const { data, refresh } = await useAsyncData('invitations', () => unwrap(adminInvitationsList({ client: api, query: { page: page.value, pageSize: 20 } })), { watch: [page] });

const open = ref(false);
const roleId = ref<string | undefined>();
const form = useZodForm(CreateInvitationInput, { email: '', expiresInDays: 7 });
const submit = form.handleSubmit(async (values) => {
  await adminInvitationsCreate({ client: api, body: { ...values, roleId: roleId.value } });
  toast.success(`Invitación enviada a ${values.email}`);
  open.value = false;
  form.reset();
  roleId.value = undefined;
  await refresh();
});
async function resend(id: string) {
  try {
    await adminInvitationsResend({ client: api, path: { id } });
    toast.success('Invitación reenviada');
  } catch (err) {
    notify.error(err);
  }
}
async function revoke(id: string, email: string) {
  if (!(await confirm({ title: `¿Revocar la invitación de ${email}?`, confirmLabel: 'Revocar', destructive: true }))) return;
  try {
    await adminInvitationsRevoke({ client: api, path: { id } });
    toast.success('Invitación revocada');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <PageHeader title="Invitaciones" description="Personas invitadas que aún no ingresan. Al ingresar con su código se aplica el rol indicado.">
    <template #actions><Button data-testid="invite-open" @click="open = true"><Plus class="size-4" /> Invitar</Button></template>
  </PageHeader>
  <EmptyState v-if="data && !data.total" title="Sin invitaciones" description="Invita personas por correo; recibirán un enlace para ingresar." :icon="Mail" />
  <div v-else class="overflow-x-auto rounded-md border">
    <Table>
      <TableHeader><TableRow><TableHead>Correo</TableHead><TableHead>Rol</TableHead><TableHead>Estado</TableHead><TableHead>Vence</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="i in data?.items" :key="i.id" :data-testid="`invitation-${i.email}`">
          <TableCell class="font-medium">{{ i.email }}</TableCell>
          <TableCell>{{ i.role?.name ?? '—' }}</TableCell>
          <TableCell><StatusBadge :status="i.status" /><span v-if="i.kind === 'bootstrap'" class="text-muted-foreground ml-2 text-xs">propietario</span></TableCell>
          <TableCell>{{ formatDate(i.expiresAt, { dateStyle: 'medium' }) }}</TableCell>
          <TableCell class="text-right">
            <template v-if="i.status === 'pending'">
              <Button variant="ghost" size="sm" @click="resend(i.id)">Reenviar</Button>
              <Button variant="ghost" size="sm" class="text-destructive" @click="revoke(i.id, i.email)">Revocar</Button>
            </template>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
  <Pagination v-if="(data?.pageCount ?? 1) > 1" v-slot="{ page: p }" :total="data?.total ?? 0" :items-per-page="20" :page="page" @update:page="page = $event">
    <PaginationContent><PaginationPrevious /><span class="px-2 text-sm">{{ p }} / {{ data?.pageCount }}</span><PaginationNext /></PaginationContent>
  </Pagination>

  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader><DialogTitle>Invitar por correo</DialogTitle><DialogDescription>Se enviará un correo con el enlace de acceso.</DialogDescription></DialogHeader>
      <form id="invite" class="space-y-4" novalidate @submit="submit">
        <Field :data-invalid="!!form.errors.email"><FieldLabel for="inv-email">Correo</FieldLabel><Input id="inv-email" v-model="form.values.email" type="email" data-testid="invite-email" /><FieldError :errors="[form.errors.email]" /></Field>
        <Field v-if="can('roles.manage')"><FieldLabel for="inv-role">Rol al ingresar</FieldLabel><RoleSelect id="inv-role" v-model="roleId" /></Field>
        <Field><FieldLabel for="inv-days">Vigencia (días)</FieldLabel><Input id="inv-days" v-model.number="form.values.expiresInDays" type="number" min="1" max="60" /></Field>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="invite" :disabled="form.submitting.value" data-testid="invite-submit">Enviar invitación</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { z } from 'zod';
import { Mail } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Input } from '#ui/components/ui/input';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Spinner } from '#ui/components/ui/spinner';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Ingresar' });

const route = useRoute();
const branding = useBranding();
const schema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email('Ingresa un correo válido')) });
const form = useZodForm(schema, { email: String(route.query.email ?? '') });

if (import.meta.client && useMe().value) await navigateTo(String(route.query.redirect ?? '/admin'));

const hydrated = ref(false);
onMounted(() => (hydrated.value = true));
const submit = form.handleSubmit(async ({ email }) => {
  const { error } = await authClient().emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
  if (error && error.code !== 'OTP_RESEND_COOLDOWN') {
    form.formError.value = authErrorMessage(error);
    return;
  }
  await navigateTo({ path: '/verify', query: { email, redirect: route.query.redirect, cooldown: error ? '1' : undefined } });
});
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Ingresar</CardTitle>
      <CardDescription>Te enviaremos un código de {{ branding.otpLength }} dígitos a tu correo.</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="space-y-4" novalidate data-testid="login-form" @submit="submit">
        <Field :data-invalid="!!form.errors.email">
          <FieldLabel for="email">Correo electrónico</FieldLabel>
          <Input
            id="email"
            v-model="form.values.email"
            type="email"
            autocomplete="email"
            inputmode="email"
            placeholder="nombre@empresa.com"
            :aria-invalid="!!form.errors.email"
            required
            autofocus
            data-testid="login-email"
          />
          <FieldError :errors="[form.errors.email]" />
        </Field>
        <Alert v-if="form.formError.value" variant="destructive" data-testid="login-error">
          <AlertDescription>{{ form.formError.value }}</AlertDescription>
        </Alert>
        <Button type="submit" class="w-full" :disabled="form.submitting.value || !hydrated" data-testid="login-submit">
          <Spinner v-if="form.submitting.value" />
          <Mail v-else class="size-4" />
          Enviar código
        </Button>
        <p v-if="branding.registration !== 'open'" class="text-muted-foreground text-center text-xs">
          El acceso es por invitación. Si no recibes el código, solicita acceso a un administrador.
        </p>
      </form>
    </CardContent>
  </Card>
</template>

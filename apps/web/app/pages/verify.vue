<script setup lang="ts">
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '#ui/components/ui/input-otp';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Spinner } from '#ui/components/ui/spinner';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Verificar código' });

const route = useRoute();
const branding = useBranding();
const email = computed(() => String(route.query.email ?? ''));
const demoCode = computed(() => (branding.value.demoLogin?.email === email.value.toLowerCase() ? branding.value.demoLogin.code : null));
const code = ref('');
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const verifying = ref(false);
const cooldown = ref(branding.value.otpResendSeconds);
let timer: ReturnType<typeof setInterval> | undefined;

function startCooldown(seconds: number) {
  cooldown.value = seconds;
  clearInterval(timer);
  timer = setInterval(() => {
    cooldown.value = Math.max(0, cooldown.value - 1);
    if (!cooldown.value) clearInterval(timer);
  }, 1000);
}
onMounted(() => {
  if (!email.value) void navigateTo('/login');
  startCooldown(branding.value.otpResendSeconds);
});
onBeforeUnmount(() => clearInterval(timer));

async function verify() {
  if (code.value.length !== branding.value.otpLength || verifying.value) return;
  verifying.value = true;
  error.value = null;
  const { error: err } = await authClient().signIn.emailOtp({ email: email.value, otp: code.value });
  if (err) {
    verifying.value = false;
    error.value = authErrorMessage(err);
    code.value = '';
    return;
  }
  await refreshMe();
  await navigateTo(String(route.query.redirect ?? '/admin'), { replace: true });
}

async function resend() {
  error.value = null;
  info.value = null;
  const { error: err } = await authClient().emailOtp.sendVerificationOtp({ email: email.value, type: 'sign-in' });
  if (err) {
    error.value = authErrorMessage(err);
    const retry = (err as { retryAfter?: number }).retryAfter;
    if (retry) startCooldown(retry);
    return;
  }
  info.value = 'Te enviamos un nuevo código.';
  startCooldown(branding.value.otpResendSeconds);
}

watch(code, (v) => {
  if (v.length === branding.value.otpLength) void verify();
});
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Revisa tu correo</CardTitle>
      <CardDescription>
        Ingresa el código enviado a <strong class="text-foreground break-all">{{ email }}</strong>. Vence en pocos minutos y solo se puede usar una vez.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <form class="flex flex-col items-center gap-4" data-testid="verify-form" @submit.prevent="verify">
        <label for="otp" class="sr-only">Código de verificación</label>
        <InputOTP id="otp" v-model="code" :maxlength="branding.otpLength" autocomplete="one-time-code" inputmode="numeric" :disabled="verifying" data-testid="otp-input">
          <InputOTPGroup>
            <InputOTPSlot v-for="i in branding.otpLength" :key="i" :index="i - 1" />
          </InputOTPGroup>
        </InputOTP>
        <AppAlert v-if="demoCode" class="w-full" data-testid="demo-code">
          Cuenta de demostración: el código es <strong>{{ demoCode }}</strong>.
          <template #actions>
            <Button type="button" size="sm" variant="outline" :disabled="verifying" data-testid="demo-code-use" @click="code = demoCode">Usar código demo</Button>
          </template>
        </AppAlert>
        <Alert v-if="error" variant="destructive" class="w-full" data-testid="verify-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <p v-if="info" class="text-muted-foreground text-sm" role="status">{{ info }}</p>
        <Button type="submit" class="w-full" :disabled="code.length !== branding.otpLength || verifying" data-testid="verify-submit">
          <Spinner v-if="verifying" /> Verificar
        </Button>
      </form>
      <div class="flex items-center justify-between text-sm">
        <Button variant="link" class="px-0" as-child><NuxtLink :to="{ path: '/login', query: { email } }"><ArrowLeft class="size-4" /> Cambiar correo</NuxtLink></Button>
        <Button variant="ghost" size="sm" :disabled="cooldown > 0" data-testid="resend" @click="resend">
          <RefreshCw class="size-4" />
          {{ cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar código' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

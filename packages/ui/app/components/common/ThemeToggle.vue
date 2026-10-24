<script setup lang="ts">
import { useColorMode } from '@vueuse/core';
import { Moon, Sun, Monitor } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';

const mode = useColorMode({ emitAuto: true, storageKey: 'starter-color-mode' });
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" aria-label="Cambiar tema" data-testid="theme-toggle">
        <Sun class="size-4 dark:hidden" />
        <Moon class="hidden size-4 dark:block" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem data-testid="theme-light" @click="mode = 'light'"><Sun class="size-4" /> Claro</DropdownMenuItem>
      <DropdownMenuItem data-testid="theme-dark" @click="mode = 'dark'"><Moon class="size-4" /> Oscuro</DropdownMenuItem>
      <DropdownMenuItem @click="mode = 'auto'"><Monitor class="size-4" /> Sistema</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ChevronsUpDown, LogOut, UserRound } from '@lucide/vue';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#ui/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '#ui/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';

const me = useMe();
const can = useCan();
const route = useRoute();
const branding = useBranding();
const sections = computed(() => visibleNavigation(can, (me.value?.features ?? {}) as Record<string, boolean>));
const initials = computed(() => (me.value?.user.name || me.value?.user.email || '?').slice(0, 2).toUpperCase());
const navId = (to: string) => `nav${to.split('/').join('-')}`;
const isActive = (to: string) => (to === '/admin' ? route.path === '/admin' : route.path === to || route.path.startsWith(`${to}/`));
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <NuxtLink to="/admin">
              <span class="flex aspect-square size-8 items-center justify-center rounded-lg text-white" :style="{ background: branding.primaryColor }" aria-hidden="true">
                {{ branding.appName.slice(0, 1) }}
              </span>
              <span class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">{{ branding.appName }}</span>
                <span class="text-muted-foreground truncate text-xs">{{ me?.organization.name }}</span>
              </span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <OrganizationSwitcher v-if="me?.features.organizations" />
    </SidebarHeader>
    <SidebarContent>
      <nav aria-label="Navegación principal">
        <SidebarGroup v-for="section in sections" :key="section.title">
          <SidebarGroupLabel>{{ section.title }}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in section.items" :key="item.to">
              <SidebarMenuButton :is-active="isActive(item.to)" :tooltip="item.title" as-child>
                <a v-if="item.to.startsWith('/api/')" :href="item.to" target="_blank" rel="noopener"><component :is="item.icon" /> <span>{{ item.title }}</span></a>
                <NuxtLink v-else :to="item.to" :data-testid="navId(item.to)"><component :is="item.icon" /> <span>{{ item.title }}</span></NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </nav>
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton size="lg" data-testid="user-menu">
                <Avatar class="size-8 rounded-lg">
                  <AvatarImage v-if="me?.user.image" :src="me.user.image" alt="" />
                  <AvatarFallback class="rounded-lg">{{ initials }}</AvatarFallback>
                </Avatar>
                <span class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-medium">{{ me?.user.name || 'Sin nombre' }}</span>
                  <span class="text-muted-foreground truncate text-xs">{{ me?.user.email }}</span>
                </span>
                <ChevronsUpDown class="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" class="w-56">
              <DropdownMenuLabel class="text-muted-foreground text-xs">{{ me?.roles.map((r) => r.name).join(', ') || 'Sin roles' }}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child><NuxtLink to="/admin/profile"><UserRound class="size-4" /> Perfil y sesiones</NuxtLink></DropdownMenuItem>
              <DropdownMenuItem data-testid="logout" @click="signOut()"><LogOut class="size-4" /> Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>

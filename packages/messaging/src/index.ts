import { MailAutomationsService } from './automations.js';
import type { MessagingDeps } from './context.js';
import { MailDeliveriesService } from './deliveries.js';
import { MailSettingsService } from './settings.js';
import { MailTemplatesService } from './templates.js';

export * from './context.js';
export * from './settings.js';
export * from './templates.js';
export * from './automations.js';
export * from './deliveries.js';

export function createMessagingServices(deps: MessagingDeps) {
  return {
    settings: new MailSettingsService(deps),
    templates: new MailTemplatesService(deps),
    automations: new MailAutomationsService(deps),
    deliveries: new MailDeliveriesService(deps),
  };
}
export type MessagingServices = ReturnType<typeof createMessagingServices>;

import { Injectable } from '@nestjs/common';
import type { AccessEvent } from '@starter/auth';
import { createLogger } from '@starter/observability';

type Listener = (e: AccessEvent) => Promise<void> | void;
const log = createLogger('access-events');

/** Fan-out of access domain events (e.g. purge files of deleted users) to other modules. */
@Injectable()
export class AccessEventsService {
  private readonly listeners: Listener[] = [];

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  async handle(e: AccessEvent): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l(e);
      } catch (err) {
        log.error({ type: e.type, err: (err as Error).message }, 'access event listener failed');
      }
    }
  }
}

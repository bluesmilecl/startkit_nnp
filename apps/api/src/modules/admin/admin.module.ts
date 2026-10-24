import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { ProposalsController } from './proposals.controller.js';
import { RolesController } from './roles.controller.js';
import { SettingsController } from './settings.controller.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController, RolesController, InvitationsController, AuditController, SettingsController, ProposalsController, OrganizationsController],
})
export class AdminModule {}

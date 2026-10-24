import { randomBytes } from 'node:crypto';

// Integration environment: deterministic secrets, log mail transport, no rate limiting.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('hex');
process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.MAIL_TRANSPORT = 'log';
process.env.APP_URL = 'http://localhost:3000';
process.env.OWNER_EMAIL = '';
process.env.AI_TEST_PROVIDER_ENABLED = 'true';
process.env.OPENAPI_DOCS = 'protected';
process.env.STORAGE_LOCAL_DIR = `/tmp/starter-it-storage-${process.pid}`;

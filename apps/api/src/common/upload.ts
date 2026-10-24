import { Inject, Injectable, UseInterceptors, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Env } from '@starter/config';
import { ENV } from '../infra/tokens.js';

/** In-memory upload of the multipart field (the content is validated by the service). */
export interface UploadedBinary {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Single-file multipart upload with the size limit read from the environment at request time
 * (multer rejects larger bodies while streaming, before buffering them completely).
 */
export function UploadFile(field: string, limit: 'UPLOAD_MAX_BYTES' | 'AUDIO_MAX_BYTES'): MethodDecorator {
  @Injectable()
  class UploadInterceptor implements NestInterceptor {
    private inner: NestInterceptor | null = null;
    constructor(@Inject(ENV) private readonly env: Env) {}
    intercept(context: ExecutionContext, next: CallHandler) {
      this.inner ??= new (FileInterceptor(field, { limits: { fileSize: this.env[limit], files: 1, fields: 10 } }))();
      return this.inner.intercept(context, next);
    }
  }
  return UseInterceptors(UploadInterceptor);
}

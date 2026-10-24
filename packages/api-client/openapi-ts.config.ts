import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi.json',
  output: { path: './src/generated', clean: true, importFileExtension: '.js' },
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', { name: '@hey-api/sdk' }],
});

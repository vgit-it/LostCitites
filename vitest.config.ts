import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    // Node by default; component tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['{shared,server,client,scripts}/**/*.test.{ts,tsx}'],
  },
});

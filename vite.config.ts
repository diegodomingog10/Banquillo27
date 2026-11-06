import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Siempre el mismo puerto: las partidas guardadas van ligadas a la dirección (http://localhost:5173)
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as never);

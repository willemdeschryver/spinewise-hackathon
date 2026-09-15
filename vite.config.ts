import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:lan` serves over https on the LAN so a phone or tablet can use its microphone
// (getUserMedia needs a secure context away from localhost).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'lan' ? [basicSsl()] : [],
  // Two pages: the app and, at /present.html, the pitch deck that runs on the same organism.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        present: fileURLToPath(new URL('present.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173 },
  // The analysis runs in module workers; onnxruntime-web loads its own wasm and must not be pre-bundled.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
}));

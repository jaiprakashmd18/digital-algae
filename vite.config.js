import { defineConfig, loadEnv } from 'vite';
import { prerenderPlugin } from './scripts/prerender.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // Used in index.html meta tags; falls back to a local URL in development.
  process.env.VITE_PUBLIC_SITE_URL = (env.VITE_PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  for (const key of Object.keys(env)) {
    if (/SERVICE_ROLE|SECRET/i.test(key)) {
      throw new Error(`Refusing to build: ${key} looks like a secret and must not be prefixed with VITE_.`);
    }
  }
  return {
    plugins: [prerenderPlugin({ siteUrl: process.env.VITE_PUBLIC_SITE_URL })],
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three')) return 'three';
            if (id.includes('node_modules/@supabase')) return 'supabase';
            return undefined;
          },
        },
      },
    },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});

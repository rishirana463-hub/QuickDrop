import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
  const publicUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_APP_URL;
  const allowedHosts = publicUrl ? [new URL(publicUrl).hostname] : [];
  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['buffer', 'process', 'events', 'util', 'stream'],
        globals: { Buffer: true, global: true, process: true },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (
              id.includes('framer-motion') ||
              id.includes('motion-dom') ||
              id.includes('motion-utils')
            )
              return 'motion';
            if (id.includes('simple-peer') || id.includes('readable-stream')) return 'peer';
          },
        },
      },
    },
    server: {
      allowedHosts,
      port: 5173,
      strictPort: true,
      proxy: {
        '/signal': { target: 'ws://127.0.0.1:3001', ws: true },
        '/health': { target: 'http://127.0.0.1:3001' },
      },
    },
  };
});

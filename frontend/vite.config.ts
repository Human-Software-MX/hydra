import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/ceadevws': {
        target: 'https://appcea.ceaqueretaro.gob.mx',
        changeOrigin: true,
      },
      '/aquacis-cea': {
        target: 'https://aquacis-cf-int.ceaqueretaro.gob.mx/Comercial',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/aquacis-cea/, ''),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Separar módulos que tienen inicialización de módulo compleja en sus
         * propios chunks garantiza que se inicialicen antes de que el chunk
         * consumidor corra — evita el "Cannot access 'X' before initialization"
         * (Temporal Dead Zone) que Rollup produce en builds de producción cuando
         * aplana módulos CJS/ESM en orden incorrecto.
         */
        manualChunks(id) {
          if (id.includes('@react-pdf/renderer') || id.includes('@react-pdf/')) {
            return 'react-pdf';
          }
          if (
            id.includes('/src/lib/tarifas') ||
            id.includes('/src/lib/cotizacion-tarifas') ||
            id.includes('/src/lib/cotizacion.ts') ||
            id.includes('/src/data/tarifas-agua') ||
            id.includes('/src/data/tarifas-contratacion')
          ) {
            return 'tarifas';
          }
        },
      },
    },
  },
}));

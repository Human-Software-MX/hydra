import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Solo los specs escritos con la API de vitest; el resto (jest) los corre jest.config.js.
    include: ['src/modules/supra/**/*.spec.ts', 'src/modules/pagos/pagos.supra-first.spec.ts'],
    environment: 'node',
  },
});

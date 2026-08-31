/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // Los specs de SUPRA (y pagos.supra-first) usan la API de vitest — los corre
  // `npm run test:vitest`; jest cubre el resto.
  testPathIgnorePatterns: ['/node_modules/', '/src/modules/supra/', 'pagos\\.supra-first\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

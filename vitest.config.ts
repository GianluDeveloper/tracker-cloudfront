import { defineConfig, coverageConfigDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-env.ts'],
    coverage: {
      exclude: [
        '**/scripts/**',
        '**/tests/**',
        ...coverageConfigDefaults.exclude
      ]
    }
  }
});

import { defineConfig } from 'vitest/config';

// Relative base so the build works under any GitHub Pages path.
export default defineConfig({
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});

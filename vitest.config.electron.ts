import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/**/*.test.ts'],
    exclude: ['node_modules', 'n8n-master', 'dist'],
  },
})

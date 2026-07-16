import { defineConfig } from 'vitest/config'

// Config própria para os testes (não usa o vite.config.ts da app, por isso não
// carrega os plugins de React/Tailwind). Os testes são de lógica pura — correm
// em Node, sem DOM nem Supabase.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

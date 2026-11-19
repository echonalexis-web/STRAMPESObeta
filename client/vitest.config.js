import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Component tests only: files named *.ui.test.jsx run here, in jsdom. Every
// other test (utils, chatbot, data) keeps running under `node --test`, so the
// pure tests stay fast and need no DOM.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.ui.test.{js,jsx}'],
      setupFiles: ['./src/test/setup.js'],
      css: false,
      restoreMocks: true,
    },
  })
)

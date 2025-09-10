import { defineConfig } from 'vite'
import { resolve as r } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'
  return {
    base: isBuild ? '/ISiK-Questionnaire-Tooling-Demo/' : '/',
    build: {
      rollupOptions: {
        // Explicitly include multi-page entries
        input: {
          main: r(__dirname, 'index.html'),
          resolve: r(__dirname, 'resolve.html'),
          result: r(__dirname, 'result.html'),
        }
      }
    }
  }
})

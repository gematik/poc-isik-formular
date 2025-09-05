import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'
  return {
    base: isBuild ? '/ISiK-Questionnaire-Tooling-Demo/' : '/',
  }
})
// Vitest setup for jsdom environment
import { beforeAll } from 'vitest'

// Provide a minimal fetch mock if not present (Node <18 or jsdom)
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
}

// Make URL and URLSearchParams available (jsdom provides them)
beforeAll(() => {
  // nothing yet; placeholder for future global stubs
})


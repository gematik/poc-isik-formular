/*
*
* Copyright 2025 gematik GmbH
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
* *******
*
* For additional notes and disclaimer from gematik and in case of changes by gematik find details in the "Readme" file.
*/

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


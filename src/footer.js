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

export async function injectFooter(rootId = 'footer-root') {
  const mount = document.getElementById(rootId);
  if (!mount) return;
  // Hide footer entirely in minimal mode
  try {
    if (document?.body?.classList?.contains('minimal')) {
      mount.style.display = 'none';
      return;
    }
  } catch {}
  try {
    const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
    // Build URL relative to Vite base to work under subpaths (e.g., GitHub Pages)
    const url = new URL('partials/footer.html', base).toString();
    const res = await fetch(url, { cache: 'no-cache' });
    const html = await res.text();
    mount.innerHTML = html;
  } catch (e) {
    // Fallback inline footer if fetch fails (ensures minimal branding)
    mount.innerHTML = '<footer class="site-footer"><div class="footer-content"><span>Copyright 2025 gematik GmbH; created by Gefyra GmbH</span><span>·</span><a href="https://www.gematik.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a></div></footer>';
  }
}

injectFooter();

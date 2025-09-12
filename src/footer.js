export async function injectFooter(rootId = 'footer-root') {
  const mount = document.getElementById(rootId);
  if (!mount) return;
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


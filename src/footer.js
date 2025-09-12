export async function injectFooter(rootId = 'footer-root') {
  const mount = document.getElementById(rootId);
  if (!mount) return;
  try {
    const res = await fetch('/partials/footer.html', { cache: 'no-cache' });
    const html = await res.text();
    mount.innerHTML = html;
  } catch (e) {
    mount.innerHTML = '<footer class="site-footer"><div class="footer-content"><span>© 2025 Team PT-DATA</span><span>·</span><a href="https://www.gematik.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a></div></footer>';
  }
}

injectFooter();


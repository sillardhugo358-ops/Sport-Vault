(() => {
  const header = document.querySelector('.site-header');
  const desktopNav = document.querySelector('.nav');
  const menuButton = document.querySelector('.menu-btn');
  if (!header || !desktopNav || !menuButton) return;

  let panel = document.querySelector('.mobile-nav-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'mobile-nav-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="mobile-nav-backdrop" data-mobile-close></div>
      <nav class="mobile-nav" aria-label="Navigation mobile">
        ${desktopNav.innerHTML}
      </nav>`;
    document.body.appendChild(panel);
  }

  const close = () => {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    menuButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-menu-open');
  };

  const open = () => {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    menuButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-menu-open');
  };

  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
  panel.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  panel.querySelector('[data-mobile-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 760) close(); });
})();

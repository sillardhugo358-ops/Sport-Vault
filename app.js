(() => {
  const button = document.querySelector('.menu-btn');
  const nav = document.querySelector('.nav');
  if (button && nav) {
    button.addEventListener('click', () => {
      nav.classList.toggle('open');
      button.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    });
  }
})();

(() => {
  const style = document.createElement('style');
  style.textContent = `
    .draw-card:not(.is-revealed){transform:translateY(18px) rotateY(180deg) scale(.96);opacity:1;}
    .draw-card:not(.is-revealed) .draw-card-inner > *{visibility:hidden;}
    .draw-card:not(.is-revealed) .draw-card-inner:before{content:'FOOTVAULT';position:absolute;inset:12px;display:grid;place-items:center;color:var(--gold2);font:800 28px var(--head);letter-spacing:2px;border:1px solid rgba(240,209,140,.25);background:radial-gradient(circle,rgba(240,209,140,.17),transparent 58%),linear-gradient(145deg,#292318,#080909 65%);visibility:visible;}
    .draw-card:not(.is-revealed) .draw-card-inner:after{content:'26 · REVEAL';position:absolute;left:0;right:0;bottom:28px;text-align:center;color:#858780;font:700 9px var(--body);letter-spacing:2px;visibility:visible;}
    .football-card-link{text-decoration:none;color:inherit;display:block;}
    .football-card-link:hover .football-card-frame{transform:translateY(-5px);}
    .football-card-frame{transition:transform .25s ease,box-shadow .25s ease;}
  `;
  document.head.appendChild(style);
})();

async function refreshSessionUI(){
  try{
    const r = await fetch('/api/me', {cache:'no-store', credentials:'same-origin'});
    const logged = r.ok;
    document.querySelectorAll('[data-auth-link]').forEach(link => {
      if(logged){
        link.textContent='Mon Vault';
        link.href='vault.html';
      } else if(location.pathname.endsWith('/vault.html') || location.pathname.endsWith('/album.html') || location.pathname.endsWith('/collection.html')) {
        link.textContent='Connexion';
        link.href=`auth.html?next=${encodeURIComponent(location.pathname.split('/').pop())}`;
      }
    });
  }catch{}
}
refreshSessionUI();

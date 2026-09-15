(() => {
  const apply = () => {
    const opening = document.getElementById('opening');
    const inner = document.querySelector('.opening-inner');
    const stage = document.querySelector('.pack-stage');
    const reveals = document.getElementById('reveals');
    if (!opening || !inner || !stage || !reveals) return;

    const style = document.createElement('style');
    style.textContent = `
      .opening{padding:16px!important;overflow:hidden!important}
      .opening-inner{max-height:calc(100vh - 32px)!important;overflow-y:auto!important;overflow-x:hidden!important;padding:26px 22px 28px!important}
      .opening-inner::-webkit-scrollbar{width:6px}
      .opening-inner::-webkit-scrollbar-thumb{background:rgba(216,180,106,.35);border-radius:8px}
      .pack-stage.compact{height:0!important;min-height:0!important;margin:0!important;overflow:hidden!important}
      .pack-stage.playing{height:210px!important}
      .reveals.compact-five{grid-template-columns:repeat(5,minmax(130px,1fr))!important;max-width:1120px!important}
      .reveals.compact-many{grid-template-columns:repeat(4,minmax(150px,1fr))!important;max-width:1050px!important}
      .reveal-card{height:270px!important}
      .reveal-card:hover{transform:translateY(-5px)!important}
      .pack-price{margin-top:12px;padding:11px 13px;border:1px solid rgba(216,180,106,.45);background:linear-gradient(135deg,rgba(216,180,106,.10),rgba(5,6,6,.58));display:flex;align-items:center;justify-content:space-between;gap:12px;color:#aaa;font:700 9px var(--font-head);letter-spacing:1.5px;text-transform:uppercase}
      .pack-price strong{color:var(--gold2);font:800 23px var(--font-head);letter-spacing:0;white-space:nowrap}
      .pack-price small{color:#777;font:600 8px var(--font-body);letter-spacing:.3px;text-transform:none}
      .sv-notice{position:fixed;right:24px;bottom:24px;width:min(410px,calc(100vw - 32px));padding:18px 42px 18px 18px;background:linear-gradient(145deg,#151716,#080909);border:1px solid var(--gold);box-shadow:0 22px 55px rgba(0,0,0,.65),0 0 32px rgba(216,180,106,.09);z-index:1000;opacity:0;transform:translateY(16px);pointer-events:none;transition:.25s}
      .sv-notice.show{opacity:1;transform:none;pointer-events:auto}
      .sv-notice b{display:block;color:var(--gold2);font:800 15px var(--font-head);letter-spacing:1.6px;margin-bottom:6px}
      .sv-notice span{display:block;color:#aaa;font-size:11px;line-height:1.55}
      .sv-notice button{position:absolute;right:10px;top:8px;border:0;background:transparent;color:#777;font-size:20px;cursor:pointer}
      .sv-notice button:hover{color:#fff}
      @media(max-width:1050px){.reveals.compact-five{grid-template-columns:repeat(3,minmax(150px,1fr))!important}.reveals.compact-many{grid-template-columns:repeat(3,minmax(145px,1fr))!important}}
      @media(max-width:720px){.opening-inner{padding:22px 12px 24px!important}.reveals.compact-five,.reveals.compact-many{grid-template-columns:repeat(2,minmax(130px,1fr))!important}.reveal-card{height:225px!important}.sv-notice{right:16px;bottom:16px}}
      @media(max-width:480px){.reveals.compact-five,.reveals.compact-many{grid-template-columns:1fr 1fr!important}.reveal-card{height:210px!important}.opening-title{font-size:34px!important}}
    `;
    document.head.appendChild(style);

    const showNotice = (message) => {
      let box = document.getElementById('svNotice');
      if (!box) {
        box = document.createElement('div');
        box.id = 'svNotice';
        box.className = 'sv-notice';
        box.innerHTML = '<button type="button" aria-label="Fermer">×</button><b>OUVERTURE IMPOSSIBLE</b><span></span>';
        document.body.appendChild(box);
        box.querySelector('button').onclick = () => box.classList.remove('show');
      }
      box.querySelector('span').textContent = String(message || 'Une erreur est survenue.');
      box.classList.add('show');
      clearTimeout(window.__svNoticeTimer);
      window.__svNoticeTimer = setTimeout(() => box.classList.remove('show'), 4200);
    };
    window.alert = (message) => showNotice(message);

    const prices = [100, 250, 500];
    const cards = document.querySelectorAll('.pack-card');
    cards.forEach((card, i) => {
      if (i > 2 || card.querySelector('.pack-price')) return;
      const meta = card.querySelector('.pack-meta');
      if (!meta) return;
      const price = document.createElement('div');
      price.className = 'pack-price';
      price.innerHTML = '<span>PRIX</span><strong>' + prices[i].toLocaleString('fr-FR') + ' <small>FOOTCOINS</small></strong>';
      meta.insertAdjacentElement('afterend', price);
    });

    const observer = new MutationObserver(() => {
      const cards = reveals.querySelectorAll('.reveal-card');
      const hiddenStage = getComputedStyle(document.getElementById('stagePack')).display === 'none';
      stage.classList.toggle('compact', hiddenStage);
      stage.classList.toggle('playing', !hiddenStage);
      reveals.classList.toggle('compact-five', cards.length <= 5);
      reveals.classList.toggle('compact-many', cards.length > 5);
    });
    observer.observe(reveals, { childList: true });
    observer.observe(document.getElementById('stagePack'), { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(document.getElementById('closeOpening'), { attributes: true, attributeFilter: ['class'] });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();

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
      @media(max-width:1050px){.reveals.compact-five{grid-template-columns:repeat(3,minmax(150px,1fr))!important}.reveals.compact-many{grid-template-columns:repeat(3,minmax(145px,1fr))!important}}
      @media(max-width:720px){.opening-inner{padding:22px 12px 24px!important}.reveals.compact-five,.reveals.compact-many{grid-template-columns:repeat(2,minmax(130px,1fr))!important}.reveal-card{height:225px!important}}
      @media(max-width:480px){.reveals.compact-five,.reveals.compact-many{grid-template-columns:1fr 1fr!important}.reveal-card{height:210px!important}.opening-title{font-size:34px!important}}
    `;
    document.head.appendChild(style);

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

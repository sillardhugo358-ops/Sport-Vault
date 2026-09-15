(function cleanInternalHeader(){
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const isHome=page==='index.html'||page==='';
  if(isHome) return;

  const removeByLabel=root=>{
    root?.querySelectorAll('a').forEach(a=>{
      const label=(a.textContent||'').trim().toLowerCase();
      if(label==='à propos'||label==='a propos'||label==='compte'||label==='compte connecté ✓') a.remove();
    });
  };

  const header=document.querySelector('.site-header');
  if(!header) return;
  removeByLabel(header.querySelector('.nav'));
  header.querySelector('.header-actions')?.remove();

  removeByLabel(document.querySelector('.mobile-menu-links'));
})();

(() => {
  const button = document.querySelector('.menu-btn');
  const nav = document.querySelector('.nav');
  if (!button || !nav) return;
  button.addEventListener('click', () => {
    nav.classList.toggle('open');
    button.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
  });
})();

async function refreshSessionUI(){
  try{
    const r=await fetch('/api/me',{cache:'no-store'});
    const logged=r.ok;
    document.querySelectorAll('[data-auth-link]').forEach(link=>{
      if(logged){link.textContent='Mon Vault';link.href='vault.html'}
    });
  }catch{}
}
refreshSessionUI();

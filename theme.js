// Thème d'affichage : nuit (par défaut, comme avant), jour, ou automatique (selon le mode de l'appareil). Chargé dans <head>, avant
// les feuilles de style, pour éviter un éclair sombre. Le thème jour est une feuille à part (theme-light.css, générée par
// scripts/build-light-theme.js) que seuls les joueurs en thème jour téléchargent. Le choix est gardé dans le navigateur.
(()=>{
const KEY='fv-theme',CSS_ID='fv-theme-light',CSS_HREF='theme-light.css?v=20261013-jour1';
const mq=window.matchMedia?matchMedia('(prefers-color-scheme: light)'):{matches:false};
const read=()=>{try{const v=localStorage.getItem(KEY);return v==='light'||v==='auto'||v==='dark'?v:'dark'}catch{return'dark'}};
const effective=pref=>pref==='auto'?(mq.matches?'light':'dark'):pref;
function apply(first){
  const pref=read(),eff=effective(pref),root=document.documentElement;
  root.dataset.theme=eff;root.dataset.themePref=pref;
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',eff==='light'?'#f2f5fa':'#050b16');
  let link=document.getElementById(CSS_ID);
  if(eff==='light'&&!link){
    // Au premier affichage, la feuille est écrite dans la page (elle bloque le rendu : pas d'éclair sombre) ; ensuite elle est ajoutée.
    if(first&&document.readyState==='loading')document.write('<link rel="stylesheet" id="'+CSS_ID+'" href="'+CSS_HREF+'">');
    else{link=document.createElement('link');link.rel='stylesheet';link.id=CSS_ID;link.href=CSS_HREF;document.head.appendChild(link)}
  }else if(eff!=='light'&&link)link.remove();
  document.dispatchEvent(new CustomEvent('fv-theme',{detail:{pref,effective:eff}}));
}
const LABELS={dark:'NUIT',light:'JOUR',auto:'AUTO'};
window.fvTheme={get:read,labels:LABELS,set(v){try{localStorage.setItem(KEY,v)}catch{}apply(false)},cycle(){const order=['dark','light','auto'];this.set(order[(order.indexOf(read())+1)%3])}};
if(mq.addEventListener)mq.addEventListener('change',()=>{if(read()==='auto')apply(false)});
// Bouton du pied de page : nuit -> jour -> auto ; et réglage « Apparence » du profil (boutons data-theme-set).
function sync(){
  const pref=read(),btn=document.getElementById('themeBtn');
  if(btn){btn.textContent='THÈME : '+LABELS[pref];btn.title='Thème d’affichage : '+LABELS[pref]+' (cliquer pour changer)'}
  document.querySelectorAll('[data-theme-set]').forEach(b=>{const on=b.dataset.themeSet===pref;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',on?'true':'false')});
}
document.addEventListener('fv-theme',sync);
document.addEventListener('click',e=>{
  if(e.target.closest('#themeBtn')){window.fvTheme.cycle();return}
  const b=e.target.closest('[data-theme-set]');if(b)window.fvTheme.set(b.dataset.themeSet);
});
document.addEventListener('DOMContentLoaded',sync);
// Après chaque changement de page, le réglage du profil est resynchronisé.
window.addEventListener('hashchange',()=>setTimeout(sync,0));
apply(true);
})();

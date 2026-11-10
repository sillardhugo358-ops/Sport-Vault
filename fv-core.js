// Socle de l'interface (Q3) : état, aides communes (échappement, montants, appels API), notifications éphémères, fenêtres modales accessibles.
// Chargé AVANT app.js : publie ses éléments dans FVC.core (que app.js complète avec render, viewHero, bind…).
(()=>{
const FVC=window.FVC=window.FVC||{};FVC.core=FVC.core||{};
const bind=(...a)=>FVC.core.bind(...a);
const state={user:null,cards:[],catalog:[],packs:[],progress:null,album:null,auctions:[],auctionHistory:[],adminUsers:[],adminCompetitions:[],adminClubs:[],filter:'all',collectionSearch:'',collectionSort:'ovr',marketRarity:'all',marketSort:'ending',authMode:'login',packShopType:'all',packShopSearch:'',packShopMax:5000,packShopSort:'recent'};
const $=s=>document.querySelector(s);
const app=()=>$('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('fr-FR');
const initials=n=>String(n||'FV').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const rarityOrder={common:1,rare:2,epic:3,legendary:4,icon:5};
const rarityValue={common:100,rare:300,epic:700,legendary:1800,icon:4500};
const route=()=>{const h=location.hash.replace(/^#/,'')||'home';const [r,q]=h.split('?');return{r:r||'home',q:new URLSearchParams(q||'')}};
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('.skip-link');if(a){e.preventDefault();app().focus()}});
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...opt});let d={};try{d=await r.json()}catch{};if(!r.ok){if(r.status===503&&/démarrage/i.test(d.error||''))showStarting();const e=new Error(d.error||'Une erreur est survenue.');e.status=r.status;e.data=d;throw e}
 // Après une action (pack, enchère, récompense…), la cloche vérifie les succès et missions terminés (notifications-bell.js).
 if(opt.method==='POST'&&!/^\/api\/(activity|notifications)/.test(path))window.fvNotifRefresh?.();return d}
// Écran « Le serveur démarre » : l'hébergeur gratuit endort le serveur, et la base peut mettre une à deux minutes à répondre (503 « en cours de démarrage »).
// Au premier 503 de ce type, un écran explique la situation, interroge /api/health toutes les 3 s (FVC.core.startingPollMs pour les tests) et
// recharge la page courante tout seul dès que la base répond. Après 2 minutes, un bouton propose de réessayer à la main.
const starting={el:null,timer:0,t0:0};
function stopStarting(){clearTimeout(starting.timer);starting.el?.remove();starting.el=null;const a=app();if(a)a.inert=false}
function showStarting(){
 if(starting.el)return;
 const el=document.createElement('div');el.id='fvStarting';el.className='fv-starting';el.setAttribute('role','status');
 el.innerHTML='<div class="fv-starting-card"><span class="fv-starting-spin" aria-hidden="true"></span><h2>Le serveur démarre</h2>'
  +'<p>FOOTVAULT se réveille. Cela prend en général moins d’une minute : la page se rechargera toute seule.</p>'
  +'<p class="fv-starting-time"></p><button class="btn btn-gold fv-starting-retry" type="button" hidden>Réessayer maintenant</button></div>';
 el.querySelector('button').addEventListener('click',()=>location.reload());
 document.body.appendChild(el);starting.el=el;starting.t0=Date.now();
 const a=app();if(a)a.inert=true;
 const tick=async()=>{
  if(!starting.el)return;
  const sec=Math.round((Date.now()-starting.t0)/1000);
  el.querySelector('.fv-starting-time').textContent=sec>=120?'Cela prend plus de temps que d’habitude ('+sec+' s).':'Démarrage en cours depuis '+sec+' s.';
  if(sec>=120)el.querySelector('button').hidden=false;
  let ready=false;
  try{const h=await (await fetch('/api/health',{cache:'no-store'})).json();ready=h.ready===true&&h.database?.ok===true}catch{}
  if(!starting.el)return;
  if(ready){stopStarting();FVC.core.render?.();return}
  starting.timer=setTimeout(tick,FVC.core.startingPollMs||3000);
 };
 starting.timer=setTimeout(tick,FVC.core.startingPollMs||3000);
}
// Comme api(), avec de nouvelles tentatives (2 s, 4 s, 8 s) quand le serveur démarre (503) ou que le réseau échoue ;
// les autres erreurs (401 non connecté, 404…) sont renvoyées tout de suite.
async function apiRetry(path,opt={},delays=[2000,4000,8000]){
 for(let i=0;;i++){
  try{return await api(path,opt)}
  catch(e){if((e.status&&e.status!==503)||i>=delays.length)throw e;await new Promise(r=>setTimeout(r,delays[i]))}
 }
}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200)}
// Fenêtres modales (toutes passent par setModal/closeModal) : rôle « dialog » nommé par son titre, focus placé dedans et piégé,
// Échap pour annuler, fond inerte, focus rendu au déclencheur à la fermeture.
let modalOpener=null;
const MODAL_FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalBackground=()=>[...document.body.children].filter(e=>e.id!=='modal'&&e.id!=='toast'&&e.tagName!=='SCRIPT');
function modalItems(m){return[...m.querySelectorAll(MODAL_FOCUSABLE)].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')}
function setModal(html){const m=$('#modal');if(!m.classList.contains('show'))modalOpener=document.activeElement;m.innerHTML=html;m.classList.add('show');m.setAttribute('aria-hidden','false');m.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);if(typeof bind==='function')bind();
 m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');const title=m.querySelector('h1,h2,h3');if(title){title.id=title.id||'modalTitle';m.setAttribute('aria-labelledby',title.id);m.removeAttribute('aria-label')}else{m.removeAttribute('aria-labelledby');m.setAttribute('aria-label','Fenêtre')}
 modalBackground().forEach(e=>{e.inert=true});
 const box=m.querySelector('.modal-box')||m;if(!box.hasAttribute('tabindex'))box.setAttribute('tabindex','-1');
 const items=modalItems(m);const first=m.querySelector('[autofocus]')||items.find(e=>!e.classList.contains('modal-close'))||items[0]||box;first.focus({preventScroll:true})}
function closeModal(){const m=$('#modal');const wasOpen=m.classList.contains('show');m.classList.remove('show');m.setAttribute('aria-hidden','true');m.removeAttribute('role');m.removeAttribute('aria-modal');m.removeAttribute('aria-labelledby');m.removeAttribute('aria-label');m.innerHTML='';modalBackground().forEach(e=>{e.inert=false});
 if(wasOpen&&modalOpener&&document.contains(modalOpener)&&!modalOpener.disabled)modalOpener.focus({preventScroll:true});modalOpener=null}
document.addEventListener('keydown',e=>{const m=$('#modal');if(!m||!m.classList.contains('show'))return;
 if(e.key==='Escape'){const cancel=m.querySelector('#siteConfirmCancel,#auctionDialogCancel')||m.querySelector('.modal-close');if(cancel&&!e.defaultPrevented){e.preventDefault();cancel.click()}else if(!cancel){closeModal()}return}
 if(e.key!=='Tab')return;const items=modalItems(m);if(!items.length){e.preventDefault();return}
 const firstEl=items[0],lastEl=items[items.length-1],active=document.activeElement;
 if(!m.contains(active)){e.preventDefault();firstEl.focus()}else if(e.shiftKey&&(active===firstEl||active===m.querySelector('.modal-box'))){e.preventDefault();lastEl.focus()}else if(!e.shiftKey&&active===lastEl){e.preventDefault();firstEl.focus()}});
Object.assign(FVC.core,{$,api,apiRetry,app,closeModal,esc,initials,money,rarityOrder,rarityValue,route,setModal,state,toast});
})();

// PWA et notifications push : enregistre le service worker, propose « Installer l'application » et le réglage des notifications (Profil).
// Chargé après fv-pages.js ; serveur : /api/push/* (lib/push.js). Le consentement n'est demandé qu'au clic du joueur, jamais à la première visite.
// Pas d'e-mail : seulement le push du navigateur.
(()=>{
const {api,esc,render,toast}=FVC.core;
const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const st={cfg:null,subscribed:false,permission:supported?Notification.permission:'unsupported',installEvent:null,installed:false,busy:false};
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
const key64=s=>{const p='='.repeat((4-s.length%4)%4),b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0))};
let reg=null;
async function refresh(){
 st.permission=supported?Notification.permission:'unsupported';
 if(!supported||!reg){st.subscribed=false;return}
 try{st.subscribed=!!(await reg.pushManager.getSubscription())&&st.permission==='granted'}catch{st.subscribed=false}
}
async function init(){
 if(!('serviceWorker' in navigator))return;
 try{reg=await navigator.serviceWorker.register('sw.js')}catch{return}
 try{st.cfg=await api('/api/push/config')}catch{st.cfg={enabled:false}}
 await refresh();
 if(location.hash.startsWith('#profil'))render();
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();st.installEvent=e;if(location.hash.startsWith('#profil'))render()});
window.addEventListener('appinstalled',()=>{st.installEvent=null;st.installed=true;if(location.hash.startsWith('#profil'))render()});
async function enable(){
 if(st.busy||!supported||!st.cfg?.enabled)return;
 st.busy=true;
 try{
  const perm=await Notification.requestPermission();
  if(perm!=='granted'){toast(perm==='denied'?'Notifications bloquées : autorise-les dans les réglages du navigateur.':'Notifications non activées.');return}
  const r=reg||await navigator.serviceWorker.ready;
  const sub=(await r.pushManager.getSubscription())||await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key64(st.cfg.publicKey)});
  await post('/api/push/subscribe',sub.toJSON());
  toast('Notifications activées sur cet appareil.');
 }catch(e){toast(e.message||'Activation impossible.')}
 finally{st.busy=false;await refresh();render()}
}
async function disable(){
 if(st.busy||!reg)return;
 st.busy=true;
 try{
  const sub=await reg.pushManager.getSubscription();
  if(sub){await post('/api/push/unsubscribe',{endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe()}
  toast('Notifications désactivées sur cet appareil.');
 }catch(e){toast(e.message||'Désactivation impossible.')}
 finally{st.busy=false;await refresh();render()}
}
async function install(){
 const ev=st.installEvent;if(!ev)return;
 st.installEvent=null;ev.prompt();
 try{await ev.userChoice}catch{}
 render();
}
// Bloc du profil : activer ou couper les notifications de cet appareil, installer l'application.
function panelHtml(){
 let notif;
 if(!supported)notif='<p class="push-note">'+(ios&&!standalone()?'Sur iPhone, installe d’abord l’application : bouton Partager, puis « Sur l’écran d’accueil ». Les notifications ne marchent ensuite que depuis cette icône.':'Ton navigateur ne gère pas les notifications push.')+'</p>';
 else if(!st.cfg)notif='<p class="push-note">Chargement…</p>';
 else if(!st.cfg.enabled)notif='<p class="push-note">Les notifications ne sont pas encore disponibles sur ce site.</p>';
 else if(st.permission==='denied')notif='<p class="push-note">Les notifications sont bloquées pour ce site : autorise-les dans les réglages du navigateur, puis reviens ici.</p>';
 else notif='<p class="push-note">Reçois une alerte quand tu es surenchéri, qu’une enchère est gagnée, qu’un échange t’est proposé ou qu’une récompense de classement t’attend. Jamais d’e-mail.</p><button class="btn '+(st.subscribed?'btn-outline':'btn-gold')+'" type="button" data-push-toggle aria-pressed="'+st.subscribed+'" '+(st.busy?'disabled':'')+'>'+(st.subscribed?'DÉSACTIVER SUR CET APPAREIL':'ACTIVER LES NOTIFICATIONS')+'</button>';
 const inst=standalone()||st.installed?'<p class="push-note">Application installée ✔</p>':st.installEvent?'<button class="btn btn-outline" type="button" data-pwa-install>INSTALLER L’APPLICATION</button>':ios?'<p class="push-note">Pour installer : bouton Partager, puis « Sur l’écran d’accueil ».</p>':'';
 return '<section class="profile-panel push-panel"><p class="eyebrow">APPLICATION</p><h2>NOTIFICATIONS</h2>'+notif+(inst?'<div class="push-install">'+inst+'</div>':'')+'</section>';
}
document.addEventListener('click',e=>{
 if(e.target.closest?.('[data-push-toggle]'))return st.subscribed?disable():enable();
 if(e.target.closest?.('[data-pwa-install]'))return install();
});
FVC.push={panelHtml,state:st,refresh};
init();
})();

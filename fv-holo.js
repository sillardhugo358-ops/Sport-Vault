// Cartes « physiques » (voir card-detail.css) : inclinaison 3D et reflets holographiques qui suivent la souris (au survol) ou
// l'inclinaison du téléphone (gyroscope : fiche d'une carte et ouverture d'un pack). Aucun effet si l'utilisateur demande moins de mouvement.
(()=>{
if(typeof window==='undefined'||!window.matchMedia)return;
const calm=matchMedia('(prefers-reduced-motion: reduce)');
if(calm.matches)return;
const MAX=14,CARD='.tcg-card.v4';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let cur=null,rect=null,raf=0,pend=null;

function setVars(card,mx,my,rx,ry,act){
  card.style.setProperty('--mx',mx.toFixed(1)+'%');card.style.setProperty('--my',my.toFixed(1)+'%');
  card.style.setProperty('--rx',rx.toFixed(2)+'deg');card.style.setProperty('--ry',ry.toFixed(2)+'deg');card.style.setProperty('--act',String(act));
}
function rest(card){card.classList.remove('holo-live','holo-on');['--mx','--my','--rx','--ry','--act'].forEach(k=>card.style.removeProperty(k))}

// --- Souris : la carte sous le pointeur s'incline vers lui et reflète la lumière ---
function onMove(e){
  if(e.pointerType==='touch')return;
  const card=e.target.closest&&e.target.closest(CARD);
  if(card!==cur){if(cur)rest(cur);cur=card;rect=card?card.getBoundingClientRect():null;if(card)card.classList.add('holo-live','holo-on')}
  if(!card||!rect||!rect.width)return;
  pend={card,x:clamp((e.clientX-rect.left)/rect.width,0,1),y:clamp((e.clientY-rect.top)/rect.height,0,1)};
  if(!raf)raf=requestAnimationFrame(()=>{raf=0;const p=pend;if(!p||p.card!==cur)return;setVars(p.card,p.x*100,p.y*100,(.5-p.y)*MAX*1.4,(p.x-.5)*MAX*1.4,1)});
}
document.addEventListener('pointermove',onMove,{passive:true});
document.addEventListener('pointerleave',e=>{if(cur&&e.target===cur){rest(cur);cur=null}},true);
// Le pointeur quitte la page ou passe sur autre chose que la carte : retour au repos.
document.addEventListener('pointerout',e=>{if(cur&&!e.relatedTarget){rest(cur);cur=null}},true);
window.addEventListener('blur',()=>{if(cur){rest(cur);cur=null}});
document.addEventListener('scroll',()=>{rect=cur?cur.getBoundingClientRect():null},{passive:true,capture:true});

// --- Gyroscope : les cartes de la fiche détail et de l'ouverture de pack suivent l'inclinaison du téléphone ---
const GYRO_TARGETS='.detail-card '+CARD+',.pack-reveal-modal .reveal-card.flipped '+CARD;
let gyroOn=false,base=null,smooth={b:0,g:0};
function onTilt(e){
  if(e.beta==null||e.gamma==null)return;
  if(!base)base={b:e.beta,g:e.gamma};
  // Le point neutre suit lentement la position de la main : seule l'inclinaison récente compte.
  base.b+=(e.beta-base.b)*.02;base.g+=(e.gamma-base.g)*.02;
  smooth.b+=((e.beta-base.b)-smooth.b)*.35;smooth.g+=((e.gamma-base.g)-smooth.g)*.35;
  const cards=document.querySelectorAll(GYRO_TARGETS);
  if(!cards.length)return;
  const gx=clamp(smooth.g,-25,25),gy=clamp(smooth.b,-25,25);
  const mx=50+gx*2,my=50+gy*2,rx=-gy*(MAX/25),ry=gx*(MAX/25),act=clamp(Math.hypot(gx,gy)/8,0.25,1);
  cards.forEach(c=>{c.classList.add('holo-live');setVars(c,clamp(mx,0,100),clamp(my,0,100),rx,ry,act)});
}
function startGyro(){if(gyroOn)return;gyroOn=true;window.addEventListener('deviceorientation',onTilt,true)}
function stopGyro(){if(!gyroOn)return;gyroOn=false;base=null;window.removeEventListener('deviceorientation',onTilt,true)}
const needsPermission=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function';
const touchOnly=()=>(window.fvHolo&&window.fvHolo.force)||matchMedia('(hover: none)').matches;
function refresh(){
  const has=!!document.querySelector(GYRO_TARGETS);
  if(!has||!touchOnly()||typeof DeviceOrientationEvent==='undefined'){stopGyro();document.querySelectorAll('.holo-enable').forEach(b=>b.remove());return}
  if(needsPermission){
    // iPhone : une demande d'autorisation, déclenchée par un geste.
    if(!gyroOn&&!document.querySelector('.holo-enable')){
      const host=document.querySelector('.detail-card');if(!host)return;
      const b=document.createElement('button');b.type='button';b.className='holo-enable';b.textContent='ACTIVER L’EFFET 3D';
      b.onclick=async()=>{try{if(await DeviceOrientationEvent.requestPermission()==='granted')startGyro()}catch{}b.remove()};
      host.after(b);
    }
  }else startGyro();
}
let t=0;
new MutationObserver(()=>{clearTimeout(t);t=setTimeout(refresh,120)}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('hashchange',()=>setTimeout(refresh,200));
refresh();
// Pour les tests : simuler une inclinaison sans capteur.
window.fvHolo={force:false,refresh,tilt:(beta,gamma)=>onTilt({beta,gamma}),gyroActive:()=>gyroOn};
})();

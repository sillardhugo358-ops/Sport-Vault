// Effets de confort : vibrations (navigator.vibrate) et sons synthétisés (WebAudio, aucun fichier audio) pour l'ouverture des packs et les
// complétions. Purement cosmétique, jamais bloquant : sans API, en mouvement réduit (vibrations) ou si le joueur coupe l'option, rien ne se passe.
// Préférences sur l'appareil (localStorage « fv-fx ») ; réglage dans Profil > Effets. Chargé avant app.js.
(()=>{
const KEY='fv-fx';
const calm=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function prefs(){try{const p=JSON.parse(localStorage.getItem(KEY)||'{}');return{haptics:p.haptics!==false,sound:p.sound!==false}}catch{return{haptics:true,sound:true}}}
function setPref(k,on){const p=prefs();p[k]=!!on;try{localStorage.setItem(KEY,JSON.stringify(p))}catch{}return p}

function vibrate(pattern){
  if(!prefs().haptics||calm()||!navigator.vibrate)return false;
  try{return navigator.vibrate(pattern)}catch{return false}
}

let ctx=null;
function audio(){
  if(ctx)return ctx;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
  try{ctx=new AC()}catch{ctx=null}return ctx;
}
// Une note : fréquence, début (s), durée (s), forme d'onde, volume (restent discrets).
function tone(a,f,t0,dur,type='sine',vol=.12,f1){
  const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+t0;
  o.type=type;o.frequency.setValueAtTime(f,t);if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+dur);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+dur+.03);
}
function noise(a,t0,dur,vol=.08,hp=2500){
  const n=Math.max(1,Math.floor(a.sampleRate*dur)),buf=a.createBuffer(1,n,a.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
  const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain(),t=a.currentTime+t0;
  s.buffer=buf;f.type='highpass';f.frequency.value=hp;g.gain.value=vol;s.connect(f);f.connect(g);g.connect(a.destination);s.start(t);
}
const SOUNDS={
  open(a){noise(a,0,.35,.07,1800);tone(a,180,0,.25,'triangle',.1,90)},                      // papier froissé + grondement
  flip(a){noise(a,0,.12,.05,3500)},                                                           // carte retournée
  rare(a){tone(a,660,0,.18,'sine',.1);tone(a,880,.09,.22,'sine',.09)},
  epic(a){[523,659,784].forEach((f,i)=>tone(a,f,i*.08,.28,'triangle',.1))},
  legend(a){[392,523,659,784,1047].forEach((f,i)=>tone(a,f,i*.09,.5,'triangle',.1));noise(a,.2,.6,.05,4000)},   // montée + éclat
  stamp(a){tone(a,110,0,.22,'square',.12,55);noise(a,0,.08,.08,900)}                         // tampon
};
function sound(name){
  if(!prefs().sound||!SOUNDS[name])return false;
  const a=audio();if(!a)return false;
  try{if(a.state==='suspended')a.resume();SOUNDS[name](a);return true}catch{return false}
}
// Vibrations associées à chaque événement (ms).
const BUZZ={open:[30,40,30],flip:12,rare:[20],epic:[30,40,30],legend:[40,50,40,50,120],stamp:[60,40,90]};
function play(name){const s=sound(name),v=vibrate(BUZZ[name]||10);return s||v}

// Rareté d'une carte -> événement.
const forRarity=r=>({rare:'rare',epic:'epic',legendary:'legend',icon:'legend'}[r]||'flip');

function panelHtml(){
  const p=prefs(),b=(k,l)=>'<button type="button" data-fx-set="'+k+'" class="'+(p[k]?'is-on':'')+'" aria-pressed="'+p[k]+'">'+l+(p[k]?' : OUI':' : NON')+'</button>';
  return '<section class="profile-panel profile-fx"><p class="eyebrow">AFFICHAGE</p><h2>EFFETS</h2><p class="wk-note">Sons et vibrations à l’ouverture des packs et aux complétions. Réglage propre à cet appareil.</p>'
    +'<div class="theme-choice" role="group" aria-label="Effets">'+b('sound','SONS')+b('haptics','VIBRATIONS')+'</div></section>';
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-fx-set]');if(!b)return;
  const k=b.dataset.fxSet,p=setPref(k,!prefs()[k]);
  b.classList.toggle('is-on',p[k]);b.setAttribute('aria-pressed',String(p[k]));b.textContent=(k==='sound'?'SONS':'VIBRATIONS')+(p[k]?' : OUI':' : NON');
  if(p[k])play('rare');
});

window.FVC=window.FVC||{};
FVC.fx={prefs,setPref,vibrate,sound,play,forRarity,panelHtml};
})();

// Micro-récompenses de complétion : quand un club, une édition ou un championnat de l'album vient d'être complété, une animation plein écran
// (tampon « COMPLÉTÉ », confettis, légère secousse) le célèbre une seule fois. Purement visuel : aucune récompense, le serveur ne change pas.
// Chargé après app.js ; appelé par la page album (fv-pages.js) avec les données de /api/album. L'état « déjà célébré » reste sur l'appareil
// (localStorage, par joueur) ; à la toute première visite il sert de point de départ sans rien célébrer, pour ne pas fêter l'existant.
(()=>{
const {esc,state}=FVC.core;
const KIND={competition:['CHAMPIONNAT',3],season:['ÉDITION',2],club:['CLUB',1]};
const calm=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const storeKey=()=>'fv-celebrated:'+(state.user&&state.user.id||'anon');
function load(){try{const raw=localStorage.getItem(storeKey());return raw?new Set(JSON.parse(raw)):null}catch{return null}}
function save(set){try{localStorage.setItem(storeKey(),JSON.stringify([...set]))}catch{}}

// Toutes les complétions visibles dans les données de l'album.
function collect(d){
  const out=[];
  for(const c of (d&&d.album&&d.album.competitions)||[]){
    if(c.completion&&c.completion.complete)out.push({key:'competition:'+c.id,kind:'competition',label:c.name});
    for(const s of c.seasons||[]){
      if(s.completion&&s.completion.complete)out.push({key:'season:'+s.id,kind:'season',label:(c.name||'')+' · '+(s.label||s.season||'')});
      for(const cl of s.clubs||[])if(cl.total>0&&cl.complete)out.push({key:'club:'+s.id+':'+cl.id,kind:'club',label:cl.name});
    }
  }
  return out;
}

function close(el){if(!el||!el.isConnected)return;el.remove();document.documentElement.classList.remove('fv-shake')}
function show(item,more){
  document.querySelector('.fv-celebrate')?.remove();
  const still=calm(),el=document.createElement('div');
  el.className='fv-celebrate'+(still?' is-calm':'');el.setAttribute('role','alertdialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','fvCelTitle');
  let confetti='';
  if(!still)for(let i=0;i<44;i++){
    const hue=[48,152,205,350,28][i%5];
    confetti+='<i style="left:'+Math.round(Math.random()*100)+'%;--d:'+(1.8+Math.random()*1.8).toFixed(2)+'s;--w:'+(Math.random()*0.8).toFixed(2)+'s;--x:'+Math.round(Math.random()*160-80)+'px;--r:'+Math.round(Math.random()*720-360)+'deg;background:hsl('+hue+' 90% 58%)"></i>';
  }
  el.innerHTML='<div class="fv-confetti" aria-hidden="true">'+confetti+'</div><div class="fv-celebrate-card"><p class="fv-celebrate-kind">'+esc(KIND[item.kind][0])+'</p>'
    +'<h2 id="fvCelTitle" class="fv-stamp">COMPLÉTÉ</h2><p class="fv-celebrate-label">'+esc(item.label)+'</p>'
    +(more>0?'<p class="fv-celebrate-more">+ '+more+' autre'+(more>1?'s':'')+' complétion'+(more>1?'s':'')+'</p>':'')
    +'<button class="btn btn-gold" type="button" data-fv-celebrate-close>CONTINUER</button></div>';
  document.body.appendChild(el);
  if(!still){document.documentElement.classList.add('fv-shake');setTimeout(()=>document.documentElement.classList.remove('fv-shake'),500)}
  const btn=el.querySelector('[data-fv-celebrate-close]');btn.focus();
  const onKey=e=>{if(e.key==='Escape'){document.removeEventListener('keydown',onKey);close(el)}};
  document.addEventListener('keydown',onKey);
  btn.addEventListener('click',()=>{document.removeEventListener('keydown',onKey);close(el)});
  setTimeout(()=>{document.removeEventListener('keydown',onKey);close(el)},still?12000:7000);
}

// Compare avec ce qui a déjà été célébré ; célèbre la plus haute complétion nouvelle (championnat > édition > club).
function scan(d,delay=250){
  const all=collect(d),seen=load();
  const next=new Set([...(seen||[]),...all.map(x=>x.key)]);
  if(!seen){save(next);return null}                       // première visite : point de départ silencieux
  const fresh=all.filter(x=>!seen.has(x.key));
  if(!fresh.length)return null;
  save(next);
  fresh.sort((a,b)=>KIND[b.kind][1]-KIND[a.kind][1]);
  setTimeout(()=>show(fresh[0],fresh.length-1),delay);     // après l'affichage de la page
  return fresh[0];
}

FVC.celebrate={scan,collect};
window.fvCelebrate={scan,reset:()=>{try{localStorage.removeItem(storeKey())}catch{}}};
})();

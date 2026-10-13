// Atelier (page « atelier ») : fusion de 5 doublons CHOISIS en 1 carte de rareté supérieure (révélation animée) et vente rapide des doublons.
// Chargé après app.js ; serveur : /api/workshop/* (lib/economy.js), qui décide de tout (prix, éligibilité, tirage, validation du choix).
(()=>{
const {api,esc,money,render,toast,viewHero,setModal,closeModal,cardMarkup}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic'};
const st={busy:false,tab:'fuse',rarity:'common',picks:{},cost:5,spare:{}};
const tag=r=>'<span class="rarity-tag rarity-'+esc(r)+'">'+esc(RL[r]||r)+'</span>';
const total=()=>Object.values(st.picks).reduce((a,b)=>a+b,0);
const calm=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// Le choix ne garde que des cartes encore vendables, en quantité possible, pour la rareté affichée.
function cleanPicks(d){
  st.cost=d.fusion.cost;st.spare=Object.fromEntries(d.cards.filter(c=>c.rarity===st.rarity).map(c=>[c.cardId,c.spare]));
  for(const id of Object.keys(st.picks)){const m=Math.min(st.picks[id],st.spare[id]||0);if(m>0)st.picks[id]=m;else delete st.picks[id]}
}
function tileHtml(c){
  const n=st.picks[c.cardId]||0,full=total()>=st.cost;
  return '<li class="wk-tile'+(n?' is-picked':'')+' rarity-'+esc(c.rarity)+'"><div class="wk-tile-ovr">'+c.ovr+'<small>'+esc(c.position)+'</small></div><div class="wk-tile-main"><strong>'+esc(c.name)+'</strong><small>'+esc(c.club)+' · '+esc(c.season)+'</small><small>'+c.spare+' doublon'+(c.spare>1?'s':'')+' disponible'+(c.spare>1?'s':'')+'</small></div>'
   +'<div class="wk-step" role="group" aria-label="Doublons de '+esc(c.name)+' à utiliser"><button type="button" class="wk-step-btn" data-wk-pick="'+esc(c.cardId)+'" data-d="-1" aria-label="Retirer un doublon de '+esc(c.name)+'"'+(n?'':' disabled')+'>−</button><output aria-live="polite">'+n+'</output><button type="button" class="wk-step-btn" data-wk-pick="'+esc(c.cardId)+'" data-d="1" aria-label="Ajouter un doublon de '+esc(c.name)+'"'+(n>=c.spare||full?' disabled':'')+'>+</button></div></li>';
}
function trayHtml(d,cards,left){
  const byId=new Map(cards.map(c=>[c.cardId,c])),chosen=[];
  Object.entries(st.picks).forEach(([id,n])=>{for(let i=0;i<n;i++)chosen.push(byId.get(id))});
  const slots=Array.from({length:st.cost},(_,i)=>{const c=chosen[i];return c?'<li class="wk-slot is-filled rarity-'+esc(c.rarity)+'"><b>'+c.ovr+'</b><span>'+esc(c.name)+'</span></li>':'<li class="wk-slot" aria-hidden="true"><i>+</i></li>'}).join('');
  const rule=d.fusion.rules[st.rarity],to=rule.to,fresh=rule.fresh,ready=total()===st.cost&&left>0&&fresh>0;
  return '<div class="wk-tray"><ul class="wk-slots" aria-label="Doublons choisis pour la fusion">'+slots+'</ul>'
   +'<div class="wk-tray-side"><p class="wk-tray-count" role="status"><b>'+total()+' / '+st.cost+'</b> doublons choisis → 1 carte '+esc(RL[to])+'</p>'
   +'<div class="wk-actions"><button class="btn btn-outline" type="button" data-wk-auto'+(cards.length?'':' disabled')+'>CHOISIR POUR MOI</button><button class="btn btn-outline" type="button" data-wk-clear'+(total()?'':' disabled')+'>VIDER</button>'
   +'<button class="btn '+(ready?'btn-gold':'btn-outline')+'" type="button" data-wk-fuse="'+esc(st.rarity)+'"'+(ready&&!st.busy?'':' disabled')+'>FUSIONNER</button></div>'
   +(fresh>0?'<p class="wk-note">'+fresh+' carte'+(fresh>1?'s':'')+' '+esc(RL[to])+' que tu n’as pas encore peu'+(fresh>1?'ven':'')+'t sortir : la fusion ne donne jamais une carte que tu possèdes déjà.</p>':'<p class="wk-note">Tu possèdes déjà toutes les cartes '+esc(RL[to])+' que la fusion peut donner : rien de nouveau à gagner pour le moment.</p>')+(left<=0?'<p class="wk-note">Limite du jour atteinte : reviens demain.</p>':'')+'</div></div>';
}
function fuseHtml(d){
  const f=d.fusion,cards=d.cards.filter(c=>c.rarity===st.rarity);
  const seg=Object.entries(f.rules).map(([from,r])=>'<button type="button" class="wk-seg'+(from===st.rarity?' is-on':'')+'" data-wk-rarity="'+from+'" aria-pressed="'+(from===st.rarity)+'">'+esc(RL[from])+' → '+esc(RL[r.to])+'<small>'+r.available+' doublon'+(r.available>1?'s':'')+'</small></button>').join('');
  return '<p class="wk-note">Choisis '+f.cost+' doublons de même rareté : ils donnent 1 carte de la rareté supérieure, tirée au hasard. Sont exclus : Legendary et Icon, éditions limitées, cartes de bienvenue, favorites, celles aux enchères ou dans un échange. Tu gardes toujours un exemplaire de chaque carte.</p>'
   +'<div class="wk-segs" role="group" aria-label="Rareté à fusionner">'+seg+'</div>'+trayHtml(d,cards,f.left)
   +(cards.length?'<ul class="wk-tiles">'+cards.map(tileHtml).join('')+'</ul>':'<p class="wk-note">Aucun doublon '+esc(RL[st.rarity])+' à fusionner pour l’instant : ouvre des packs !</p>');
}
function sellHtml(d){
  if(!d.cards.length)return '<p class="wk-note">Aucun doublon à vendre pour l’instant : ouvre des packs !</p>';
  return '<p class="wk-note">Prix = '+Math.round(d.sellRatio*100)+' % du prix de référence (médiane des dernières ventes aux enchères), ou un prix fixe sans vente connue. Les enchères restent en général plus avantageuses.</p><ul class="wk-list">'+d.cards.map(c=>'<li class="wk-row rarity-'+esc(c.rarity)+'"><div class="wk-main"><strong>'+esc(c.name)+'</strong> '+tag(c.rarity)+'<small>'+esc(c.club)+' · '+esc(c.season)+' · '+c.ovr+' · '+c.spare+' doublon'+(c.spare>1?'s':'')+' · '+money(c.unitPrice)+' FC pièce</small></div><div class="wk-actions"><button class="btn btn-outline" type="button" data-wk-sell="'+esc(c.cardId)+'" data-count="1" '+(st.busy?'disabled':'')+'>VENDRE 1</button>'+(c.spare>1?'<button class="btn btn-outline" type="button" data-wk-sell="'+esc(c.cardId)+'" data-count="'+c.spare+'" '+(st.busy?'disabled':'')+'>TOUT ('+c.spare+') · '+money(c.spare*c.unitPrice)+' FC</button>':'')+'</div></li>').join('')+'</ul>';
}
async function atelier(){
  let d;
  try{d=await api('/api/workshop')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'atelier'}));throw e}
  cleanPicks(d);
  const tabs=[['fuse','FUSION'],['sell','VENTE RAPIDE']].map(([k,l])=>'<button type="button" role="tab" class="wk-tab'+(st.tab===k?' is-on':'')+'" data-wk-tab="'+k+'" aria-selected="'+(st.tab===k)+'">'+l+'</button>').join('');
  return '<div class="page wk-page">'+viewHero('FOOTVAULT / ATELIER','TON <span>ATELIER.</span>','Fusionne des doublons que tu choisis en une carte plus rare, ou revends-les contre des FOOTCOINS.',String(d.fusion.left)+'/'+d.fusion.perDay,'FUSIONS RESTANTES AUJOURD’HUI')
   +'<section class="section"><div class="wk-tabs" role="tablist" aria-label="Atelier">'+tabs+'</div>'+(st.tab==='fuse'?fuseHtml(d):sellHtml(d))+'</section></div>';
}
// Révélation : les doublons se fondent, puis la nouvelle carte apparaît face cachée ; le joueur la retourne lui-même.
function showFusion(card){
  const chips=Array.from({length:st.cost},(_,i)=>'<i style="--i:'+i+'"></i>').join('');
  const box=m=>'<div class="modal-box pack-reveal-modal rv-opened wk-reveal" data-best="'+esc(card.rarity)+'"><button class="modal-close" data-close aria-label="Fermer">×</button><p class="eyebrow">FUSION</p><h2 class="pack-reveal-title">'+m+'</h2>';
  const stage=calm()?'':'<div class="wk-fusing" aria-hidden="true">'+chips+'<span></span></div>';
  setModal(box(calm()?'Ta nouvelle carte':'Fusion en cours…')+'<div class="wk-stage">'+stage+'</div></div>');
  const reveal=()=>{
    const stageEl=document.querySelector('.wk-reveal .wk-stage');if(!stageEl)return;
    document.querySelector('.wk-reveal .pack-reveal-title').textContent='Ta nouvelle carte';
    stageEl.innerHTML='<div class="reveal-grid wk-reveal-grid"><button class="reveal-card rv-'+esc(card.rarity)+'" type="button" aria-pressed="false" aria-label="Retourner la carte" data-wk-flip><span class="reveal-card-inner"><span class="reveal-face reveal-back" aria-hidden="true">FV</span><span class="reveal-face reveal-front">'+cardMarkup(card)+'</span></span></button></div>'
     +'<p class="reveal-result wk-reveal-note" role="status">Touche la carte pour la retourner.</p>'
     +'<div class="wk-actions wk-reveal-actions" hidden><a class="btn btn-gold" href="#card?id='+encodeURIComponent(card.instanceId)+'" data-close>VOIR LA CARTE</a><button class="btn btn-outline" type="button" data-close>CONTINUER</button></div>';
    stageEl.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',closeModal));
    const b=stageEl.querySelector('[data-wk-flip]');b.focus({preventScroll:true});
    b.addEventListener('click',()=>{if(b.classList.contains('flipped'))return;b.classList.add('flipped');b.setAttribute('aria-pressed','true');if(card.rarity!=='common')b.classList.add('rv-burst');
      stageEl.querySelector('.wk-reveal-note').textContent='Nouvelle carte pour ta collection : '+card.name+' · '+(RL[card.rarity]||card.rarity)+' · '+card.ovr;stageEl.querySelector('.wk-reveal-actions').hidden=false});
  };
  if(calm())reveal();else setTimeout(reveal,1500);
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-wk-tab],[data-wk-rarity],[data-wk-pick],[data-wk-auto],[data-wk-clear],[data-wk-sell],[data-wk-fuse]');if(!t||st.busy)return;
  if(t.dataset.wkTab){st.tab=t.dataset.wkTab;return render()}
  if(t.dataset.wkRarity){st.rarity=t.dataset.wkRarity;st.picks={};return render()}
  if(t.dataset.wkPick){const id=t.dataset.wkPick,n=(st.picks[id]||0)+Number(t.dataset.d);if(n>0)st.picks[id]=Math.min(n,st.spare[id]||0);else delete st.picks[id];return render()}
  if(t.matches('[data-wk-clear]')){st.picks={};return render()}
  if(t.matches('[data-wk-auto]')){
    // Les doublons les moins forts d'abord : on garde les meilleures cartes.
    const d=await api('/api/workshop').catch(()=>null);if(!d)return;
    const cards=d.cards.filter(c=>c.rarity===st.rarity).sort((a,b)=>a.ovr-b.ovr||a.name.localeCompare(b.name));
    st.picks={};let need=d.fusion.cost;for(const c of cards){const n=Math.min(need,c.spare);if(n>0){st.picks[c.cardId]=n;need-=n}if(!need)break}
    return render();
  }
  st.busy=true;t.disabled=true;let fused=null;
  try{
    if(t.dataset.wkSell){const r=await post('/api/workshop/sell',{cardId:t.dataset.wkSell,count:Number(t.dataset.count)});if(r.user)FVC.core.state.user=r.user;toast('Vendu : +'+money(r.total)+' FC')}
    else{const r=await post('/api/workshop/fuse',{rarity:t.dataset.wkFuse,picks:{...st.picks}});fused=r.card;st.picks={}}
  }catch(err){toast(err.message)}
  finally{st.busy=false;FVC.core.nav?.();render();if(fused)showFusion(fused)}
});
FVC.pages.atelier=atelier;
})();

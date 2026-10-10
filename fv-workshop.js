// Atelier (page « atelier ») : vente rapide des doublons et fusion de 5 doublons en 1 carte de rareté supérieure.
// Chargé après app.js ; serveur : /api/workshop/* (lib/economy.js), qui décide de tout (prix, éligibilité, tirage).
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic'};
const st={busy:false,last:null};
const tag=r=>'<span class="rarity-tag rarity-'+esc(r)+'">'+esc(RL[r]||r)+'</span>';
const section=(eyebrow,title,body)=>'<section class="section"><div class="section-head"><div><p class="eyebrow">'+eyebrow+'</p><h2>'+title+'</h2></div></div>'+body+'</section>';
async function atelier(){
  let d;
  try{d=await api('/api/workshop')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'atelier'}));throw e}
  const f=d.fusion;
  const fusionRows=Object.entries(f.rules).map(([from,r])=>{
    const can=r.available>=f.cost&&f.left>0;
    return '<li class="wk-row"><div class="wk-main"><strong>'+f.cost+' '+esc(RL[from])+' → 1 '+esc(RL[r.to])+'</strong><small>'+money(r.available)+' doublon'+(r.available>1?'s':'')+' '+esc(RL[from])+' disponible'+(r.available>1?'s':'')+'</small></div><button class="btn '+(can?'btn-gold':'btn-outline')+'" type="button" data-wk-fuse="'+from+'" '+(can&&!st.busy?'':'disabled')+'>FUSIONNER</button></li>';
  }).join('');
  const last=st.last?'<div class="panel wk-result" role="status"><p class="eyebrow">DERNIÈRE FUSION</p><strong>'+esc(st.last.name)+'</strong> '+tag(st.last.rarity)+'<small>'+esc(st.last.club)+' · '+esc(st.last.season)+' · '+Number(st.last.ovr)+'</small><a class="btn btn-outline" href="#card?id='+encodeURIComponent(st.last.instanceId)+'">VOIR LA CARTE</a></div>':'';
  return '<div class="page wk-page">'+viewHero('FOOTVAULT / ATELIER','TON <span>ATELIER.</span>','Revends tes doublons contre des FOOTCOINS ou fusionne-les en une carte plus rare. Tu gardes toujours un exemplaire de chaque carte.',String(f.left)+'/'+f.perDay,'FUSIONS RESTANTES AUJOURD’HUI')
   +section('FUSION','FUSIONNER DES DOUBLONS','<p class="wk-note">'+f.cost+' doublons de même rareté donnent 1 carte de la rareté supérieure, tirée au hasard. Les cartes Legendary et Icon, les éditions limitées, les cartes de bienvenue, les favorites, celles aux enchères ou dans un échange sont exclues.</p><ul class="wk-list">'+fusionRows+'</ul>'+last)
   +section('VENTE RAPIDE','VENDRE DES DOUBLONS',(d.cards.length?'<p class="wk-note">Prix = '+Math.round(d.sellRatio*100)+' % du prix de référence (médiane des dernières ventes aux enchères), ou un prix fixe sans vente connue. Les enchères restent en général plus avantageuses.</p><ul class="wk-list">'+d.cards.map(c=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(c.name)+'</strong> '+tag(c.rarity)+'<small>'+esc(c.club)+' · '+esc(c.season)+' · '+c.ovr+' · '+c.spare+' doublon'+(c.spare>1?'s':'')+' · '+money(c.unitPrice)+' FC pièce</small></div><div class="wk-actions"><button class="btn btn-outline" type="button" data-wk-sell="'+esc(c.cardId)+'" data-count="1" '+(st.busy?'disabled':'')+'>VENDRE 1</button>'+(c.spare>1?'<button class="btn btn-outline" type="button" data-wk-sell="'+esc(c.cardId)+'" data-count="'+c.spare+'" '+(st.busy?'disabled':'')+'>TOUT ('+c.spare+') · '+money(c.spare*c.unitPrice)+' FC</button>':'')+'</div></li>').join('')+'</ul>':'<p class="wk-note">Aucun doublon à vendre pour l’instant : ouvre des packs !</p>'))
   +'</div>';
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-wk-sell],[data-wk-fuse]');if(!t||st.busy)return;
  st.busy=true;t.disabled=true;
  try{
    if(t.dataset.wkSell){const r=await post('/api/workshop/sell',{cardId:t.dataset.wkSell,count:Number(t.dataset.count)});if(r.user)FVC.core.state.user=r.user;toast('Vendu : +'+money(r.total)+' FC')}
    else{const r=await post('/api/workshop/fuse',{rarity:t.dataset.wkFuse});st.last=r.card;toast('Fusion réussie : '+r.card.name)}
  }catch(err){toast(err.message)}
  finally{st.busy=false;FVC.core.nav?.();render()}
});
FVC.pages.atelier=atelier;
})();

// Liste de souhaits (page « souhaits ») : cartes du catalogue recherchées, alerte quand l'une d'elles est mise aux enchères.
// Chargé après app.js ; serveur : /api/wishlist/* (lib/wishlist.js), qui valide tout (existence, limite de 50).
(()=>{
const {$,api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};
const st={results:[],q:'',timer:0,seq:0};
const tag=c=>'<span class="rarity-tag rarity-'+esc(c.rarity)+'">'+esc(RL[c.rarity]||c.rarity)+'</span>';
const line=(c,btn)=>'<li class="wish-row rarity-'+esc(c.rarity)+'"><div class="wish-ovr">'+Number(c.ovr)+'<small>'+esc(c.position)+'</small></div><div class="wish-main"><strong>'+esc(c.name)+'</strong><span class="wish-meta">'+tag(c)+(c.limited?'<span class="wish-limited">Édition limitée</span>':'')+'</span><small>'+esc(c.club)+' · '+esc(c.season)+'</small></div><div class="wish-side">'+btn+'</div></li>';
function resultsHtml(){
  if(st.q.trim().length<2)return '<p class="wish-empty">Tape au moins 2 lettres (nom du joueur ou du club).</p>';
  if(!st.results.length)return '<p class="wish-empty">Aucune carte trouvée.</p>';
  return '<ul class="wish-list">'+st.results.map(c=>line(c,c.wished?'<span class="wish-done">✔ Dans tes souhaits</span>':'<button class="btn btn-outline" type="button" data-wish-add="'+esc(c.id)+'">Ajouter</button>')).join('')+'</ul>';
}
async function souhaits(){
  let d;
  try{d=await api('/api/wishlist')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'souhaits'}));throw e}
  const own=c=>c.owned?'<span class="wish-owned">Tu en as '+c.owned+'</span>':'';
  const sell=c=>c.selling?'<a class="btn btn-gold" href="#market?auction='+encodeURIComponent(c.auctionId)+'">EN VENTE dès '+money(c.fromPrice)+' FC</a>':'<span class="wish-note">Pas en vente</span>';
  const rows=[...d.cards].sort((x,y)=>(y.selling?1:0)-(x.selling?1:0)||Number(y.ovr)-Number(x.ovr));
  const selling=d.cards.filter(c=>c.selling).length;
  const summary=d.cards.length?'<p class="wish-summary"><b>'+selling+'</b> en vente · <b>'+d.cards.filter(c=>c.owned).length+'</b> déjà possédée'+(d.cards.filter(c=>c.owned).length>1?'s':'')+'</p>':'';
  return '<div class="page wish-page">'+viewHero('SOUHAITS','Les cartes que tu veux.','Garde les cartes que tu cherches : tu es prévenu dès que l’une d’elles est mise aux enchères.',String(d.cards.length)+'/'+d.max,'CARTES')
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">MA LISTE</p><h2>Cartes recherchées ('+d.cards.length+')</h2></div></div>'+summary
   +(rows.length?'<ul class="wish-list">'+rows.map(c=>line(c,own(c)+sell(c)+'<button class="btn btn-outline" type="button" data-wish-remove="'+esc(c.id)+'" aria-label="Retirer '+esc(c.name)+'">Retirer</button>')).join('')+'</ul>':'<p class="wish-empty">Ta liste est vide : cherche une carte ci-dessous.</p>')+'</section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">AJOUTER</p><h2>Chercher une carte</h2></div></div><div class="panel wish-search"><label for="wishQuery">Nom du joueur ou du club</label><input id="wishQuery" type="search" autocomplete="off" maxlength="40" value="'+esc(st.q)+'" placeholder="Ex. Mbappé, Marseille"><div id="wishResults" role="status" aria-live="polite">'+resultsHtml()+'</div></div></section></div>';
}
document.addEventListener('input',e=>{
  if(e.target.id!=='wishQuery')return;
  st.q=e.target.value;clearTimeout(st.timer);
  const my=++st.seq;
  st.timer=setTimeout(async()=>{
    if(st.q.trim().length<2){st.results=[]}
    else{try{st.results=(await api('/api/wishlist/search?q='+encodeURIComponent(st.q.trim()))).cards}catch(err){toast(err.message);return}}
    if(my!==st.seq)return;
    const box=$('#wishResults');if(box)box.innerHTML=resultsHtml();
  },250);
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-wish-add],[data-wish-remove]');if(!t)return;
  t.disabled=true;
  try{
    if(t.dataset.wishAdd){await post('/api/wishlist/add',{cardId:t.dataset.wishAdd});const c=st.results.find(x=>x.id===t.dataset.wishAdd);if(c)c.wished=true;toast('Ajoutée à tes souhaits.')}
    else{await post('/api/wishlist/remove',{cardId:t.dataset.wishRemove});toast('Retirée de tes souhaits.')}
    render();
  }catch(err){toast(err.message);t.disabled=false}
});
FVC.pages.souhaits=souhaits;
})();

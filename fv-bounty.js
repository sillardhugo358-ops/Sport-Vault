// Primes (page « primes ») : offrir des FC pour une carte qu'on cherche, ou gagner la prime d'un autre en lui donnant la carte.
// Chargé après app.js ; serveur : /api/bounties/* (lib/bounties.js), qui décide de tout (FC bloqués, exclusions, commission, expiration).
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};
const ST={open:'Ouverte',fulfilled:'Remplie',expired:'Expirée',cancelled:'Annulée'};
const st={q:'',results:[],pick:null,timer:0,seq:0,busy:false};
const left=d=>{const h=Math.max(0,Math.round((new Date(d)-Date.now())/3600000));return h<48?h+' h':Math.round(h/24)+' j'};
const tag=c=>'<span class="rarity-tag rarity-'+esc(c.rarity)+'">'+esc(RL[c.rarity]||c.rarity)+'</span>';
const meta=c=>esc(c.club)+' · '+esc(c.season)+' · '+esc(c.position)+' · note '+Number(c.ovr);
function resultsHtml(cfg){
  if(st.q.trim().length<2)return '<p class="wk-note">Tape au moins 2 lettres (nom du joueur ou du club).</p>';
  if(!st.results.length)return '<p class="wk-note">Aucune carte trouvée.</p>';
  return '<ul class="wk-list">'+st.results.map(c=>{
    const blocked=cfg.blockedRarities.includes(c.rarity)||c.limited;
    return '<li class="wk-row"><div class="wk-main"><strong>'+esc(c.name)+'</strong> '+tag(c)+'<small>'+meta(c)+'</small></div><div class="wk-actions">'+(blocked?'<small>Pas de prime sur cette carte</small>':'<button class="btn btn-outline" type="button" data-bty-pick="'+esc(c.id)+'">Choisir</button>')+'</div></li>';
  }).join('')+'</ul>';
}
const mineRow=b=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(b.card.name)+'</strong> '+tag(b.card)+'<small>'+ST[b.status]+' · '+money(b.reward)+' FC'+(b.status==='open'?' bloqués · expire dans '+left(b.expiresAt):'')+'</small></div><div class="wk-actions">'+(b.status==='open'?'<button class="btn btn-outline" type="button" data-bty-cancel="'+esc(b.id)+'" aria-label="Annuler la prime pour '+esc(b.card.name)+'">Annuler</button>':'')+'</div></li>';
const openRow=b=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(b.card.name)+'</strong> '+tag(b.card)+'<small>'+meta(b.card)+'</small><small>Demandée par '+esc(b.poster)+' · expire dans '+left(b.expiresAt)+'</small></div><div class="wk-actions"><b>'+money(b.net)+' FC</b>'+(b.canFulfil?'<button class="btn btn-gold" type="button" data-bty-fulfil="'+esc(b.id)+'" data-name="'+esc(b.card.name)+'" data-net="'+b.net+'">Donner ma carte</button>':'<small>Tu n’as pas cette carte</small>')+'</div></li>';
async function primes(){
  let d;
  try{d=await api('/api/bounties')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'primes'}));throw e}
  st.cfg=d.config;
  const pick=st.pick?'<div class="panel bty-pick" role="status"><p><strong>'+esc(st.pick.name)+'</strong> '+tag(st.pick)+'<br><small>'+meta(st.pick)+'</small></p><label class="cp-field"><span>Prime (FC, de '+money(d.config.minReward)+' à '+money(d.config.maxReward)+')</span><input id="btyReward" type="number" inputmode="numeric" min="'+d.config.minReward+'" max="'+d.config.maxReward+'" step="1" value="500"></label><p class="wk-note">Les FC sont bloqués jusqu’à ce qu’un joueur te donne la carte, puis débités. Sans preneur après '+d.config.days+' jours, ils te sont rendus. Le preneur reçoit la prime moins '+d.config.commissionPct+' %.</p><button class="btn btn-gold" type="button" data-bty-create>Poster la prime</button></div>':'';
  return '<div class="page wk-page bty-page">'+viewHero('Primes','Offre des FC pour la carte qui te manque.','Poste une prime : les FC sont bloqués, et rendus si personne ne répond sous '+d.config.days+' jours. Les cartes Legendary, Icon et limitées ne sont pas concernées.',String(d.open.length),'Primes ouvertes')
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Poster une prime</p><h2>Quelle carte cherches-tu ?</h2></div></div><div class="panel"><label class="cp-field"><span class="sr-only">Rechercher une carte</span><input id="btySearch" type="search" placeholder="Rechercher une carte" autocomplete="off" value="'+esc(st.q)+'"></label><div id="btyResults">'+resultsHtml(d.config)+'</div></div>'+pick+'</section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Mes primes</p><h2>Mes primes ('+d.mine.filter(b=>b.status==='open').length+'/'+d.config.maxOpen+' ouvertes)</h2></div></div>'+(d.mine.length?'<ul class="wk-list">'+d.mine.map(mineRow).join('')+'</ul>':'<p class="wk-note">Tu n’as encore posté aucune prime.</p>')+'</section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Primes ouvertes</p><h2>Gagne des FC avec tes doublons</h2></div></div>'+(d.open.length?'<ul class="wk-list">'+d.open.map(openRow).join('')+'</ul>':'<p class="wk-note">Aucune prime ouverte pour le moment.</p>')+'</section></div>';
}
document.addEventListener('input',e=>{
  const t=e.target;if(t.id!=='btySearch')return;
  st.q=t.value;clearTimeout(st.timer);const seq=++st.seq;
  st.timer=setTimeout(async()=>{
    let r={cards:[]};if(st.q.trim().length>=2)try{r=await api('/api/wishlist/search?q='+encodeURIComponent(st.q))}catch(err){toast(err.message)}
    if(seq!==st.seq)return;st.results=r.cards.map(c=>({...c,limited:!!(c.limited||c.isLimited)}));
    const box=document.getElementById('btyResults');if(box)box.innerHTML=resultsHtml(st.cfg||{blockedRarities:['legendary','icon']});
  },250);
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-bty-pick],[data-bty-create],[data-bty-cancel],[data-bty-fulfil]');if(!t||!t.closest('.bty-page')||st.busy)return;
  if(t.dataset.btyPick){st.pick=st.results.find(c=>c.id===t.dataset.btyPick)||null;return render()}
  if(t.dataset.btyFulfil&&!window.confirm('Donner « '+t.dataset.name+' » contre '+Number(t.dataset.net).toLocaleString('fr-FR')+' FC ? La carte quitte ta collection.'))return;
  st.busy=true;t.disabled=true;
  try{
    if(t.matches('[data-bty-create]')){const reward=Number(document.getElementById('btyReward').value);await post('/api/bounties/create',{cardId:st.pick.id,reward});toast('Prime postée : '+reward.toLocaleString('fr-FR')+' FC bloqués.');st.pick=null;st.q='';st.results=[]}
    else if(t.dataset.btyCancel){await post('/api/bounties/cancel',{id:t.dataset.btyCancel});toast('Prime annulée : FC débloqués.')}
    else{const r=await post('/api/bounties/fulfil',{id:t.dataset.btyFulfil});if(r.user)FVC.core.state.user=r.user;toast('Carte donnée : +'+r.reward.toLocaleString('fr-FR')+' FC (commission '+r.fee.toLocaleString('fr-FR')+' FC).')}
  }catch(err){toast(err.message)}
  finally{st.busy=false;FVC.core.nav?.();render()}
});
FVC.pages.primes=primes;
})();

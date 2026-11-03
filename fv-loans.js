// Prêts de cartes (page « prets ») : prêter une carte Common ou Rare à un ami pour 7 jours, la reprendre, rendre une carte empruntée.
// Chargé après app.js ; serveur : /api/loans/* (lib/loans.js), qui décide de tout (ami accepté, raretés, limites, retour automatique).
(()=>{
const {api,esc,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};
const st={q:'',results:[],timer:0,seq:0,busy:false,friend:''};
const left=d=>{const h=Math.max(0,Math.round((new Date(d)-Date.now())/3600000));return h<48?h+' h':Math.round(h/24)+' j'};
const tag=c=>'<span class="rarity-tag rarity-'+esc(c.rarity)+'">'+esc(RL[c.rarity]||c.rarity)+'</span>';
const meta=c=>esc(c.club)+' · '+esc(c.season)+' · '+esc(c.position)+' · note '+Number(c.ovr);
const resultsHtml=()=>st.q.trim().length<2?'<p class="wk-note">Tape au moins 2 lettres (nom du joueur ou du club).</p>':!st.results.length?'<p class="wk-note">Aucune carte prêtable trouvée (Common ou Rare, libre, échangeable).</p>'
  :'<ul class="wk-list">'+st.results.map(c=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(c.name)+'</strong> '+tag(c)+'<small>'+meta(c)+'</small></div><div class="wk-actions"><button class="btn btn-gold" type="button" data-loan-lend="'+esc(c.instanceId)+'" data-name="'+esc(c.name)+'">Prêter</button></div></li>').join('')+'</ul>';
const row=(l,btn)=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(l.card.name)+'</strong> '+tag(l.card)+'<small>'+meta(l.card)+'</small><small>'+(l.role==='lender'?'Prêtée à ':'Prêtée par ')+esc(l.other)+(l.status==='active'?' · retour automatique dans '+left(l.expiresAt):' · rendue')+'</small></div><div class="wk-actions">'+btn+'</div></li>';
async function prets(){
  let d,f;
  try{[d,f]=await Promise.all([api('/api/loans'),api('/api/friends')])}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'prets'}));throw e}
  st.cfg=d.config;
  const friends=(f.friends||[]).filter(p=>p.code);   // le prêt s'adresse par code d'échange
  if(!friends.some(p=>p.code===st.friend))st.friend=friends[0]?.code||'';
  const active=d.lent.filter(l=>l.status==='active'),borrowed=d.borrowed.filter(l=>l.status==='active');
  const form=friends.length?'<div class="panel"><label class="cp-field"><span>Prêter à</span><select id="loanFriend">'+friends.map(p=>'<option value="'+esc(p.code)+'"'+(p.code===st.friend?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><label class="cp-field"><span class="sr-only">Rechercher une de mes cartes</span><input id="loanSearch" type="search" placeholder="Rechercher une de mes cartes" autocomplete="off" value="'+esc(st.q)+'"></label><div id="loanResults">'+resultsHtml()+'</div></div>'
    :'<p class="wk-note">Il te faut un ami accepté pour prêter une carte. <a href="#amis">Ajouter un ami</a></p>';
  return '<div class="page wk-page loan-page">'+viewHero('Prêts','Prête une carte à un ami.','Prête une carte Common ou Rare à un ami pendant '+d.config.days+' jours : il peut l’aligner dans son équipe type, puis elle te revient toute seule. Pendant le prêt, elle n’est ni vendable ni échangeable.',String(active.length+borrowed.length),'Prêts en cours')
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Prêter</p><h2>Quelle carte prêtes-tu ?</h2></div></div>'+form+'</section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Mes prêts</p><h2>Cartes que j’ai prêtées ('+active.length+'/'+d.config.maxLent+')</h2></div></div>'+(d.lent.length?'<ul class="wk-list">'+d.lent.map(l=>row(l,l.status==='active'?'<button class="btn btn-outline" type="button" data-loan-return="'+esc(l.id)+'" aria-label="Reprendre '+esc(l.card.name)+'">Reprendre</button>':'')).join('')+'</ul>':'<p class="wk-note">Tu n’as prêté aucune carte.</p>')+'</section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Empruntées</p><h2>Cartes que l’on m’a prêtées ('+borrowed.length+'/'+d.config.maxBorrowed+')</h2></div></div>'+(d.borrowed.length?'<ul class="wk-list">'+d.borrowed.map(l=>row(l,l.status==='active'?'<a class="btn btn-outline" href="#equipe">Équipe type</a><button class="btn btn-outline" type="button" data-loan-return="'+esc(l.id)+'" aria-label="Rendre '+esc(l.card.name)+'">Rendre</button>':'')).join('')+'</ul>':'<p class="wk-note">Aucune carte empruntée.</p>')+'</section></div>';
}
document.addEventListener('change',e=>{if(e.target.id==='loanFriend')st.friend=e.target.value});
document.addEventListener('input',e=>{
  const t=e.target;if(t.id!=='loanSearch')return;
  st.q=t.value;clearTimeout(st.timer);const seq=++st.seq;
  st.timer=setTimeout(async()=>{
    let r={cards:[]};if(st.q.trim().length>=2)try{r=await api('/api/loans/cards?q='+encodeURIComponent(st.q))}catch(err){toast(err.message)}
    if(seq!==st.seq)return;st.results=r.cards;
    const box=document.getElementById('loanResults');if(box)box.innerHTML=resultsHtml();
  },250);
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-loan-lend],[data-loan-return]');if(!t||!t.closest('.loan-page')||st.busy)return;
  st.busy=true;t.disabled=true;
  try{
    if(t.dataset.loanLend){
      const who=document.getElementById('loanFriend')?.selectedOptions[0]?.textContent||'ton ami';
      if(!window.confirm('Prêter « '+t.dataset.name+' » à '+who+' pour '+st.cfg.days+' jours ?')){t.disabled=false;st.busy=false;return}
      await post('/api/loans/lend',{instanceId:t.dataset.loanLend,code:st.friend});toast('Carte prêtée à '+who+'.');st.q='';st.results=[];
    }else{await post('/api/loans/return',{id:t.dataset.loanReturn});toast('Carte revenue dans ta collection.')}
  }catch(err){toast(err.message)}
  finally{st.busy=false;FVC.core.nav?.();render()}
});
FVC.pages.prets=prets;
})();

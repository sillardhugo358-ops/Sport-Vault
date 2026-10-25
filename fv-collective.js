// Défis collectifs (page « collectif ») : jauge commune à toute la communauté, paliers de récompense à réclamer ;
// éditeur réservé aux administrateurs (le serveur vérifie le rôle). Chargé après app.js ; serveur : lib/collective.js.
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const st={busy:false,edit:null,errors:{}};
const isAdmin=()=>['admin','creator'].includes(FVC.core.state.user?.role);
const fmt=d=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const local=d=>{const x=new Date(d),p=n=>String(n).padStart(2,'0');return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate())+'T'+p(x.getHours())+':'+p(x.getMinutes())};
const STATE={live:'EN COURS',upcoming:'À VENIR',ended:'TERMINÉ'};
const tier=(c,t)=>{
  const label=money(t.coins)+' FC'+(t.xp?' + '+money(t.xp)+' XP':'');
  const btn=t.claimed?'<span class="cl-done">✓ Récupéré</span>':t.claimable?'<button class="btn btn-gold" type="button" data-cl-claim="'+esc(c.id)+'" data-tier="'+t.index+'" '+(st.busy?'disabled':'')+'>RÉCLAMER</button>':t.reached?'<small>Contribue au défi pour réclamer</small>':'<small>'+money(t.at)+' à atteindre</small>';
  return '<li class="cl-tier'+(t.reached?' is-reached':'')+'"><div><strong>'+money(t.at)+'</strong><small>'+label+'</small></div>'+btn+'</li>';
};
const card=c=>{
  const pct=Math.min(100,Math.round(c.total/c.target*1000)/10);
  return '<article class="panel cl-card"><header><p class="eyebrow">'+STATE[c.state]+' · '+esc(fmt(c.startsAt))+' → '+esc(fmt(c.endsAt))+'</p><h3>'+esc(c.title)+'</h3><p>'+esc(c.description)+'</p><p class="wk-note">Compte : '+c.metrics.map(m=>esc(m.label)).join(', ')+'.</p></header>'
   +'<div class="cl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="'+c.target+'" aria-valuenow="'+Math.min(c.total,c.target)+'" aria-label="Avancement de la communauté"><span style="width:'+pct+'%"></span></div>'
   +'<p class="cl-count"><strong>'+money(c.total)+'</strong> / '+money(c.target)+' · ta contribution : <strong>'+money(c.mine)+'</strong></p>'
   +'<ul class="wk-list">'+c.tiers.map(t=>tier(c,t)).join('')+'</ul>'
   +(c.state==='ended'?'<p class="wk-note">Récompenses récupérables jusqu’au '+esc(fmt(c.claimUntil))+'.</p>':'')+'</article>';
};
const tierRow=(t,i)=>'<div class="cl-trow"><label>Objectif<input type="number" min="1" data-cl-tier="at" data-i="'+i+'" value="'+esc(t.at)+'"></label><label>FC<input type="number" min="0" data-cl-tier="coins" data-i="'+i+'" value="'+esc(t.coins)+'"></label><label>XP<input type="number" min="0" data-cl-tier="xp" data-i="'+i+'" value="'+esc(t.xp)+'"></label><button class="btn btn-outline" type="button" data-cl-tier-del="'+i+'" aria-label="Retirer le palier '+(i+1)+'">×</button></div>';
function editor(adm){
  const e=st.edit,err=st.errors;
  const fe=k=>err[k]?'<small class="cl-err" role="alert">'+esc(err[k])+'</small>':'';
  if(!e)return '<section class="section"><div class="section-head"><div><p class="eyebrow">ADMINISTRATION</p><h2>GÉRER LES DÉFIS COLLECTIFS</h2></div><button class="btn btn-gold" type="button" data-cl-new>CRÉER UN DÉFI</button></div>'
   +'<ul class="wk-list">'+adm.challenges.map(c=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(c.title)+'</strong> <small>'+STATE[c.state]+(c.active?'':' · désactivé')+'</small><small>'+money(c.total)+' / '+money(c.target)+' · '+c.claims+' récompense(s) réclamée(s)</small></div><div class="wk-actions"><button class="btn btn-outline" type="button" data-cl-edit="'+esc(c.id)+'">MODIFIER</button><button class="btn btn-outline" type="button" data-cl-toggle="'+esc(c.id)+'" data-active="'+(c.active?'0':'1')+'">'+(c.active?'DÉSACTIVER':'ACTIVER')+'</button></div></li>').join('')+'</ul></section>';
  return '<section class="section"><form class="panel cl-form" onsubmit="return false"><h2>'+(e.id?'MODIFIER LE DÉFI':'NOUVEAU DÉFI COLLECTIF')+'</h2>'
   +'<label>Titre<input data-cl-f="title" maxlength="100" value="'+esc(e.title)+'">'+fe('title')+'</label>'
   +'<label>Description<input data-cl-f="description" maxlength="300" value="'+esc(e.description)+'">'+fe('description')+'</label>'
   +'<fieldset class="cp-group"><legend>Actions qui font avancer la jauge</legend><div class="cp-checks">'+Object.entries(adm.metrics).map(([k,l])=>'<label class="cp-check"><input type="checkbox" data-cl-metric value="'+k+'"'+(e.metrics.includes(k)?' checked':'')+'><span>'+esc(l)+'</span></label>').join('')+'</div>'+fe('metrics')+'</fieldset>'
   +'<div class="cl-dates"><label>Début<input type="datetime-local" data-cl-f="startsAt" value="'+esc(e.startsAt)+'">'+fe('startsAt')+'</label><label>Fin<input type="datetime-local" data-cl-f="endsAt" value="'+esc(e.endsAt)+'">'+fe('endsAt')+'</label></div>'
   +'<fieldset class="cp-group"><legend>Paliers (objectif croissant, récompense FC + XP)</legend>'+e.tiers.map(tierRow).join('')+fe('tiers')+(e.tiers.length<adm.limits.maxTiers?'<button class="btn btn-outline" type="button" data-cl-tier-add>AJOUTER UN PALIER</button>':'')+'</fieldset>'
   +'<div class="wk-actions"><button class="btn btn-gold" type="button" data-cl-save '+(st.busy?'disabled':'')+'>ENREGISTRER</button><button class="btn btn-outline" type="button" data-cl-cancel>ANNULER</button></div></form></section>';
}
async function collectif(){
  let d;
  try{d=await api('/api/collective')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'collectif'}));throw e}
  const adm=isAdmin()?await api('/api/admin/collective').catch(()=>null):null;
  st.adm=adm;
  const live=d.challenges.filter(c=>c.state!=='ended'),ended=d.challenges.filter(c=>c.state==='ended');
  return '<div class="page wk-page cl-page">'+viewHero('DÉFIS COLLECTIFS','Tous ensemble, un même objectif.','Toute la communauté fait avancer la même jauge. Chaque palier atteint se réclame une fois, à condition d’avoir contribué au défi.',String(live.length),'DÉFIS ACTIFS')
   +'<section class="section">'+(live.length?'<div class="cl-grid">'+live.map(card).join('')+'</div>':'<p class="wk-note">Aucun défi collectif en cours pour le moment.</p>')+'</section>'
   +(ended.length?'<section class="section"><div class="section-head"><div><p class="eyebrow">TERMINÉS</p><h2>RÉCOMPENSES À RÉCUPÉRER</h2></div></div><div class="cl-grid">'+ended.map(card).join('')+'</div></section>':'')
   +(adm?editor(adm):'')+'</div>';
}
const blank=()=>({id:null,title:'',description:'',metrics:['packs'],startsAt:local(Date.now()),endsAt:local(Date.now()+7*86400000),tiers:[{at:1000,coins:200,xp:20},{at:5000,coins:500,xp:50}]});
const reload=()=>{FVC.core.nav?.();render()};
document.addEventListener('input',e=>{
  const t=e.target;if(!t.closest?.('.cl-form')||!st.edit)return;
  if(t.dataset.clF)st.edit[t.dataset.clF]=t.value;
  else if(t.dataset.clTier)st.edit.tiers[Number(t.dataset.i)][t.dataset.clTier]=t.value;
  else if(t.matches('[data-cl-metric]')){const m=st.edit.metrics,i=m.indexOf(t.value);if(t.checked&&i<0)m.push(t.value);if(!t.checked&&i>=0)m.splice(i,1)}
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-cl-claim],[data-cl-new],[data-cl-edit],[data-cl-toggle],[data-cl-cancel],[data-cl-save],[data-cl-tier-add],[data-cl-tier-del]');
  if(!t||!t.closest('.cl-page')||st.busy)return;
  if(t.matches('[data-cl-new]')){st.edit=blank();st.errors={};return render()}
  if(t.matches('[data-cl-cancel]')){st.edit=null;st.errors={};return render()}
  if(t.matches('[data-cl-tier-add]')){const l=st.edit.tiers,last=l[l.length-1];l.push({at:Number(last?.at||0)*2||1000,coins:Number(last?.coins||100),xp:Number(last?.xp||10)});return render()}
  if(t.matches('[data-cl-tier-del]')){st.edit.tiers.splice(Number(t.dataset.clTierDel),1);return render()}
  if(t.matches('[data-cl-edit]')){const c=st.adm.challenges.find(x=>x.id===t.dataset.clEdit);st.edit={id:c.id,title:c.title,description:c.description,metrics:[...c.metrics],startsAt:local(c.startsAt),endsAt:local(c.endsAt),tiers:c.tiers.map(x=>({...x}))};st.errors={};return render()}
  st.busy=true;t.disabled=true;
  try{
    if(t.matches('[data-cl-claim]')){const r=await post('/api/collective/claim',{id:t.dataset.clClaim,tier:Number(t.dataset.tier)});if(r.user)FVC.core.state.user=r.user;toast('Récompense : +'+money(r.reward.coins)+' FC'+(r.reward.xp?' · +'+money(r.reward.xp)+' XP':''))}
    else if(t.matches('[data-cl-toggle]')){await post('/api/admin/collective',{action:'toggle',id:t.dataset.clToggle,active:t.dataset.active==='1'})}
    else if(t.matches('[data-cl-save]')){
      const x=st.edit,body={action:x.id?'update':'create',id:x.id,title:x.title,description:x.description,metrics:x.metrics,startsAt:x.startsAt?new Date(x.startsAt).toISOString():'',endsAt:x.endsAt?new Date(x.endsAt).toISOString():'',tiers:x.tiers.map(r=>({at:Number(r.at),coins:Number(r.coins),xp:Number(r.xp)}))};
      try{await post('/api/admin/collective',body);st.edit=null;st.errors={};toast('Défi enregistré')}
      catch(err){st.errors=err.data?.errors||{};throw err}
    }
  }catch(err){toast(err.message)}
  finally{st.busy=false;reload()}
});
FVC.pages.collectif=collectif;
})();

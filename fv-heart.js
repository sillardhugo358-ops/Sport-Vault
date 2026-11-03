// Club de cœur (page « club ») : un club par saison de classement, choix gratuit, classement des clubs par cartes possédées par leurs supporters.
// Chargé après app.js ; serveur : /api/heart-club/* (lib/heart-club.js), qui valide le club, la saison et la période de changement.
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const st={results:[],q:'',timer:0,seq:0,busy:false};
const fmt=d=>new Date(d).toLocaleDateString('fr-FR',{day:'numeric',month:'long'});
function resultsHtml(mine){
  if(st.q.trim().length<2)return '<p class="wk-note">Tape au moins 2 lettres du nom du club.</p>';
  if(!st.results.length)return '<p class="wk-note">Aucun club trouvé.</p>';
  return '<ul class="wk-list">'+st.results.map(c=>'<li class="wk-row"><div class="wk-main"><strong>'+esc(c.name)+'</strong><small>'+money(c.cards)+' cartes au catalogue</small></div><div class="wk-actions">'+(mine.club?.key===c.key?'<span class="cl-done">✓ Ton club de cœur</span>':'<button class="btn btn-gold" type="button" data-hc-choose="'+esc(c.key)+'"'+(!mine.club||mine.canChange?'':' disabled')+'>'+(mine.club?'Changer pour ce club':'Choisir ce club')+'</button>')+'</div></li>').join('')+'</ul>';
}
async function club(){
  let d;
  try{d=await api('/api/heart-club')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'club'}));throw e}
  const m=d.mine,cur=m.club;
  const rows=d.clubs.map(c=>'<li class="wk-row'+(cur&&cur.key===c.key?' is-mine':'')+'"><div class="wk-main"><strong>#'+c.rank+' '+esc(c.name)+'</strong><small>'+money(c.fans)+' supporter'+(c.fans>1?'s':'')+'</small></div><div class="wk-actions"><b>'+money(c.cards)+' cartes</b></div></li>').join('');
  const rule=cur?(m.canChange?'Tu peux encore changer de club'+(m.changeUntil?' jusqu’au '+esc(fmt(m.changeUntil)):'')+'.':'Ton choix est verrouillé jusqu’à la prochaine saison.'):'Le choix est gratuit. Tu pourras changer pendant les premiers jours de chaque saison.';
  return '<div class="page wk-page hc-page">'+viewHero('Club de cœur','Ton club, ta fierté.','Choisis le club que tu supportes cette saison. Les cartes de ce club que tu possèdes font monter son rang parmi tous les supporters. Aucune récompense en FC : juste la fierté.',cur?'♥':'—',cur?cur.name:'Pas encore de club')
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Ma saison</p><h2>'+(cur?esc(cur.name):'Choisis ton club de cœur')+'</h2></div></div><p class="wk-note" role="status">'+rule+'</p>'
   +'<div class="panel"><label class="cp-field"><span class="sr-only">Rechercher un club</span><input id="hcSearch" type="search" placeholder="Rechercher un club" autocomplete="off" value="'+esc(st.q)+'"></label><div id="hcResults">'+resultsHtml(m)+'</div></div></section>'
   +'<section class="section"><div class="section-head"><div><p class="eyebrow">Classement des clubs</p><h2>Les clubs les plus supportés</h2></div></div>'+(rows?'<ul class="wk-list">'+rows+'</ul>':'<p class="wk-note">Aucun supporter pour l’instant : sois le premier.</p>')+'</section></div>';
}
document.addEventListener('input',e=>{
  const t=e.target;if(t.id!=='hcSearch')return;
  st.q=t.value;clearTimeout(st.timer);const seq=++st.seq;
  st.timer=setTimeout(async()=>{
    let r={clubs:[]};if(st.q.trim().length>=2)try{r=await api('/api/heart-club/search?q='+encodeURIComponent(st.q))}catch(err){toast(err.message)}
    if(seq!==st.seq)return;st.results=r.clubs;
    const box=document.getElementById('hcResults');if(!box)return;
    const mine=(await api('/api/heart-club')).mine;box.innerHTML=resultsHtml(mine);
  },250);
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-hc-choose]');if(!t||!t.closest('.hc-page')||st.busy)return;
  st.busy=true;t.disabled=true;
  try{const r=await post('/api/heart-club/choose',{club:t.dataset.hcChoose});toast('Club de cœur : '+r.club.name)}
  catch(err){toast(err.message)}
  finally{st.busy=false;render()}
});
FVC.pages.club=club;
})();

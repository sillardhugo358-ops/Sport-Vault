// Pack sur mesure (page « surmesure ») : taille, filtres et rareté minimale choisis par le joueur.
// Chargé après app.js ; serveur : /api/custom-pack/* (lib/cards.js), qui décide du prix, de la sélection et du tirage.
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};
const st={cards:5,minRarity:'common',filters:{competitions:[],seasons:[],clubs:[],positions:[]},busy:false,quote:null,opts:null,timer:0,seq:0};
const body=()=>({cards:st.cards,minRarity:st.minRarity,filters:st.filters});
const chk=(name,value,label,on)=>'<label class="cp-check"><input type="checkbox" data-cp-multi="'+name+'" value="'+esc(value)+'"'+(on?' checked':'')+'><span>'+esc(label)+'</span></label>';
function quoteHtml(){
  const q=st.quote,me=FVC.core.state.user;
  if(!q)return '<p class="wk-note" role="status">Calcul du prix…</p>';
  if(q.error)return '<p class="wk-note" role="alert">'+esc(q.error)+'</p>';
  const poor=me&&Number(me.coins)-Number(me.reservedCoins||0)<q.price;
  return '<div class="cp-price"><span class="fc-coin" aria-hidden="true">FC</span> <strong>'+money(q.price)+'</strong><small>'+q.cards+' cartes · '+esc(RL[q.minRarity])+' minimum</small></div>'
   +'<p class="wk-note" role="status">'+(q.ok?money(q.poolSize)+' cartes correspondent à ta sélection ('+money(q.eligible)+' en '+esc(RL[q.minRarity])+' ou mieux).':'Sélection impossible : '+money(q.poolSize)+' cartes correspondent à tes filtres, dont '+money(q.eligible)+' en '+esc(RL[q.minRarity])+' ou mieux. Il en faut au moins '+q.minPool+' (et '+q.cards+' de la rareté demandée).')+'</p>'
   +(poor?'<p class="wk-note" role="alert">FOOTCOINS disponibles insuffisants.</p>':'')
   +'<button class="btn btn-gold" type="button" data-cp-open '+(q.ok&&!poor&&!st.busy?'':'disabled')+'>OUVRIR MON PACK</button>';
}
function refreshQuote(){
  st.quote=null;const box=document.getElementById('cpQuote');if(box)box.innerHTML=quoteHtml();
  clearTimeout(st.timer);const seq=++st.seq;
  st.timer=setTimeout(async()=>{
    let q;try{q=await post('/api/custom-pack/quote',body())}catch(e){q={error:e.message}}
    if(seq!==st.seq)return;st.quote=q;const b=document.getElementById('cpQuote');if(b)b.innerHTML=quoteHtml();
  },250);
}
async function surmesure(){
  let o;
  try{o=await api('/api/custom-pack/options')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'surmesure'}));throw e}
  st.opts=o;if(!st.quote)setTimeout(refreshQuote,0);
  const f=st.filters;
  const rar=Object.keys(o.perCard).map(r=>'<label class="cp-radio"><input type="radio" name="cpRarity" data-cp-rarity value="'+r+'"'+(st.minRarity===r?' checked':'')+'><span><b>'+esc(RL[r])+'</b><small>'+money(o.perCard[r])+' FC / carte</small></span></label>').join('');
  const sizes=Array.from({length:o.max-o.min+1},(_,i)=>o.min+i).map(n=>'<option value="'+n+'"'+(n===st.cards?' selected':'')+'>'+n+' cartes</option>').join('');
  const sec=(t,b)=>'<fieldset class="cp-group"><legend>'+t+'</legend>'+b+'</fieldset>';
  const chips=f.clubs.map(c=>'<button class="cp-chip" type="button" data-cp-club-del="'+esc(c)+'" aria-label="Retirer '+esc(c)+'">'+esc(c)+' ×</button>').join('');
  return '<div class="page wk-page cp-page">'+viewHero('FOOTVAULT / SUR MESURE','PACK <span>SUR MESURE.</span>','Compose ton pack : nombre de cartes, compétitions, saisons, clubs, postes et rareté minimale. Le prix est calculé par le serveur et affiché avant l’achat.','FC','PRIX SELON TES CHOIX')
   +'<section class="section"><div class="cp-grid"><form class="panel cp-form" onsubmit="return false">'
   +sec('Nombre de cartes','<label class="cp-field"><span class="sr-only">Nombre de cartes</span><select data-cp-size>'+sizes+'</select></label>')
   +sec('Rareté minimale garantie (toutes les cartes)','<div class="cp-radios">'+rar+'</div><p class="wk-note">Chaque carte est tirée aux probabilités habituelles puis relevée à cette rareté. Les raretés supérieures restent possibles.</p>')
   +sec('Compétitions','<div class="cp-checks">'+o.competitions.map(c=>chk('competitions',c.id,c.name,f.competitions.includes(c.id))).join('')+'</div>')
   +sec('Saisons','<div class="cp-checks">'+o.seasons.map(s=>chk('seasons',s,s,f.seasons.includes(s))).join('')+'</div>')
   +sec('Postes','<div class="cp-checks">'+o.positions.map(p=>chk('positions',p,p,f.positions.includes(p))).join('')+'</div>')
   +sec('Clubs','<div class="cp-clubadd"><input id="cpClub" list="cpClubs" placeholder="Rechercher un club" autocomplete="off" aria-label="Club à ajouter"><datalist id="cpClubs">'+o.clubs.map(c=>'<option value="'+esc(c)+'"></option>').join('')+'</datalist><button class="btn btn-outline" type="button" data-cp-club-add>AJOUTER</button></div><div class="cp-chips">'+chips+'</div>')
   +'</form><aside class="panel cp-summary"><p class="eyebrow">TON PACK</p><div id="cpQuote">'+quoteHtml()+'</div><p class="wk-note">+'+o.filterBonusPct+' % du prix par catégorie de filtre utilisée (compétition, saison, poste, club).</p></aside></div></section></div>';
}
document.addEventListener('change',e=>{
  const t=e.target;if(!t.closest?.('.cp-page'))return;
  if(t.matches('[data-cp-size]'))st.cards=Number(t.value);
  else if(t.matches('[data-cp-rarity]'))st.minRarity=t.value;
  else if(t.matches('[data-cp-multi]')){const l=st.filters[t.dataset.cpMulti],i=l.indexOf(t.value);if(t.checked&&i<0)l.push(t.value);if(!t.checked&&i>=0)l.splice(i,1)}
  else return;
  refreshQuote();
});
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-cp-club-add],[data-cp-club-del],[data-cp-open]');if(!t||!t.closest('.cp-page'))return;
  if(t.matches('[data-cp-club-add]')){
    const inp=document.getElementById('cpClub'),v=inp.value.trim();
    if(!v||!st.opts.clubs.includes(v)){toast('Choisis un club de la liste.');return}
    if(st.filters.clubs.length>=st.opts.maxValues){toast('10 clubs au maximum.');return}
    if(!st.filters.clubs.includes(v))st.filters.clubs.push(v);
    refreshQuote();render();return;
  }
  if(t.matches('[data-cp-club-del]')){st.filters.clubs=st.filters.clubs.filter(c=>c!==t.dataset.cpClubDel);refreshQuote();render();return}
  if(st.busy)return;
  st.busy=true;t.disabled=true;
  try{
    const d=await post('/api/custom-pack/open',body());
    FVC.core.state.user=d.user;
    FVC.ui.showReveal(d.cards||[],d.pack,()=>document.querySelector('[data-cp-open]')?.click());
    toast('Pack ouvert · '+d.cards.length+' cartes · +'+d.cards.length*2+' XP');
  }catch(err){toast(err.message)}
  finally{st.busy=false;FVC.core.nav?.();refreshQuote()}
});
FVC.pages.surmesure=surmesure;
})();

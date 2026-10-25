// Échanges de cartes entre joueurs (page « trades »). Chargé après app.js : reçoit ses aides par FVC.core et enregistre la page dans FVC.pages.
// Serveur : /api/trades/* (lib/trades.js), qui valide tout (propriété, raretés, plafonds) ; ici, seulement l'affichage et la composition de l'offre.
(()=>{
const {$,api,esc,money,render,toast,viewHero}=FVC.core;
const MAX_CARDS=3;
const st={code:'',player:null,theirs:[],mine:[],give:new Set(),ask:new Set(),busy:false,info:null,f:{q:'',rarity:'',sort:'ovr'},h:{status:'all',page:1},hist:null,autoCode:''};
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const fmt=d=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const rc=c=>' rarity-'+esc(String(c.rarity||'common').toLowerCase());
const cardLine=c=>'<li class="trade-card'+rc(c)+'"><b>'+Number(c.ovr)+'</b><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+'</small></span></li>';
const pick=(side,c,checked,locked)=>'<li><label class="trade-pick trade-card'+rc(c)+(checked?' is-picked':'')+'"><input type="checkbox" data-trade-pick="'+side+'" value="'+esc(c.instanceId)+'" '+(checked?'checked ':'')+(locked&&!checked?'disabled ':'')+'><b>'+Number(c.ovr)+'</b><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+'</small></span></label></li>';
const RAR={common:'Common',rare:'Rare',epic:'Epic'};
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const applyF=cards=>{
  const q=norm(st.f.q).trim();
  let out=cards.filter(c=>(!st.f.rarity||String(c.rarity).toLowerCase()===st.f.rarity)&&(!q||norm(c.name+' '+c.club+' '+c.season).includes(q)));
  out=out.slice().sort(st.f.sort==='name'?(a,b)=>String(a.name).localeCompare(String(b.name),'fr'):st.f.sort==='rarity'?(a,b)=>((FVC.core.rarityOrder[String(b.rarity).toLowerCase()]||0)-(FVC.core.rarityOrder[String(a.rarity).toLowerCase()]||0))||Number(b.ovr)-Number(a.ovr):(a,b)=>Number(b.ovr)-Number(a.ovr));
  return out;
};
const filterBar=()=>'<div class="trade-filters" role="search"><label>Recherche<input id="tradeFilterQ" type="search" data-trade-f="q" value="'+esc(st.f.q)+'" placeholder="Nom, club ou saison" autocomplete="off"></label>'
  +'<label>Rareté<select data-trade-f="rarity"><option value="">Toutes</option>'+Object.entries(RAR).map(([k,l])=>'<option value="'+k+'"'+(st.f.rarity===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'
  +'<label>Tri<select data-trade-f="sort"><option value="ovr"'+(st.f.sort==='ovr'?' selected':'')+'>OVR décroissant</option><option value="rarity"'+(st.f.sort==='rarity'?' selected':'')+'>Rareté</option><option value="name"'+(st.f.sort==='name'?' selected':'')+'>Nom (A-Z)</option></select></label></div>';
const pickList=(side,cards,set)=>{const shown=applyF(cards);return shown.length?'<ul class="trade-pick-list">'+shown.map(c=>pick(side,c,set.has(c.instanceId),set.size>=MAX_CARDS)).join('')+'</ul>':'<p class="trade-empty">'+(cards.length?'Aucune carte ne correspond à ces filtres.':'Aucune carte échangeable.')+'</p>'};

function composerHtml(){
  const ready=st.player&&st.give.size>=1&&st.ask.size>=1;
  return '<div class="trade-search"><label for="tradeCode">Code d’échange du joueur</label><div class="trade-search-row"><input id="tradeCode" maxlength="8" autocomplete="off" autocapitalize="characters" value="'+esc(st.code)+'" placeholder="Ex. K7M2QX9P"><button class="btn btn-outline" type="button" data-trade-search>Rechercher</button></div></div>'
    +(st.player?'<p class="trade-with">Échange avec <strong>'+esc(st.player.name)+'</strong> · choisis 1 à '+MAX_CARDS+' cartes de chaque côté.</p>'+filterBar()+'<div class="trade-columns"><fieldset><legend>Tu donnes ('+st.give.size+'/'+MAX_CARDS+')</legend>'+pickList('give',st.mine,st.give)+'</fieldset><fieldset><legend>Tu reçois ('+st.ask.size+'/'+MAX_CARDS+')</legend>'+pickList('ask',st.theirs,st.ask)+'</fieldset></div>'
      +'<button class="btn btn-gold" type="button" data-trade-send '+(ready&&!st.busy?'':'disabled')+'>Envoyer l’offre</button>':'');
}
const offerCard=(o,kind)=>'<article class="panel trade-offer"><div class="trade-offer-head"><p class="eyebrow">'+(kind==='received'?'DE '+esc(o.fromName.toUpperCase()):kind==='sent'?'POUR '+esc(o.toName.toUpperCase()):esc(({accepted:'ACCEPTÉE',declined:'REFUSÉE',cancelled:'ANNULÉE',expired:'EXPIRÉE'})[o.status]||o.status))+'</p><small>'+(o.status==='open'?'Valable jusqu’au '+esc(fmt(o.expiresAt)):esc(fmt(o.resolvedAt||o.createdAt)))+'</small></div>'
  +'<div class="trade-columns trade-offer-cols"><div><h4>'+(kind==='received'?'Il donne':kind==='sent'?'Tu donnes':'Donné')+'</h4><ul>'+o.give.map(cardLine).join('')+'</ul></div><div><h4>'+(kind==='received'?'Tu donnes':kind==='sent'?'Tu reçois':'Demandé')+'</h4><ul>'+o.ask.map(cardLine).join('')+'</ul></div></div>'
  +(kind==='received'?'<div class="actions"><button class="btn btn-gold" type="button" data-trade-accept="'+esc(o.id)+'">Accepter</button><button class="btn btn-outline" type="button" data-trade-decline="'+esc(o.id)+'">Refuser</button></div>':kind==='sent'?'<div class="actions"><button class="btn btn-outline" type="button" data-trade-cancel="'+esc(o.id)+'">Annuler l’offre</button></div>':'')+'</article>';
const section=(eyebrow,title,body)=>'<section class="section trade-section"><div class="section-head"><div><p class="eyebrow">'+eyebrow+'</p><h2>'+title+'</h2></div></div>'+body+'</section>';

const HS={all:'Tous',accepted:'Acceptées',declined:'Refusées',cancelled:'Annulées',expired:'Expirées'};
function historyHtml(){
  const h=st.hist;if(!h)return '';
  const pager=h.pages>1?'<div class="trade-pager"><button class="btn btn-outline" type="button" data-trade-hpage="'+(h.page-1)+'" '+(h.page<=1?'disabled':'')+'>← PRÉCÉDENTS</button><span>Page '+h.page+' / '+h.pages+'</span><button class="btn btn-outline" type="button" data-trade-hpage="'+(h.page+1)+'" '+(h.page>=h.pages?'disabled':'')+'>SUIVANTS →</button></div>':'';
  return '<div class="trade-filters"><label>Statut<select data-trade-hstatus>'+Object.entries(HS).map(([k,l])=>'<option value="'+k+'"'+(h.status===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label><p class="trade-hcount" role="status">'+h.total+' échange'+(h.total>1?'s':'')+'</p></div>'
    +(h.offers.length?'<div class="trade-offers">'+h.offers.map(o=>offerCard(o,'history')).join('')+'</div>':'<p class="trade-empty">Aucun échange pour ce filtre.</p>')+pager;
}
const loadHistory=()=>api('/api/trades/history?status='+encodeURIComponent(st.h.status)+'&page='+st.h.page).then(h=>{st.hist=h;st.h.page=h.page}).catch(e=>{if(e.status!==401)toast(e.message)});
const redrawHistory=()=>{const el=$('#tradeHistory');if(el)el.innerHTML=historyHtml()};
async function trades(){
  let data,mine;
  const wanted=(FVC.core.route().q.get('code')||'').trim().toUpperCase();
  try{[data,mine]=await Promise.all([api('/api/trades'),api('/api/trades/mine/cards'),loadHistory()]).then(r=>r.slice(0,2))}
  catch(e){if(/connect/i.test(e.message||'')||e.status===401)return FVC.pages.auth(new URLSearchParams({next:'trades'}));throw e}
  st.info=data;st.mine=mine.cards||[];
  // Lien « Échanger » d'un profil ou de la liste d'amis : #trades?code=XXXXXXXX remplit le code et lance la recherche.
  if(/^[A-Z0-9]{8}$/.test(wanted)&&st.autoCode!==wanted){
    st.autoCode=wanted;st.code=wanted;
    try{const d=await api('/api/trades/player?code='+encodeURIComponent(wanted));st.player=d.player;st.theirs=d.cards||[];st.ask.clear();st.give.clear()}
    catch(err){st.player=null;st.theirs=[];toast(err.message)}
  }
  const keep=new Set(st.mine.map(c=>c.instanceId));for(const id of [...st.give])if(!keep.has(id))st.give.delete(id);
  const L=data.limits;
  return '<div class="page trades-page">'+viewHero('ÉCHANGES','Échange avec tes amis, carte contre carte.','Échange 1 à '+L.maxCardsPerSide+' de tes cartes contre celles d’un autre joueur. Les cartes Legendary et Icon ne s’échangent pas.',String(data.remainingToday),'ÉCHANGES RESTANTS AUJOURD’HUI')
    +section('MON CODE','Mon code d’échange','<div class="panel trade-code-box"><strong class="trade-code" id="tradeMyCode">'+esc(data.code)+'</strong><button class="btn btn-outline" type="button" data-trade-copy>Copier</button><p>Donne ce code à un ami pour qu’il t’envoie une offre. '+L.maxOpenSent+' offres ouvertes maximum ('+data.openSent+' en cours) · '+L.dailyLimit+' échanges conclus par jour · une offre expire au bout de '+L.expiresDays+' jours.</p></div>')
    +section('REÇUES','Offres reçues ('+data.received.length+')',data.received.length?'<div class="trade-offers">'+data.received.map(o=>offerCard(o,'received')).join('')+'</div>':'<p class="trade-empty">Aucune offre en attente.</p>')
    +section('NOUVELLE OFFRE','Proposer un échange','<div class="panel trade-composer" id="tradeComposer">'+composerHtml()+'</div>')
    +section('ENVOYÉES','Mes offres en cours ('+data.sent.length+')',data.sent.length?'<div class="trade-offers">'+data.sent.map(o=>offerCard(o,'sent')).join('')+'</div>':'<p class="trade-empty">Aucune offre en cours.</p>')
    +section('HISTORIQUE','Historique des échanges','<div id="tradeHistory">'+historyHtml()+'</div>')
    +'</div>';
}
const redrawComposer=()=>{const el=$('#tradeComposer');if(el){const a=document.activeElement,focus=a?.id,pos=a?.selectionStart;el.innerHTML=composerHtml();if(focus==='tradeCode'||focus==='tradeFilterQ'){const n=$('#'+focus);n?.focus();if(pos!=null)try{n.setSelectionRange(pos,pos)}catch{}}}};
async function act(btn,url,body,okMsg){
  if(btn)btn.disabled=true;
  try{const r=await post(url,body);toast(okMsg);render();return r}
  catch(e){toast(e.message);if(btn)btn.disabled=false}
}
document.addEventListener('click',async e=>{
  const hp=e.target.closest('[data-trade-hpage]');
  if(hp){st.h.page=Number(hp.dataset.tradeHpage);await loadHistory();redrawHistory();return}
  const t=e.target.closest('[data-trade-search],[data-trade-send],[data-trade-accept],[data-trade-decline],[data-trade-cancel],[data-trade-copy]');
  if(!t)return;
  if(t.matches('[data-trade-copy]')){try{await navigator.clipboard.writeText($('#tradeMyCode').textContent);toast('Code copié.')}catch{toast('Copie impossible : sélectionne le code à la main.')}return}
  if(t.matches('[data-trade-search]')){
    const code=($('#tradeCode')?.value||'').trim().toUpperCase();st.code=code;
    try{const d=await api('/api/trades/player?code='+encodeURIComponent(code));st.player=d.player;st.theirs=d.cards||[];st.ask.clear();if(!st.theirs.length)toast('Ce joueur n’a aucune carte échangeable.')}
    catch(err){st.player=null;st.theirs=[];toast(err.message)}
    redrawComposer();return;
  }
  if(t.matches('[data-trade-send]')){
    st.busy=true;t.disabled=true;
    try{await post('/api/trades/offer',{toCode:st.code,give:[...st.give],ask:[...st.ask]});toast('Offre envoyée à '+st.player.name+'.');st.player=null;st.theirs=[];st.give.clear();st.ask.clear();st.code='';st.busy=false;render()}
    catch(err){st.busy=false;toast(err.message);redrawComposer()}
    return;
  }
  if(t.dataset.tradeAccept)return act(t,'/api/trades/accept',{id:t.dataset.tradeAccept},'Échange réalisé ! Les cartes sont dans ta collection.');
  if(t.dataset.tradeDecline)return act(t,'/api/trades/decline',{id:t.dataset.tradeDecline},'Offre refusée.');
  if(t.dataset.tradeCancel)return act(t,'/api/trades/cancel',{id:t.dataset.tradeCancel},'Offre annulée.');
});
document.addEventListener('change',async e=>{
  const f=e.target.closest('[data-trade-f]');
  if(f&&f.tagName==='SELECT'){st.f[f.dataset.tradeF]=f.value;redrawComposer();return}
  const hs=e.target.closest('[data-trade-hstatus]');
  if(hs){st.h.status=hs.value;st.h.page=1;await loadHistory();redrawHistory();return}
  const c=e.target.closest('[data-trade-pick]');if(!c)return;
  const set=c.dataset.tradePick==='give'?st.give:st.ask;
  if(c.checked)set.add(c.value);else set.delete(c.value);
  redrawComposer();
});
document.addEventListener('input',e=>{if(e.target.matches?.('input[data-trade-f]')){st.f[e.target.dataset.tradeF]=e.target.value;redrawComposer();return}if(e.target.id==='tradeCode'){st.code=e.target.value.toUpperCase();if(st.player&&st.player.code!==st.code){st.player=null;st.theirs=[];st.ask.clear();redrawComposer()}}});
FVC.pages.trades=trades;
})();

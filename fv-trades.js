// Échanges de cartes entre joueurs (page « trades »). Chargé après app.js : reçoit ses aides par FVC.core et enregistre la page dans FVC.pages.
// Serveur : /api/trades/* (lib/trades.js), qui valide tout (propriété, raretés, plafonds) ; ici, seulement l'affichage et la composition de l'offre.
(()=>{
const {$,api,esc,money,render,toast,viewHero}=FVC.core;
const MAX_CARDS=3;
const st={code:'',player:null,theirs:[],mine:[],give:new Set(),ask:new Set(),busy:false,info:null};
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const fmt=d=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const cardLine=c=>'<li><strong>'+esc(c.name)+'</strong> <small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+' · '+Number(c.ovr)+'</small></li>';
const pick=(side,c,checked,locked)=>'<li><label class="trade-pick"><input type="checkbox" data-trade-pick="'+side+'" value="'+esc(c.instanceId)+'" '+(checked?'checked ':'')+(locked&&!checked?'disabled ':'')+'><span><strong>'+esc(c.name)+'</strong> <small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+' · '+Number(c.ovr)+'</small></span></label></li>';
const pickList=(side,cards,set)=>cards.length?'<ul class="trade-pick-list">'+cards.map(c=>pick(side,c,set.has(c.instanceId),set.size>=MAX_CARDS)).join('')+'</ul>':'<p class="trade-empty">Aucune carte échangeable.</p>';

function composerHtml(){
  const ready=st.player&&st.give.size>=1&&st.ask.size>=1;
  return '<div class="trade-search"><label for="tradeCode">Code d’échange du joueur</label><div class="trade-search-row"><input id="tradeCode" maxlength="8" autocomplete="off" autocapitalize="characters" value="'+esc(st.code)+'" placeholder="Ex. K7M2QX9P"><button class="btn btn-outline" type="button" data-trade-search>RECHERCHER</button></div></div>'
    +(st.player?'<p class="trade-with">Échange avec <strong>'+esc(st.player.name)+'</strong> · choisis 1 à '+MAX_CARDS+' cartes de chaque côté.</p><div class="trade-columns"><fieldset><legend>Tu donnes ('+st.give.size+'/'+MAX_CARDS+')</legend>'+pickList('give',st.mine,st.give)+'</fieldset><fieldset><legend>Tu reçois ('+st.ask.size+'/'+MAX_CARDS+')</legend>'+pickList('ask',st.theirs,st.ask)+'</fieldset></div>'
      +'<button class="btn btn-gold" type="button" data-trade-send '+(ready&&!st.busy?'':'disabled')+'>ENVOYER L’OFFRE</button>':'');
}
const offerCard=(o,kind)=>'<article class="panel trade-offer"><div class="trade-offer-head"><p class="eyebrow">'+(kind==='received'?'DE '+esc(o.fromName.toUpperCase()):kind==='sent'?'POUR '+esc(o.toName.toUpperCase()):esc(({accepted:'ACCEPTÉE',declined:'REFUSÉE',cancelled:'ANNULÉE',expired:'EXPIRÉE'})[o.status]||o.status))+'</p><small>'+(o.status==='open'?'Valable jusqu’au '+esc(fmt(o.expiresAt)):esc(fmt(o.resolvedAt||o.createdAt)))+'</small></div>'
  +'<div class="trade-columns"><div><h4>'+(kind==='received'?'Il donne':kind==='sent'?'Tu donnes':'Donné')+'</h4><ul>'+o.give.map(cardLine).join('')+'</ul></div><div><h4>'+(kind==='received'?'Tu donnes':kind==='sent'?'Tu reçois':'Demandé')+'</h4><ul>'+o.ask.map(cardLine).join('')+'</ul></div></div>'
  +(kind==='received'?'<div class="actions"><button class="btn btn-gold" type="button" data-trade-accept="'+esc(o.id)+'">ACCEPTER</button><button class="btn btn-outline" type="button" data-trade-decline="'+esc(o.id)+'">REFUSER</button></div>':kind==='sent'?'<div class="actions"><button class="btn btn-outline" type="button" data-trade-cancel="'+esc(o.id)+'">ANNULER L’OFFRE</button></div>':'')+'</article>';
const section=(eyebrow,title,body)=>'<section class="section trade-section"><div class="section-head"><div><p class="eyebrow">'+eyebrow+'</p><h2>'+title+'</h2></div></div>'+body+'</section>';

async function trades(){
  let data,mine;
  try{[data,mine]=await Promise.all([api('/api/trades'),api('/api/trades/mine/cards')])}
  catch(e){if(/connect/i.test(e.message||'')||e.status===401)return FVC.pages.auth(new URLSearchParams({next:'trades'}));throw e}
  st.info=data;st.mine=mine.cards||[];
  const keep=new Set(st.mine.map(c=>c.instanceId));for(const id of [...st.give])if(!keep.has(id))st.give.delete(id);
  const L=data.limits;
  return '<div class="page trades-page">'+viewHero('FOOTVAULT / ÉCHANGES','ÉCHANGE <span>DE CARTES.</span>','Échange 1 à '+L.maxCardsPerSide+' de tes cartes contre celles d’un autre joueur. Les cartes Legendary et Icon ne s’échangent pas.',String(data.remainingToday),'ÉCHANGES RESTANTS AUJOURD’HUI')
    +section('MON CODE','MON CODE D’ÉCHANGE','<div class="panel trade-code-box"><strong class="trade-code" id="tradeMyCode">'+esc(data.code)+'</strong><button class="btn btn-outline" type="button" data-trade-copy>COPIER</button><p>Donne ce code à un ami pour qu’il t’envoie une offre. '+L.maxOpenSent+' offres ouvertes maximum ('+data.openSent+' en cours) · '+L.dailyLimit+' échanges conclus par jour · une offre expire au bout de '+L.expiresDays+' jours.</p></div>')
    +section('NOUVELLE OFFRE','PROPOSER UN ÉCHANGE','<div class="panel trade-composer" id="tradeComposer">'+composerHtml()+'</div>')
    +section('REÇUES','OFFRES REÇUES ('+data.received.length+')',data.received.length?'<div class="trade-offers">'+data.received.map(o=>offerCard(o,'received')).join('')+'</div>':'<p class="trade-empty">Aucune offre en attente.</p>')
    +section('ENVOYÉES','MES OFFRES EN COURS ('+data.sent.length+')',data.sent.length?'<div class="trade-offers">'+data.sent.map(o=>offerCard(o,'sent')).join('')+'</div>':'<p class="trade-empty">Aucune offre en cours.</p>')
    +(data.history.length?section('HISTORIQUE','DERNIERS ÉCHANGES','<div class="trade-offers">'+data.history.map(o=>offerCard(o,'history')).join('')+'</div>'):'')
    +'</div>';
}
const redrawComposer=()=>{const el=$('#tradeComposer');if(el){const focus=document.activeElement?.id;el.innerHTML=composerHtml();if(focus==='tradeCode')$('#tradeCode')?.focus()}};
async function act(btn,url,body,okMsg){
  if(btn)btn.disabled=true;
  try{const r=await post(url,body);toast(okMsg);render();return r}
  catch(e){toast(e.message);if(btn)btn.disabled=false}
}
document.addEventListener('click',async e=>{
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
document.addEventListener('change',e=>{
  const c=e.target.closest('[data-trade-pick]');if(!c)return;
  const set=c.dataset.tradePick==='give'?st.give:st.ask;
  if(c.checked)set.add(c.value);else set.delete(c.value);
  redrawComposer();
});
document.addEventListener('input',e=>{if(e.target.id==='tradeCode'){st.code=e.target.value.toUpperCase();if(st.player&&st.player.code!==st.code){st.player=null;st.theirs=[];st.ask.clear();redrawComposer()}}});
FVC.pages.trades=trades;
})();

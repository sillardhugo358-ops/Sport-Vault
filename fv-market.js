// Marché et enchères (page « market », fenêtres de confirmation/saisie, mise, retrait, annulation, création d'enchère).
// Chargé après app.js : reçoit ses aides par FVC.core, enregistre la page dans FVC.pages et ses actions dans FVC.market (utilisées par bind() et fv-admin.js).
// Le serveur (lib/auctions.js, lib/market.js) valide tout : prix, solde, paliers, propriété.
(()=>{
const {$,api,cardMarkup,closeModal,esc,money,render,rarityOrder,setModal,state,toast,viewHero}=FVC.core;
async function market(){
 try{
  const [a,c,m]=await Promise.all([api('/api/auctions'),api('/api/collection').catch(()=>({cards:[],user:null})),api('/api/me').catch(()=>({user:null}))]);
  state.auctions=a.auctions||[];state.cards=c.cards||[];state.user=m.user||c.user||null;
 }catch(e){throw e}
 const now=Date.now();
 const fmtEnd=iso=>{const sec=Math.max(0,Math.floor((new Date(iso).getTime()-Date.now())/1000));if(sec<60)return sec+'s';const min=Math.floor(sec/60);if(min<60)return min+' min';const h=Math.floor(min/60),r=min%60;return h+'h'+(r?' '+r+'min':'')};
 const auctionCard=x=>{const c=x.card||{};const mine=state.user&&x.sellerId===state.user.id;const hasBid=!!x.currentBidderId;const min=hasBid?Math.ceil(x.currentBid*11/10):x.startingBid;const status=!mine&&x.isCurrentUserBidder?'<span class="auction-status status-leading">● TU ES MEILLEUR ENCHÉRISSEUR</span>':(!mine&&x.bidCount>0?'<span class="auction-status status-outbid">● TU AS ÉTÉ DÉPASSÉ</span>':(mine&&hasBid?'<span class="auction-status status-seller">● ENCHÈRE EN COURS</span>':''));const participationStatus=x.isCurrentUserWithdrawn?'<span class="auction-status status-outbid">● PARTICIPATION ABANDONNÉE</span>':status;const sellerAction=mine?(hasBid?'<button class="btn" disabled>ENCHÈRE EN COURS</button>':'<button class="btn btn-danger" data-cancel-auction="'+esc(x.id)+'">ANNULER L’ENCHÈRE</button>'):x.isCurrentUserWithdrawn?'<button class="btn" disabled>PARTICIPATION TERMINÉE</button>':x.isCurrentUserParticipant?'<div class="auction-action-row"><button class="btn btn-gold" data-bid="'+esc(x.id)+'" data-min="'+min+'">ENCHÉRIR</button><button class="btn btn-danger" data-withdraw-auction="'+esc(x.id)+'">SE RETIRER</button></div>':'<button class="btn btn-gold" data-bid="'+esc(x.id)+'" data-min="'+min+'">ENCHÉRIR</button>';return `<article class="auction-card" data-auction-id="${esc(x.id)}"><div class="auction-card-visual">${cardMarkup(c)}<span class="auction-live">LIVE</span></div><div class="auction-copy"><div class="auction-top"><span class="eyebrow">${esc(c.rarityLabel||c.rarity)} · ${esc(c.club)}</span><strong class="auction-time" data-end="${esc(x.endsAt)}">${fmtEnd(x.endsAt)}</strong></div><h3>${esc(c.name)}</h3><p>${esc(c.position)} · ${esc(c.nation)} · ${c.isLimited?esc(c.serialLabel||'LIMITED'):'STANDARD'}</p>${participationStatus}<div class="auction-price"><span>ENCHÈRE ACTUELLE</span><b>${money(x.currentBid)} FC</b></div><div class="auction-meta"><span>${x.bidCount||0} offre${x.bidCount===1?'':'s'} · <button class="auction-link" data-bids="${esc(x.id)}">VOIR</button></span><span>Min. ${money(min)} FC</span></div>${x.referencePrice?`<div class="auction-reference ${x.currentBid<=x.referencePrice?'is-below':'is-above'}">RÉFÉRENCE : <strong>${money(x.referencePrice)} FC</strong><small>médiane des dernières ventes · ${x.currentBid<=x.referencePrice?'offre actuelle sous la référence':'offre actuelle au-dessus de la référence'}</small></div>`:'<div class="auction-reference is-none">RÉFÉRENCE : <strong>—</strong><small>aucune vente de cette carte pour l’instant</small></div>'}${state.user&&!mine?`<button class="auction-link auction-alert-link" type="button" data-price-alert="${esc(c.cardId||'')}" data-card-name="${esc(c.name)}">🔔 ALERTE DE PRIX</button>`:''}<div class="auction-actions">${sellerAction}</div></div></article>`};
 const mineCards=state.cards.filter(c=>c.source!=='welcome'&&c.tradeable!==false);
 return `<div class="page">${viewHero('MARCHÉ','Enchéris pour la carte qui manque.','Achète et vends tes cartes aux enchères. Aucune commission, et les cartes de bienvenue restent verrouillées.',state.auctions.length,'ENCHÈRES ACTIVES')}
 <div class="auction-summary"><div><span>ACTIVES</span><strong>${state.auctions.length}</strong></div><div><span>TES ENCHÈRES</span><strong>${state.auctions.filter(x=>x.isCurrentUserBidder).length}</strong></div><div><span>FC DISPONIBLES</span><strong>${money(state.user?.availableCoins??state.user?.coins??0)}</strong></div></div><div class="auction-toolbar"><div><button class="filter active" data-auction-tab="live">Enchères actives</button><button class="filter" data-auction-tab="sell">Mes cartes</button><button class="filter" data-auction-tab="sales">Ventes récentes</button><button class="filter" data-auction-tab="history">Mon historique</button><button class="filter" data-auction-tab="alerts">Mes alertes</button></div><div class="auction-tools"><input id="auctionSearch" class="auction-search" aria-label="Rechercher une enchère" placeholder="Rechercher une carte, un club..." /><select id="auctionRarity" class="auction-select" aria-label="Filtrer les enchères par rareté"><option value="all">Toutes raretés</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option><option value="icon">Icon</option></select><select id="auctionSort" class="auction-select" aria-label="Trier les enchères"><option value="ending">Fin prochaine</option><option value="price">Prix croissant</option><option value="rarity">Rareté</option></select></div></div>
 <section id="auctionLive" class="auction-grid">${(()=>{let list=state.auctions.filter(x=>state.marketRarity==="all"||x.card?.rarity===state.marketRarity);const q=(state.auctionSearch||"").toLowerCase();if(q)list=list.filter(x=>[x.card?.name,x.card?.club,x.card?.nation,x.sellerName].some(v=>String(v||"").toLowerCase().includes(q)));list.sort((a,b)=>state.marketSort==="price"?Number(a.currentBid)-Number(b.currentBid):state.marketSort==="rarity"?(rarityOrder[b.card?.rarity]||0)-(rarityOrder[a.card?.rarity]||0):new Date(a.endsAt)-new Date(b.endsAt));return list.length?list.map(auctionCard).join(""):state.auctions.length?'<div class="empty empty-rich"><span aria-hidden="true">⌕</span><strong>Aucune enchère ne correspond aux filtres</strong><p>Essaie une autre rareté ou un autre mot-clé.</p></div>':'<div class="empty empty-rich"><span aria-hidden="true">⚒</span><strong>Aucune enchère en cours</strong><p>Le marché est calme : mets une de tes cartes en vente pour lancer les enchères.</p><button class="btn btn-gold" type="button" data-auction-goto="sell">METTRE UNE CARTE EN VENTE</button></div>'})()}</section>
 <section id="auctionSell" class="auction-sell" hidden>
  <div class="sell-market-head">
    <div><p class="eyebrow">TES CARTES ÉLIGIBLES</p><h2>CHOISIS TA <span>CARTE.</span></h2><p>Chaque carte peut être mise aux enchères individuellement. Les cartes non échangeables sont automatiquement exclues.</p></div>
    <div class="sell-duration-note"><span>DURÉES DISPONIBLES</span><strong>10 min · 30 min · 1 h · 3 h · 6 h · 12 h · 24 h</strong></div>
  </div>
  <div class="sell-card-grid">${mineCards.length?mineCards.map(c=>`<article class="sell-card">
    <div class="sell-card-visual">${cardMarkup(c)}</div>
    <div class="sell-card-body">
      <div class="sell-card-heading"><div><span class="sell-card-kicker">${esc(c.rarityLabel||c.rarity)} · ${esc(c.club)}</span><h3>${esc(c.name)}</h3></div><span class="sell-card-ovr">OVR <b>${Number(c.ovr||0)||'—'}</b></span></div>
      <div class="sell-card-specs"><span><small>POSTE</small><b>${esc(c.position)}</b></span><span><small>NATIONALITÉ</small><b>${esc(c.nation)}</b></span><span><small>NUMÉRO</small><b>${c.jerseyNumber==null?'—':esc(c.jerseyNumber)}</b></span></div>
      <div class="sell-card-footer"><p><strong>Carte éligible</strong><span>STANDARD · échangeable</span></p><button class="btn btn-gold" data-sell-card="${esc(c.instanceId)}">METTRE AUX ENCHÈRES <span>→</span></button></div>
    </div>
  </article>`).join(''):'<div class="empty">AUCUNE CARTE ÉLIGIBLE.</div>'}</div>
</section>
<section id="auctionHistory" class="auction-grid" hidden><div class="empty">L’historique sera chargé à l’ouverture de cet onglet.</div></section>
<section id="auctionSales" class="market-insights" hidden><div class="empty">Chargement des ventes…</div></section>
<section id="auctionAlerts" class="market-insights" hidden><div class="empty">Chargement de tes alertes…</div></section>
 </div>`
}
async function loadAuctionHistory(){
 try{const d=await api('/api/auctions/history');state.auctionHistory=d.auctions||[];return state.auctionHistory}catch(e){toast(e.message);return[]}
}
async function showBidHistory(id){try{const d=await api('/api/auctions/'+encodeURIComponent(id)+'/bids');const bids=d.bids||[];const rows=bids.map(b=>'<div class="bid-row"><strong>'+esc(b.bidderName)+'</strong><span>'+money(b.amount)+' FC</span></div>').join('');setModal('<div class="modal-box auction-modal-box"><button class="modal-close" aria-label="Fermer" data-close>×</button><p class="eyebrow">FOOTVAULT / ENCHÈRES</p><h2>HISTORIQUE DES OFFRES</h2><div class="bid-history">'+(rows||'<div class="empty">Aucune offre.</div>')+'</div></div>')}catch(e){toast(e.message)}}
function updateAuctionTimers(){document.querySelectorAll('.auction-time[data-end]').forEach(el=>{const sec=Math.max(0,Math.floor((new Date(el.dataset.end).getTime()-Date.now())/1000));if(sec<=0){el.textContent='TERMINÉE';return}if(sec<60)el.textContent=sec+' s';else if(sec<3600)el.textContent=Math.floor(sec/60)+' min';else{const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);el.textContent=h+' h'+(m?' '+m+' min':'')}})}
function startAuctionTimer(){clearInterval(window.auctionTimer);if($('#auctionLive')){updateAuctionTimers();window.auctionTimer=setInterval(updateAuctionTimers,1000)}}
function auctionSearchFilter(){
 const input=$('#auctionSearch');if(!input)return;
 const q=input.value.trim().toLowerCase();
 document.querySelectorAll('.auction-card').forEach(card=>card.style.display=!q||card.textContent.toLowerCase().includes(q)?'':'none');
}
function siteConfirmDialog({title,subtitle='',confirm='CONFIRMER'}){
 return new Promise(resolve=>{
  const safeTitle=esc(title).replace(/ \?/g,'&nbsp;?');setModal(`<div class="modal-box auction-modal-box"><button class="modal-close" aria-label="Fermer" data-close>×</button><p class="eyebrow">FOOTVAULT / CONFIRMATION</p><h2>${safeTitle}</h2>${subtitle?`<p class="auction-dialog-subtitle">${esc(subtitle)}</p>`:''}<div class="auction-dialog-actions"><button class="btn btn-ghost" id="siteConfirmCancel">ANNULER</button><button class="btn btn-gold" id="siteConfirmOk">${esc(confirm)}</button></div></div>`);
  const finish=v=>{closeModal();resolve(v)};
  $('#siteConfirmCancel').onclick=()=>finish(null);
  $('#siteConfirmOk').onclick=()=>finish(true);
 });
}
function auctionDialog({title,subtitle='',label='Valeur',value='',type='number',options=null,confirm='CONFIRMER'}){
 return new Promise(resolve=>{
  const isConfirm=type==='confirm';
  setModal(`<div class="modal-box auction-modal-box"><button class="modal-close" aria-label="Fermer" data-close>×</button><p class="eyebrow">FOOTVAULT / ENCHÈRES</p><h2>${esc(title)}</h2>${subtitle?`<p class="auction-dialog-subtitle">${esc(subtitle)}</p>`:''}${isConfirm?'':`<div class="auction-dialog-form">${options?`<label class="auction-field"><span>${esc(label)}</span><select id="auctionDialogValue">${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`:`<label class="auction-field"><span>${esc(label)}</span><input id="auctionDialogValue" type="${type}" value="${esc(value)}" min="1" inputmode="numeric" autocomplete="off"></label>`}</div>`}<div class="auction-dialog-actions"><button class="btn btn-ghost" id="auctionDialogCancel">ANNULER</button><button class="btn btn-gold" id="auctionDialogConfirm">${esc(confirm)}</button></div></div>`);
  const input=$('#auctionDialogValue');const finish=(v)=>{closeModal();resolve(v)};
  $('#auctionDialogCancel').onclick=()=>finish(null);
  $('#auctionDialogConfirm').onclick=()=>{if(!isConfirm&&!options&&(!input.value||Number(input.value)<1)){input.focus();return}finish(isConfirm?true:input.value)};
  if(input&&!options){input.focus();input.select();input.onkeydown=e=>{if(e.key==='Enter')$('#auctionDialogConfirm').click();if(e.key==='Escape')$('#auctionDialogCancel').click()}}
 });
}
async function bidAuction(id,min){
 const amount=await auctionDialog({title:'PLACER UNE ENCHÈRE',subtitle:`Minimum actuel : ${money(min)} FC. Une nouvelle offre doit respecter le minimum affiché.`,label:'Ton offre en FOOTCOINS',value:min});
 if(amount===null)return;
 try{const d=await api('/api/auctions/bid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id,amount:Number(amount)})});toast(`Enchère de ${money(d.auction.currentBid)} FC enregistrée`);render()}catch(e){toast(e.message)}
}
async function withdrawAuction(id){ const ok=await auctionDialog({title:'SE RETIRER DE L’ENCHÈRE ?',subtitle:'Après ton retrait, tu ne pourras plus enchérir sur cette enchère. Cette décision ne bloque aucune autre enchère de cette carte.',label:'Confirmation',type:'confirm',confirm:'SE RETIRER'}); if(ok===null)return; try{await api('/api/auctions/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id})});toast('Tu as quitté cette enchère.');render()}catch(e){toast(e.message)} }
async function cancelAuction(id){
 const ok=await auctionDialog({title:'ANNULER L’ENCHÈRE ?',subtitle:'La carte sera immédiatement remise dans ta collection. Cette action est possible uniquement tant qu’aucune offre n’a été placée.',label:'Confirmation',type:'confirm',confirm:'ANNULER L’ENCHÈRE'});
 if(ok===null)return;
 try{await api('/api/auctions/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id})});toast('Enchère annulée · carte récupérée.');render()}catch(e){toast(e.message)}
}
async function createAuction(cardId){
 const start=await auctionDialog({title:'CRÉER UNE ENCHÈRE',subtitle:'Définis le montant de départ. Ta carte sera bloquée pendant l’enchère.',label:'Mise de départ en FOOTCOINS',value:100});
 if(start===null)return;
 const durations=[['10','10 minutes'],['30','30 minutes'],['60','1 heure'],['180','3 heures'],['360','6 heures'],['720','12 heures'],['1440','24 heures']];
 const duration=await auctionDialog({title:'DURÉE DE L’ENCHÈRE',subtitle:'Choisis combien de temps ton annonce restera active.',label:'Durée',value:'30',options:durations.map(([value,label])=>({value,label}))});
 if(duration===null)return;
 try{await api('/api/auctions/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardInstanceId:cardId,startingBid:Number(start),duration:Number(duration)})});toast('Enchère créée.');render()}catch(e){toast(e.message)}
}
FVC.market={market,loadAuctionHistory,showBidHistory,siteConfirmDialog,auctionDialog,bidAuction,withdrawAuction,cancelAuction,createAuction,startAuctionTimer};
FVC.pages.market=market;
})();

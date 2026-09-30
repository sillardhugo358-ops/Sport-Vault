// Marché plus lisible : prix de marché sur la fiche carte, onglets « Ventes récentes » et
// « Mes alertes » du marché, bouton « Alerte de prix ». Reçoit de app.js (bind) : api, toast,
// auctionDialog, loggedIn, focusAuction. Serveur : /api/market/* (lib/market.js), qui valide tout.
(()=>{
  let api,toast,auctionDialog,loggedIn=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('fr-FR');
  const day=d=>new Date(d).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  const post=body=>api('/api/market/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

  async function editAlert(cardId,name,current,reference){
    const suggested=current||(reference?Math.max(1,Math.round(reference*0.9)):100);
    const value=await auctionDialog({title:'ALERTE DE PRIX',subtitle:'Tu seras prévenu (cloche) dès qu’une enchère sur « '+name+' » s’ouvre à ce prix ou moins.'+(reference?' Référence actuelle : '+money(reference)+' FC.':''),label:'Prix maximum en FOOTCOINS',value:suggested,confirm:current?'METTRE À JOUR':'CRÉER L’ALERTE'});
    if(value===null)return false;
    try{await post({cardId,maxPrice:Number(value)});toast('Alerte enregistrée : '+money(value)+' FC maximum.');return true;}
    catch(e){toast(e.message);return false;}
  }
  async function removeAlert(cardId){
    try{await post({action:'delete',cardId});toast('Alerte supprimée.');return true;}catch(e){toast(e.message);return false;}
  }

  // Fiche carte : référence, fourchette, dernières ventes, enchères en cours, alerte.
  async function loadCardPanel(panel){
    const cardId=panel.dataset.cardId,name=panel.dataset.cardName||'cette carte';
    if(!cardId){panel.hidden=true;return;}
    let m;
    try{m=await api('/api/market/card?cardId='+encodeURIComponent(cardId));}
    catch(e){panel.innerHTML='<span class="eyebrow">MARCHÉ</span><p class="card-market-empty">Prix de marché indisponible : '+esc(e.message)+'</p>';return;}
    const ref=m.reference;
    const sales=m.sales.length?'<ul class="card-market-sales">'+m.sales.map(s=>'<li><span>'+esc(day(s.soldAt))+(s.serial?' · #'+esc(s.serial):'')+'</span><strong>'+money(s.price)+' FC</strong></li>').join('')+'</ul>':'<p class="card-market-empty">Aucune vente de cette carte pour l’instant : la référence apparaîtra après la première vente.</p>';
    const alert=loggedIn?(m.alert?'<div class="card-market-alert"><span>🔔 Alerte active : <strong>'+money(m.alert.maxPrice)+' FC</strong> maximum</span><div><button class="btn btn-outline" type="button" data-market-alert-edit>MODIFIER</button><button class="btn btn-ghost" type="button" data-market-alert-delete>SUPPRIMER</button></div></div>':'<button class="btn btn-gold" type="button" data-market-alert-edit>🔔 CRÉER UNE ALERTE DE PRIX</button>'):'';
    panel.innerHTML='<span class="eyebrow">MARCHÉ</span>'
      +'<div class="card-market-figures"><div><span>RÉFÉRENCE</span><strong>'+(ref?money(ref.median)+' FC':'—')+'</strong><small>'+(ref?'médiane de '+(ref.sales>20?'20 dernières ventes':ref.sales+' vente'+(ref.sales>1?'s':'')):'pas encore de vente')+'</small></div>'
      +'<div><span>FOURCHETTE</span><strong>'+(ref?money(ref.low)+' – '+money(ref.high):'—')+'</strong><small>FC, toutes ventes</small></div>'
      +'<div><span>EN VENTE</span><strong>'+m.active+'</strong><small>'+(m.active?'dès '+money(m.lowestActive)+' FC · <a href="#market">voir</a>':'aucune enchère en cours')+'</small></div></div>'
      +'<p class="card-market-sub">DERNIÈRES VENTES</p>'+sales+alert;
    const edit=panel.querySelector('[data-market-alert-edit]');
    if(edit)edit.onclick=async()=>{if(await editAlert(cardId,name,m.alert?.maxPrice,ref?.median))loadCardPanel(panel);};
    const del=panel.querySelector('[data-market-alert-delete]');
    if(del)del.onclick=async()=>{del.disabled=true;if(await removeAlert(cardId))loadCardPanel(panel);else del.disabled=false;};
  }

  async function loadSales(section){
    try{
      const {sales}=await api('/api/market/sales');
      section.innerHTML=sales.length?'<div class="market-table" role="table">'+'<div class="market-row market-head" role="row"><span>CARTE</span><span>VENDUE</span><span>PRIX</span><span>RÉFÉRENCE</span></div>'
        +sales.map(s=>{const c=s.card||{},diff=s.referencePrice?Math.round((s.price-s.referencePrice)/s.referencePrice*100):null;
          return '<div class="market-row" role="row"><span><a href="#card?id='+encodeURIComponent(c.cardId||'')+'"><strong>'+esc(c.name)+'</strong></a><small>'+esc(c.rarityLabel||c.rarity||'')+' · '+esc(c.club)+' · '+esc(c.season)+'</small></span><span>'+esc(day(s.soldAt))+'</span><span><strong>'+money(s.price)+' FC</strong></span><span>'+(s.referencePrice?money(s.referencePrice)+' FC'+(diff?'<small class="'+(diff>0?'is-above':'is-below')+'">'+(diff>0?'+':'')+diff+' %</small>':''):'—')+'</span></div>';}).join('')+'</div>'
        :'<div class="empty">AUCUNE VENTE POUR L’INSTANT.</div>';
    }catch(e){section.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  }

  async function loadAlerts(section){
    if(!loggedIn){section.innerHTML='<div class="empty">CONNECTE-TOI POUR SUIVRE LE PRIX DES CARTES.</div>';return;}
    try{
      const {alerts}=await api('/api/market/alerts');
      section.innerHTML='<p class="market-insights-note">Crée une alerte depuis une enchère ou la fiche d’une carte : la cloche te prévient dès qu’une enchère s’ouvre à ton prix maximum ou moins.</p>'
        +(alerts.length?'<div class="market-table" role="table"><div class="market-row market-head" role="row"><span>CARTE</span><span>PRIX MAX</span><span>RÉFÉRENCE</span><span></span></div>'
        +alerts.map(a=>'<div class="market-row" role="row"><span><a href="#card?id='+encodeURIComponent(a.cardId)+'"><strong>'+esc(a.name)+'</strong></a><small>'+esc(a.club)+' · '+esc(a.season)+(a.lowestActive!=null?' · en vente dès '+money(a.lowestActive)+' FC':'')+'</small></span><span><strong>'+money(a.maxPrice)+' FC</strong></span><span>'+(a.referencePrice?money(a.referencePrice)+' FC':'—')+'</span><span class="market-row-actions"><button class="auction-link" type="button" data-alert-edit="'+esc(a.cardId)+'">MODIFIER</button><button class="auction-link" type="button" data-alert-delete="'+esc(a.cardId)+'">SUPPRIMER</button></span></div>').join('')+'</div>'
        :'<div class="empty">AUCUNE ALERTE DE PRIX.</div>');
      const byId=new Map(alerts.map(a=>[a.cardId,a]));
      section.querySelectorAll('[data-alert-edit]').forEach(b=>b.onclick=async()=>{const a=byId.get(b.dataset.alertEdit);if(await editAlert(a.cardId,a.name,a.maxPrice,a.referencePrice))loadAlerts(section);});
      section.querySelectorAll('[data-alert-delete]').forEach(b=>b.onclick=async()=>{b.disabled=true;if(await removeAlert(b.dataset.alertDelete))loadAlerts(section);else b.disabled=false;});
    }catch(e){section.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
  }

  window.fvMarketTab=tab=>{const s=document.getElementById(tab==='sales'?'auctionSales':'auctionAlerts');if(s)(tab==='sales'?loadSales:loadAlerts)(s);};

  // Bouton « Alerte de prix » d'une enchère (délégué : les cartes sont re-rendues par app.js).
  document.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-price-alert]');if(!b||!api)return;
    ev.preventDefault();
    if(!b.dataset.priceAlert){toast('Carte introuvable.');return;}
    let current=null,reference=null;
    try{const m=await api('/api/market/card?cardId='+encodeURIComponent(b.dataset.priceAlert));current=m.alert?.maxPrice||null;reference=m.reference?.median||null;}catch{}
    editAlert(b.dataset.priceAlert,b.dataset.cardName||'cette carte',current,reference);
  });

  window.mountMarketInsights=function(helpers){
    ({api,toast,auctionDialog}=helpers);loggedIn=!!helpers.loggedIn;
    const panel=document.getElementById('cardMarketPanel');
    if(panel&&panel.dataset.ready!=='1'){panel.dataset.ready='1';loadCardPanel(panel);}
    // Lien d'une notification d'alerte : met l'enchère en évidence.
    if(helpers.focusAuction){const el=document.querySelector('[data-auction-id="'+CSS.escape(helpers.focusAuction)+'"]');if(el&&!el.classList.contains('is-focused')){el.classList.add('is-focused');el.scrollIntoView({block:'center',behavior:'smooth'});}}
  };
})();

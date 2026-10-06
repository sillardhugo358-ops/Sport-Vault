// Administration (page « admin » et ses éditeurs : cartes, packs, pools, compétitions, saisons, clubs, joueurs).
// Chargé après app.js : reçoit ses aides par FVC.core, enregistre la page dans FVC.pages et ses éditeurs dans FVC.admin (utilisés par bind()).
(()=>{
const {$,api,auctionDialog,cardStatDefinitions,closeModal,esc,initials,money,render,setModal,state,toast}=FVC.core;
function adminLogDetails(d){if(!d||typeof d!=='object')return String(d||'—');const labels={resource:'Ressource',amount:'Montant',reason:'Motif',instanceId:'Carte',cardId:'Carte catalogue',fromUserId:'Ancien propriétaire',toUserId:'Nouveau propriétaire',role:'Rôle',previousRole:'Ancien rôle',action:'Action'};return Object.entries(d).map(([k,v])=>(labels[k]||k)+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' · ')||'—'}
function adminUserRow(x){const initials=String(x.name||'U').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase();return `<tr class="admin-user-row" data-user-role="${esc(x.role)}" data-user-coins="${Number(x.availableCoins)||0}" data-user-cards="${Number(x.cardCount)||0}" data-user-sales="${Number(x.activeSales)||0}" data-user-search="${esc((x.name+' '+x.email).toLowerCase())}"><td><button class="admin-user-link" data-admin-user="${esc(x.id)}"><span class="admin-user-avatar">${esc(initials)}</span><span class="admin-user-identity"><strong>${esc(x.name)}</strong><small>${esc(x.email)}</small></span></button></td><td><span class="admin-role ${x.role}">${esc(x.role)}</span></td><td><strong class="admin-user-currency">${money(x.availableCoins)} <small>FC</small></strong></td><td><span class="admin-user-metric">${Number(x.cardCount)||0}</span></td><td><span class="admin-user-metric">${Number(x.activeSales)||0}</span></td><td><span class="admin-user-metric">${Number(x.activeBids)||0}</span></td><td><button class="admin-user-open" data-admin-user="${esc(x.id)}" aria-label="Ouvrir le profil de ${esc(x.name)}">↗</button></td></tr>`}
async function refreshAdminUsers(q=''){
 try{const d=await api('/api/admin/users?q='+encodeURIComponent(q));const body=$('#adminUsersBody');if(body){body.innerHTML=(d.users||[]).map(adminUserRow).join('')||'<tr><td colspan="6">Aucun joueur trouvé.</td></tr>';document.querySelectorAll('[data-admin-user]').forEach(x=>x.onclick=()=>showAdminUser(x.dataset.adminUser));}}catch(e){toast(e.message)}
}
async function showAdminUser(id){
 try{
  const d=await api('/api/admin/users/'+encodeURIComponent(id)),u=d.user,cards=u.cards||[],sales=u.sales||[],bids=u.bids||[],isCreator=state.user?.role==='creator',canManage=state.user&&((state.user.role==='creator')||(state.user.role==='admin'&&u.role==='user'));
  const roleControls=isCreator&&u.role!=='creator'?`<section class="admin-user-section"><p class="eyebrow">HIÉRARCHIE</p><div class="admin-action-buttons"><button class="btn" data-admin-role="user">USER</button><button class="btn btn-gold" data-admin-role="admin">ADMIN</button></div></section>`:'';
  const moderation=canManage?`<div class="admin-moderation"><span class="admin-status">STATUT : <strong>${esc(u.accountStatus||'active')}</strong></span><div class="admin-action-buttons">${u.accountStatus==='banned'?'<button class="btn" data-admin-action="unblock">RÉACTIVER</button>':(u.accountStatus==='blocked'?'<button class="btn" data-admin-action="unblock">DÉBLOQUER</button>':'<button class="btn" data-admin-action="block">BLOQUER 24 H</button><button class="btn btn-danger" data-admin-action="ban">BANNIR</button>')}</div></div>`:''; 
  setModal(`<div class="modal-box admin-user-modal admin-user-drawer" data-admin-user-current="${esc(id)}"><button class="modal-close" data-close aria-label="Fermer">×</button><div class="admin-user-drawer-head"><div class="admin-user-avatar admin-user-avatar-large">${esc(String(u.name||'U').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase())}</div><div><p class="eyebrow">FICHE UTILISATEUR / ADMIN</p><h2>${esc(u.name)}</h2><p class="admin-user-email">${esc(u.email)}</p></div></div>${moderation}<div class="admin-user-summary"><div><span>RÔLE</span><strong>${esc(u.role)}</strong></div><div><span>FC DISPONIBLES</span><strong>${money(u.availableCoins)}</strong></div><div><span>FC RÉSERVÉS</span><strong>${money(u.reservedCoins)}</strong></div><div><span>GEMS</span><strong>${money(u.gems)}</strong></div><div><span>XP</span><strong>${money(u.xp)}</strong></div><div><span>PACKS OUVERTS</span><strong>${u.packsOpened}</strong></div></div>${roleControls}${canManage?`<section class="admin-user-section"><p class="eyebrow">RESSOURCES</p><div class="admin-resource-form"><select id="adminResource"><option value="coins">FOOTCOINS</option><option value="gems">GEMS</option></select><div class="admin-amount-control"><button type="button" class="amount-step" data-resource-step="-100">−</button><input id="adminAmount" type="text" inputmode="numeric" autocomplete="off" value="0" aria-label="Montant en FOOTCOINS ou GEMS"><button type="button" class="amount-step" data-resource-step="100">+</button></div><input id="adminReason" placeholder="Motif (obligatoire)"><button class="btn btn-gold" data-admin-resource>APPLIQUER</button></div></section>`:''}<section class="admin-user-section"><p class="eyebrow">COLLECTION / ${cards.length}</p><div class="admin-mini-list">${cards.slice(0,20).map(c=>`<div><strong>${esc(c.name)}</strong><span>${esc(c.rarity)} · ${c.is_limited?`${Number(c.serial)}/${Number(c.max_supply)}`:'STANDARD'} · ${esc(c.status)} ${canManage?'<button class="mini-action" data-remove-card="'+esc(c.instance_id)+'">RETIRER</button>':''}</span></div>`).join('')||'<small>Aucune carte.</small>'}</div>${canManage?`<div class="admin-card-grant"><input id="adminCardGrantSearch" type="search" placeholder="Rechercher une carte (joueur, club, ID)…" autocomplete="off" aria-label="Rechercher une carte à ajouter"><select id="adminCardSelect" aria-label="Carte à ajouter"><option value="">Tape un nom pour chercher</option></select><button class="btn btn-gold" data-grant-card>AJOUTER LA CARTE</button></div><div class="admin-card-grant"><select id="adminTransferCard"><option value="">Choisir une carte</option>${cards.map(c=>`<option value="${esc(c.instance_id)}">${esc(c.name)} · ${esc(c.rarity)} · ${c.is_limited?`${Number(c.serial)}/${Number(c.max_supply)}`:'STANDARD'}</option>`).join('')}</select><select id="adminTransferTarget"><option value="">Destinataire</option>${state.adminUsers.filter(x=>x.id!==id).map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.role)}</option>`).join('')}</select><button class="btn" data-transfer-card>TRANSFÉRER</button></div>`:''}</section><section class="admin-user-section"><p class="eyebrow">VENTES / ${sales.length}</p><div class="admin-mini-list">${sales.slice(0,10).map(x=>`<div><strong>${esc(x.card_name)}</strong><span>${esc(x.status)} · ${money(x.current_bid)} FC</span></div>`).join('')||'<small>Aucune vente.</small>'}</div></section><section class="admin-user-section"><p class="eyebrow">OFFRES / ${bids.length}</p><div class="admin-mini-list">${bids.slice(0,10).map(x=>`<div><strong>${esc(x.card_name)}</strong><span>${money(x.amount)} FC · ${esc(x.status)}</span></div>`).join('')||'<small>Aucune offre.</small>'}</div></section></div>`);
 }catch(e){toast(e.message)}
}
function rememberAdminView(tab='cards'){
 state.adminReturn={tab};
 if(tab==='cards'){
  state.adminReturn.search=$('#adminCardSearch')?.value||'';
  state.adminReturn.rarity=$('#adminCardRarity')?.value||'';
  state.adminReturn.position=$('#adminCardPosition')?.value||'';
  state.adminReturn.club=$('#adminCardClub')?.value||'';
  state.adminReturn.page=state.adminCardPageNum||1;
 }
}
async function showCatalogCardEditor(card,isNew=false){
 const rarityOptions=['common','rare','epic','legendary','icon'].map(r=>'<option value="'+r+'" '+(card.rarity===r?'selected':'')+'>'+esc(r.toUpperCase())+'</option>').join('');
 const positions=['GK','RB','LB','CB','RWB','LWB','DM','CM','AM','RW','LW','ST'];
 const competitions=(state.adminCompetitions||[]).filter(c=>c.status==='available').sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'));
 const clubsById=new Map((state.adminClubs||[]).map(c=>[String(c.id),c]));
 const findCurrentContext=()=>{
  for(const comp of competitions){
   for(const season of (comp.seasons||[])){
    if(String(season.season)===String(card.season)&&season.clubIds?.some(id=>String(clubsById.get(String(id))?.name||'')===String(card.club)))return{competitionId:comp.id,seasonId:season.id};
   }
  }
  return null;
 };
 const currentContext=isNew?null:findCurrentContext();
 const currentCompetitionId=currentContext?.competitionId||competitions[0]?.id||'';
 const currentCompetition=competitions.find(c=>String(c.id)===String(currentCompetitionId));
 const initialClubId=(()=>{
  const candidates=currentCompetition?.seasons?.filter(s=>s.status==='available'&&String(s.season)===String(card.season)).flatMap(s=>s.clubIds||[])||[];
  return candidates.find(id=>String(clubsById.get(String(id))?.name||'')===String(card.club))||'';
 })();
 const initialSeasonId=currentContext?.seasonId||'';
 const positionOptions=positions.map(p=>'<option value="'+p+'" '+(card.position===p?'selected':'')+'>'+p+'</option>').join('');
 const statFields=cardStatDefinitions(card.position).map(([label,key])=>[label,'catalog'+key.charAt(0).toUpperCase()+key.slice(1),key]);
 const statHtml=statFields.map(([label,id,key])=>'<div class="catalog-stat-editor"><div class="catalog-stat-head"><label for="'+id+'">'+label+'</label><output id="'+id+'Out">'+Number(card[key]||72)+'</output></div><div class="catalog-stat-control"><button type="button" class="stat-step" data-stat-step="-1" data-stat="'+id+'">−</button><input id="'+id+'" type="range" min="1" max="99" value="'+Number(card[key]||72)+'" data-stat-range="'+id+'"><button type="button" class="stat-step" data-stat-step="1" data-stat="'+id+'">+</button></div></div>').join('');
 const competitionOptions=competitions.map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(currentCompetitionId)?'selected':'')+'>'+esc(c.name)+' · '+esc(c.tag)+'</option>').join('');
 setModal('<div class="modal-box admin-user-modal catalog-card-editor"><button class="modal-close" aria-label="Fermer" data-close>×</button><div class="catalog-editor-head"><div><p class="eyebrow">CRÉATEUR / '+(isNew?'NOUVELLE CARTE':'ÉDITION DE CARTE')+'</p><h2>'+(isNew?'AJOUTER UNE CARTE':esc(card.name))+'</h2><p class="catalog-editor-id">'+(isNew?'Création d’une nouvelle carte joueur':esc(card.id)+' · '+esc(card.club))+'</p></div><div class="catalog-ovr-badge"><span>OVR</span><strong id="catalogOvrPreview">'+Number(card.ovr||72)+'</strong></div></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">IDENTITÉ</p><span>Informations du joueur</span></div><div class="admin-card-edit-grid"><label>Nom<input id="catalogName" value="'+esc(card.name)+'"></label>'+'<label>Poste<select id="catalogPosition">'+positionOptions+'</select></label><label>N° de maillot<input id="catalogJerseyNumber" type="number" min="1" max="99" value="'+(card.jerseyNumber??'')+'" placeholder="Ex. 10"></label><label>Compétition<select id="catalogCompetition">'+(competitionOptions||'<option value="">Aucune compétition disponible</option>')+'</select></label><label>Club<select id="catalogClub" '+(currentCompetition?'':'disabled')+'></select></label><label>Saison<select id="catalogSeason" '+(initialClubId?'':'disabled')+'></select></label><label>Nation<input id="catalogNation" value="'+esc(card.nation)+'"></label><label>Rareté<select id="catalogRarity" '+(card.rarityLocked?'':'disabled')+'>'+rarityOptions+'</select></label><label class="catalog-rarity-lock"><input id="catalogRarityLocked" type="checkbox" '+(card.rarityLocked?'checked':'')+'> Carte spéciale : rareté manuelle</label></div><p class="catalog-context-help" id="catalogSeasonHelp">Choisis une compétition, puis un club : seules les saisons dans lesquelles ce club apparaît seront proposées.</p></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">ATTRIBUTS</p><span>Réglez les 6 statistiques du joueur</span></div><div class="catalog-stats-grid">'+statHtml+'</div><div class="catalog-ovr-editor"><div><span class="catalog-ovr-label">OVR GLOBAL</span><small>Évaluation générale de la carte</small></div><div class="catalog-ovr-control"><button type="button" class="stat-step" data-ovr-step="-1">−</button><input id="catalogOvr" type="range" min="1" max="99" value="'+Number(card.ovr||72)+'"><button type="button" class="stat-step" data-ovr-step="1">+</button><output id="catalogOvrValue">'+Number(card.ovr||72)+'</output></div></div></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">ÉDITION</p><span>Distribution de la carte</span></div><div class="admin-card-edit-grid"><label>Type<select id="catalogDistribution" '+((Number(card.totalInstances||0)>0)?'disabled':'')+'><option value="STANDARD" '+(!card.isLimited?'selected':'')+'>STANDARD — illimitée</option><option value="LIMITED" '+(card.isLimited?'selected':'')+'>LIMITED — numérotée</option></select></label><label id="catalogMaxSupplyWrap">Quantité maximale<input id="catalogMaxSupply" type="number" min="'+Math.max(1,Number(card.totalInstances||0))+'" value="'+(card.maxSupply??'')+'"></label></div></div><div class="auction-dialog-actions catalog-editor-actions"><button class="btn btn-ghost" data-close>ANNULER</button>'+(isNew?'':`<button class="btn btn-danger" data-delete-catalog-card="${esc(card.id)}">SUPPRIMER</button>`)+'<button class="btn btn-gold" data-save-catalog-card>'+(isNew?"AJOUTER LA CARTE":"ENREGISTRER")+'</button></div></div>');

 const syncStat=id=>{const range=$('#'+id),out=$('#'+id+'Out');if(!range)return;const v=Math.max(1,Math.min(99,Number(range.value)||1));range.value=v;if(out)out.textContent=v;};
 statFields.forEach(([,id])=>$('#'+id)?.addEventListener('input',()=>syncStat(id))); const positionSelect=$('#catalogPosition'); const syncPositionLabels=()=>{const defs=cardStatDefinitions(positionSelect?.value||'');document.querySelectorAll('.catalog-stat-editor .catalog-stat-head label').forEach((label,i)=>{if(defs[i]){label.textContent=defs[i][0];label.htmlFor=defs[i][1]}})}; positionSelect?.addEventListener('change',syncPositionLabels); syncPositionLabels();
 document.querySelectorAll('[data-stat-step]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.stat,range=$('#'+id);if(range){range.value=Math.max(1,Math.min(99,Number(range.value||1)+Number(btn.dataset.statStep)));syncStat(id)}}));

 const ovr=$('#catalogOvr'),ovrPreview=$('#catalogOvrPreview'),ovrValue=$('#catalogOvrValue');
 const rarityField=$('#catalogRarity'),rarityLock=$('#catalogRarityLocked');
 // Barème officiel (identique à rarity.js côté serveur, qui fait foi).
 const rarityFromOvr=v=>v>=92?'icon':v>=90?'legendary':v>=84?'epic':v>=78?'rare':'common';
 const syncRarity=()=>{if(!rarityField)return;const locked=!!rarityLock?.checked;rarityField.disabled=!locked;if(!locked)rarityField.value=rarityFromOvr(Number(ovr?.value)||1);};
 rarityLock?.addEventListener('change',syncRarity);
 const syncOvr=()=>{const v=Math.max(1,Math.min(99,Number(ovr?.value)||1));if(ovr)ovr.value=v;if(ovrPreview)ovrPreview.textContent=v;if(ovrValue)ovrValue.textContent=v;syncRarity();};
 ovr?.addEventListener('input',syncOvr);
 document.querySelectorAll('[data-ovr-step]').forEach(btn=>btn.addEventListener('click',()=>{if(ovr){ovr.value=Math.max(1,Math.min(99,Number(ovr.value||1)+Number(btn.dataset.ovrStep)));syncOvr()}}));
 syncOvr();

 const competitionSelect=$('#catalogCompetition'),clubSelect=$('#catalogClub'),seasonSelect=$('#catalogSeason'),seasonHelp=$('#catalogSeasonHelp');
 const clubIdsForCompetition=competitionId=>{
  const comp=competitions.find(c=>String(c.id)===String(competitionId));
  return [...new Set((comp?.seasons||[]).filter(s=>s.status==='available').flatMap(s=>s.clubIds||[]).map(String))];
 };
 const renderSeasons=({competitionId,clubId,selectedSeasonId=''})=>{
  const comp=competitions.find(c=>String(c.id)===String(competitionId));
  const seasons=(comp?.seasons||[]).filter(s=>s.status==='available'&&(s.clubIds||[]).some(id=>String(id)===String(clubId)));
  seasonSelect.innerHTML='<option value="">Choisir une saison</option>'+seasons.map(s=>'<option value="'+esc(s.id)+'" '+(String(s.id)===String(selectedSeasonId)?'selected':'')+'>'+esc(s.label||('Saison '+s.season))+' · '+esc(s.season)+'</option>').join('');
  seasonSelect.disabled=!seasons.length;
  if(seasonHelp)seasonHelp.textContent=seasons.length?'Saisons disponibles pour ce club dans la compétition sélectionnée.':'Aucune saison disponible pour ce club dans cette compétition.';
 };
 const renderClubs=({competitionId,selectedClubId=''})=>{
  const ids=clubIdsForCompetition(competitionId);
  clubSelect.innerHTML='<option value="">Choisir un club</option>'+ids.map(id=>{const club=clubsById.get(String(id));return club?'<option value="'+esc(club.id)+'" '+(String(club.id)===String(selectedClubId)?'selected':'')+'>'+esc(club.name)+' · '+esc(club.tag)+'</option>':''}).join('');
  clubSelect.disabled=!ids.length;
  renderSeasons({competitionId,clubId:ids.some(id=>String(id)===String(selectedClubId))?selectedClubId:''});
 };
 competitionSelect?.addEventListener('change',()=>renderClubs({competitionId:competitionSelect.value}));
 clubSelect?.addEventListener('change',()=>renderSeasons({competitionId:competitionSelect.value,clubId:clubSelect.value}));
 renderClubs({competitionId:currentCompetitionId,selectedClubId:initialClubId});
 if(initialSeasonId)renderSeasons({competitionId:currentCompetitionId,clubId:initialClubId,selectedSeasonId:initialSeasonId});

 const limitedToggle=()=>{const limited=$('#catalogDistribution')?.value==='LIMITED';if($('#catalogMaxSupplyWrap'))$('#catalogMaxSupplyWrap').style.display=limited?'flex':'none';};
 $('#catalogDistribution')?.addEventListener('change',limitedToggle);limitedToggle();

 document.querySelector('[data-save-catalog-card]')?.addEventListener('click',async()=>{
  const isLimited=$('#catalogDistribution').value==='LIMITED';
  const competitionId=$('#catalogCompetition').value;
  const seasonId=$('#catalogSeason').value;
  const clubId=$('#catalogClub').value;
  const club=clubsById.get(String(clubId));
  const selectedCompetition=competitions.find(c=>String(c.id)===String(competitionId));
  const selectedSeason=(selectedCompetition?.seasons||[]).find(s=>String(s.id)===String(seasonId));
  if(!competitionId||!clubId||!seasonId||!club||!selectedSeason)return toast('Choisis une compétition, un club et une saison valides.');
  const body={id:isNew?'':card.id,name:$('#catalogName').value,position:$('#catalogPosition').value,jerseyNumber:$('#catalogJerseyNumber').value,ovr:Number($('#catalogOvr').value),pace:Number($('#catalogPace').value),shooting:Number($('#catalogShooting').value),passing:Number($('#catalogPassing').value),dribbling:Number($('#catalogDribbling').value),defending:Number($('#catalogDefending').value),physical:Number($('#catalogPhysical').value),rarity:$('#catalogRarity').value,rarityLocked:!!$('#catalogRarityLocked')?.checked,club:club.name,nation:$('#catalogNation').value,season:selectedSeason.season,competitionId,seasonId,isLimited,maxSupply:isLimited?$('#catalogMaxSupply').value:null};
  try{await api(isNew?'/api/admin/cards/create':'/api/admin/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});rememberAdminView('cards');closeModal();toast(isNew?'Carte ajoutée au catalogue.':'Carte entièrement mise à jour.');render()}catch(e){toast(e.message)}
 });
}
async function showCompetitionEditor(comp){
 if(state.user?.role!=='creator')return;
 const c=comp||{id:'',name:'',tag:'',country:'',description:'',status:'upcoming',seasons:[]};
 const seasons=(c.seasons||[]).map(s=>`<div class="admin-season-row"><div><strong>${esc(s.label||('Saison '+s.season))}</strong><small>${esc(s.season)} · ${s.status==='available'?'DISPONIBLE':'À VENIR'} · ${s.clubCount} clubs</small></div><div><button class="btn" data-edit-season="${esc(s.id)}">Gérer</button><button class="btn btn-danger" data-delete-season="${esc(s.id)}">Supprimer</button></div></div>`).join('')||'<div class="entity-empty-seasons">Aucune saison configurée pour le moment.</div>';
 setModal(`<div class="modal-box admin-entity-editor competition-editor">
  <button class="modal-close" data-close aria-label="Fermer">×</button>
  <div class="entity-editor-top"><div><p class="eyebrow">ADMINISTRATION / STRUCTURE</p><h2>${comp?'Modifier la compétition':'Ajouter une compétition'}</h2><p>Gère les informations principales, la disponibilité et les saisons.</p></div><span class="entity-editor-status">${comp?'ÉDITION':'NOUVELLE'}</span></div>
  <div class="entity-editor-layout">
   <aside class="entity-editor-preview competition-preview"><div class="entity-preview-logo" id="competitionPreviewLogo"><span id="competitionPreviewTag">${esc(c.tag||'COMP')}</span></div><strong id="competitionPreviewName">${esc(c.name||'Nom de la compétition')}</strong><small id="competitionPreviewCountry">${esc(c.country||'PAYS / RÉGION')}</small><div class="entity-preview-meta"><span>STATUT</span><b id="competitionPreviewStatus">${c.status==='available'?'DISPONIBLE':'À VENIR'}</b></div></aside>
   <div class="entity-editor-fields">
    <section class="entity-editor-section"><div class="entity-editor-section-title"><span>01</span><div><h3>Informations générales</h3><p>Les informations visibles dans le catalogue.</p></div></div>
     <label class="entity-field"><span>Nom de la compétition <i>*</i></span><input id="competitionName" placeholder="Ex. Ligue 1" maxlength="80" value="${esc(c.name)}" required></label>
     <div class="entity-field-grid">
      <label class="entity-field"><span>Code / abréviation <i>*</i></span><input id="competitionTag" placeholder="Ex. L1" maxlength="12" value="${esc(c.tag||'')}" required></label>
      <label class="entity-field"><span>Pays / région</span><input id="competitionCountry" placeholder="Ex. France" maxlength="100" value="${esc(c.country||'')}"></label>
     </div>
     <label class="entity-field"><span>Description</span><textarea id="competitionDescription" rows="3" maxlength="500" placeholder="Quelques mots sur cette compétition…">${esc(c.description||'')}</textarea></label>
     <label class="entity-field"><span>Disponibilité</span><select id="competitionStatus"><option value="available" ${c.status==='available'?'selected':''}>Disponible</option><option value="upcoming" ${c.status==='upcoming'?'selected':''}>À venir</option></select></label>
    </section>
   </div>
  </div>
  <section class="entity-editor-section entity-seasons-section"><div class="entity-editor-section-title"><span>02</span><div><h3>Saisons de la compétition</h3><p>Gère les éditions et les clubs associés à chaque saison.</p></div><button class="btn btn-gold" type="button" data-new-season>＋ Nouvelle saison</button></div><div class="admin-season-list">${seasons}</div></section>
  <div class="entity-editor-footer"><span><i>*</i> Champs obligatoires</span><div><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-gold" data-save-competition>Enregistrer la compétition <span>→</span></button></div></div>
 </div>`);
 const nameInput=$('#competitionName'),tagInput=$('#competitionTag'),countryInput=$('#competitionCountry'),statusInput=$('#competitionStatus');
 const refreshPreview=()=>{$('#competitionPreviewName').textContent=nameInput.value.trim()||'Nom de la compétition';$('#competitionPreviewTag').textContent=tagInput.value.trim().toUpperCase()||'COMP';$('#competitionPreviewCountry').textContent=countryInput.value.trim()||'PAYS / RÉGION';$('#competitionPreviewStatus').textContent=statusInput.value==='available'?'DISPONIBLE':'À VENIR';};
 [nameInput,tagInput,countryInput,statusInput].forEach(input=>input.addEventListener('input',refreshPreview));
 const save=document.querySelector('[data-save-competition]');
 save?.addEventListener('click',async()=>{
  const name=nameInput.value.trim(),tag=tagInput.value.trim().toUpperCase(),country=countryInput.value.trim(),description=$('#competitionDescription').value.trim(),status=statusInput.value;
  if(name.length<2)return toast('Le nom de la compétition doit contenir au moins 2 caractères.');
  if(!tag||tag.length>12)return toast('Le code de la compétition est obligatoire (12 caractères maximum).');
  const slug=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,44);
  const id=comp?.id||slug(name);
  try{await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:comp?'update':'create',id,name,tag,country,description,status})});rememberAdminView('competitions');closeModal();toast('Compétition enregistrée.');render()}catch(e){toast(e.message)}
 });
 document.querySelector('[data-new-season]')?.addEventListener('click',e=>{e.preventDefault();showSeasonEditor(null,c.id)});
 document.querySelectorAll('[data-edit-season]').forEach(x=>x.addEventListener('click',e=>{e.preventDefault();const selected=(c.seasons||[]).find(v=>String(v.id)===String(x.dataset.editSeason));if(selected)showSeasonEditor(selected,c.id);else toast('Saison introuvable.')}));
 document.querySelectorAll('[data-delete-season]').forEach(x=>x.addEventListener('click',async e=>{e.preventDefault();const ok=await auctionDialog({title:'SUPPRIMER CETTE SAISON ?',subtitle:'Cette action supprimera cette saison de la compétition. Vérifie que tu souhaites bien continuer.',type:'confirm',confirm:'SUPPRIMER'});if(ok===null)return;try{await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:'season_delete',seasonId:x.dataset.deleteSeason})});rememberAdminView('competitions');closeModal();toast('Saison supprimée.');render()}catch(err){toast(err.message)}}));
}
async function showSeasonEditor(season,competitionId){
 if(state.user?.role!=='creator')return;
 const s=season||{id:'',season:'2026',label:'Saison 2026',status:'upcoming',description:'',clubIds:[]};
 const comp=(state.adminCompetitions||[]).find(x=>String(x.id)===String(competitionId));
 const allowedIds=new Set(comp?.clubIds||[]);
 const clubs=(state.adminClubs||[]).filter(x=>allowedIds.has(String(x.id)));
 const clubOptions=clubs.map(x=>`<label class="collection-card-option"><input type="checkbox" value="${esc(x.id)}" ${(s.clubIds||[]).includes(x.id)?'checked':''}><span><strong>${esc(x.name)}</strong><small>${esc(x.country||'')}</small></span></label>`).join('')||'<div class="empty">Aucun club n’est encore lié à cette compétition.</div>';
 setModal(`<div class="modal-box admin-user-modal">
  <button class="modal-close" aria-label="Fermer" data-close>×</button><p class="eyebrow">CRÉATEUR / SAISON</p><h2>${season?'MODIFIER':'CRÉER'} L’ÉDITION</h2>
  <p class="lead">Les clubs proposés sont uniquement ceux qui sont liés à cette compétition.</p>
  <div class="admin-card-grant collection-meta-form">
   <input id="seasonYear" placeholder="Saison (ex. 2025-2026)" value="${esc(s.season||'')}">
   <select id="seasonStatus"><option value="available" ${s.status==='available'?'selected':''}>DISPONIBLE</option><option value="upcoming" ${s.status==='upcoming'?'selected':''}>À VENIR</option></select>
  </div>
  <p class="eyebrow" style="margin-top:20px">CLUBS DE L’ÉDITION</p><div class="collection-card-picker">${clubOptions}</div>
  <div class="auction-dialog-actions"><button class="btn btn-ghost" data-close>ANNULER</button><button class="btn btn-gold" data-save-season>ENREGISTRER</button></div>
 </div>`);
 document.querySelector('[data-save-season]')?.addEventListener('click',async()=>{
  const year=$('#seasonYear').value.trim(),status=$('#seasonStatus').value,description=season?.description||'',clubIds=[...document.querySelectorAll('.collection-card-picker input:checked')].map(x=>x.value);
  if(!year)return toast('Le nom de la saison est obligatoire.');
  try{
   const result=await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:season?'season_update':'season_create',seasonId:season?.id||'',competitionId,season:year,label:year,seasonStatus:status,seasonDescription:description})});
   const savedId=season?.id||result.seasonId;
   await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:'season_set_clubs',seasonId:savedId,clubIds})});
   rememberAdminView('competitions');closeModal();toast('Saison enregistrée.');render();
  }catch(e){toast(e.message)}
 });
}
async function showClubEditor(club){
 if(state.user?.role!=='creator')return;
 const c=club||{id:'',name:'',competitionIds:[]};
 const competitions=(state.adminCompetitions||[]).filter(x=>x.status==='available');
 const currentCompetitionIds=club?.competitionIds||[];
 const competitionOptions=competitions.map(comp=>`<label class="collection-card-option"><input type="checkbox" value="${esc(comp.id)}" ${currentCompetitionIds.includes(comp.id)?'checked':''}><span><strong>${esc(comp.name)}</strong><small>${esc(comp.country||'Pays non renseigné')}</small></span></label>`).join('')||'<div class="empty">Aucune compétition disponible.</div>';
 setModal(`<div class="modal-box admin-entity-editor club-editor">
  <button class="modal-close" data-close aria-label="Fermer">×</button>
  <div class="entity-editor-top"><div><p class="eyebrow">ADMINISTRATION / CATALOGUE</p><h2>${club?'Modifier le club':'Ajouter un club'}</h2><p>Configure son identité visuelle et ses compétitions de rattachement.</p></div><span class="entity-editor-status">${club?'ÉDITION':'NOUVEAU CLUB'}</span></div>
  <div class="entity-editor-layout">
   <aside class="entity-editor-preview"><div class="entity-preview-logo" id="clubLogoPreview">${c.logo_url||c.logoUrl?`<img src="${esc(c.logo_url||c.logoUrl)}" alt="Aperçu du logo" onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">`:'<span>CLUB</span>'}</div><strong id="clubPreviewName">${esc(c.name||'Nom du club')}</strong><small>APERÇU DE LA FICHE</small><div class="entity-preview-meta"><span>COMPÉTITIONS</span><b id="clubPreviewCount">${currentCompetitionIds.length}</b></div></aside>
   <div class="entity-editor-fields">
    <section class="entity-editor-section"><div class="entity-editor-section-title"><span>01</span><div><h3>Identité du club</h3><p>Nom affiché et logo officiel.</p></div></div>
     <label class="entity-field"><span>Nom du club <i>*</i></span><input id="clubName" placeholder="Ex. Paris Saint-Germain" maxlength="80" value="${esc(c.name)}" required></label>
     <label class="entity-field"><span>URL du logo</span><input id="clubLogoUrl" type="url" inputmode="url" placeholder="https://…/logo.png" value="${esc(c.logo_url||c.logoUrl||'')}"></label>
     <p class="entity-field-help">Lien direct vers une image PNG, SVG ou WebP. Laisse vide pour retirer le logo.</p>
    </section>
    <section class="entity-editor-section"><div class="entity-editor-section-title"><span>02</span><div><h3>Compétitions associées</h3><p>Un club peut être rattaché à plusieurs compétitions.</p></div><b class="entity-selection-count" id="clubSelectionCount">${currentCompetitionIds.length} sélectionnée(s)</b></div>
     <div class="entity-competition-picker" id="clubCompetitionPicker">${competitionOptions}</div>
    </section>
   </div>
  </div>
  <div class="entity-editor-footer"><span><i>*</i> Champs obligatoires</span><div><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-gold" data-save-club>Enregistrer le club <span>→</span></button></div></div>
 </div>`);
 const nameInput=$('#clubName'),logoInput=$('#clubLogoUrl'),picker=$('#clubCompetitionPicker');
 const refreshPreview=()=>{
  $('#clubPreviewName').textContent=nameInput.value.trim()||'Nom du club';
  const count=picker.querySelectorAll('input:checked').length;
  $('#clubPreviewCount').textContent=count;$('#clubSelectionCount').textContent=count+' sélectionnée(s)';
  const url=logoInput.value.trim(),preview=$('#clubLogoPreview');
  preview.innerHTML=url?`<img src="${esc(url)}" alt="Aperçu du logo" onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">`:'<span>CLUB</span>';
  preview.classList.toggle('is-empty',!url);
 };
 nameInput.addEventListener('input',refreshPreview);logoInput.addEventListener('input',refreshPreview);picker.addEventListener('change',refreshPreview);
 document.querySelector('[data-save-club]').onclick=async()=>{
  const name=nameInput.value.trim(),logoUrl=logoInput.value.trim();
  const competitionIds=[...picker.querySelectorAll('input:checked')].map(x=>x.value);
  if(!name)return toast('Le nom du club est obligatoire.');
  if(!competitionIds.length)return toast('Sélectionne au moins une compétition.');
  try{
   await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:club?'club_update':'club_create',id:club?.id||'',clubId:club?.id||'',clubName:name,clubTag:'',clubCountry:'',name,tag:'',country:'',logoUrl,competitionIds})});
   rememberAdminView('competitions');closeModal();toast('Club enregistré.');render();
  }catch(e){toast(e.message)}
 };
}
async function adminAllCards(){if(!state.adminCards)state.adminCards=(await api('/api/admin/cards')).cards||[];return state.adminCards;}
async function admin(){
 const adminReturn=state.adminReturn||null; state.adminReturn=null;
 const [o,u,a,l,com,pk]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users'),api('/api/admin/auctions'),api('/api/admin/logs'),api('/api/admin/competitions'),api('/api/admin/packs')]);
 state.user=o.admin;
 const s=o.overview.stats;
 const users=u.users||[],auctions=a.auctions||[],logs=l.logs||[],competitions=com.competitions||[],clubs=com.clubs||[],packsData=pk.packs||[],poolsData=pk.pools||[];state.adminUsers=users;state.adminCompetitions=competitions;state.adminClubs=clubs;state.adminPacks=packsData;state.adminPools=poolsData;const cardSummary=await api('/api/admin/cards/summary');state.adminCardSummary=cardSummary;state.adminCards=null;state.adminCardPage=[];const cardsByClub=new Map((cardSummary.clubs||[]).map(c=>[String(c.name||"").toLowerCase(),Number(c.cards||0)]));
 const adminAuctionRow=x=>{
  const status=String(x.status||"").toLowerCase(),statusClass=status==="active"?"active":status==="completed"?"completed":status==="cancelled"?"cancelled":"";
  const statusLabel={active:"EN COURS",completed:"TERMINÉE",cancelled:"ANNULÉE"}[status]||String(x.status||"").toUpperCase();
  const endDate=new Date(x.ends_at),createdDate=new Date(x.created_at);
  const endLabel=Number.isNaN(endDate.getTime())?"—":endDate.toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
  const createdLabel=Number.isNaN(createdDate.getTime())?"—":createdDate.toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
  const bidder=x.bidder_name||"Aucun";
  const offer=Number(x.current_bid||0),start=Number(x.starting_bid||0);
  const limited=x.is_limited;
  return `<article class="admin-auction-card">
   <div class="admin-auction-card-visual">
    <div class="admin-auction-mini-card"><div class="admin-auction-mini-rating">${esc(x.rarity||"")}</div><strong>${esc(x.card_name||"Carte")}</strong><span>${limited?`${Number(x.serial||0)}/${Number(x.max_supply||0)}`:"STANDARD"}</span></div>
    <span class="admin-auction-status ${statusClass}">${statusLabel}</span>
   </div>
   <div class="admin-auction-card-body">
    <div class="admin-auction-card-title"><div><p class="eyebrow">ENCHÈRE</p><h3>${esc(x.card_name||"Carte")}</h3></div><strong class="admin-auction-price-big">${money(offer)} <small>FC</small></strong></div>
    <div class="admin-auction-facts">
     <div><span>VENDEUR</span><strong>${esc(x.seller_name||"—")}</strong></div>
     <div><span>MEILLEURE OFFRE</span><strong>${esc(bidder)}</strong></div>
     <div><span>OFFRES</span><strong>${x.bid_count||0}</strong></div>
     <div><span>MISE DE DÉPART</span><strong>${money(start)} FC</strong></div>
    </div>
    <div class="admin-auction-card-foot"><span>CRÉÉE ${createdLabel}</span><span>${status==="active"?"FIN":"FINIE"} · ${endLabel}</span></div>
   </div>
  </article>`;
 };
 return `<div class="page admin-console-page"><section class="view-hero"><div><p class="eyebrow">FOOTVAULT / ADMIN</p><h1>CENTRE DE <span>CONTRÔLE.</span></h1><p class="lead">Supervision de la plateforme, des comptes, de l'économie et des enchères.</p></div><div class="hero-stat"><strong>ADMIN</strong><span>ACCÈS PRIVILÉGIÉ</span></div></section>
 <nav class="admin-tabs" aria-label="Sections administration">
  <p class="admin-nav-label">ADMINISTRATION</p>
  <button class="admin-tab ${!adminReturn||adminReturn?.tab==="dashboard"?"active":""}" data-admin-tab="dashboard"><span>▦</span> Tableau de bord</button>
  <button class="admin-tab" data-admin-tab="players"><span>♙</span> Joueurs</button>
  <button class="admin-tab ${adminReturn?.tab==="competitions"?"active":""}" data-admin-tab="competitions"><span>♜</span> Compétitions & saisons</button>
  <button class="admin-tab ${adminReturn?.tab==="cards"?"active":""}" data-admin-tab="cards"><span>▤</span> Cartes</button>
  <button class="admin-tab ${adminReturn?.tab==="packs"?"active":""}" data-admin-tab="packs"><span>⬡</span> Packs & pools</button>
  <button class="admin-tab" data-admin-tab="auctions"><span>⚒</span> Marché / enchères</button>
  <button class="admin-tab" data-admin-tab="successes"><span>🏆</span> Succès & missions</button>
  <button class="admin-tab" data-admin-tab="logs"><span>▧</span> Journal système</button>
  <a class="admin-back-link" href="#home"><span>↗</span> Retour au site</a>
 </nav>
 <div class="admin-tab-panel ${!adminReturn||adminReturn?.tab==="dashboard"?"active":""}" data-admin-panel="dashboard">
  <section class="admin-dashboard">
   <header class="admin-dashboard-heading"><div><p class="eyebrow">FOOTVAULT / ADMINISTRATION</p><h2>TABLEAU <span>DE BORD.</span></h2><p class="lead">Gérez votre plateforme et suivez son activité en un coup d’œil.</p></div><div class="admin-live-status"><span class="admin-live-dot"></span><div><strong>ESPACE ADMINISTRATEUR</strong><small>Vue d’ensemble de la plateforme</small></div></div></header>
   <div class="admin-highlight-grid">
    <article class="admin-highlight admin-highlight-blue"><div class="admin-highlight-icon">▤</div><div><span>CARTES EN CIRCULATION</span><strong>${Number(s.cards||0).toLocaleString('fr-FR')}</strong><small>Cartes possédées par les joueurs</small></div></article>
    <article class="admin-highlight admin-highlight-green"><div class="admin-highlight-icon">♙</div><div><span>COMPTES JOUEURS</span><strong>${Number(s.users||0).toLocaleString('fr-FR')}</strong><small>Comptes enregistrés</small></div></article>
    <article class="admin-highlight admin-highlight-purple"><div class="admin-highlight-icon">♢</div><div><span>ENCHÈRES ACTIVES</span><strong>${Number(s.activeAuctions||0).toLocaleString('fr-FR')}</strong><small>Enchères en cours</small></div></article>
    <article class="admin-highlight admin-highlight-gold"><div class="admin-highlight-icon">🏆</div><div><span>ENCHÈRES TERMINÉES</span><strong>${Number(s.completedAuctions||0).toLocaleString('fr-FR')}</strong><small>Enchères clôturées</small></div></article>
   </div>
   <section class="admin-stats" id="adminStatsMount" aria-live="polite"></section>
   <div class="admin-dashboard-section-head"><div><p class="eyebrow">PILOTAGE RAPIDE</p><h3>Actions rapides</h3></div><span>Accès direct aux outils</span></div>
   <div class="admin-quick-actions">
    <button type="button" data-admin-tab="players"><span class="admin-quick-icon blue">♙</span><span><strong>Gérer les joueurs</strong><small>Comptes, rôles et activité</small></span><b>→</b></button>
    <button type="button" data-admin-tab="competitions"><span class="admin-quick-icon purple">♜</span><span><strong>Compétitions & saisons</strong><small>Organiser l’album</small></span><b>→</b></button>
    <button type="button" data-admin-tab="cards"><span class="admin-quick-icon cyan">▤</span><span><strong>Catalogue de cartes</strong><small>Ajouter et modifier des cartes</small></span><b>→</b></button>
    <button type="button" data-admin-tab="packs"><span class="admin-quick-icon green">⬡</span><span><strong>Gérer les packs</strong><small>Offres et tirages</small></span><b>→</b></button>
    <button type="button" data-admin-tab="auctions"><span class="admin-quick-icon gold">⚒</span><span><strong>Marché & enchères</strong><small>Suivre les ventes en cours</small></span><b>→</b></button>
    <button type="button" data-admin-tab="logs"><span class="admin-quick-icon slate">▤</span><span><strong>Journal système</strong><small>Consulter les événements</small></span><b>→</b></button>
   </div>
   <div class="admin-dashboard-bottom">
    <section class="admin-economy-panel"><div class="admin-dashboard-section-head"><div><p class="eyebrow">ÉCONOMIE DU JEU</p><h3>Ressources en circulation</h3></div></div><div class="admin-economy-grid"><div><span>FOOTCOINS ÉMIS</span><strong>${money(s.totalCoins)}</strong></div><div><span>FOOTCOINS RÉSERVÉS</span><strong>${money(s.reservedCoins)}</strong></div><div><span>GEMS EN CIRCULATION</span><strong>${money(s.totalGems)}</strong></div><div><span>PACKS OUVERTS</span><strong>${Number(s.packsOpened||0).toLocaleString('fr-FR')}</strong></div></div></section>
    <section class="admin-system-panel"><div class="admin-dashboard-section-head"><div><p class="eyebrow">ÉTAT DE LA PLATEFORME</p><h3>Vue synthétique</h3></div></div><div class="admin-system-row"><span>Catalogue</span><strong>${Number(s.cards||0).toLocaleString('fr-FR')} cartes</strong></div><div class="admin-system-row"><span>Communauté</span><strong>${Number(s.users||0).toLocaleString('fr-FR')} comptes</strong></div><div class="admin-system-row"><span>Marché actif</span><strong>${Number(s.activeAuctions||0).toLocaleString('fr-FR')} enchères</strong></div></section>
   </div>
  </section>
 </div>
 <div class="admin-tab-panel" data-admin-panel="players">
  <section class="admin-users-console admin-section-first">
   <header class="admin-users-heading"><div><p class="eyebrow">ADMINISTRATION / COMPTES</p><h2>GESTION DES <span>UTILISATEURS.</span></h2><p>Supervise les comptes FOOTVAULT, consulte leur activité et gère les accès.</p></div><div class="admin-users-heading-mark">♙</div></header>
   <div class="admin-users-kpis">
    <article class="admin-users-kpi kpi-blue"><span class="admin-users-kpi-icon">♙</span><div><small>COMPTES LISTÉS</small><strong>${users.length}</strong><span>Joueurs chargés</span></div></article>
    <article class="admin-users-kpi kpi-green"><span class="admin-users-kpi-icon">▤</span><div><small>CARTES POSSÉDÉES</small><strong>${users.reduce((n,x)=>n+Number(x.cardCount||0),0).toLocaleString('fr-FR')}</strong><span>Exemplaires en collection</span></div></article>
    <article class="admin-users-kpi kpi-purple"><span class="admin-users-kpi-icon">♢</span><div><small>VENTES ACTIVES</small><strong>${users.reduce((n,x)=>n+Number(x.activeSales||0),0).toLocaleString('fr-FR')}</strong><span>Enchères en cours</span></div></article>
    <article class="admin-users-kpi kpi-gold"><span class="admin-users-kpi-icon">♛</span><div><small>ADMINISTRATEURS</small><strong>${users.filter(x=>['admin','creator'].includes(x.role)).length}</strong><span>Comptes à privilèges</span></div></article>
   </div>
   <div class="admin-users-table-card">
    <div class="admin-users-toolbar"><div><h3>Répertoire des comptes</h3><p>Recherche un compte puis ouvre sa fiche pour consulter ou gérer ses données.</p></div><div class="admin-users-filters"><label class="admin-users-search"><span>⌕</span><input id="adminUserSearch" placeholder="Pseudo ou adresse e-mail…"></label><select id="adminUserRoleFilter" aria-label="Filtrer par rôle"><option value="">Tous les rôles</option><option value="user">Utilisateur</option><option value="admin">Administrateur</option><option value="creator">Créateur</option></select><select id="adminUserSort" aria-label="Trier les utilisateurs"><option value="name">Pseudo A → Z</option><option value="coins">FOOTCOINS ↓</option><option value="cards">Cartes ↓</option><option value="sales">Ventes actives ↓</option></select></div></div>
    <div class="admin-table-wrap"><table class="admin-table admin-users-table"><thead><tr><th>UTILISATEUR</th><th>RÔLE</th><th>FOOTCOINS</th><th>CARTES</th><th>VENTES</th><th>OFFRES</th><th></th></tr></thead><tbody id="adminUsersBody">${users.map(x=>adminUserRow(x)).join('')}</tbody></table></div>
    <footer class="admin-users-table-foot"><span id="adminUserCount">${users.length} compte${users.length>1?'s':''} affiché${users.length>1?'s':''}</span><span>Ouvre une ligne pour afficher la fiche détaillée du compte.</span></footer>
   </div>
  </section>
 </div>
 <div class="admin-tab-panel admin-competition-panel ${adminReturn?.tab==="competitions"?"active":""}" data-admin-panel="competitions">
  <section class="admin-management-section admin-section-first">
   <header class="admin-management-heading"><div class="admin-management-icon trophy">🏆</div><div><p class="eyebrow">ALBUM / STRUCTURE</p><h2>Compétitions</h2><p class="lead">Gérez les compétitions disponibles sur FOOTVAULT.</p></div><div class="admin-management-heading-action">${state.user?.role==="creator"?'<button class="btn btn-gold" data-new-competition>＋ Ajouter une compétition</button>':""}</div></header>
   <div class="admin-management-stats">
    <article class="admin-management-stat stat-blue"><span class="stat-icon">🏆</span><div><strong>${competitions.length}</strong><span>Compétitions</span><small>Au total</small></div></article>
    <article class="admin-management-stat stat-green"><span class="stat-icon">✓</span><div><strong>${competitions.filter(c=>c.status==="available").length}</strong><span>Actives</span><small>Disponibles</small></div></article>
    <article class="admin-management-stat stat-purple"><span class="stat-icon">▱</span><div><strong>${competitions.reduce((n,c)=>n+Number(c.seasonCount||0),0)}</strong><span>Saisons</span><small>Toutes compétitions</small></div></article>
    <article class="admin-management-stat stat-cyan"><span class="stat-icon">▤</span><div><strong>${clubs.length}</strong><span>Clubs</span><small>Dans le catalogue</small></div></article>
   </div>
   <div class="admin-management-table-card">
    <div class="admin-management-table-head"><div><h3>Liste des compétitions</h3><p>Consultez les saisons et les clubs associés.</p></div><div class="admin-management-tools"><label class="admin-search-field"><span>⌕</span><input id="adminCompetitionSearch" type="search" placeholder="Rechercher une compétition…"></label><select id="adminCompetitionStatus" aria-label="Filtrer par statut"><option value="">Statut : tous</option><option value="available">Disponible</option><option value="upcoming">À venir</option></select></div></div>
    <div class="admin-table-wrap"><table class="admin-table admin-management-table"><thead><tr><th>Compétition</th><th>Code</th><th>Type</th><th>Pays / région</th><th>Saisons</th><th>Clubs</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="adminCompetitionsBody">
    ${competitions.map(c=>{const compCards=[...new Set((c.clubIds||[]).map(id=>String(state.adminClubs.find(cl=>String(cl.id)===String(id))?.name||"").toLowerCase()))].reduce((n,name)=>n+(cardsByClub.get(name)||0),0);return `<tr class="admin-competition-row" data-search="${esc([c.name,c.tag,c.country].join(" ").toLowerCase())}" data-status="${esc(c.status||"")}"><td><div class="admin-competition-identity">${c.logo_url?'<img src="'+esc(c.logo_url)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<span class="admin-competition-logo">'+esc((c.tag||c.name||"C").slice(0,3))+'</span>'}<div><strong>${esc(c.name)}</strong><small>${esc(c.description||"Compétition")}</small></div></div></td><td><span class="admin-code-pill">${esc(c.tag||"—")}</span></td><td><span class="admin-type-pill">${/cup|coupe|champions|europa/i.test(c.name)?"Coupe":"Championnat"}</span></td><td>${esc(c.country||"—")}</td><td><strong>${Number(c.seasonCount||0)}</strong></td><td><strong>${(c.clubIds||[]).length||"—"}</strong></td><td><span class="admin-status-dot ${c.status==="available"?"is-active":"is-upcoming"}">${c.status==="available"?"Active":"À venir"}</span></td><td><div class="admin-row-actions"><button class="btn btn-gold" data-edit-competition="${esc(c.id)}">↗ Gérer</button>${state.user?.role==="creator"?'<button class="btn btn-danger" data-delete-competition="'+esc(c.id)+'" aria-label="Supprimer '+esc(c.name)+'">⌫</button>':""}</div></td></tr>`}).join("")||'<tr><td colspan="8"><div class="admin-table-empty">Aucune compétition enregistrée.</div></td></tr>'}
    </tbody></table></div>
    <div class="admin-management-table-foot"><span id="adminCompetitionCount">${competitions.length} compétition${competitions.length>1?"s":""}</span><span>Gestion des éditions et des associations</span></div>
   </div>
  </section>
  <section class="admin-management-section admin-clubs-management">
   <header class="admin-management-heading"><div class="admin-management-icon shield">⬡</div><div><p class="eyebrow">CATALOGUE / ÉQUIPES</p><h2>Clubs</h2><p class="lead">Gérez les clubs et leurs rattachements aux compétitions.</p></div><div class="admin-management-heading-action">${state.user?.role==="creator"?'<button class="btn btn-ghost" data-new-club>＋ Ajouter un club</button>':""}</div></header>
   <div class="admin-management-table-card">
    <div class="admin-management-table-head admin-club-filter-head"><div><h3>Liste des clubs</h3><p>Filtrez par compétition, pays ou statut.</p></div><div class="admin-management-tools admin-club-tools"><select id="adminClubCompetition" aria-label="Filtrer par compétition"><option value="">Toutes les compétitions</option>${competitions.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("")}</select><select id="adminClubCountry" aria-label="Filtrer par pays"><option value="">Tous les pays</option>${[...new Set(clubs.map(c=>c.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr")).map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("")}</select><label class="admin-search-field"><span>⌕</span><input id="adminClubSearch" type="search" placeholder="Rechercher un club…"></label><div class="admin-club-total"><strong>${clubs.length}</strong><span>Clubs au total</span></div></div></div>
    <div class="admin-table-wrap"><table class="admin-table admin-management-table"><thead><tr><th>Club</th><th>Code</th><th>Compétitions</th><th>Pays</th><th>Cartes</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="adminClubsBody">
    ${clubs.map(c=>{const linkedCards=cardsByClub.get(String(c.name||"").toLowerCase())||0;return `<tr class="admin-club-row" data-search="${esc([c.name,c.tag,c.country,(c.competitionNames||[]).join(" ")].join(" ").toLowerCase())}" data-country="${esc(c.country||"")}" data-competitions="${esc((c.competitionIds||[]).join(","))}"><td><div class="admin-club-identity">${c.logo_url?'<img class="club-logo admin-club-logo" src="'+esc(c.logo_url)+'" alt="" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';this.nextElementSibling.classList.remove(\'is-hidden\')"><span class="club-logo-fallback is-hidden">'+esc((c.tag||c.name||"CL").slice(0,3))+'</span>':'<span class="club-logo-fallback">'+esc((c.tag||c.name||"CL").slice(0,3))+'</span>'}<strong>${esc(c.name)}</strong></div></td><td><span class="admin-code-pill">${esc(c.tag||"—")}</span></td><td><small>${esc((c.competitionNames||[]).join(" · ")||"Aucune")}</small></td><td>${esc(c.country||"—")}</td><td><strong>${linkedCards.toLocaleString("fr-FR")}</strong></td><td><span class="admin-status-dot ${(c.competitionIds||[]).length?"is-active":"is-upcoming"}">${(c.competitionIds||[]).length?"Actif":"Non lié"}</span></td><td><div class="admin-row-actions">${state.user?.role==="creator"?'<button class="btn btn-gold" data-edit-club="'+esc(c.id)+'">↗ Gérer</button> <button class="btn btn-danger" data-delete-club="'+esc(c.id)+'" aria-label="Supprimer '+esc(c.name)+'">⌫</button>':"—"}</div></td></tr>`}).join("")||'<tr><td colspan="7"><div class="admin-table-empty">Aucun club enregistré.</div></td></tr>'}
    </tbody></table></div>
    <div class="admin-management-table-foot"><span id="adminClubCount">${clubs.length} club${clubs.length>1?"s":""}</span><span>Les clubs peuvent être liés à plusieurs compétitions.</span></div>
   </div>
  </section>
 </div>
 <div class="admin-tab-panel ${adminReturn?.tab==="cards"?"active":""}" data-admin-panel="cards">
  <section class="section admin-section-first catalog-admin-section">
   <div class="catalog-admin-hero">
    <div class="catalog-admin-hero-copy"><p class="eyebrow">ADMINISTRATION / BASE DE DONNÉES</p><h2>GESTION DES <span>CARTES</span></h2><p>Centralisez le catalogue des joueurs, les éditions limitées et les exemplaires en circulation.</p></div>
    <button class="btn btn-gold catalog-admin-add" data-new-catalog-card><span>＋</span> AJOUTER UNE CARTE</button>
   </div>
   <div class="catalog-admin-kpis">
    <div class="catalog-admin-kpi"><span class="catalog-admin-kpi-icon">▤</span><div><small>CARTES AU CATALOGUE</small><strong>${Number(cardSummary.cards||0).toLocaleString('fr-FR')}</strong><span>Fiches joueurs actives</span></div></div>
    <div class="catalog-admin-kpi limited"><span class="catalog-admin-kpi-icon">✦</span><div><small>ÉDITIONS LIMITÉES</small><strong>${Number(cardSummary.limited||0).toLocaleString('fr-FR')}</strong><span>Cartes à tirage limité</span></div></div>
    <div class="catalog-admin-kpi gold"><span class="catalog-admin-kpi-icon">▣</span><div><small>EXEMPLAIRES ÉMIS</small><strong>${Number(cardSummary.instances||0).toLocaleString('fr-FR')}</strong><span>Cartes distribuées</span></div></div>
    <div class="catalog-admin-kpi violet"><span class="catalog-admin-kpi-icon">♙</span><div><small>DÉTENTEURS CUMULÉS</small><strong>${Number(cardSummary.owners||0).toLocaleString('fr-FR')}</strong><span>Possessions sur le catalogue</span></div></div>
   </div>
   <div class="catalog-admin-list-head"><div><p class="eyebrow">BIBLIOTHÈQUE</p><h3>Catalogue des joueurs</h3><p>Recherchez, filtrez et gérez chaque fiche joueur.</p></div><span class="catalog-admin-live"><i></i> SYNCHRONISÉ</span></div>
   <div class="catalog-filter-bar catalog-admin-filters">
    <div class="catalog-search-box"><span>⌕</span><input id="adminCardSearch" type="search" value="${esc(adminReturn?.search||"")}" placeholder="Rechercher un joueur, club, nation ou ID..." autocomplete="off"><button type="button" id="adminCardSearchClear" class="catalog-filter-clear" aria-label="Effacer">×</button></div>
    <div class="catalog-filter-selects">
     <select id="adminCardRarity"><option value="">Toutes les raretés</option>${["common","rare","epic","legendary","icon"].filter(r=>(cardSummary.rarities||[]).includes(r)).concat((cardSummary.rarities||[]).filter(r=>!["common","rare","epic","legendary","icon"].includes(r))).map(r=>`<option value="${esc(r)}" ${adminReturn?.rarity===r?"selected":""}>${esc(String(r).toUpperCase())}</option>`).join('')}</select>
     <select id="adminCardPosition"><option value="">Tous les postes</option>${(cardSummary.positions||[]).filter(Boolean).sort((a,b)=>{const order=["GK","LB","CB","RB","LWB","RWB","DM","CM","AM","LW","RW","ST"];const ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?999:ia)-(ib<0?999:ib)||String(a).localeCompare(String(b),"fr")}).map(p=>`<option value="${esc(p)}" ${adminReturn?.position===p?"selected":""}>${esc(p)}</option>`).join('')}</select>
     <select id="adminCardClub"><option value="">Tous les clubs</option>${(cardSummary.clubs||[]).map(c=>c.name).filter(Boolean).sort((x,y)=>x.localeCompare(y,'fr')).map(cl=>`<option value="${esc(cl)}" ${adminReturn?.club===cl?"selected":""}>${esc(cl)}</option>`).join('')}</select>
    </div>
    <div class="catalog-filter-footer"><span id="adminCardCount">Chargement…</span><button type="button" id="adminCardReset" class="btn btn-ghost">RÉINITIALISER</button></div>
   </div>
   <div class="catalog-admin-table-wrap"><table class="admin-table catalog-admin-table"><thead><tr><th>CARTE / JOUEUR</th><th>RARETÉ</th><th>ÉDITION</th><th>EXEMPLAIRES</th><th>DÉTENTEURS</th><th>GESTION</th></tr></thead><tbody id="adminCardsBody" aria-live="polite"></tbody></table></div>
   <nav class="admin-card-pager" id="adminCardPager" aria-label="Pages du catalogue" hidden><button type="button" class="btn btn-ghost" data-card-page="prev">← PRÉCÉDENTE</button><span id="adminCardPageInfo"></span><button type="button" class="btn btn-ghost" data-card-page="next">SUIVANTE →</button></nav>
  </section>
 </div> <div class="admin-tab-panel ${adminReturn?.tab==="packs"?"active":""}" data-admin-panel="packs">
  <section class="admin-management-page admin-packs-page">
   <header class="admin-management-hero"><div class="admin-management-title"><p class="eyebrow">FOOTVAULT / ÉCONOMIE DU JEU</p><h2>PACKS <span>&amp; POOLS.</span></h2><p>Configurez les offres, les réserves de cartes et les règles de tirage.</p></div><div class="admin-management-hero-actions"><button class="btn btn-outline" data-new-pool>＋ NOUVEAU POOL</button><button class="btn btn-gold" data-new-pack>＋ CRÉER UN PACK</button></div></header>
   <div class="admin-management-kpis">
    <article class="admin-management-kpi blue"><span class="admin-management-kpi-icon">▣</span><div><small>PACKS AU TOTAL</small><strong>${packsData.length.toLocaleString('fr-FR')}</strong><span>Offres configurées</span></div></article>
    <article class="admin-management-kpi green"><span class="admin-management-kpi-icon">✓</span><div><small>PACKS ACTIFS</small><strong>${packsData.filter(p=>p.active).length.toLocaleString('fr-FR')}</strong><span>Disponibles aux joueurs</span></div></article>
    <article class="admin-management-kpi purple"><span class="admin-management-kpi-icon">▤</span><div><small>POOLS DISPONIBLES</small><strong>${poolsData.length.toLocaleString('fr-FR')}</strong><span>Réserves indépendantes</span></div></article>
    <article class="admin-management-kpi gold"><span class="admin-management-kpi-icon">◈</span><div><small>PRIX DES PACKS</small><strong>${packsData.length?money(packsData.reduce((sum,p)=>sum+Number(p.price||0),0)):"0"} <small>FC cumulés</small></strong><span>Somme des prix affichés</span></div></article>
   </div>
   <section class="admin-management-block">
    <div class="admin-management-block-head"><div><p class="eyebrow">OFFRES DE TIRAGE</p><h3>Vos packs</h3><p>Gérez les prix, les garanties et la disponibilité de chaque offre.</p></div><span class="admin-management-count">${packsData.length} PACK(S)</span></div>
    <div class="admin-management-table-wrap"><table class="admin-table admin-management-table"><thead><tr><th>PACK</th><th>PRIX</th><th>CARTES</th><th>CONDITIONS</th><th>GARANTIE</th><th>STATUT</th><th>ACTIONS</th></tr></thead><tbody>
    ${packsData.map(p=>`<tr><td><div class="admin-management-name"><span class="admin-management-name-icon">▣</span><div><strong>${esc(p.name)}</strong><small>${esc(p.badge||'Pack standard')}</small></div></div></td><td><strong class="admin-management-price">${money(p.price)} <small>FC</small></strong></td><td><span class="admin-management-value">${p.cards}</span></td><td><small>${esc((p.conditions?.rarities||[]).join(', ').toUpperCase()||'Toutes selon catalogue')}</small></td><td><span class="admin-management-pill gold">${esc(String(p.guarantee||'common').toUpperCase())} × ${p.guarantee_count}</span></td><td><span class="admin-management-pill ${p.active?'green':'muted'}"><i></i>${p.active?'ACTIF':'INACTIF'}</span></td><td><div class="admin-management-actions"><button class="btn btn-gold" data-edit-pack="${esc(p.id)}">MODIFIER ↗</button><button class="btn btn-danger" data-delete-pack="${esc(p.id)}" aria-label="Supprimer ${esc(p.name)}">×</button></div></td></tr>`).join('')||'<tr><td colspan="7"><div class="admin-management-empty">Aucun pack configuré. Créez votre première offre.</div></td></tr>'}
    </tbody></table></div>
   </section>
   <section class="admin-management-block">
    <div class="admin-management-block-head"><div><p class="eyebrow">RÉSERVES DE CARTES</p><h3>Pools de tirage</h3><p>Les pools sont indépendants des packs et définissent les cartes disponibles pour les tirages.</p></div><span class="admin-management-count">${poolsData.length} POOL(S)</span></div>
    <div class="admin-management-table-wrap"><table class="admin-table admin-management-table"><thead><tr><th>POOL</th><th>TYPE</th><th>CONFIGURATION</th><th>ACTIONS</th></tr></thead><tbody>
    ${poolsData.map(p=>`<tr><td><div class="admin-management-name"><span class="admin-management-name-icon purple">▤</span><div><strong>${esc(p.name)}</strong><small>Réserve de cartes</small></div></div></td><td><span class="admin-management-pill purple">${esc(String(p.type||'all').toUpperCase())}</span></td><td><span class="admin-management-config">${esc(p.type==='rarity'?(p.config?.rarities||[]).join(', ').toUpperCase():p.type==='club'?(p.config?.club||'Club'):p.type==='season'?(p.config?.season||'Saison'):p.type==='limited'?'Cartes LIMITED':p.type==='manual'?((p.config?.cardIds||[]).length+' cartes sélectionnées'):'Toutes les cartes')}</span></td><td><div class="admin-management-actions"><button class="btn btn-gold" data-edit-pool="${esc(p.id)}">MODIFIER ↗</button><button class="btn btn-danger" data-delete-pool="${esc(p.id)}" aria-label="Supprimer ${esc(p.name)}">×</button></div></td></tr>`).join('')||'<tr><td colspan="4"><div class="admin-management-empty">Aucun pool configuré. Créez une réserve de cartes.</div></td></tr>'}
    </tbody></table></div>
   </section>
  </section>
 </div>
 <div class="admin-tab-panel" data-admin-panel="auctions">
  <section class="admin-management-page admin-market-page">
   <header class="admin-management-hero"><div class="admin-management-title"><p class="eyebrow">FOOTVAULT / ÉCONOMIE &amp; ÉCHANGES</p><h2>MARCHÉ <span>/ ENCHÈRES.</span></h2><p>Surveillez les annonces, les transactions et les enchères actives du marché.</p></div><div class="admin-management-hero-actions"><span class="admin-management-live"><i></i> SURVEILLANCE ACTIVE</span></div></header>
   <div class="admin-management-kpis">
    <article class="admin-management-kpi blue"><span class="admin-management-kpi-icon">⚒</span><div><small>ANNONCES EN COURS</small><strong>${auctions.filter(x=>x.status==="active").length.toLocaleString('fr-FR')}</strong><span>Offres ouvertes</span></div></article>
    <article class="admin-management-kpi green"><span class="admin-management-kpi-icon">✓</span><div><small>ENCHÈRES TERMINÉES</small><strong>${auctions.filter(x=>x.status==="completed").length.toLocaleString('fr-FR')}</strong><span>Clôturées</span></div></article>
    <article class="admin-management-kpi gold"><span class="admin-management-kpi-icon">◈</span><div><small>ANNONCES ANNULÉES</small><strong>${auctions.filter(x=>x.status==="cancelled").length.toLocaleString('fr-FR')}</strong><span>Retirées du marché</span></div></article>
    <article class="admin-management-kpi purple"><span class="admin-management-kpi-icon">◷</span><div><small>ANNONCES CHARGÉES</small><strong>${auctions.length.toLocaleString('fr-FR')}</strong><span>Historique récent</span></div></article>
   </div>
   <section class="admin-management-block admin-market-list">
    <div class="admin-management-block-head"><div><p class="eyebrow">ACTIVITÉ DU MARCHÉ</p><h3>Suivi des enchères</h3><p>Historique des ${auctions.length} dernières enchères enregistrées, avec les offres, les vendeurs et les statuts.</p></div><span class="admin-management-count">${auctions.length} ANNONCE(S)</span></div>
    <div class="admin-auction-grid">${auctions.map(adminAuctionRow).join("")||'<div class="admin-auction-empty"><strong>AUCUNE ENCHÈRE</strong><span>Les activités du marché apparaîtront ici dès qu’une enchère sera créée.</span></div>'}</div>
   </section>
  </section>
 </div>
 <div class="admin-tab-panel" data-admin-panel="successes"><section class="admin-management-page success-admin-page"><header class="admin-management-hero success-admin-hero"><div class="admin-management-title"><p class="eyebrow">FOOTVAULT / CENTRE DE PROGRESSION</p><h2>SUCCÈS <span>& RÉCOMPENSES.</span></h2><p>Configurez les défis, définissez leurs conditions et gérez les récompenses de la communauté.</p></div><div class="success-admin-hero-badge"><span>♛</span><strong>ACHIEVEMENTS</strong><small>CONSOLE ADMIN</small></div></header><div class="success-admin-summary"><article><span>✦</span><div><small>CATALOGUE</small><strong id="adminAchievementTotal">—</strong><em>succès configurés</em></div></article><article><span>✓</span><div><small>ACTIFS</small><strong id="adminAchievementActive">—</strong><em>visibles aux joueurs</em></div></article><article><span>◉</span><div><small>RÉCOMPENSES</small><strong>FC <b>+</b> XP</strong><em>récompenses cumulables</em></div></article></div><section class="admin-management-block success-admin-catalog"><div class="admin-management-block-head"><div><p class="eyebrow">GESTION DES CONTENUS</p><h3>Catalogue des succès</h3><p>Modifiez les critères, ajustez les récompenses ou retirez un défi.</p></div><div class="success-admin-head-actions"><button class="btn btn-outline" type="button" data-refresh-achievements>↻ ACTUALISER</button><button class="btn btn-gold" type="button" data-new-achievement>＋ CRÉER UN SUCCÈS</button></div></div><div class="success-admin-catalog-tools"><label class="success-admin-search"><span>⌕</span><input id="adminAchievementSearch" type="search" placeholder="Nom, numéro (ex. 12), ID ou catégorie…" aria-label="Rechercher dans le catalogue"></label><select id="adminAchievementStatus" aria-label="Filtrer par statut"><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Inactifs</option><option value="pending">À venir</option><option value="secret">Secrets</option><option value="claimed">Déjà récupérés</option><option value="unclaimed">Jamais récupérés</option></select><select id="adminAchievementCategory" aria-label="Filtrer par catégorie"><option value="">Toutes les catégories</option></select><select id="adminAchievementType" aria-label="Filtrer par condition"><option value="">Toutes les conditions</option></select><select id="adminAchievementSort" aria-label="Trier les succès"><option value="code">Tri : numéro</option><option value="name">Tri : nom (A → Z)</option><option value="reward">Tri : récompense FC</option><option value="claims">Tri : récupérations</option><option value="target">Tri : objectif</option></select><button class="btn btn-ghost" type="button" data-reset-achievement-filters>RÉINITIALISER</button><span id="adminAchievementCount" class="admin-management-count">CHARGEMENT…</span></div><div id="adminAchievementList" class="admin-achievement-list">Chargement…</div></section><section class="admin-management-block mission-admin-block"><div class="admin-management-block-head"><div><p class="eyebrow">PARCOURS DU JOUEUR</p><h3>Missions</h3><p>Chaîne de missions débloquées une à une : objectifs, prérequis, récompenses et ordre. <span id="adminMissionCount" class="admin-management-count">CHARGEMENT…</span></p></div><button class="btn btn-gold" type="button" data-new-mission>＋ CRÉER UNE MISSION</button></div><div class="catalog-admin-table-wrap"><table class="admin-table mission-admin-table"><thead><tr><th>ORDRE</th><th>MISSION</th><th>CONDITION</th><th>PRÉREQUIS</th><th>RÉCOMPENSE</th><th>VALIDÉE PAR</th><th>STATUT</th><th>GESTION</th></tr></thead><tbody id="adminMissionBody"><tr><td colspan="8">Chargement…</td></tr></tbody></table></div></section><section class="admin-management-block task-admin-block challenge-admin-block"><div class="admin-management-block-head"><div><p class="eyebrow">ÉVÉNEMENTS</p><h3>Défis thématiques</h3><p>Objectifs à durée limitée (ex. « Semaine Serie A »), liés à un championnat ou à un pack. <span id="adminChallengeCount" class="admin-management-count">CHARGEMENT…</span></p></div><button class="btn btn-gold" type="button" data-new-challenge>＋ CRÉER UN DÉFI</button></div><div class="catalog-admin-table-wrap"><table class="admin-table task-admin-table"><thead><tr><th>DÉFI</th><th>CONDITION</th><th>PÉRIODE</th><th>RÉCOMPENSE</th><th>STATUT</th><th>GESTION</th></tr></thead><tbody id="adminChallengeBody"><tr><td colspan="6">Chargement…</td></tr></tbody></table></div></section><section class="admin-management-block task-admin-block"><div class="admin-management-block-head"><div><p class="eyebrow">OBJECTIFS RÉCURRENTS</p><h3>Missions quotidiennes, hebdomadaires et mensuelles</h3><p>Chaque période, une sélection est tirée parmi les missions actives (3 par jour, 5 par semaine, 5 par mois), la même pour tous les joueurs. Une mission ajoutée entre dans le tirage suivant. <span id="adminTaskCount" class="admin-management-count">CHARGEMENT…</span></p></div><button class="btn btn-gold" type="button" data-new-task>＋ CRÉER UNE MISSION</button></div><div class="task-admin-tabs" role="group" aria-label="Période"><button type="button" data-task-kind="daily" class="active" aria-pressed="true">QUOTIDIENNES</button><button type="button" data-task-kind="weekly" aria-pressed="false">HEBDOMADAIRES</button><button type="button" data-task-kind="monthly" aria-pressed="false">MENSUELLES</button></div><div class="catalog-admin-table-wrap"><table class="admin-table task-admin-table"><thead><tr><th>ORDRE</th><th>TÂCHE</th><th>CONDITION</th><th>RÉCOMPENSE</th><th>RÉCUPÉRÉE</th><th>STATUT</th><th>GESTION</th></tr></thead><tbody id="adminTaskBody"><tr><td colspan="7">Chargement…</td></tr></tbody></table></div></section></section></div><div class="admin-tab-panel" data-admin-panel="logs">
  <section class="admin-management-page admin-logs-page">
   <header class="admin-management-hero"><div class="admin-management-title"><p class="eyebrow">FOOTVAULT / SUPERVISION</p><h2>JOURNAL <span>SYSTÈME.</span></h2><p>Consultez les actions administratives et les événements enregistrés sur la plateforme.</p></div><div class="admin-management-hero-actions"><span class="admin-management-live"><i></i> JOURNAL SYNCHRONISÉ</span></div></header>
   <div class="admin-management-kpis">
    <article class="admin-management-kpi blue"><span class="admin-management-kpi-icon">▤</span><div><small>ÉVÉNEMENTS AFFICHÉS</small><strong>${logs.length.toLocaleString('fr-FR')}</strong><span>Dernières actions chargées</span></div></article>
    <article class="admin-management-kpi green"><span class="admin-management-kpi-icon">✓</span><div><small>ACTIONS ADMIN</small><strong>${logs.filter(x=>/admin|create|update|delete|edit/i.test(String(x.action||''))).length.toLocaleString('fr-FR')}</strong><span>Événements administratifs</span></div></article>
    <article class="admin-management-kpi purple"><span class="admin-management-kpi-icon">◷</span><div><small>UTILISATEURS DISTINCTS</small><strong>${new Set(logs.map(x=>x.admin_name).filter(Boolean)).size.toLocaleString('fr-FR')}</strong><span>Acteurs recensés</span></div></article>
    <article class="admin-management-kpi gold"><span class="admin-management-kpi-icon">◈</span><div><small>CIBLES DISTINCTES</small><strong>${new Set(logs.map(x=>x.target_name).filter(Boolean)).size.toLocaleString('fr-FR')}</strong><span>Éléments concernés</span></div></article>
   </div>
   <section class="admin-management-block">
    <div class="admin-management-block-head"><div><p class="eyebrow">HISTORIQUE DES OPÉRATIONS</p><h3>Activité récente</h3><p>Les ${logs.length} dernières actions disponibles, de la plus récente à la plus ancienne.</p></div><span class="admin-management-count">${logs.length} ÉVÉNEMENT(S)</span></div>
    <div class="admin-management-table-wrap"><table class="admin-table admin-management-table admin-management-log-table"><thead><tr><th>DATE &amp; HEURE</th><th>ADMINISTRATEUR</th><th>CIBLE</th><th>ACTION</th><th>DÉTAILS</th></tr></thead><tbody>
    ${logs.map(x=>`<tr><td><span class="admin-management-date">${new Date(x.created_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</span></td><td><div class="admin-management-name"><span class="admin-management-avatar">${esc(String(x.admin_name||'—').trim().split(/\\s+/).slice(0,2).map(n=>n[0]||'').join('').toUpperCase())}</span><strong>${esc(x.admin_name||'—')}</strong></div></td><td><span class="admin-management-target">${esc(x.target_name||'—')}</span></td><td><span class="admin-management-pill blue">${esc(String(x.action||'ÉVÉNEMENT').replace(/_/g,' ').toUpperCase())}</span></td><td><small class="admin-log-details">${esc(adminLogDetails(x.details))}</small></td></tr>`).join('')||'<tr><td colspan="5"><div class="admin-management-empty">Aucune action enregistrée pour le moment.</div></td></tr>'}
    </tbody></table></div>
   </section>
  </section>
 </div></div>`;
}
async function showPoolEditor(pool=null){
 const p=pool||{id:'',name:'',type:'manual',config:{}};
 const cfg=p.config||{}, selectedCardIds=new Set((cfg.cardIds||[]).map(String));
 let cards;try{cards=await adminAllCards();}catch(e){return toast(e.message);}
 const selectedById=()=>cards.filter(c=>selectedCardIds.has(String(c.id)));
 const rarityCount=r=>selectedById().filter(c=>String(c.rarity)===r).length;
 const total=()=>selectedCardIds.size;
 setModal(`<div class="modal-box pool-editor-modal">
  <button class="modal-close" data-close aria-label="Fermer">×</button>
  <div class="pool-editor-heading"><p class="eyebrow">ADMIN / POOLS</p><h2>${pool?'MODIFIER UN POOL':'CRÉER UN POOL'}</h2><p>Un pool est une boîte de cartes limitée. Chaque carte sélectionnée peut être tirée une seule fois.</p></div>
  <div class="pool-editor-layout">
   <div class="pool-editor-left">
    <section class="pool-editor-card"><h3><span>▤</span> INFORMATIONS GÉNÉRALES</h3>
     <div class="pool-form-grid">
      <label>Nom du pool<input id="poolName" value="${esc(p.name||'')}" placeholder="Ex. Japanese Stars"></label>
      <label>Édition (optionnel)<input id="poolEdition" value="${esc(cfg.edition||'')}" placeholder="Ex. Saison 2026-2027"></label><label>Prix du tirage (FC)<input id="poolPrice" type="number" min="0" value="${Number(p.price??cfg.price??100)}"></label><label>Cartes par tirage<input id="poolCards" type="number" min="1" max="20" value="${Number(p.cards??cfg.cards??1)}"></label>
      <label class="pool-description-field">Description<textarea id="poolDescription" maxlength="250" placeholder="Présente le contenu du pool">${esc(cfg.description||'')}</textarea><small id="poolDescCounter"></small></label>
      <label class="pool-description-field">Image du pool (optionnel)<input id="poolImage" value="${esc(cfg.image||'')}" placeholder="URL de l'image"></label>
     </div>
    </section>
    <section class="pool-editor-card"><h3><span>◆</span> COMPOSITION DU POOL</h3><p class="pool-help">Définissez la répartition souhaitée. Les quantités sont comparées aux cartes sélectionnées.</p>
     <div class="pool-composition-row"><div><b>★</b><span>Spéciales</span></div><input id="poolSpecial" type="number" min="0" value="${Number(cfg.specialCount??3)}"><strong id="poolSpecialPct">0 %</strong><div class="pool-rarity-preview special">★</div></div>
     <div class="pool-composition-row"><div><b>◆</b><span>Rares</span></div><input id="poolRare" type="number" min="0" value="${Number(cfg.rareCount??10)}"><strong id="poolRarePct">0 %</strong><div class="pool-rarity-preview rare">◆</div></div>
     <div class="pool-composition-row"><div><b>●</b><span>Communes</span></div><input id="poolCommon" type="number" min="0" value="${Number(cfg.commonCount??237)}"><strong id="poolCommonPct">0 %</strong><div class="pool-rarity-preview common">●</div></div>
     <div class="pool-composition-total"><span>TOTAL</span><strong id="poolCompositionTotal">250</strong><em>100 %</em></div>
    </section>
    <section class="pool-editor-card"><h3><span>⚙</span> STATUT DU POOL</h3><p class="pool-help">Activez ou désactivez ce pool dans la boutique.</p>
     <label class="pool-switch-row"><input id="poolActive" type="checkbox" ${cfg.active!==false?'checked':''}><span class="pool-switch"></span><span><b>Pool disponible</b><small>Le pool sera visible et utilisable par les joueurs.</small></span></label>
    </section>
   </div>
   <div class="pool-editor-right">
    <section class="pool-editor-card pool-selection-card"><h3><span>▰</span> SÉLECTION DES CARTES</h3><p class="pool-help">Ajoutez les cartes qui feront partie de ce pool. Utilisez la recherche et les filtres pour trouver plus facilement les cartes.</p>
     <div class="pool-search"><span>⌕</span><input id="poolCardSearch" type="search" placeholder="Rechercher un joueur, club, nation ou ID..." autocomplete="off"></div>
     <div class="pool-filters">
      <select id="poolRarityFilter"><option value="">Toutes les raretés</option><option value="common">Commun</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option><option value="icon">Icon</option></select>
      <select id="poolPositionFilter"><option value="">Tous les postes</option></select>
      <select id="poolClubFilter"><option value="">Tous les clubs</option></select>
      <select id="poolNationFilter"><option value="">Toutes les nations</option></select>
     </div>
     <div class="pool-selection-head"><div><span>▣</span><strong id="poolCardCount">0 cartes sélectionnées</strong></div><b id="poolSelectionMax">0 / 250</b></div>
     <div class="pool-progress"><i id="poolProgressBar"></i></div>
     <div id="poolCardResults" class="pool-card-grid"></div>
    </section>
   </div>
  </div>
  <div class="pool-editor-footer"><button class="btn btn-ghost" data-close>ANNULER</button><button class="btn btn-gold" data-save-pool>▣ &nbsp; ${pool?'ENREGISTRER LES MODIFICATIONS':'CRÉER LE POOL'}</button></div>
 </div>`);
 const fillSelect=(id,vals)=>{const el=$(id);if(!el)return;el.innerHTML='<option value="">'+(id==='#poolPositionFilter'?'Tous les postes':id==='#poolClubFilter'?'Tous les clubs':'Toutes les nations')+'</option>'+vals.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('')};
 fillSelect('#poolPositionFilter',[...new Set(cards.map(c=>String(c.position||'')).filter(Boolean))].sort());
 fillSelect('#poolClubFilter',[...new Set(cards.map(c=>String(c.club||'')).filter(Boolean))].sort());
 fillSelect('#poolNationFilter',[...new Set(cards.map(c=>String(c.nation||'')).filter(Boolean))].sort());
 const render=()=>{
  const q=($('#poolCardSearch')?.value||'').trim().toLowerCase(),rar=$('#poolRarityFilter')?.value||'',pos=$('#poolPositionFilter')?.value||'',club=$('#poolClubFilter')?.value||'',nation=$('#poolNationFilter')?.value||'';
  const filtered=cards.filter(c=>{const hay=[c.name,c.club,c.nation,c.position,c.id].join(' ').toLowerCase();return (!q||hay.includes(q))&&(!rar||c.rarity===rar)&&(!pos||c.position===pos)&&(!club||c.club===club)&&(!nation||c.nation===nation)});
  const results=$('#poolCardResults');
  // 200 cartes affichées au plus (le catalogue en compte des dizaines de milliers) : la recherche affine.
  const shown=filtered.length>200?filtered.slice(0,200):filtered;
  if(results)results.innerHTML=(filtered.length>200?'<div class="empty">'+filtered.length.toLocaleString('fr-FR')+' cartes correspondent : les 200 premières sont affichées, affine la recherche ou les filtres.</div>':'')+shown.map(c=>{const id=String(c.id),sel=selectedCardIds.has(id);return `<label class="pool-card-tile ${sel?'is-selected':''}"><input type="checkbox" value="${esc(id)}" data-pool-card ${sel?'checked':''}><span class="pool-check">✓</span><div class="pool-card-tile-info"><strong>${esc(c.name)}</strong><small>${esc(c.position||'—')} · ${esc(c.club||'—')} · ${esc(c.nation||'—')}</small><b>${esc(c.rarityLabel||c.rarity||'')} · OVR ${Number(c.ovr||0)}</b></div></label>`}).join('')||'<div class="empty">Aucune carte ne correspond aux filtres.</div>';
  const n=total(),max=Number($('#poolCompositionTotal')?.textContent||250);$('#poolCardCount').textContent=n+' carte'+(n!==1?'s':'')+' sélectionnée'+(n!==1?'s':'');$('#poolSelectionMax').textContent=n+' / '+max;$('#poolProgressBar').style.width=Math.min(100,max?n/max*100:0)+'%';
  results?.querySelectorAll('[data-pool-card]').forEach(cb=>cb.onchange=()=>{const id=String(cb.value);if(cb.checked)selectedCardIds.add(id);else selectedCardIds.delete(id);render();});
 };
  const updateComposition=()=>{const special=Number($('#poolSpecial').value)||0;const rare=Number($('#poolRare').value)||0;const common=Number($('#poolCommon').value)||0;const sum=special+rare+common;const pct=v=>sum?(v/sum*100).toFixed(1):'0';$('#poolCompositionTotal').textContent=String(sum);$('#poolSpecialPct').textContent=pct(special)+' %';$('#poolRarePct').textContent=pct(rare)+' %';$('#poolCommonPct').textContent=pct(common)+' %';};
 ['#poolSpecial','#poolRare','#poolCommon'].forEach(id=>$(id).oninput=updateComposition);$('#poolDescription').oninput=()=>$('#poolDescCounter').textContent=$('#poolDescription').value.length+'/250';updateComposition();$('#poolDescription').dispatchEvent(new Event('input'));
 ['#poolCardSearch','#poolRarityFilter','#poolPositionFilter','#poolClubFilter','#poolNationFilter'].forEach(id=>$(id).addEventListener('input',render));render();
 document.querySelector('[data-save-pool]').onclick=async()=>{
  const composition={specialCount:Number($('#poolSpecial').value)||0,rareCount:Number($('#poolRare').value)||0,commonCount:Number($('#poolCommon').value)||0};
  const compositionTotal=composition.specialCount+composition.rareCount+composition.commonCount;
  if(!$('#poolName').value.trim())return toast('Le nom du pool est obligatoire.');
  if(!selectedCardIds.size)return toast('Sélectionne au moins une carte pour ce pool.');
  if(compositionTotal!==selectedCardIds.size)return toast('La composition du pool doit correspondre au nombre de cartes sélectionnées.');
  const price=Number($('#poolPrice').value),cardsPerDraw=Number($('#poolCards').value);
  if(!Number.isInteger(price)||price<0)return toast('Le prix du tirage doit être un nombre entier positif ou nul.');
  if(!Number.isInteger(cardsPerDraw)||cardsPerDraw<1||cardsPerDraw>20)return toast('Le nombre de cartes par tirage doit être compris entre 1 et 20.');
  if(compositionTotal!==selectedCardIds.size)return toast('La composition du pool doit correspondre au nombre de cartes sélectionnées.');
  const config={...cfg,cardIds:[...selectedCardIds],edition:$('#poolEdition').value.trim(),description:$('#poolDescription').value.trim(),image:$('#poolImage').value.trim(),...composition,active:$('#poolActive').checked,price,cards:cardsPerDraw};
  try{await api('/api/admin/packs',{method:'POST',body:JSON.stringify({action:pool?'pool_update':'pool_create',id:p.id,name:$('#poolName').value.trim(),type:'manual',config,price,cards:cardsPerDraw,badge:cfg.badge||'POOL',description:$('#poolDescription').value.trim(),active:$('#poolActive').checked})});rememberAdminView('packs');closeModal();toast('Pool enregistré.');render()}catch(e){toast(e.message)}
 };
}
function localInput(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());}
function showPackEditor(pack=null){
 const p=pack||{id:'',name:'',price:100,cards:5,badge:'',description:'',guarantee:'rare',guarantee_count:1,conditions:{},active:true};
 const cfg=p.conditions||{}, arr=v=>Array.isArray(v)?v.map(String):[];
 const selected={competitions:new Set(arr(cfg.competitions)),decades:new Set(arr(cfg.decades)),rarities:new Set(arr(cfg.rarities)),clubs:new Set(arr(cfg.clubs)),seasons:new Set(arr(cfg.seasons)),nations:new Set(arr(cfg.nations)),positions:new Set(arr(cfg.positions))};
 const facets=state.adminCardSummary||{};
 const seasons=[...new Set((facets.seasons||[]).map(String).filter(Boolean))].sort((a,b)=>b.localeCompare(a,'fr',{numeric:true}));
 const clubs=[...new Set((facets.clubs||[]).map(c=>String(c.name||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const nations=[...new Set((facets.nations||[]).map(String).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const positions=[...new Set((facets.positions||[]).map(String).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const multi=(id,values,set)=>'<div class="pack-condition-checks" id="'+id+'">'+values.map(v=>'<label><input type="checkbox" value="'+esc(v)+'" '+(set.has(v)?'checked':'')+'><span>'+esc(v.toUpperCase())+'</span></label>').join('')+'</div>';
 const select=(id,label,values,set,icon,text=v=>v)=>'<label class="pack-select-field"><span>'+icon+' '+label+'</span><select id="'+id+'"><option value="">Tous</option>'+values.map(v=>'<option value="'+esc(v)+'" '+(set.size===1&&set.has(v)?'selected':'')+'>'+esc(text(v))+'</option>').join('')+'</select></label>';
 const competitionList=(state.adminCompetitions||[]).filter(c=>c.status==='available'||selected.competitions.has(String(c.id))),competitionName=id=>competitionList.find(c=>String(c.id)===String(id))?.name||id;
 const decades=[...new Set(seasons.map(s=>{const y=Number(String(s).slice(0,4));return Number.isFinite(y)?String(y-y%10):''}).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
 setModal(`<div class="modal-box pack-editor-modal">
  <button class="modal-close" data-close aria-label="Fermer">×</button>
  <div class="pack-editor-heading"><p class="eyebrow">ADMIN / PACKS</p><h2>${pack?'MODIFIER UN PACK':'CRÉER UN PACK'}</h2></div>
  <div class="pack-editor-layout">
   <div class="pack-editor-left">
    <section class="pack-editor-card"><h3><span>✎</span> INFORMATIONS GÉNÉRALES</h3>
     <div class="pack-form-grid">
      <label>Nom du pack<input id="packName" value="${esc(p.name||'')}" placeholder="Ex. Japanese Stars"></label>
      <label>Prix (FC)<input id="packPrice" type="number" min="0" value="${Number(p.price||0)}"></label>
      <label>Nombre de cartes<input id="packCards" type="number" min="1" max="20" value="${Number(p.cards||1)}"></label>
      <label>Badge (optionnel)<input id="packBadge" value="${esc(p.badge||'')}" placeholder="Haute rareté"></label>
      <label class="pack-description-field">Description<textarea id="packDescription" maxlength="150" placeholder="Description du pack">${esc(p.description||'')}</textarea><small class="pack-counter" id="packDescCounter"></small></label>
     </div>
    </section>
    <section class="pack-editor-card"><h3><span>★</span> GARANTIE DE RARETÉ</h3><p class="pack-help">Définit le type de carte garanti dans ce pack.</p>
     <div class="pack-form-grid two"><label>Rareté minimale garantie<select id="packGuarantee"><option value="common">Common+</option><option value="rare">Rare+</option><option value="epic">Epic+</option><option value="legendary">Legendary+</option><option value="icon">Icon</option></select></label><label>Nombre de cartes garanties<input id="packGuaranteeCount" type="number" min="0" value="${Number(p.guarantee_count||0)}"></label></div>
     <div class="pack-info-note">ⓘ Au moins <b id="packGuaranteeText">1</b> carte <b id="packGuaranteeLabel">Rare</b> ou mieux sera garantie dans ce pack.</div>
    </section>
    <section class="pack-editor-card"><h3><span>⚙</span> DISPONIBILITÉ</h3><p class="pack-help">Active ou désactive l'affichage de ce pack dans la boutique.</p>
     <div class="pack-form-grid two pack-window"><label>Disponible à partir du (optionnel)<input id="packFrom" type="datetime-local" value="${localInput(p.available_from)}"></label><label>Disponible jusqu’au (optionnel)<input id="packUntil" type="datetime-local" value="${localInput(p.available_until)}"></label></div><p class="pack-info-note">ⓘ Pack à durée limitée : visible et ouvrable seulement pendant cette période (heure de ton navigateur). Laisser vide pour un pack permanent.</p>
     <label class="pack-switch-row"><input id="packActive" type="checkbox" ${p.active!==false?'checked':''}><span class="pack-switch"></span><span><b>Pack disponible</b><small>Le pack sera visible et achetable par les joueurs.</small></span></label>
    </section>
   </div>
   <div class="pack-editor-right">
    <section class="pack-editor-card"><h3><span>▣</span> SOURCE DU PACK</h3><p class="pack-help">Choisis une réserve de cartes (pool). Sans pool, les conditions ci-dessous s'appliquent au catalogue.</p><label class="pack-select-field"><span>▤ POOL DE CARTES</span><select id="packPool"><option value="">Catalogue selon conditions</option>${(state.adminPools||[]).map(v=>'<option value="'+esc(v.id)+'" '+(String(p.pool_id||'')===String(v.id)?'selected':'')+'>'+esc(v.name)+'</option>').join('')}</select></label></section><section class="pack-editor-card pack-conditions-card"><h3><span>⌖</span> CONDITIONS DU PACK</h3><p class="pack-help">Le pack tire directement dans le catalogue selon ces conditions. <b>Aucun pool n'est utilisé.</b></p>
     <div class="pack-condition-grid">
      <div class="pack-filter-box"><div class="pack-filter-title">RARETÉS AUTORISÉES</div>${multi('packRarities',['common','rare','epic','legendary','icon'],selected.rarities)}</div>
      <div class="pack-filter-box">${select('packCompetition','COMPÉTITION',competitionList.map(c=>String(c.id)),selected.competitions,'🏆',competitionName)}</div>
      <div class="pack-filter-box">${select('packDecade','DÉCENNIE',decades,selected.decades,'◷',d=>'Années '+d)}</div>
      <div class="pack-filter-box">${select('packPosition','POSTES',positions,selected.positions,'⚽')}</div>
      <div class="pack-filter-box">${select('packClub','CLUBS',clubs,selected.clubs,'◈')}</div>
      <div class="pack-filter-box">${select('packNation','NATIONALITÉS',nations,selected.nations,'⚑')}</div>
      <div class="pack-filter-box">${select('packSeason','SAISONS',seasons,selected.seasons,'▣')}</div>
      <div class="pack-ovr-box"><label>OVR MINIMUM<input id="packMinOvr" type="number" min="0" max="100" value="${cfg.minOvr??''}" placeholder="Aucun"></label><label>OVR MAXIMUM<input id="packMaxOvr" type="number" min="0" max="100" value="${cfg.maxOvr??''}" placeholder="Aucun"></label></div>
     </div>
     <div class="pack-type-box"><div class="pack-filter-title">TYPE DE CARTES</div><label><input id="packLimitedOnly" type="checkbox" ${cfg.limitedOnly?'checked':''}> <span>◆</span> LIMITED uniquement</label><label><input id="packStandardOnly" type="checkbox" ${cfg.standardOnly?'checked':''}> <span>▰</span> STANDARD uniquement</label></div>
    </section>
   </div>
  </div>
  <div class="pack-editor-footer"><button class="btn btn-ghost" data-close>ANNULER</button><button class="btn btn-gold" data-save-pack>▣ &nbsp; ENREGISTRER</button></div>
 </div>`);
 $('#packGuarantee').value=p.guarantee||'common';
 const updateGuarantee=()=>{const names={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};$('#packGuaranteeText').textContent=$('#packGuaranteeCount').value||0;$('#packGuaranteeLabel').textContent=names[$('#packGuarantee').value]||'Rare';$('#packDescCounter').textContent=(($('#packDescription').value||'').length)+'/150';};
 $('#packGuarantee').onchange=updateGuarantee;$('#packGuaranteeCount').oninput=updateGuarantee;$('#packDescription').oninput=updateGuarantee;updateGuarantee();
 document.querySelector('[data-save-pack]').onclick=async()=>{
  const getChecked=id=>[...document.querySelectorAll('#'+id+' input:checked')].map(x=>x.value);
  const one=id=>{const v=$(id)?.value||'';return v?[v]:[]};
  const conditions={competitions:one('#packCompetition'),decades:one('#packDecade'),rarities:getChecked('packRarities'),positions:one('#packPosition'),clubs:one('#packClub'),nations:one('#packNation'),seasons:one('#packSeason'),minOvr:$('#packMinOvr').value===''?null:Number($('#packMinOvr').value),maxOvr:$('#packMaxOvr').value===''?null:Number($('#packMaxOvr').value),limitedOnly:$('#packLimitedOnly').checked,standardOnly:$('#packStandardOnly').checked};
  if(!$('#packName').value.trim())return toast('Le nom du pack est obligatoire.');
  if(conditions.limitedOnly&&conditions.standardOnly)return toast('Un pack ne peut pas être LIMITED et STANDARD uniquement.');
  if($('#packFrom').value&&$('#packUntil').value&&new Date($('#packFrom').value)>=new Date($('#packUntil').value))return toast('La fin de disponibilité doit suivre le début.');
  if(conditions.minOvr!=null&&conditions.maxOvr!=null&&conditions.minOvr>conditions.maxOvr)return toast('L’OVR minimum ne peut pas dépasser l’OVR maximum.');
  try{await api('/api/admin/packs',{method:'POST',body:JSON.stringify({action:pack?'pack_update':'pack_create',id:p.id,name:$('#packName').value.trim(),price:Number($('#packPrice').value),cards:Number($('#packCards').value),badge:$('#packBadge').value.trim(),description:$('#packDescription').value.trim(),poolId:$('#packPool').value||null,conditions,guarantee:$('#packGuarantee').value,guaranteeCount:Number($('#packGuaranteeCount').value),active:$('#packActive').checked,availableFrom:$('#packFrom').value?new Date($('#packFrom').value).toISOString():null,availableUntil:$('#packUntil').value?new Date($('#packUntil').value).toISOString():null})});rememberAdminView('packs');closeModal();toast('Pack enregistré.');render()}catch(e){toast(e.message)}
 };
}
FVC.admin={showAdminUser,showCatalogCardEditor,rememberAdminView,showPackEditor,showPoolEditor,showCompetitionEditor,showClubEditor,refreshAdminUsers};
FVC.pages.admin=admin;
})();

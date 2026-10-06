// Éditeur des sets thématiques (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/sets (lib/card-sets.js), qui valide tout à nouveau ; la récompense dépend de la taille du set (barème serveur).
(()=>{
  const state={sets:[],tiers:[],dailyCap:0,minCards:2,maxCards:100};
  let api,setModal,closeModal,toast,siteConfirmDialog;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('fr-FR');
  const rewardFor=n=>state.tiers.find(t=>t.maxCards===null||n<=t.maxCards)||{name:'—',coins:0,xp:0};

  async function load(body){
    try{const d=await api('/api/admin/sets');Object.assign(state,d);render(body);}
    catch(e){body.innerHTML='<tr><td colspan="5">Impossible de charger les sets : '+esc(e.message)+' <button class="btn btn-outline" type="button" data-sets-retry>RÉESSAYER</button></td></tr>';const b=body.querySelector('[data-sets-retry]');if(b)b.onclick=()=>load(body);}
  }
  function render(body){
    const count=document.getElementById('adminSetCount');
    if(count)count.textContent=state.sets.filter(s=>s.active).length+' actif(s) sur '+state.sets.length+' · plafond '+money(state.dailyCap)+' FC par joueur et par jour';
    const byId=new Map(state.sets.map(s=>[s.id,s]));
    body.innerHTML=state.sets.length?state.sets.map(s=>'<tr class="'+(s.active?'':'is-inactive')+'"><td data-label="SET"><strong>'+esc(s.name)+'</strong><small>'+esc(s.description)+'</small></td>'
      +'<td data-label="CARTES">'+s.cardIds.length+'</td>'
      +'<td data-label="RÉCOMPENSE">+'+money(s.reward.coins)+' FC<small>+'+money(s.reward.xp)+' XP · '+esc(s.reward.tier)+' · '+Number(s.claims||0)+' récupération(s)</small></td>'
      +'<td data-label="STATUT"><span class="mission-status '+(s.active?'on':'off')+'">'+(s.active?'ACTIF':'INACTIF')+'</span></td>'
      +'<td data-label="GESTION"><div class="mission-admin-actions"><button class="btn btn-gold" type="button" data-edit-set="'+esc(s.id)+'">MODIFIER</button><button class="btn btn-outline" type="button" data-toggle-set="'+esc(s.id)+'">'+(s.active?'DÉSACTIVER':'ACTIVER')+'</button></div></td></tr>').join('')
      :'<tr><td colspan="5">Aucun set pour le moment.</td></tr>';
    body.querySelectorAll('[data-edit-set]').forEach(b=>b.onclick=()=>openEditor(byId.get(b.dataset.editSet),body));
    body.querySelectorAll('[data-toggle-set]').forEach(b=>b.onclick=()=>toggle(byId.get(b.dataset.toggleSet),b,body));
  }
  async function toggle(s,button,body){
    if(!s)return;
    if(s.active){const ok=await siteConfirmDialog({title:'DÉSACTIVER CE SET ?',subtitle:'« '+s.name+' » ne sera plus visible par les joueurs. Les récompenses déjà récupérées restent acquises.',confirm:'DÉSACTIVER'});if(ok===null)return;}
    button.disabled=true;
    try{await api('/api/admin/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',id:s.id,active:!s.active})});toast(s.active?'Set désactivé.':'Set activé.');await load(body);}
    catch(e){toast(e.message);button.disabled=false;}
  }
  function openEditor(set,body){
    const isNew=!set;
    const s=set||{name:'',description:'',cardIds:[],cards:[]};
    const chosen=new Map((s.cards||[]).map(c=>[c.id,c]));
    const field=(name,label,input,wide)=>'<label class="'+(wide?'wide':'')+'" data-field="'+name+'">'+label+input+'<span class="field-error" data-error="'+name+'"></span></label>';
    setModal('<div class="modal-box mission-editor-modal set-editor-modal"><button class="modal-close" type="button" data-set-cancel aria-label="Fermer">×</button>'
      +'<p class="eyebrow">ADMIN / SETS</p><h2>'+(isNew?'CRÉER UN SET':'MODIFIER LE SET')+'</h2>'
      +'<form class="mission-editor-form" novalidate onsubmit="return false">'
      +field('name','Nom','<input name="name" maxlength="80" value="'+esc(s.name)+'" placeholder="Ex. GARDIENS LÉGENDAIRES">',true)
      +field('description','Description','<textarea name="description" maxlength="300" rows="2" placeholder="Ce que le joueur doit réunir">'+esc(s.description)+'</textarea>',true)
      +field('search','Ajouter des cartes','<input name="search" type="search" maxlength="80" placeholder="Rechercher un joueur, un club, une saison…" autocomplete="off">',true)
      +'<div class="wide set-editor-results" id="setEditorResults" aria-live="polite"></div>'
      +'<div class="wide" data-field="cardIds"><p class="eyebrow" id="setEditorCount"></p><ul class="set-editor-chosen" id="setEditorChosen"></ul><span class="field-error" data-error="cardIds"></span></div>'
      +'</form><p class="mission-editor-note">La récompense dépend du nombre de cartes : '+state.tiers.map(t=>esc(t.name)+' (≤ '+(t.maxCards===null?'∞':t.maxCards)+') = '+money(t.coins)+' FC').join(', ')+'. Plafond de '+money(state.dailyCap)+' FC de sets par joueur et par jour ; un set déjà récupéré ne redonne jamais de récompense. '+(isNew?'L\'identifiant est généré à partir du nom.':'Identifiant : '+esc(s.id)+'.')+'</p>'
      +'<div class="mission-editor-footer"><button class="btn btn-ghost" type="button" data-set-cancel>ANNULER</button><button class="btn btn-gold" type="button" data-set-save>ENREGISTRER</button></div></div>');
    const modal=document.getElementById('modal'),f=modal.querySelector('form'),save=modal.querySelector('[data-set-save]');
    const results=modal.querySelector('#setEditorResults'),list=modal.querySelector('#setEditorChosen'),counter=modal.querySelector('#setEditorCount');
    const snapshot=()=>JSON.stringify([f.elements.name.value,f.elements.description.value,[...chosen.keys()]]);
    const initial=snapshot();
    const renderChosen=()=>{
      const n=chosen.size,r=rewardFor(n);
      counter.textContent=n+' carte'+(n>1?'s':'')+' · '+(n>=state.minCards?'récompense '+money(r.coins)+' FC + '+money(r.xp)+' XP ('+r.tier+')':'minimum '+state.minCards+' cartes');
      list.innerHTML=[...chosen.values()].map(c=>'<li><span>'+esc(c.name)+' <small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+'</small></span><button class="btn btn-ghost" type="button" data-set-remove="'+esc(c.id)+'" aria-label="Retirer '+esc(c.name)+'">RETIRER</button></li>').join('');
      list.querySelectorAll('[data-set-remove]').forEach(b=>b.onclick=()=>{chosen.delete(b.dataset.setRemove);renderChosen();});
    };
    renderChosen();
    let timer,seq=0;
    const search=async()=>{
      const q=f.elements.search.value.trim();const mine=++seq;
      if(q.length<2){results.innerHTML='';return;}
      results.textContent='Recherche…';
      try{
        const d=await api('/api/admin/cards/page?limit=12&q='+encodeURIComponent(q));
        if(mine!==seq)return;
        results.innerHTML=(d.cards||[]).length?(d.cards||[]).map(c=>'<div class="set-editor-result"><span>'+esc(c.name)+' <small>'+esc(c.club)+' · '+esc(c.season)+' · '+esc(String(c.rarity||'').toUpperCase())+'</small></span><button class="btn btn-outline" type="button" data-set-add="'+esc(c.id)+'" '+(chosen.has(c.id)?'disabled':'')+'>'+(chosen.has(c.id)?'AJOUTÉE':'AJOUTER')+'</button></div>').join('')+(d.total>d.cards.length?'<p class="mission-editor-note">'+d.total+' résultats : précise la recherche.</p>':''):'Aucune carte trouvée.';
        const byId=new Map((d.cards||[]).map(c=>[c.id,c]));
        results.querySelectorAll('[data-set-add]').forEach(b=>b.onclick=()=>{const c=byId.get(b.dataset.setAdd);if(!c||chosen.size>=state.maxCards)return;chosen.set(c.id,{id:c.id,name:c.name,club:c.club,season:c.season,rarity:c.rarity});b.disabled=true;b.textContent='AJOUTÉE';renderChosen();});
      }catch(e){if(mine===seq)results.textContent='Recherche impossible : '+e.message;}
    };
    f.elements.search.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,250);};
    f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');const er=l.querySelector('[data-error]');if(er)er.textContent='';}});
    modal.querySelectorAll('[data-set-cancel]').forEach(b=>b.onclick=async()=>{if(snapshot()!==initial){const ok=await siteConfirmDialog({title:'ABANDONNER LES MODIFICATIONS ?',subtitle:'Les changements non enregistrés seront perdus.',confirm:'ABANDONNER'});if(ok===null)return;}closeModal();});
    const showErrors=errors=>{f.parentElement.querySelectorAll('[data-field]').forEach(l=>{const msg=errors[l.dataset.field]||'';l.classList.toggle('has-error',!!msg);const er=l.querySelector('[data-error]');if(er)er.textContent=msg;});};
    save.onclick=async()=>{
      const e=f.elements,errors={};
      if(e.name.value.trim().length<2)errors.name='Nom : au moins 2 caractères.';
      if(!e.description.value.trim())errors.description='Description obligatoire.';
      if(chosen.size<state.minCards||chosen.size>state.maxCards)errors.cardIds='Un set contient de '+state.minCards+' à '+state.maxCards+' cartes.';
      showErrors(errors);if(Object.keys(errors).length)return;
      const payload={action:isNew?'create':'update',id:isNew?undefined:s.id,name:e.name.value.trim(),description:e.description.value.trim(),cardIds:[...chosen.keys()]};
      save.disabled=true;save.textContent='ENREGISTREMENT…';
      try{await api('/api/admin/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});closeModal();toast(isNew?'Set créé.':'Set enregistré.');await load(body);}
      catch(err){showErrors(err.data?.errors||{});toast(err.message);save.disabled=false;save.textContent='ENREGISTRER';}
    };
  }
  // Appelé par bind() (app.js) après chaque rendu : ne charge qu'une fois par affichage de la console.
  window.mountSetAdmin=function(helpers){
    ({api,setModal,closeModal,toast,siteConfirmDialog}=helpers);
    const body=document.getElementById('adminSetBody');
    if(!body||body.dataset.ready==='1')return;
    body.dataset.ready='1';
    const create=document.querySelector('[data-new-set]');if(create)create.onclick=()=>openEditor(null,body);
    load(body);
  };
})();

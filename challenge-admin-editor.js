// Éditeur des défis thématiques (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/challenges (lib/challenges.js), qui valide tout à nouveau.
(()=>{
  const state={challenges:[],types:{},competitions:[],packs:[]};
  let api,setModal,closeModal,toast,siteConfirmDialog;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=d=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const localInput=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());};
  const status=c=>{const now=Date.now();if(!c.active)return['off','INACTIF'];if(new Date(c.startsAt)>now)return['soon','À VENIR'];if(new Date(c.endsAt)<=now)return['off','TERMINÉ'];return['on','EN COURS'];};

  async function load(body){
    try{const d=await api('/api/admin/challenges');Object.assign(state,d);render(body);}
    catch(e){body.innerHTML='<tr><td colspan="6">Impossible de charger les défis : '+esc(e.message)+' <button class="btn btn-outline" type="button" data-challenges-retry>RÉESSAYER</button></td></tr>';const b=body.querySelector('[data-challenges-retry]');if(b)b.onclick=()=>load(body);}
  }
  function scope(c){if(c.type==='competitionCards')return (state.competitions.find(x=>x.id===c.competitionId)||{}).name||c.competitionId;if(c.type==='packOpens')return (state.packs.find(x=>x.id===c.packId)||{}).name||c.packId;return '';}
  function render(body){
    const count=document.getElementById('adminChallengeCount');
    if(count)count.textContent=state.challenges.filter(c=>status(c)[0]==='on').length+' en cours sur '+state.challenges.length;
    const byId=new Map(state.challenges.map(c=>[c.id,c]));
    body.innerHTML=state.challenges.map(c=>{const [cls,label]=status(c);return '<tr class="'+(c.active?'':'is-inactive')+'"><td data-label="DÉFI"><strong>'+esc(c.title)+'</strong><small>'+esc(c.description)+'</small></td>'
      +'<td data-label="CONDITION">'+esc(state.types[c.type]||c.type)+' : '+Number(c.target)+(scope(c)?'<small>'+esc(scope(c))+'</small>':'')+'</td>'
      +'<td data-label="PÉRIODE">'+esc(fmt(c.startsAt))+'<small>→ '+esc(fmt(c.endsAt))+'</small></td>'
      +'<td data-label="RÉCOMPENSE">+'+Number(c.reward.coins)+' FC<small>+'+Number(c.reward.xp)+' XP · '+Number(c.claims||0)+' réussite(s)</small></td>'
      +'<td data-label="STATUT"><span class="mission-status '+(cls==='on'?'on':'off')+'">'+label+'</span></td>'
      +'<td data-label="GESTION"><div class="mission-admin-actions"><button class="btn btn-gold" type="button" data-edit-challenge="'+esc(c.id)+'">MODIFIER</button><button class="btn btn-outline" type="button" data-toggle-challenge="'+esc(c.id)+'">'+(c.active?'DÉSACTIVER':'ACTIVER')+'</button></div></td></tr>';}).join('')||'<tr><td colspan="6">Aucun défi. Crée le premier !</td></tr>';
    body.querySelectorAll('[data-edit-challenge]').forEach(b=>b.onclick=()=>openEditor(byId.get(b.dataset.editChallenge),body));
    body.querySelectorAll('[data-toggle-challenge]').forEach(b=>b.onclick=()=>toggle(byId.get(b.dataset.toggleChallenge),b,body));
  }
  async function toggle(c,button,body){
    if(!c)return;
    if(c.active){const ok=await siteConfirmDialog({title:'DÉSACTIVER CE DÉFI ?',subtitle:'« '+c.title+' » ne sera plus proposé. Les récompenses déjà récupérées restent acquises.',confirm:'DÉSACTIVER'});if(ok===null)return;}
    button.disabled=true;
    try{await api('/api/admin/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',id:c.id,active:!c.active})});toast(c.active?'Défi désactivé.':'Défi activé.');await load(body);}
    catch(e){toast(e.message);button.disabled=false;}
  }
  function openEditor(challenge,body){
    const isNew=!challenge,now=new Date(),week=new Date(now.getTime()+7*86400000);
    const c=challenge||{title:'',description:'',type:'competitionCards',competitionId:(state.competitions[0]||{}).id||'',packId:'',target:10,reward:{coins:500,xp:50},startsAt:now.toISOString(),endsAt:week.toISOString()};
    const opt=(list,val,label)=>list.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===val?'selected':'')+'>'+esc(label(x))+'</option>').join('');
    const field=(name,label,input,wide)=>'<label class="'+(wide?'wide':'')+'" data-field="'+name+'">'+label+input+'<span class="field-error" data-error="'+name+'"></span></label>';
    setModal('<div class="modal-box mission-editor-modal"><button class="modal-close" type="button" data-challenge-cancel aria-label="Fermer">×</button>'
      +'<p class="eyebrow">ADMIN / DÉFIS</p><h2>'+(isNew?'CRÉER UN DÉFI':'MODIFIER LE DÉFI')+'</h2>'
      +'<form class="mission-editor-form" novalidate>'
      +field('title','Titre','<input name="title" maxlength="100" value="'+esc(c.title)+'" placeholder="Ex. SEMAINE SERIE A">',true)
      +field('description','Description','<textarea name="description" maxlength="300" rows="2" placeholder="Ce que le joueur doit accomplir">'+esc(c.description)+'</textarea>',true)
      +field('type','Condition','<select name="type">'+Object.entries(state.types).map(([k,v])=>'<option value="'+esc(k)+'" '+(k===c.type?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select>')
      +field('target','Objectif','<input name="target" type="number" min="1" step="1" value="'+Number(c.target)+'">')
      +field('competitionId','Championnat','<select name="competitionId">'+opt(state.competitions,c.competitionId,x=>x.name)+'</select>')
      +field('packId','Pack','<select name="packId"><option value="">Choisir un pack</option>'+opt(state.packs,c.packId,x=>x.name+(x.available_until?' (limité)':'')+(x.active?'':' (inactif)'))+'</select>')
      +field('startsAt','Début','<input name="startsAt" type="datetime-local" value="'+localInput(c.startsAt)+'">')
      +field('endsAt','Fin','<input name="endsAt" type="datetime-local" value="'+localInput(c.endsAt)+'">')
      +field('coins','Récompense FC','<input name="coins" type="number" min="0" step="1" value="'+Number(c.reward.coins)+'">')
      +field('xp','Récompense XP','<input name="xp" type="number" min="0" step="1" value="'+Number(c.reward.xp)+'">')
      +'</form><p class="mission-editor-note">Seules comptent les cartes obtenues (ou les packs ouverts) entre le début et la fin, à l\'heure de ton navigateur. '+(isNew?'L\'identifiant est généré à partir du titre.':'Identifiant conservé : <code>'+esc(c.id)+'</code> ; '+Number(c.claims||0)+' joueur(s) l\'ont déjà réussi.')+' Pour un pack éphémère, règle ses dates de disponibilité dans l\'onglet Packs.</p>'
      +'<div class="mission-editor-footer"><button class="btn btn-ghost" type="button" data-challenge-cancel>ANNULER</button><button class="btn btn-gold" type="button" data-challenge-save>ENREGISTRER</button></div></div>');
    const modal=document.getElementById('modal'),f=modal.querySelector('form'),save=modal.querySelector('[data-challenge-save]');
    const sync=()=>{const t=f.elements.type.value;f.querySelector('[data-field="competitionId"]').hidden=t!=='competitionCards';f.querySelector('[data-field="packId"]').hidden=t!=='packOpens';};
    f.elements.type.onchange=sync;sync();
    const initial=JSON.stringify(Object.fromEntries(new FormData(f)));
    f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');l.querySelector('[data-error]').textContent='';}});
    modal.querySelectorAll('[data-challenge-cancel]').forEach(b=>b.onclick=async()=>{if(JSON.stringify(Object.fromEntries(new FormData(f)))!==initial){const ok=await siteConfirmDialog({title:'ABANDONNER LES MODIFICATIONS ?',subtitle:'Les changements non enregistrés seront perdus.',confirm:'ABANDONNER'});if(ok===null)return;}closeModal();});
    const showErrors=errors=>{f.querySelectorAll('[data-field]').forEach(l=>{const msg=errors[l.dataset.field]||'';l.classList.toggle('has-error',!!msg);l.querySelector('[data-error]').textContent=msg;});};
    save.onclick=async()=>{
      const e=f.elements,errors={};
      if(e.title.value.trim().length<2)errors.title='Titre : au moins 2 caractères.';
      if(!e.description.value.trim())errors.description='Description obligatoire.';
      if(!(Number(e.target.value)>=1&&Number.isInteger(Number(e.target.value))))errors.target='Nombre entier d\'au moins 1.';
      if(Number(e.coins.value||0)===0&&Number(e.xp.value||0)===0)errors.coins='Une récompense (FC ou XP) est nécessaire.';
      if(!e.startsAt.value)errors.startsAt='Date de début obligatoire.';
      if(!e.endsAt.value)errors.endsAt='Date de fin obligatoire.';
      else if(e.startsAt.value&&new Date(e.endsAt.value)<=new Date(e.startsAt.value))errors.endsAt='La fin doit suivre le début.';
      if(e.type.value==='packOpens'&&!e.packId.value)errors.packId='Choisis un pack.';
      showErrors(errors);if(Object.keys(errors).length)return;
      const payload={action:isNew?'create':'update',id:isNew?undefined:c.id,title:e.title.value.trim(),description:e.description.value.trim(),type:e.type.value,target:Number(e.target.value),competitionId:e.competitionId.value,packId:e.packId.value,startsAt:new Date(e.startsAt.value).toISOString(),endsAt:new Date(e.endsAt.value).toISOString(),coins:Number(e.coins.value||0),xp:Number(e.xp.value||0)};
      save.disabled=true;save.textContent='ENREGISTREMENT…';
      try{await api('/api/admin/challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});closeModal();toast(isNew?'Défi créé.':'Défi enregistré.');await load(body);}
      catch(err){showErrors(err.data?.errors||{});toast(err.message);save.disabled=false;save.textContent='ENREGISTRER';}
    };
  }
  // Appelé par bind() (app.js) après chaque rendu : ne charge qu'une fois par affichage de la console.
  window.mountChallengeAdmin=function(helpers){
    ({api,setModal,closeModal,toast,siteConfirmDialog}=helpers);
    const body=document.getElementById('adminChallengeBody');
    if(!body||body.dataset.ready==='1')return;
    body.dataset.ready='1';
    const create=document.querySelector('[data-new-challenge]');if(create)create.onclick=()=>openEditor(null,body);
    load(body);
  };
})();

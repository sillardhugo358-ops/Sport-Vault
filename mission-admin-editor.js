// Éditeur de missions (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/missions (lib/missions.js), qui valide tout à nouveau.
(()=>{
  const STYLE_ID='fv-mission-editor-style';
  const CSS=`
    .mission-admin-block .admin-management-block-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
    .mission-admin-table td small{display:block;opacity:.7;margin-top:2px}
    .mission-admin-table .mission-status{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.06em}
    .mission-admin-table .mission-status.on{background:rgba(46,204,113,.15);color:#2ecc71}
    .mission-admin-table .mission-status.off{background:rgba(149,165,166,.18);color:#95a5a6}
    .mission-admin-table tr.is-inactive td{opacity:.6}
    .mission-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
    .mission-editor-modal{max-width:900px;width:100%}
    .mission-editor-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:22px;margin-top:14px}
    .mission-editor-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .mission-editor-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700}
    .mission-editor-form .wide{grid-column:1/-1}
    .mission-editor-form .field-error{color:#ff6b6b;font-weight:600;font-size:12px;min-height:0}
    .mission-editor-form .has-error input,.mission-editor-form .has-error select,.mission-editor-form .has-error textarea{border-color:#ff6b6b}
    .mission-editor-form .checkbox-label{flex-direction:row;align-items:center}
    .mission-editor-preview .eyebrow{margin-bottom:8px}
    .mission-editor-note{font-size:12px;opacity:.75;margin-top:10px}
    .mission-editor-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap}
    @media(max-width:700px){.mission-admin-table tbody tr td:before{content:attr(data-label)!important}}
    @media(max-width:760px){.mission-editor-layout{grid-template-columns:1fr}.mission-editor-form{grid-template-columns:1fr}}
  `;
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};
  const state={missions:[],types:{}};
  let api,setModal,closeModal,toast,siteConfirmDialog;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function load(body){
    try{
      const d=await api('/api/admin/missions');
      state.missions=d.missions||[];state.types=d.types||{};
      render(body);
    }catch(e){body.innerHTML='<tr><td colspan="8">Impossible de charger les missions : '+esc(e.message)+' <button class="btn btn-outline" type="button" data-missions-retry>RÉESSAYER</button></td></tr>';const b=body.querySelector('[data-missions-retry]');if(b)b.onclick=()=>load(body);}
  }

  function render(body){
    const byId=new Map(state.missions.map(m=>[m.id,m]));
    const count=document.getElementById('adminMissionCount');
    if(count)count.textContent=state.missions.filter(m=>m.active).length+' active(s) sur '+state.missions.length;
    body.innerHTML=state.missions.map(m=>{
      const pre=m.prerequisite?byId.get(m.prerequisite):null;
      return '<tr class="'+(m.active?'':'is-inactive')+'"><td data-label="ORDRE">'+String(m.order).padStart(2,'0')+'</td>'
        +'<td data-label="MISSION"><strong>'+esc(m.title)+'</strong><small>'+esc(m.description)+'</small></td>'
        +'<td data-label="CONDITION">'+esc(state.types[m.type]||m.type)+' : '+Number(m.target)+'</td>'
        +'<td data-label="PRÉREQUIS">'+(pre?esc(pre.title)+(pre.active?'':' <small>(inactive : ne bloque plus)</small>'):'—')+'</td>'
        +'<td data-label="RÉCOMPENSE">+'+Number(m.reward.coins)+' FC<small>+'+Number(m.reward.xp)+' XP</small></td>'
        +'<td data-label="VALIDÉE PAR">'+Number(m.claims||0)+'</td>'
        +'<td data-label="STATUT"><span class="mission-status '+(m.active?'on':'off')+'">'+(m.active?'ACTIVE':'INACTIVE')+'</span></td>'
        +'<td data-label="GESTION"><div class="mission-admin-actions"><button class="btn btn-gold" type="button" data-edit-mission="'+esc(m.id)+'">MODIFIER</button>'
        +'<button class="btn btn-outline" type="button" data-toggle-mission="'+esc(m.id)+'">'+(m.active?'DÉSACTIVER':'ACTIVER')+'</button></div></td></tr>';
    }).join('')||'<tr><td colspan="8">Aucune mission.</td></tr>';
    body.querySelectorAll('[data-edit-mission]').forEach(b=>b.onclick=()=>openEditor(byId.get(b.dataset.editMission),body));
    body.querySelectorAll('[data-toggle-mission]').forEach(b=>b.onclick=()=>toggle(byId.get(b.dataset.toggleMission),b,body));
  }

  async function toggle(m,button,body){
    if(!m)return;
    if(m.active){const ok=await siteConfirmDialog({title:'DÉSACTIVER CETTE MISSION ?',subtitle:'« '+m.title+' » ne sera plus proposée aux joueurs. Les récompenses déjà récupérées restent acquises.',confirm:'DÉSACTIVER'});if(ok===null)return;}
    button.disabled=true;
    try{await api('/api/admin/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',id:m.id,active:!m.active})});toast(m.active?'Mission désactivée.':'Mission activée.');await load(body);}
    catch(e){toast(e.message);button.disabled=false;}
  }

  function preview(f){
    const coins=Number(f.coins.value||0),xp=Number(f.xp.value||0),target=Math.max(1,Number(f.target.value||1));
    return '<article class="mission vault-mission"><div class="mission-head"><div><p class="eyebrow">MISSION '+String(Number(f.order.value||0)).padStart(2,'0')+'</p><h3>'+esc(f.title.value||'Titre de la mission')+'</h3></div><b>+'+coins+' FC<br>+'+xp+' XP</b></div><p>'+esc(f.description.value||'Description de la mission.')+'</p><div class="vault-mission-progress"><div class="progress"><i style="width:0%"></i></div><span>0/'+target+'</span></div><button class="btn btn-outline" disabled>EN COURS</button></article>';
  }

  function openEditor(mission,body){
    const isNew=!mission;
    const m=mission||{title:'',description:'',type:'cards',target:1,prerequisite:null,reward:{coins:100,xp:20},order:(Math.max(0,...state.missions.map(x=>Number(x.order)||0))+1),active:true};
    const typeOptions=Object.entries(state.types).map(([k,v])=>'<option value="'+esc(k)+'" '+(k===m.type?'selected':'')+'>'+esc(v)+'</option>').join('');
    const preOptions='<option value="">Aucun (disponible dès le départ)</option>'+state.missions.filter(x=>x.id!==m.id).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===m.prerequisite?'selected':'')+'>'+String(x.order).padStart(2,'0')+' · '+esc(x.title)+(x.active?'':' (inactive)')+'</option>').join('');
    const field=(name,label,input,wide)=>'<label class="'+(wide?'wide':'')+'" data-field="'+name+'">'+label+input+'<span class="field-error" data-error="'+name+'"></span></label>';
    setModal('<div class="modal-box mission-editor-modal"><button class="modal-close" type="button" data-mission-cancel aria-label="Fermer">×</button>'
      +'<p class="eyebrow">ADMIN / MISSIONS</p><h2>'+(isNew?'CRÉER UNE MISSION':'MODIFIER LA MISSION')+'</h2>'
      +'<div class="mission-editor-layout"><form class="mission-editor-form" novalidate>'
      +field('title','Titre','<input name="title" maxlength="100" value="'+esc(m.title)+'" placeholder="Ex. PREMIÈRE COLLECTION">',true)
      +field('description','Description','<textarea name="description" maxlength="300" rows="2" placeholder="Ce que le joueur doit accomplir">'+esc(m.description)+'</textarea>',true)
      +field('type','Condition','<select name="type">'+typeOptions+'</select>')
      +field('target','Objectif','<input name="target" type="number" min="1" step="1" value="'+Number(m.target)+'">')
      +field('prerequisite','Prérequis','<select name="prerequisite">'+preOptions+'</select>',true)
      +field('coins','Récompense FC','<input name="coins" type="number" min="0" step="1" value="'+Number(m.reward.coins)+'">')
      +field('xp','Récompense XP','<input name="xp" type="number" min="0" step="1" value="'+Number(m.reward.xp)+'">')
      +field('order','Ordre d\'affichage','<input name="order" type="number" min="0" step="1" value="'+Number(m.order)+'">')
      +(isNew?'<label class="checkbox-label"><input name="active" type="checkbox" checked> Mission active</label>':'<span></span>')
      +'</form><div class="mission-editor-preview"><p class="eyebrow">APERÇU JOUEUR</p><div data-mission-preview></div>'
      +'<p class="mission-editor-note">'+(isNew?'L\'identifiant est généré à partir du titre.':'Identifiant conservé : <code>'+esc(m.id)+'</code>. '+Number(m.claims||0)+' joueur(s) l\'ont déjà validée ; leurs récompenses restent acquises.')+'</p></div></div>'
      +'<div class="mission-editor-footer"><button class="btn btn-ghost" type="button" data-mission-cancel>ANNULER</button><button class="btn btn-gold" type="button" data-mission-save>ENREGISTRER</button></div></div>');
    const modal=document.getElementById('modal'),f=modal.querySelector('form'),save=modal.querySelector('[data-mission-save]');
    const snapshot=()=>JSON.stringify(Object.fromEntries(new FormData(f)));const initial=snapshot();
    const refresh=()=>{modal.querySelector('[data-mission-preview]').innerHTML=preview(f.elements);};
    f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');l.querySelector('[data-error]').textContent='';}refresh();});refresh();
    modal.querySelectorAll('[data-mission-cancel]').forEach(b=>b.onclick=async()=>{
      if(snapshot()!==initial){const ok=await siteConfirmDialog({title:'ABANDONNER LES MODIFICATIONS ?',subtitle:'Les changements non enregistrés seront perdus.',confirm:'ABANDONNER'});if(ok===null)return;}
      closeModal();
    });
    const showErrors=errors=>{f.querySelectorAll('[data-field]').forEach(l=>{const msg=errors[l.dataset.field]||'';l.classList.toggle('has-error',!!msg);l.querySelector('[data-error]').textContent=msg;});};
    save.onclick=async()=>{
      const e=f.elements,errors={};
      if(e.title.value.trim().length<2)errors.title='Titre : au moins 2 caractères.';
      if(!e.description.value.trim())errors.description='Description obligatoire.';
      if(!(Number(e.target.value)>=1&&Number.isInteger(Number(e.target.value))))errors.target='Nombre entier d\'au moins 1.';
      if(Number(e.coins.value||0)===0&&Number(e.xp.value||0)===0)errors.coins='Une récompense (FC ou XP) est nécessaire.';
      showErrors(errors);if(Object.keys(errors).length)return;
      const payload={action:isNew?'create':'update',id:isNew?undefined:m.id,title:e.title.value.trim(),description:e.description.value.trim(),type:e.type.value,target:Number(e.target.value),prerequisite:e.prerequisite.value,coins:Number(e.coins.value||0),xp:Number(e.xp.value||0),order:Number(e.order.value||0),active:isNew?e.active.checked:undefined};
      save.disabled=true;save.textContent='ENREGISTREMENT…';
      try{
        await api('/api/admin/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        closeModal();toast(isNew?'Mission créée.':'Mission enregistrée.');await load(body);
      }catch(err){showErrors(err.data?.errors||{});toast(err.message);save.disabled=false;save.textContent='ENREGISTRER';}
    };
  }

  // Appelé par bind() (app.js) après chaque rendu : ne charge qu'une fois par affichage de la console.
  window.mountMissionAdmin=function(helpers){
    ({api,setModal,closeModal,toast,siteConfirmDialog}=helpers);
    const body=document.getElementById('adminMissionBody');
    if(!body||body.dataset.ready==='1')return;
    body.dataset.ready='1';style();
    const create=document.querySelector('[data-new-mission]');if(create)create.onclick=()=>openEditor(null,body);
    load(body);
  };
})();

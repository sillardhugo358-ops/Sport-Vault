// Éditeur des tâches quotidiennes et hebdomadaires (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/tasks (lib/tasks.js), qui valide tout à nouveau.
(()=>{
  const STYLE_ID='fv-task-editor-style';
  const CSS=`
    .task-admin-block{margin-top:22px}
    .task-admin-block .admin-management-block-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
    .task-admin-tabs{display:flex;gap:6px;margin:4px 0 12px;flex-wrap:wrap}
    .task-admin-tabs button{padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);font-weight:800;font-size:12px;cursor:pointer}
    .task-admin-tabs button.active{background:var(--gold);border-color:var(--gold);color:#111}
    .task-admin-table td small{display:block;opacity:.7;margin-top:2px}
    .task-admin-table .mission-status{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.06em}
    .task-admin-table .mission-status.on{background:rgba(46,204,113,.15);color:#2ecc71}
    .task-admin-table .mission-status.off{background:rgba(149,165,166,.18);color:#95a5a6}
    .task-admin-table tr.is-inactive td{opacity:.6}
    @media(max-width:700px){.task-admin-table tbody tr td:before{content:attr(data-label)!important}}
  `;
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};
  const state={tasks:[],types:{},kinds:{daily:'Quotidienne',weekly:'Hebdomadaire',monthly:'Mensuelle'},kind:'daily'};
  let api,setModal,closeModal,toast,siteConfirmDialog;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periodWord=k=>({weekly:'cette semaine',monthly:'ce mois-ci'})[k]||'aujourd’hui';
  const LABEL={daily:'QUOTIDIENNE',weekly:'HEBDOMADAIRE',monthly:'MENSUELLE'},PLURAL={daily:'QUOTIDIENNES',weekly:'HEBDOMADAIRES',monthly:'MENSUELLES'};
  const RESET={daily:'Remise à zéro chaque jour à minuit (heure de Paris).',weekly:'Remise à zéro chaque lundi à minuit (heure de Paris).',monthly:'Remise à zéro le 1er de chaque mois à minuit (heure de Paris).'};

  async function load(body){
    try{
      const d=await api('/api/admin/tasks');
      state.tasks=d.tasks||[];state.types=d.types||{};state.kinds=d.kinds||state.kinds;
      render(body);
    }catch(e){body.innerHTML='<tr><td colspan="7">Impossible de charger les tâches : '+esc(e.message)+' <button class="btn btn-outline" type="button" data-tasks-retry>RÉESSAYER</button></td></tr>';const b=body.querySelector('[data-tasks-retry]');if(b)b.onclick=()=>load(body);}
  }

  function render(body){
    const list=state.tasks.filter(t=>t.kind===state.kind);
    const count=document.getElementById('adminTaskCount');
    if(count)count.textContent=list.filter(t=>t.active).length+' active(s) sur '+list.length;
    document.querySelectorAll('[data-task-kind]').forEach(b=>{const on=b.dataset.taskKind===state.kind;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
    body.innerHTML=list.map(t=>'<tr class="'+(t.active?'':'is-inactive')+'"><td data-label="ORDRE">'+String(t.order).padStart(2,'0')+'</td>'
      +'<td data-label="TÂCHE"><strong>'+(t.code!=null?'n° '+String(t.code).padStart(2,'0')+' · ':'')+esc(t.title)+'</strong><small>'+esc(t.description)+'</small></td>'
      +'<td data-label="CONDITION">'+esc(state.types[t.type]||t.type)+' : '+Number(t.target)+'</td>'
      +'<td data-label="RÉCOMPENSE">+'+Number(t.reward.coins)+' FC<small>+'+Number(t.reward.xp)+' XP</small></td>'
      +'<td data-label="RÉCUPÉRÉE">'+Number(t.claims||0)+' fois</td>'
      +'<td data-label="STATUT"><span class="mission-status '+(t.active?'on':'off')+'">'+(t.type==='pending'?'À VENIR':t.active?'ACTIVE':'INACTIVE')+'</span></td>'
      +'<td data-label="GESTION"><div class="mission-admin-actions"><button class="btn btn-gold" type="button" data-edit-task="'+esc(t.id)+'">MODIFIER</button>'
      +'<button class="btn btn-outline" type="button" data-toggle-task="'+esc(t.id)+'">'+(t.active?'DÉSACTIVER':'ACTIVER')+'</button></div></td></tr>').join('')||'<tr><td colspan="7">Aucune tâche.</td></tr>';
    const byId=new Map(list.map(t=>[t.id,t]));
    body.querySelectorAll('[data-edit-task]').forEach(b=>b.onclick=()=>openEditor(byId.get(b.dataset.editTask),body));
    body.querySelectorAll('[data-toggle-task]').forEach(b=>b.onclick=()=>toggle(byId.get(b.dataset.toggleTask),b,body));
  }

  async function toggle(t,button,body){
    if(!t)return;
    if(t.active){const ok=await siteConfirmDialog({title:'DÉSACTIVER CETTE TÂCHE ?',subtitle:'« '+t.title+' » ne sera plus proposée aux joueurs. Les récompenses déjà récupérées restent acquises.',confirm:'DÉSACTIVER'});if(ok===null)return;}
    button.disabled=true;
    try{await api('/api/admin/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',kind:t.kind,id:t.id,active:!t.active})});toast(t.active?'Tâche désactivée.':'Tâche activée.');await load(body);}
    catch(e){toast(e.message);button.disabled=false;}
  }

  function preview(f,kind){
    const coins=Number(f.coins.value||0),xp=Number(f.xp.value||0),target=Math.max(1,Number(f.target.value||1));
    return '<article class="mission vault-mission"><div class="mission-head"><div><p class="eyebrow">'+'MISSION '+LABEL[kind]+'</p><h3>'+esc(f.title.value||'Titre de la tâche')+'</h3></div><b>+'+coins+' FC<br>+'+xp+' XP</b></div><p>'+esc(f.description.value||'Ce que le joueur doit accomplir '+periodWord(kind)+'.')+'</p><div class="vault-mission-progress"><div class="progress"><i style="width:0%"></i></div><span>0/'+target+'</span></div><button class="btn btn-outline" disabled>EN COURS</button></article>';
  }

  function openEditor(task,body){
    const isNew=!task,kind=task?task.kind:state.kind;
    const sameKind=state.tasks.filter(x=>x.kind===kind);
    const t=task||{title:'',description:'',type:'packsOpened',target:1,reward:{coins:100,xp:10},order:(Math.max(-1,...sameKind.map(x=>Number(x.order)||0))+1),active:true};
    const typeOptions=Object.entries(state.types).filter(([k])=>k!=='pending'||k===t.type).map(([k,v])=>'<option value="'+esc(k)+'" '+(k===t.type?'selected':'')+'>'+esc(v)+'</option>').join('');
    const field=(name,label,input,wide)=>'<label class="'+(wide?'wide':'')+'" data-field="'+name+'">'+label+input+'<span class="field-error" data-error="'+name+'"></span></label>';
    const kindLabel=LABEL[kind];
    setModal('<div class="modal-box mission-editor-modal"><button class="modal-close" type="button" data-task-cancel aria-label="Fermer">×</button>'
      +'<p class="eyebrow">ADMIN / MISSIONS '+PLURAL[kind]+'</p><h2>'+(isNew?'CRÉER UNE MISSION '+kindLabel:'MODIFIER LA TÂCHE')+'</h2>'
      +'<div class="mission-editor-layout"><form class="mission-editor-form" novalidate>'
      +field('title','Titre','<input name="title" maxlength="100" value="'+esc(t.title)+'" placeholder="Ex. OUVERTURE DU JOUR">',true)
      +field('description','Description','<textarea name="description" maxlength="300" rows="2" placeholder="Ce que le joueur doit accomplir '+periodWord(kind)+'">'+esc(t.description)+'</textarea>',true)
      +field('type','Condition','<select name="type">'+typeOptions+'</select>')
      +field('target','Objectif','<input name="target" type="number" min="1" step="1" value="'+Number(t.target)+'">')
      +field('coins','Récompense FC','<input name="coins" type="number" min="0" step="1" value="'+Number(t.reward.coins)+'">')
      +field('xp','Récompense XP','<input name="xp" type="number" min="0" step="1" value="'+Number(t.reward.xp)+'">')
      +field('order','Ordre d\'affichage','<input name="order" type="number" min="0" step="1" value="'+Number(t.order)+'">')
      +(isNew?'<label class="checkbox-label"><input name="active" type="checkbox" checked> Tâche active</label>':'<span></span>')
      +'</form><div class="mission-editor-preview"><p class="eyebrow">APERÇU JOUEUR</p><div data-task-preview></div>'
      +'<p class="mission-editor-note">'+RESET[kind]+' Une nouvelle mission entre dans le tirage de la période suivante.'+' '+(isNew?'L\'identifiant est généré à partir du titre.':'Identifiant conservé : <code>'+esc(t.id)+'</code>. Une modification s\'applique tout de suite, y compris à la période en cours ; un joueur qui l\'a déjà récupérée ne peut pas la récupérer à nouveau.')+'</p></div></div>'
      +'<div class="mission-editor-footer"><button class="btn btn-ghost" type="button" data-task-cancel>ANNULER</button><button class="btn btn-gold" type="button" data-task-save>ENREGISTRER</button></div></div>');
    const modal=document.getElementById('modal'),f=modal.querySelector('form'),save=modal.querySelector('[data-task-save]');
    const snapshot=()=>JSON.stringify(Object.fromEntries(new FormData(f)));const initial=snapshot();
    const refresh=()=>{modal.querySelector('[data-task-preview]').innerHTML=preview(f.elements,kind);};
    f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');l.querySelector('[data-error]').textContent='';}refresh();});refresh();
    modal.querySelectorAll('[data-task-cancel]').forEach(b=>b.onclick=async()=>{
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
      const payload={action:isNew?'create':'update',kind,id:isNew?undefined:t.id,title:e.title.value.trim(),description:e.description.value.trim(),type:e.type.value,target:Number(e.target.value),coins:Number(e.coins.value||0),xp:Number(e.xp.value||0),order:Number(e.order.value||0),active:isNew?e.active.checked:undefined};
      save.disabled=true;save.textContent='ENREGISTREMENT…';
      try{
        await api('/api/admin/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        closeModal();toast(isNew?'Tâche créée.':'Tâche enregistrée.');await load(body);
      }catch(err){showErrors(err.data?.errors||{});toast(err.message);save.disabled=false;save.textContent='ENREGISTRER';}
    };
  }

  // Appelé par bind() (app.js) après chaque rendu : ne charge qu'une fois par affichage de la console.
  window.mountTaskAdmin=function(helpers){
    ({api,setModal,closeModal,toast,siteConfirmDialog}=helpers);
    const body=document.getElementById('adminTaskBody');
    if(!body||body.dataset.ready==='1')return;
    body.dataset.ready='1';style();
    document.querySelectorAll('[data-task-kind]').forEach(b=>b.onclick=()=>{state.kind=b.dataset.taskKind;render(body);});
    const create=document.querySelector('[data-new-task]');if(create)create.onclick=()=>openEditor(null,body);
    load(body);
  };
})();

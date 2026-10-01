// Éditeur de succès (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/achievements (lib/achievements.js), qui valide tout à nouveau.
(()=>{
  const STYLE_ID='fv-achievement-editor-style';
  const CSS=`
    .success-admin-head-actions{display:flex;gap:10px;flex-wrap:wrap}
    .success-admin-catalog-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .success-admin-catalog-tools select{min-height:40px;flex:1 1 170px;max-width:240px;min-width:0}
    .success-admin-catalog-tools .success-admin-search{flex:2 1 260px;min-width:220px;max-width:none}
    @media(max-width:760px){.success-admin-catalog-tools select,.success-admin-catalog-tools .success-admin-search{flex:1 1 100%;max-width:none}}
    .achievement-editor-modal{max-width:900px;width:100%}
    .achievement-editor-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:22px;margin-top:14px}
    .achievement-editor-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .achievement-editor-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700}
    .achievement-editor-form .wide{grid-column:1/-1}
    .achievement-editor-form label{min-width:0}
    .achievement-editor-form input:not([type=checkbox]),.achievement-editor-form select,.achievement-editor-form textarea{width:100%;min-width:0;max-width:100%;box-sizing:border-box}
    .achievement-editor-layout>*{min-width:0}
    .achievement-editor-form .field-error{color:#ff6b6b;font-weight:600;font-size:12px}
    .achievement-editor-form .has-error input,.achievement-editor-form .has-error select,.achievement-editor-form .has-error textarea{border-color:#ff6b6b}
    .achievement-editor-form .checkbox-label{flex-direction:row;align-items:center}
    .achievement-editor-note{font-size:12px;opacity:.75;margin-top:10px}
    .achievement-editor-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap}
    .achievement-preview-states{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}
    .achievement-preview-states button{padding:6px 10px;border-radius:999px;border:1px solid rgba(121,151,190,.3);background:transparent;color:inherit;font-size:11px;font-weight:800;cursor:pointer}
    .achievement-preview-states button.active{background:var(--gold,#efcf7c);border-color:var(--gold,#efcf7c);color:#08111f}
    .achievement-preview-box .success-card{margin:0;max-width:360px}
    .achievement-preview-facts{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:4px;font-size:12px;opacity:.85}
    .achievement-more{display:flex;justify-content:center;padding:6px 0 4px}
    @media(max-width:760px){.achievement-editor-layout{grid-template-columns:1fr}.achievement-editor-form{grid-template-columns:1fr}}
  `;
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fr=n=>Number(n||0).toLocaleString('fr-FR');
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const state={items:[],types:{},limit:40};
  // Filtres gardés pendant la session (rechargement de la console compris).
  const FILTERS=['adminAchievementSearch','adminAchievementStatus','adminAchievementCategory','adminAchievementType','adminAchievementSort'];
  const KEY='fv-admin-achievement-filters';
  const saveFilters=()=>{try{sessionStorage.setItem(KEY,JSON.stringify(Object.fromEntries(FILTERS.map(id=>[id,document.getElementById(id)?.value||'']))))}catch{}};
  const savedFilters=()=>{try{return JSON.parse(sessionStorage.getItem(KEY)||'{}')||{}}catch{return{}}};
  let api,setModal,closeModal,toast,siteConfirmDialog;

  async function load(box){
    try{const d=await api('/api/admin/achievements');state.items=d.achievements||[];state.types=d.types||{};fillFilters();restoreFilters();render(box);}
    catch(e){box.innerHTML='<div class="success-admin-empty"><strong>Impossible de charger les succès</strong><p>'+esc(e.message)+'</p><button class="btn btn-outline" type="button" data-achievements-retry>RÉESSAYER</button></div>';const b=box.querySelector('[data-achievements-retry]');if(b)b.onclick=()=>load(box);}
  }

  // Listes des filtres : catégories existantes et conditions connues (valeur choisie conservée).
  function fillFilters(){
    const fill=(id,values)=>{const el=document.getElementById(id);if(!el)return;const cur=el.value,first=el.options[0].outerHTML;el.innerHTML=first+values.map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('');el.value=values.some(([v])=>v===cur)?cur:'';};
    const count=key=>{const m=new Map();for(const x of state.items)m.set(x[key],(m.get(x[key])||0)+1);return m;};
    const cats=count('category'),types=count('type');
    fill('adminAchievementCategory',[...cats.keys()].sort((a,b)=>a.localeCompare(b,'fr')).map(c=>[c,c+' ('+cats.get(c)+')']));
    fill('adminAchievementType',Object.entries(state.types).filter(([k])=>types.has(k)).map(([k,v])=>[k,v+' ('+types.get(k)+')']));
  }
  function restoreFilters(){const saved=savedFilters();for(const id of FILTERS){const el=document.getElementById(id);if(el&&saved[id]!=null&&[...(el.options||[{value:saved[id]}])].some(o=>o.value===saved[id]))el.value=saved[id];}}

  function render(box){
    const total=document.getElementById('adminAchievementTotal'),active=document.getElementById('adminAchievementActive'),count=document.getElementById('adminAchievementCount');
    if(total)total.textContent=fr(state.items.length);
    if(active)active.textContent=fr(state.items.filter(x=>x.active).length);
    const q=norm(document.getElementById('adminAchievementSearch')?.value||'').trim(),qNum=(q.match(/^(?:n[°o]?\s*)?0*(\d{1,3})$/)||[])[1];
    const st=document.getElementById('adminAchievementStatus')?.value||'',cat=document.getElementById('adminAchievementCategory')?.value||'',type=document.getElementById('adminAchievementType')?.value||'',sort=document.getElementById('adminAchievementSort')?.value||'code';
    const statusOk=x=>!st||(st==='pending'?x.type==='pending':st==='secret'?Boolean(x.hidden):st==='claimed'?x.claims>0:st==='unclaimed'?!x.claims:(st==='active')===Boolean(x.active));
    const searchOk=x=>!q||(qNum?Number(x.code)===Number(qNum):norm(x.name+' '+x.id+' '+x.category+' '+x.description).includes(q));
    const byCode=(a,b)=>(a.code??1e9)-(b.code??1e9)||a.name.localeCompare(b.name,'fr');
    const sorters={code:byCode,name:(a,b)=>a.name.localeCompare(b.name,'fr'),reward:(a,b)=>Number(b.coins)-Number(a.coins)||byCode(a,b),claims:(a,b)=>Number(b.claims)-Number(a.claims)||byCode(a,b),target:(a,b)=>Number(a.target)-Number(b.target)||byCode(a,b)};
    const matched=state.items.filter(x=>searchOk(x)&&statusOk(x)&&(!cat||x.category===cat)&&(!type||x.type===type)).sort(sorters[sort]||byCode);
    const shown=matched.slice(0,state.limit);
    if(count)count.textContent=matched.length+' / '+state.items.length+' SUCCÈS';
    box.innerHTML=shown.map(x=>'<article class="admin-achievement-row '+(x.active?'is-active':'is-inactive')+'"><div class="admin-achievement-emblem">'+esc(x.icon||'✦')+'</div><div class="admin-achievement-content"><div class="admin-achievement-heading"><strong>'+esc(x.name)+'</strong><span class="admin-achievement-state '+(x.active?'active':'inactive')+'"><i></i>'+(x.active?'ACTIF':'INACTIF')+'</span></div><small class="admin-achievement-meta">'+(x.code?'N° '+String(x.code).padStart(3,'0')+' <b>·</b> ':'')+esc(x.id)+' <b>·</b> '+esc(x.category)+(x.hidden?' <b>·</b> SECRET':'')+(x.type==='pending'?' <b>·</b> À VENIR (mesure non disponible)':'')+'</small><p>'+esc(x.description)+'</p><div class="admin-achievement-chips"><span>◈ '+esc(state.types[x.type]||x.type)+' : <b>'+fr(x.target)+'</b></span><span>◉ <b>'+fr(x.coins)+' FC</b></span><span>✦ <b>'+fr(x.xp)+' XP</b></span><span>♙ <b>'+fr(x.claims)+'</b> récompensé(s)</span></div></div><div class="admin-achievement-actions"><button class="btn btn-outline" type="button" data-preview-achievement="'+esc(x.id)+'">👁 APERÇU</button><button class="btn btn-outline" type="button" data-edit-achievement="'+esc(x.id)+'">✎ MODIFIER</button><button class="btn btn-outline" type="button" data-toggle-achievement="'+esc(x.id)+'">'+(x.active?'DÉSACTIVER':'ACTIVER')+'</button><button class="btn btn-danger" type="button" data-delete-achievement="'+esc(x.id)+'">⌫ SUPPRIMER</button></div></article>').join('')+(matched.length>shown.length?'<div class="achievement-more"><button class="btn btn-outline" type="button" data-more-achievements>AFFICHER PLUS ('+(matched.length-shown.length)+' RESTANTS)</button></div>':'')
      ||'<div class="success-admin-empty"><span>✦</span><strong>'+(state.items.length?'Aucun succès ne correspond aux filtres':'Aucun succès configuré')+'</strong><p>'+(state.items.length?'Modifiez la recherche ou les filtres.':'Créez le premier défi avec « Créer un succès ».')+'</p></div>';
    const byId=new Map(state.items.map(x=>[x.id,x]));
    box.querySelectorAll('[data-preview-achievement]').forEach(b=>b.onclick=()=>openPreview(byId.get(b.dataset.previewAchievement)));
    const more=box.querySelector('[data-more-achievements]');if(more)more.onclick=()=>{state.limit+=40;render(box);};
    box.querySelectorAll('[data-edit-achievement]').forEach(b=>b.onclick=()=>openEditor(byId.get(b.dataset.editAchievement),box));
    box.querySelectorAll('[data-toggle-achievement]').forEach(b=>b.onclick=()=>act(byId.get(b.dataset.toggleAchievement),'toggle',b,box));
    box.querySelectorAll('[data-delete-achievement]').forEach(b=>b.onclick=()=>act(byId.get(b.dataset.deleteAchievement),'delete',b,box));
  }

  async function act(x,action,button,box){
    if(!x)return;
    if(action==='delete'){const ok=await siteConfirmDialog({title:'SUPPRIMER CE SUCCÈS ?',subtitle:'« '+x.name+' » sera définitivement retiré. '+(x.claims?fr(x.claims)+' joueur(s) l\'ont déjà récupéré : leurs récompenses restent acquises. Pour le masquer sans le perdre, préférez « Désactiver ».':'Aucun joueur ne l\'a encore récupéré.'),confirm:'SUPPRIMER'});if(ok===null)return;}
    if(action==='toggle'&&x.active){const ok=await siteConfirmDialog({title:'DÉSACTIVER CE SUCCÈS ?',subtitle:'« '+x.name+' » ne sera plus visible par les joueurs. Vous pourrez le réactiver.',confirm:'DÉSACTIVER'});if(ok===null)return;}
    button.disabled=true;
    try{await api('/api/admin/achievements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:x.id,active:!x.active})});toast(action==='delete'?'Succès supprimé.':x.active?'Succès désactivé.':'Succès activé.');await load(box);}
    catch(e){toast(e.message);button.disabled=false;}
  }

  // Aperçu : la vraie carte de la page Succès (window.fvSuccessCard, app.js) dans l'état choisi.
  const PREVIEW_STATES=[['progress','EN COURS'],['ready','À RÉCUPÉRER'],['claimed','RÉCUPÉRÉ'],['secret','VU AVANT RÉUSSITE']];
  let previewState='progress';
  function previewCard(x,mode){
    const target=Math.max(1,Number(x.target)||1),secret=mode==='secret'&&x.hidden;
    const card={code:x.code,icon:x.icon||'✦',category:x.category||'Catégorie',hidden:!!x.hidden,coins:Number(x.coins)||0,xp:Number(x.xp)||0,target,
      name:secret&&x.name==='???'?'???':(x.name||'Nom du succès'),
      description:secret?'Succès secret : la condition se dévoile quand tu le réussis.':(x.description||'Description du défi.'),
      type:secret?'secret':x.type,progress:mode==='progress'?Math.floor(target*0.4):target,completed:mode==='ready'||mode==='claimed',claimed:mode==='claimed'};
    const html=window.fvSuccessCard?window.fvSuccessCard(card):'<article class="success-card"><h3>'+esc(card.name)+'</h3><p>'+esc(card.description)+'</p></article>';
    return html.replace(/data-claim-achievement="[^"]*"/g,'disabled');
  }
  function previewHtml(x){
    const states=PREVIEW_STATES.filter(([k])=>k!=='secret'||x.hidden);
    if(!states.some(([k])=>k===previewState))previewState='progress';
    return '<div class="achievement-preview-states" role="group" aria-label="État affiché">'+states.map(([k,l])=>'<button type="button" data-preview-state="'+k+'" class="'+(k===previewState?'active':'')+'" aria-pressed="'+(k===previewState)+'">'+l+'</button>').join('')+'</div>'
      +'<div class="achievement-preview-box">'+previewCard(x,previewState)+'</div>'
      +'<ul class="achievement-preview-facts"><li>Condition : <b>'+esc(state.types[x.type]||x.type)+'</b> · objectif <b>'+fr(x.target)+'</b></li>'
      +(x.id?'<li>Récupéré par <b>'+fr(x.claims)+'</b> joueur(s)</li>':'')+(x.type==='pending'?'<li>Mesure non disponible : ce succès ne peut pas être activé.</li>':'')+'</ul>';
  }
  const bindStates=(root,draw)=>root.querySelectorAll('[data-preview-state]').forEach(b=>b.onclick=()=>{previewState=b.dataset.previewState;draw();});
  // Aperçu en lecture seule depuis la liste.
  function openPreview(x){
    if(!x)return;
    setModal('<div class="modal-box achievement-editor-modal"><button class="modal-close" type="button" data-preview-close aria-label="Fermer">×</button><p class="eyebrow">ADMIN / SUCCÈS / APERÇU JOUEUR</p><h2>'+esc(x.name)+'</h2><div data-preview-root></div><div class="achievement-editor-footer"><button class="btn btn-ghost" type="button" data-preview-close>FERMER</button></div></div>');
    const modal=document.getElementById('modal'),root=modal.querySelector('[data-preview-root]');
    const draw=()=>{root.innerHTML=previewHtml(x);bindStates(root,draw);};draw();
    modal.querySelectorAll('[data-preview-close]').forEach(b=>b.onclick=()=>closeModal());
  }

  function openEditor(item,box){
    const isNew=!item;
    const x=item||{name:'',category:'Collection',description:'',icon:'✦',type:'cards',target:1,coins:50,xp:10,active:true};
    const typeOptions=Object.entries(state.types).map(([k,v])=>'<option value="'+esc(k)+'" '+(k===x.type?'selected':'')+'>'+esc(v)+'</option>').join('');
    const categories=[...new Set(state.items.map(i=>i.category))].map(c=>'<option value="'+esc(c)+'"></option>').join('');
    const field=(name,label,input,wide)=>'<label class="'+(wide?'wide':'')+'" data-field="'+name+'">'+label+input+'<span class="field-error" data-error="'+name+'"></span></label>';
    setModal('<div class="modal-box achievement-editor-modal"><button class="modal-close" type="button" data-achievement-cancel aria-label="Fermer">×</button>'
      +'<p class="eyebrow">ADMIN / SUCCÈS</p><h2>'+(isNew?'CRÉER UN SUCCÈS':'MODIFIER LE SUCCÈS')+'</h2>'
      +'<div class="achievement-editor-layout"><form class="achievement-editor-form" novalidate>'
      +field('name','Nom','<input name="name" maxlength="100" value="'+esc(x.name)+'" placeholder="Ex. Collectionneur débutant">',true)
      +field('category','Catégorie','<input name="category" maxlength="50" list="achievementCategories" value="'+esc(x.category)+'"><datalist id="achievementCategories">'+categories+'</datalist>')
      +field('icon','Icône','<input name="icon" maxlength="20" value="'+esc(x.icon||'✦')+'">')
      +field('description','Description','<textarea name="description" maxlength="300" rows="2" placeholder="Ce que le joueur doit accomplir">'+esc(x.description)+'</textarea>',true)
      +field('type','Condition','<select name="type">'+typeOptions+'</select>')
      +field('target','Objectif','<input name="target" type="number" min="1" step="1" value="'+Number(x.target)+'">')
      +field('coins','Récompense FC','<input name="coins" type="number" min="0" step="1" value="'+Number(x.coins)+'">')
      +field('xp','Récompense XP','<input name="xp" type="number" min="0" step="1" value="'+Number(x.xp)+'">')
      +(isNew?'<label class="checkbox-label wide"><input name="active" type="checkbox" checked> Succès actif (visible par les joueurs)</label>':'')
      +'<label class="checkbox-label wide"><input name="hidden" type="checkbox" '+(x.hidden?'checked':'')+'> Succès secret (condition masquée aux joueurs tant qu’il n’est pas réussi)</label>'
      +'</form><div><p class="eyebrow">APERÇU JOUEUR</p><div data-achievement-preview></div>'
      +'<p class="achievement-editor-note">'+(isNew?'L\'identifiant est créé automatiquement à partir du nom.':'Identifiant conservé : <code>'+esc(x.id)+'</code>. '+fr(x.claims)+' joueur(s) l\'ont déjà récupéré ; leurs récompenses restent acquises.')+'</p></div></div>'
      +'<div class="achievement-editor-footer"><button class="btn btn-ghost" type="button" data-achievement-cancel>ANNULER</button><button class="btn btn-gold" type="button" data-achievement-save>ENREGISTRER</button></div></div>');
    const modal=document.getElementById('modal'),f=modal.querySelector('form'),save=modal.querySelector('[data-achievement-save]');
    const snapshot=()=>JSON.stringify(Object.fromEntries(new FormData(f)));const initial=snapshot();
    const formItem=()=>{const e=f.elements;return{...x,name:e.name.value.trim(),category:e.category.value.trim(),icon:e.icon.value.trim(),description:e.description.value.trim(),type:e.type.value,target:Number(e.target.value)||1,coins:Number(e.coins.value)||0,xp:Number(e.xp.value)||0,hidden:e.hidden.checked};};
    const refresh=()=>{const root=modal.querySelector('[data-achievement-preview]');root.innerHTML=previewHtml(formItem());bindStates(root,refresh);};
    f.addEventListener('change',()=>refresh());f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');l.querySelector('[data-error]').textContent='';}refresh();});refresh();
    modal.querySelectorAll('[data-achievement-cancel]').forEach(b=>b.onclick=async()=>{
      if(snapshot()!==initial){const ok=await siteConfirmDialog({title:'ABANDONNER LES MODIFICATIONS ?',subtitle:'Les changements non enregistrés seront perdus.',confirm:'ABANDONNER'});if(ok===null)return;}
      closeModal();
    });
    const showErrors=errors=>{f.querySelectorAll('[data-field]').forEach(l=>{const msg=errors[l.dataset.field]||'';l.classList.toggle('has-error',!!msg);l.querySelector('[data-error]').textContent=msg;});};
    save.onclick=async()=>{
      const e=f.elements,errors={};
      if(e.name.value.trim().length<2)errors.name='Nom : au moins 2 caractères.';
      if(!e.category.value.trim())errors.category='Catégorie obligatoire.';
      if(!e.description.value.trim())errors.description='Description obligatoire.';
      if(!(Number.isInteger(Number(e.target.value))&&Number(e.target.value)>=1))errors.target='Nombre entier d\'au moins 1.';
      if(Number(e.coins.value||0)===0&&Number(e.xp.value||0)===0)errors.coins='Une récompense (FC ou XP) est nécessaire.';
      showErrors(errors);if(Object.keys(errors).length)return;
      const payload={action:isNew?'create':'update',id:isNew?undefined:x.id,name:e.name.value.trim(),category:e.category.value.trim(),icon:e.icon.value.trim(),description:e.description.value.trim(),type:e.type.value,target:Number(e.target.value),coins:Number(e.coins.value||0),xp:Number(e.xp.value||0),hidden:e.hidden.checked,active:isNew?e.active.checked:undefined};
      save.disabled=true;save.textContent='ENREGISTREMENT…';
      try{await api('/api/admin/achievements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});closeModal();toast(isNew?'Succès créé.':'Succès enregistré.');await load(box);}
      catch(err){showErrors(err.data?.errors||{});toast(err.message);save.disabled=false;save.textContent='ENREGISTRER';}
    };
  }

  // Appelé par bind() (app.js) après chaque rendu : ne charge qu'une fois par affichage de la console.
  window.mountAchievementAdmin=function(helpers){
    ({api,setModal,closeModal,toast,siteConfirmDialog}=helpers);
    const box=document.getElementById('adminAchievementList');
    if(!box||box.dataset.ready==='1')return;
    box.dataset.ready='1';style();
    const create=document.querySelector('[data-new-achievement]');if(create)create.onclick=()=>openEditor(null,box);
    const refresh=document.querySelector('[data-refresh-achievements]');if(refresh)refresh.onclick=()=>load(box);
    const update=()=>{state.limit=40;saveFilters();render(box);};
    FILTERS.forEach(id=>{const el=document.getElementById(id);if(el){el.oninput=update;el.onchange=update;}});
    const reset=document.querySelector('[data-reset-achievement-filters]');if(reset)reset.onclick=()=>{FILTERS.forEach(id=>{const el=document.getElementById(id);if(el)el.value=id==='adminAchievementSort'?'code':'';});update();};
    load(box);
  };
})();

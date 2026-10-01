// Éditeur de succès (console admin, onglet « Succès & missions »).
// Reçoit de app.js (bind) ses fonctions : api, setModal, closeModal, toast, siteConfirmDialog.
// Serveur : GET/POST /api/admin/achievements (lib/achievements.js), qui valide tout à nouveau.
(()=>{
  const STYLE_ID='fv-achievement-editor-style';
  const CSS=`
    .success-admin-head-actions{display:flex;gap:10px;flex-wrap:wrap}
    .success-admin-catalog-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .success-admin-catalog-tools select{min-height:40px}
    .achievement-editor-modal{max-width:900px;width:100%}
    .achievement-editor-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:22px;margin-top:14px}
    .achievement-editor-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .achievement-editor-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700}
    .achievement-editor-form .wide{grid-column:1/-1}
    .achievement-editor-form .field-error{color:#ff6b6b;font-weight:600;font-size:12px}
    .achievement-editor-form .has-error input,.achievement-editor-form .has-error select,.achievement-editor-form .has-error textarea{border-color:#ff6b6b}
    .achievement-editor-form .checkbox-label{flex-direction:row;align-items:center}
    .achievement-editor-note{font-size:12px;opacity:.75;margin-top:10px}
    .achievement-editor-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap}
    @media(max-width:760px){.achievement-editor-layout{grid-template-columns:1fr}.achievement-editor-form{grid-template-columns:1fr}}
  `;
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fr=n=>Number(n||0).toLocaleString('fr-FR');
  const state={items:[],types:{}};
  let api,setModal,closeModal,toast,siteConfirmDialog;

  async function load(box){
    try{const d=await api('/api/admin/achievements');state.items=d.achievements||[];state.types=d.types||{};fillFilters();render(box);}
    catch(e){box.innerHTML='<div class="success-admin-empty"><strong>Impossible de charger les succès</strong><p>'+esc(e.message)+'</p><button class="btn btn-outline" type="button" data-achievements-retry>RÉESSAYER</button></div>';const b=box.querySelector('[data-achievements-retry]');if(b)b.onclick=()=>load(box);}
  }

  // Listes des filtres : catégories existantes et conditions connues (valeur choisie conservée).
  function fillFilters(){
    const fill=(id,values)=>{const el=document.getElementById(id);if(!el)return;const cur=el.value,first=el.options[0].outerHTML;el.innerHTML=first+values.map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('');el.value=values.some(([v])=>v===cur)?cur:'';};
    fill('adminAchievementCategory',[...new Set(state.items.map(x=>x.category))].sort((a,b)=>a.localeCompare(b,'fr')).map(c=>[c,c]));
    fill('adminAchievementType',Object.entries(state.types));
  }

  function render(box){
    const total=document.getElementById('adminAchievementTotal'),active=document.getElementById('adminAchievementActive'),count=document.getElementById('adminAchievementCount');
    if(total)total.textContent=fr(state.items.length);
    if(active)active.textContent=fr(state.items.filter(x=>x.active).length);
    const q=String(document.getElementById('adminAchievementSearch')?.value||'').trim().toLowerCase();
    const st=document.getElementById('adminAchievementStatus')?.value||'',cat=document.getElementById('adminAchievementCategory')?.value||'',type=document.getElementById('adminAchievementType')?.value||'';
    const shown=state.items.filter(x=>(!q||(x.name+' '+x.id+' '+x.category+' '+x.description).toLowerCase().includes(q))&&(!st||(st==='pending'?x.type==='pending':st==='secret'?Boolean(x.hidden):(st==='active')===Boolean(x.active)))&&(!cat||x.category===cat)&&(!type||x.type===type));
    if(count)count.textContent=shown.length+' / '+state.items.length+' SUCCÈS';
    box.innerHTML=shown.map(x=>'<article class="admin-achievement-row '+(x.active?'is-active':'is-inactive')+'"><div class="admin-achievement-emblem">'+esc(x.icon||'✦')+'</div><div class="admin-achievement-content"><div class="admin-achievement-heading"><strong>'+esc(x.name)+'</strong><span class="admin-achievement-state '+(x.active?'active':'inactive')+'"><i></i>'+(x.active?'ACTIF':'INACTIF')+'</span></div><small class="admin-achievement-meta">'+(x.code?'N° '+String(x.code).padStart(3,'0')+' <b>·</b> ':'')+esc(x.id)+' <b>·</b> '+esc(x.category)+(x.hidden?' <b>·</b> SECRET':'')+(x.type==='pending'?' <b>·</b> À VENIR (mesure non disponible)':'')+'</small><p>'+esc(x.description)+'</p><div class="admin-achievement-chips"><span>◈ '+esc(state.types[x.type]||x.type)+' : <b>'+fr(x.target)+'</b></span><span>◉ <b>'+fr(x.coins)+' FC</b></span><span>✦ <b>'+fr(x.xp)+' XP</b></span><span>♙ <b>'+fr(x.claims)+'</b> récompensé(s)</span></div></div><div class="admin-achievement-actions"><button class="btn btn-outline" type="button" data-edit-achievement="'+esc(x.id)+'">✎ MODIFIER</button><button class="btn btn-outline" type="button" data-toggle-achievement="'+esc(x.id)+'">'+(x.active?'DÉSACTIVER':'ACTIVER')+'</button><button class="btn btn-danger" type="button" data-delete-achievement="'+esc(x.id)+'">⌫ SUPPRIMER</button></div></article>').join('')
      ||'<div class="success-admin-empty"><span>✦</span><strong>'+(state.items.length?'Aucun succès ne correspond aux filtres':'Aucun succès configuré')+'</strong><p>'+(state.items.length?'Modifiez la recherche ou les filtres.':'Créez le premier défi avec « Créer un succès ».')+'</p></div>';
    const byId=new Map(state.items.map(x=>[x.id,x]));
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

  // Aperçu : carte telle que le joueur la voit sur la page des succès.
  function preview(f){
    const target=Math.max(1,Number(f.target.value||1));
    return '<article class="success-card"><div class="success-card-top"><span class="success-icon">'+esc(f.icon.value||'✦')+'</span><span class="success-status">EN COURS</span></div><p class="eyebrow">'+esc((f.category.value||'Catégorie').toUpperCase())+'</p><h3>'+esc(f.name.value||'Nom du succès')+'</h3><p class="success-description">'+esc(f.description.value||'Description du défi.')+'</p><div class="success-progress"><div class="success-track"><i style="width:0%"></i></div><span>0 / '+fr(target)+'</span></div><div class="success-reward"><span>RÉCOMPENSE</span><b><span>◉ '+fr(f.coins.value)+' FC</span><span>✦ '+fr(f.xp.value)+' XP</span></b></div></article>';
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
    const refresh=()=>{modal.querySelector('[data-achievement-preview]').innerHTML=preview(f.elements);};
    f.addEventListener('input',ev=>{const l=ev.target.closest('[data-field]');if(l){l.classList.remove('has-error');l.querySelector('[data-error]').textContent='';}refresh();});refresh();
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
    ['adminAchievementSearch','adminAchievementStatus','adminAchievementCategory','adminAchievementType'].forEach(id=>{const el=document.getElementById(id);if(el){el.oninput=()=>render(box);el.onchange=()=>render(box);}});
    load(box);
  };
})();

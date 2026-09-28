(()=>{
  const STYLE_ID='fv-success-editor-flow-style';
  const CSS=`
    .success-admin-editor.is-editor-open{display:block!important;animation:fvEditorIn .2s ease-out}
    .success-admin-editor.is-editor-open .success-admin-form{display:flex}
    .success-admin-catalog .success-admin-new-button{display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
    .success-admin-form-actions .success-editor-cancel{margin-left:auto}
    @keyframes fvEditorIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @media(max-width:620px){.success-admin-form-actions .success-editor-cancel{margin-left:0}}
  `;
  function style(){if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)}
  const slugify=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,65)||'succes';
  function setup(){
    const form=document.querySelector('#achievementAdminForm');
    const editor=document.querySelector('.success-admin-editor');
    const catalog=document.querySelector('.success-admin-catalog');
    if(!form||!editor||!catalog||editor.dataset.flowReady==='1')return;
    editor.dataset.flowReady='1';
    const idField=form.elements.id;
    if(idField){
      const label=idField.closest('label');
      if(label)label.remove();
      idField.type='hidden';
      idField.removeAttribute('required');
      idField.removeAttribute('pattern');
    }
    editor.classList.remove('is-editor-open');
    editor.style.display='none';
    const head=catalog.querySelector('.admin-management-block-head');
    if(head){
      const create=document.createElement('button');
      create.type='button';create.className='btn btn-gold success-admin-new-button';
      create.innerHTML='<span aria-hidden="true">＋</span> CRÉER UN SUCCÈS';
      create.addEventListener('click',()=>openNew(form,editor));
      head.appendChild(create);
    }
    const actions=form.querySelector('.success-admin-form-actions');
    if(actions&&!actions.querySelector('.success-editor-cancel')){
      const cancel=document.createElement('button');
      cancel.type='button';cancel.className='btn btn-outline success-editor-cancel';cancel.textContent='ANNULER';
      cancel.addEventListener('click',()=>closeEditor(form,editor));
      actions.appendChild(cancel);
    }
    form.addEventListener('reset',()=>{window.setTimeout(()=>{editor.style.display='none';editor.classList.remove('is-editor-open')},0)});
  }
  function showEditor(form,editor){
    editor.style.display='';
    editor.classList.add('is-editor-open');
    editor.scrollIntoView({behavior:'smooth',block:'start'});
    window.setTimeout(()=>form.elements.name?.focus({preventScroll:true}),180);
  }
  function openNew(form,editor){
    form.reset();
    form.elements.id.value='';
    const title=document.querySelector('#successAdminFormTitle');
    if(title)title.textContent='Créer un succès';
    const desc=editor.querySelector('.success-admin-section-head p:not(.eyebrow)');
    if(desc)desc.textContent='Renseignez les informations du nouveau défi. Son identifiant sera créé automatiquement.';
    editor.classList.remove('is-editing');
    showEditor(form,editor);
  }
  function closeEditor(form,editor){
    form.reset();
    form.elements.id.value='';
    editor.style.display='none';
    editor.classList.remove('is-editor-open','is-editing');
  }
  function ensureId(form){
    const field=form.elements.id;
    if(!field||field.value)return;
    const base='ach-'+slugify(form.elements.name?.value);
    const used=new Set([...document.querySelectorAll('[data-edit-achievement]')].map(b=>String(b.dataset.editAchievement)));
    let id=base,n=2;
    while(used.has(id))id=base+'-'+n++;
    field.value=id;
  }
  function bindDocument(){
    document.addEventListener('click',event=>{
      const edit=event.target.closest('[data-edit-achievement]');
      if(!edit)return;
      window.setTimeout(()=>{
        const form=document.querySelector('#achievementAdminForm'),editor=document.querySelector('.success-admin-editor');
        if(!form||!editor)return;
        const title=document.querySelector('#successAdminFormTitle');
        const desc=editor.querySelector('.success-admin-section-head p:not(.eyebrow)');
        if(desc)desc.textContent='Modifiez les informations, les conditions et les récompenses de ce succès.';
        showEditor(form,editor);
      },0);
    },true);
    document.addEventListener('submit',event=>{
      if(event.target?.id==='achievementAdminForm')ensureId(event.target);
    },true);
  }
  function watchSave(){
    if(window.__fvAchievementFetchWrapped)return;
    window.__fvAchievementFetchWrapped=true;
    const original=window.fetch;
    window.fetch=function(...args){
      return original.apply(this,args).then(response=>{
        const request=args[0],options=args[1]||{};
        const url=typeof request==='string'?request:request?.url||'';
        const method=String(options.method||request?.method||'GET').toUpperCase();
        if(url.includes('/api/admin/achievements')&&method==='POST'&&response.ok){
          response.clone().json().then(data=>{
            if(data?.error)return;
            window.setTimeout(()=>{
              const form=document.querySelector('#achievementAdminForm'),editor=document.querySelector('.success-admin-editor');
              if(form&&editor&&editor.classList.contains('is-editor-open')){
                form.reset();form.elements.id.value='';
                editor.style.display='none';editor.classList.remove('is-editor-open','is-editing');
              }
            },80);
          }).catch(()=>{});
        }
        return response;
      });
    };
  }
  function init(){style();setup();bindDocument();watchSave();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  const observer=new MutationObserver(()=>setup());
  observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
})();
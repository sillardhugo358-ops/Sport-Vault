// Cloche de notifications (en-tête) : surenchères, fins d'enchère, récompenses à récupérer.
// Reçoit de app.js (bind) sa fonction api. Serveur : GET /api/notifications, POST /api/notifications/read.
// Actualisée toutes les 60 s quand l'onglet est visible ; le bouton est recréé à chaque rendu de l'en-tête.
(()=>{
  const STYLE_ID='fv-notif-style';
  const CSS=`
    .notif-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);cursor:pointer;flex:0 0 auto}
    .notif-bell svg{width:20px;height:20px}
    .notif-bell:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
    .notif-badge{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#d77c7c;color:#fff;font:800 11px/19px var(--body);text-align:center}
    .notif-badge[hidden]{display:none}
    .notif-panel{position:fixed;top:78px;right:16px;width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);overflow:auto;z-index:60;border:1px solid rgba(55,113,174,.4);border-radius:14px;background:#08111f;box-shadow:0 18px 50px rgba(0,0,0,.55);padding:14px}
    .notif-panel[hidden]{display:none}
    .notif-panel header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}
    .notif-panel h2{margin:0;font:800 16px var(--head);letter-spacing:.5px}
    .notif-panel header button{background:none;border:0;color:var(--gold);font-weight:800;font-size:12px;cursor:pointer}
    .notif-ready{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(216,181,107,.12);border:1px solid rgba(216,181,107,.35);margin-bottom:10px;color:var(--text);text-decoration:none;font-size:13px}
    .notif-ready b{color:var(--gold2);white-space:nowrap}
    .notif-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
    .notif-item a,.notif-item div{display:block;padding:10px 12px;border-radius:10px;color:var(--text);text-decoration:none;background:rgba(255,255,255,.03);border:1px solid transparent}
    .notif-item.unread a,.notif-item.unread div{border-color:rgba(111,168,214,.45);background:rgba(111,168,214,.08)}
    .notif-item strong{display:block;font-size:13px}
    .notif-item span{display:block;font-size:12px;color:var(--muted);margin-top:3px}
    .notif-item time{display:block;font-size:11px;color:var(--muted);margin-top:4px}
    .notif-empty{color:var(--muted);font-size:13px;padding:8px 2px}
    @media(max-width:760px){.notif-panel{top:68px;right:16px}}
  `;
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeLink=l=>/^#[a-z0-9-]+$/i.test(String(l||''))?l:null;
  const ago=d=>{const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<60)return'à l’instant';if(s<3600)return'il y a '+Math.floor(s/60)+' min';if(s<86400)return'il y a '+Math.floor(s/3600)+' h';return new Date(d).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});};
  let api,data=null,timer=null,loading=false,lastLoad=0;

  function badgeCount(){return data?Number(data.unread||0)+Number(data.rewardsReady||0):0;}
  function paint(){
    const bell=document.getElementById('notifBell');if(!bell)return;
    const n=badgeCount(),badge=bell.querySelector('.notif-badge');
    window.fvNotifCount=n; // relu par nav() (app.js) quand l'en-tête est recréé
    if(badge){badge.hidden=!n;badge.textContent=n>99?'99+':String(n);}
    bell.setAttribute('aria-label','Notifications'+(n?' ('+n+' nouvelle'+(n>1?'s':'')+')':''));
    const panel=document.getElementById('notifPanel');if(panel&&!panel.hidden)renderPanel(panel);
  }
  function renderPanel(panel){
    const list=data?.notifications||[],ready=Number(data?.rewardsReady||0);
    panel.innerHTML='<header><h2>NOTIFICATIONS</h2>'+(data?.unread?'<button type="button" data-notif-read>TOUT MARQUER LU</button>':'')+'</header>'
      +(ready?'<a class="notif-ready" href="#vault"><span>'+(ready>1?ready+' récompenses t’attendent':'1 récompense t’attend')+' dans ton Vault</span><b>RÉCUPÉRER →</b></a>':'')
      +(list.length?'<ul class="notif-list">'+list.map(n=>{const link=safeLink(n.link),inner='<strong>'+esc(n.title)+'</strong>'+(n.body?'<span>'+esc(n.body)+'</span>':'')+'<time datetime="'+esc(n.createdAt)+'">'+esc(ago(n.createdAt))+'</time>';return '<li class="notif-item'+(n.read?'':' unread')+'">'+(link?'<a href="'+esc(link)+'">'+inner+'</a>':'<div>'+inner+'</div>')+'</li>';}).join('')+'</ul>':(ready?'':'<p class="notif-empty">Aucune notification pour le moment. Tu seras prévenu ici des surenchères et des fins d’enchère.</p>'));
    const b=panel.querySelector('[data-notif-read]');if(b)b.onclick=markRead;
    panel.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>close()));
  }
  async function load(){
    if(loading||!document.getElementById('notifBell'))return;loading=true;
    lastLoad=Date.now();
    try{data=await api('/api/notifications');paint();}catch{/* la cloche reste en l'état ; nouvel essai au prochain passage */}
    finally{loading=false;}
  }
  async function markRead(){
    const upToId=Math.max(0,...(data?.notifications||[]).map(n=>n.id));
    try{await api('/api/notifications/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({upToId})});
      if(data){data.unread=0;data.notifications.forEach(n=>n.read=true);}paint();}catch(e){/* affichage inchangé : l'état serveur fait foi */}
  }
  function close(){const p=document.getElementById('notifPanel');if(p)p.hidden=true;document.getElementById('notifBell')?.setAttribute('aria-expanded','false');}
  function toggle(){
    let panel=document.getElementById('notifPanel');
    if(!panel){panel=document.createElement('section');panel.id='notifPanel';panel.className='notif-panel';panel.hidden=true;panel.setAttribute('aria-label','Notifications');document.body.appendChild(panel);}
    const open=panel.hidden;panel.hidden=!open;document.getElementById('notifBell')?.setAttribute('aria-expanded',String(open));
    if(open){renderPanel(panel);load();}
  }
  // Délégation : l'en-tête (et donc le bouton) est recréé à chaque rendu.
  document.addEventListener('click',e=>{if(e.target.closest('#notifBell')){e.preventDefault();toggle();return;}const p=document.getElementById('notifPanel');if(p&&!p.hidden&&!e.target.closest('#notifPanel'))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});

  // Appelé par bind() (app.js) après chaque rendu : rebranche le bouton recréé, repeint le compteur connu.
  window.mountNotifications=function(helpers){
    ({api}=helpers);style();
    const bell=document.getElementById('notifBell');
    if(!bell){close();data=null;window.fvNotifCount=0;return;}
    paint();
    // Chaque changement de page actualise la cloche (au plus toutes les 10 s).
    if(!data||Date.now()-lastLoad>10000)load();
    if(!timer)timer=setInterval(()=>{if(!document.hidden)load();},60000);
  };
})();

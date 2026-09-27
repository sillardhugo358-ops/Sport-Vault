const FV=(()=>{
const state={user:null,cards:[],catalog:[],packs:[],progress:null,album:null,auctions:[],auctionHistory:[],adminUsers:[],adminCompetitions:[],adminClubs:[],filter:'all',collectionSearch:'',collectionSort:'recent',marketRarity:'all',marketSort:'ending',authMode:'login',packShopType:'all',packShopSearch:'',packShopMax:5000,packShopSort:'recent'};
const $=s=>document.querySelector(s); const app=()=>$('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('fr-FR');
const initials=n=>String(n||'FV').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const rarityOrder={common:1,rare:2,epic:3,legendary:4,icon:5};
const rarityValue={common:100,rare:300,epic:700,legendary:1800,icon:4500};
const route=()=>{const h=location.hash.replace(/^#/,'')||'home';const [r,q]=h.split('?');return{r:r||'home',q:new URLSearchParams(q||'')}};
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...opt});let d={};try{d=await r.json()}catch{};if(!r.ok){const e=new Error(d.error||'Une erreur est survenue.');e.status=r.status;throw e}return d}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200)}
function setModal(html){const m=$('#modal');m.innerHTML=html;m.classList.add('show');m.setAttribute('aria-hidden','false');m.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);if(typeof bind==='function')bind()}
function closeModal(){const m=$('#modal');m.classList.remove('show');m.setAttribute('aria-hidden','true');m.innerHTML=''}
function nav(){const r=route().r;const adminNav=$('#adminNav');if(adminNav)adminNav.hidden=!['admin','creator'].includes(state.user?.role);document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===r));const u=$('#headerUser');const n=$('#nav');if(state.user){u.innerHTML=`<div class="header-wallet"><span class="fc-coin" aria-hidden="true">FC</span><div class="header-wallet-copy"><strong>${money(state.user.availableCoins??state.user.coins)}</strong><span>FC DISPONIBLES</span></div>${Number(state.user.reservedCoins||0)?`<span class="header-reserved" title="FC réservés par tes enchères">${money(state.user.reservedCoins)} RÉSERVÉS</span>`:''}</div><button class="btn btn-outline" id="logoutBtn" type="button">Se déconnecter</button>`;if(n){n.querySelector('.mobile-account')?.remove();if(window.matchMedia('(max-width:760px)').matches)n.insertAdjacentHTML('beforeend',`<div class="mobile-account"><div class="mobile-account-balance"><span class="fc-coin mobile-fc-coin" aria-hidden="true">FC</span><div><strong>${money(state.user.availableCoins??state.user.coins)} FC</strong><span>DISPONIBLES</span></div>${Number(state.user.reservedCoins||0)?`<small>${money(state.user.reservedCoins)} FC réservés</small>`:''}</div>${['admin','creator'].includes(state.user.role)?'<a class="btn btn-gold mobile-admin" href="#admin">PANNEAU ADMIN</a>':''}<button class="btn btn-danger mobile-logout" id="mobileLogoutBtn" type="button">SE DÉCONNECTER</button></div>`)}}else{u.innerHTML='<a class="btn btn-outline" href="#auth">Connexion</a><a class="btn btn-gold" href="#auth?mode=register">Créer un compte</a>';if(n){n.querySelector('.mobile-account')?.remove();if(window.matchMedia('(max-width:760px)').matches)n.insertAdjacentHTML('beforeend',`<div class="mobile-account mobile-account-guest"><a class="btn btn-outline" href="#auth">CONNEXION</a><a class="btn btn-gold" href="#auth?mode=register">CRÉER UN COMPTE</a></div>`)}}}
function shell(){nav();const menu=$('#menu');menu.onclick=()=>$('#nav').classList.toggle('open');document.querySelectorAll('.nav a').forEach(a=>a.onclick=()=>$('#nav').classList.remove('open'))}
function cardMarkup(c,small=false){const limited=Boolean(c.isLimited),num=c.jerseyNumber==null?'—':String(c.jerseyNumber);return `<article class="tcg-card rarity-${esc(c.rarity)}"><div class="tcg-inner"><div class="card-top"><span>FOOTVAULT · ${esc(c.season)}</span><strong>${esc(c.position)}</strong></div><div class="card-rating"><span>OVR</span><b>${Number(c.ovr||0)||'—'}</b></div><div class="card-number"><small>NO.</small><strong>${esc(num)}</strong></div><div class="card-club"><span>${esc(c.club)}</span><em>${esc(c.nation)}</em></div><h3>${esc(c.name)}</h3><div class="card-bottom"><b>${esc(c.rarityLabel||c.rarity)}</b><span>${limited?esc(c.serialLabel||'LIMITED'):'STANDARD'}</span></div></div></article>`}
function cardLink(c){const search=[c.name,c.club,c.nation,c.position,c.rarityLabel].filter(Boolean).join(" ").toLowerCase();return `<a class="card-link" data-collection-card-search="${esc(search)}" href="#card?id=${encodeURIComponent(c.instanceId)}">${cardMarkup(c)}</a>`}
function viewHero(kicker,title,sub,stat='',statLabel=''){return `<section class="view-hero"><div><p class="eyebrow">${esc(kicker)}</p><h1>${title}</h1>${sub?`<p class="lead">${esc(sub)}</p>`:''}</div>${stat?`<div class="hero-stat"><strong>${esc(stat)}</strong><span>${esc(statLabel)}</span></div>`:''}</section>`}
async function home(){
 const homeFetch=(path,fallback)=>Promise.race([
  api(path),
  new Promise(resolve=>setTimeout(()=>resolve(fallback),7000))
 ]).catch(()=>fallback);
 const [catalogData,packsData,auctionData,meData,progressData]=await Promise.all([
  homeFetch('/api/cards',{cards:[]}),
  homeFetch('/api/packs',{packs:[]}),
  homeFetch('/api/auctions',{auctions:[]}),
  homeFetch('/api/me',{user:null}),
  homeFetch('/api/progression',null)
 ]);
 const catalog=catalogData.cards||[],packs=packsData.packs||[],auctions=auctionData.auctions||[];
 state.user=meData.user||state.user;
 if(progressData?.user)state.user=progressData.user;
 const labels={common:'COMMON',rare:'RARE',epic:'EPIC',legendary:'LEGENDARY',icon:'ULTRA RARE'};
 const clubs=[...new Set(catalog.map(c=>c.club).filter(Boolean))];
 const featured=[...catalog].sort((a,b)=>Number(b.ovr||0)-Number(a.ovr||0)).slice(0,3);
 const cardHtml=featured.map((c,i)=>`<a class="dash-player-card dash-player-card-${i+1} rarity-${esc(c.rarity)}" href="#collection" aria-label="Explorer la collection : ${esc(c.name)}"><div class="dash-card-glint"></div><div class="dash-card-top"><span>FOOTVAULT · ${esc(c.season||'2026-27')}</span><b>${esc(c.position||'—')}</b></div><div class="dash-card-rating"><small>OVR</small><strong>${Number(c.ovr||0)||'—'}</strong></div><div class="dash-card-silhouette"><span>${esc((c.name||'FV').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</span></div><div class="dash-card-player"><small>${esc(c.club||'')}</small><strong>${esc(c.name||'Joueur')}</strong><span>${esc(c.nation||'')}</span></div><div class="dash-card-bottom"><b>${esc(labels[c.rarity]||c.rarity||'CARTE')}</b><span>${esc(c.jerseyNumber==null?'—':c.jerseyNumber)}</span></div></a>`).join('');
 const packIcons=['✦','◈','✧'];
 const packCards=packs.slice(0,3).map((p,i)=>`<article class="dash-pack-card dash-pack-${i+1}"><a href="#packs" class="dash-pack-art" aria-label="Voir les packs"><span class="dash-pack-emblem">${packIcons[i]||'✦'}</span><small>FOOTVAULT</small><strong>${esc(p.name||'PACK')}</strong><span>${Number(p.cards||0)} CARTES</span></a><div class="dash-pack-info"><div><b>${esc(p.name||'Pack')}</b><span>${esc(p.description||p.badge||'Découvre de nouvelles cartes')}</span></div><strong>${money(p.price)} <small>FC</small></strong></div><a href="#packs" class="dash-text-link">DÉCOUVRIR LE PACK <span>↗</span></a></article>`).join('');
 const auctionCards=auctions.slice(0,3).map(x=>{const c=x.card||{};const seconds=Math.max(0,Math.floor((new Date(x.endsAt).getTime()-Date.now())/1000));const time=seconds<60?seconds+' s':seconds<3600?Math.floor(seconds/60)+' min':Math.floor(seconds/3600)+' h';return `<a class="dash-auction-card" href="#market"><div class="dash-auction-visual"><span class="dash-live-dot">● LIVE</span><div class="dash-auction-rating">${Number(c.ovr||0)||'—'}<small>OVR</small></div><div class="dash-auction-player">${esc(c.name||'Carte')}</div><span>${esc(c.club||'FOOTVAULT')}</span></div><div class="dash-auction-info"><div><b>${esc(c.name||'Carte')}</b><span>${esc(c.rarityLabel||c.rarity||'')} · ${esc(c.club||'')}</span></div><strong>${money(x.currentBid)} <small>FC</small></strong></div><div class="dash-auction-foot"><span>◷ ${time}</span><span>${x.bidCount||0} offre(s) →</span></div></a>`}).join('');
 const daily=progressData?.dailyTasks||[];
 const taskCards=daily.slice(0,3).map(t=>{const pct=Math.min(100,t.target?Number(t.progress||0)/t.target*100:0);return `<div class="dash-task"><span class="dash-task-icon">✓</span><div class="dash-task-main"><b>${esc(t.title)}</b><div class="dash-progress"><i style="width:${pct}%"></i></div></div><span class="dash-task-count">${Number(t.progress||0)}/${Number(t.target||0)}</span><b class="dash-task-reward">+${Number(t.reward?.coins||0)} FC</b></div>`}).join('');
 const coin=state.user?money(state.user.availableCoins??state.user.coins):'—';
 const countOwned=progressData?.cardCount??0;
 const ownedLabel=state.user?money(countOwned):'—';
 return `<div class="home-page home-dashboard">
  <section class="dash-hero">
   <div class="dash-hero-copy"><p class="dash-kicker"><i></i> FOOTVAULT · SAISON 2026-27</p><h1>COLLECTIONNE<br><span>LE JEU.</span></h1><p class="dash-hero-lead">FOOTVAULT, le jeu de cartes des passionnés de football. Collectionne les joueurs, ouvre des packs, échange et complète ton album à travers les plus grandes compétitions.</p><div class="dash-hero-actions"><a class="btn btn-gold btn-large" href="#packs">▣ OUVRIR UN PACK</a><a class="btn btn-outline btn-large" href="#collection">▤ VOIR MA COLLECTION</a></div><div class="dash-hero-metrics"><span><b>${money(catalog.length)}</b> CARTES</span><i></i><span><b>${money(clubs.length)}</b> CLUBS</span><i></i><span><b>5</b> RARETÉS</span></div></div>
   <div class="dash-hero-art"><div class="dash-stadium-glow"></div><div class="dash-stadium-lines"></div><div class="dash-trophy"><span>✦</span><small>FOOTVAULT<br>CHAMPIONS</small></div><div class="dash-player-cards">${cardHtml||'<div class="dash-empty-cards">TES PROCHAINES CARTES<br><strong>T’ATTENDENT.</strong></div>'}</div></div>
  </section>
  <div class="dash-competition-strip">${[['L1','Ligue 1'],['♛','Premier League'],['L','La Liga'],['A','Serie A'],['B','Bundesliga'],['✦','Ligue des Champions'],['♜','Coupe du Monde'],['🌐','Ligue des Nations']].map(([ico,name])=>`<a href="#album"><b>${ico}</b><span>${name}</span></a>`).join('')}</div>
  <section class="dash-main-grid">
   <div class="dash-panel dash-packs-panel"><div class="dash-section-head"><h2><span>✦</span> PACKS À LA UNE</h2><a href="#packs">VOIR TOUT <b>›</b></a></div><div class="dash-pack-grid">${packCards||'<p class="dash-empty">Aucun pack disponible pour le moment.</p>'}</div></div>
   <div class="dash-panel dash-auctions-panel"><div class="dash-section-head"><h2><span>⚒</span> ENCHÈRES EN DIRECT</h2><a href="#market">VOIR TOUTES <b>›</b></a></div><div class="dash-auction-grid">${auctionCards||'<p class="dash-empty">Aucune enchère active pour le moment.</p>'}</div></div>
   <div class="dash-panel dash-tasks-panel"><div class="dash-section-head"><h2><span>◎</span> MES TÂCHES QUOTIDIENNES</h2><a href="#vault">VOIR TOUT <b>›</b></a></div><div class="dash-task-list">${taskCards||'<div class="dash-task-guest"><p>Connecte-toi pour suivre tes objectifs quotidiens et récupérer tes récompenses.</p><a class="btn btn-outline" href="#vault">ACCÉDER À MON VAULT →</a></div>'}</div></div>
  </section>
  <section class="dash-bottom-grid"><div class="dash-panel dash-news-panel"><div class="dash-section-head"><h2><span>▣</span> L’UNIVERS FOOTVAULT</h2><a href="#album">EXPLORER <b>›</b></a></div><a class="dash-news-feature" href="#album"><div class="dash-news-art"><span>FV</span><b>SAISON<br>2026 / 27</b></div><div><strong>Une nouvelle saison à collectionner</strong><p>Découvre les cartes, explore les compétitions et complète ton album au fil de la saison.</p><small>FOOTVAULT · SAISON 2026-27</small></div></a><a class="dash-news-feature" href="#packs"><div class="dash-news-art news-art-packs"><span>✦</span><b>NOUVEAUX<br>PACKS</b></div><div><strong>Ouvre tes prochains packs</strong><p>Chaque ouverture est une nouvelle occasion d’enrichir ta collection.</p><small>BOUTIQUE FOOTVAULT</small></div></a></div>
   <div class="dash-panel dash-stats-panel"><div class="dash-section-head"><h2><span>▥</span> MES STATISTIQUES</h2><a href="#vault">MON VAULT <b>›</b></a></div><div class="dash-stat-grid"><div><strong>${ownedLabel}</strong><span>CARTES POSSÉDÉES</span></div><div><strong>${money(packs.length)}</strong><span>PACKS DISPONIBLES</span></div><div><strong>${money(auctions.length)}</strong><span>ENCHÈRES EN COURS</span></div><div><strong>${coin}</strong><span>FOOTCOINS</span></div></div><div class="dash-album-progress"><div><b>Progression de mon Vault</b><span>${state.user?'Connecté':'Visiteur'}</span></div><div class="dash-progress"><i style="width:${state.user?'0%':'0%'}"></i></div><small>${state.user?'Retrouve tes cartes et ta progression dans Mon Vault.':'Connecte-toi pour consulter ta progression personnelle.'}</small></div></div>
  </section>
 </div>`;
}
async function loadCatalog(){if(state.catalog.length)return;state.catalog=(await api('/api/cards')).cards||[]}
async function collection(){
 try{const d=await api("/api/collection");state.user=d.user;state.cards=d.cards||[]}catch(e){if(e.status===401)return authView("login","collection");throw e}
 const filters=["all","common","rare","epic","legendary","icon"],labels={icon:"ULTRA RARE",legendary:"LEGENDARY",epic:"EPIC",rare:"RARE",common:"COMMON"},q=state.collectionSearch.trim().toLowerCase();
 const grouped=new Map();state.cards.forEach(c=>{const key=c.cardId||c.id||c.instanceId;const existing=grouped.get(key);if(existing){existing.quantity+=1}else grouped.set(key,{...c,quantity:1})});const uniqueCards=[...grouped.values()];
 const base=uniqueCards.filter(c=>(state.filter==="all"||c.rarity===state.filter)&&(!q||[c.name,c.club,c.nation,c.position,c.rarityLabel].some(v=>String(v||"").toLowerCase().includes(q))));
 const sorted=[...base].sort((a,b)=>state.collectionSort==="ovr"?Number(b.ovr||0)-Number(a.ovr||0):state.collectionSort==="rarity"?(rarityOrder[b.rarity]||0)-(rarityOrder[a.rarity]||0):state.collectionSort==="name"?String(a.name).localeCompare(String(b.name),"fr"):0);
 const groups=state.filter==="all"?["icon","legendary","epic","rare","common"]:[state.filter];
 const sections=groups.map(r=>{const cards=sorted.filter(c=>c.rarity===r);return cards.length?`<section class="collection-rarity-section"><div class="collection-rarity-head"><div><span class="eyebrow">${labels[r]}</span><h2>${labels[r]}</h2></div><strong>${String(cards.length).padStart(2,"0")} CARTE${cards.length>1?"S":""}</strong></div><div class="collection-card-grid">${cards.map(c=>`<div class="collection-card-item">${cardLink(c)}<span class="collection-quantity">${c.quantity} EXEMPLAIRE${c.quantity>1?"S":""}</span></div>`).join("")}</div></section>`:""}).join("");
 return `<div class="page collection-page"><section class="collection-showcase"><div class="collection-showcase-copy"><p class="eyebrow">FOOTVAULT / COLLECTION</p><h1>MA <span>COLLECTION</span></h1><p>Toutes tes cartes réunies au même endroit. Explore tes joueurs, compare les raretés et retrouve tes exemplaires.</p></div><div class="collection-showcase-mark"><span>FV</span><b>COLLECT<br>THE GAME</b></div></section><section class="collection-overview"><div><span>CARTES POSSÉDÉES</span><strong>${state.cards.length.toLocaleString('fr-FR')}</strong><small>exemplaires dans ton Vault</small></div><div><span>JOUEURS DIFFÉRENTS</span><strong>${uniqueCards.length.toLocaleString('fr-FR')}</strong><small>cartes uniques</small></div><div><span>RARETÉS</span><strong>${new Set(state.cards.map(c=>c.rarity)).size}</strong><small>niveaux présents</small></div><div><span>DOUBLONS</span><strong>${Math.max(0,state.cards.length-uniqueCards.length).toLocaleString('fr-FR')}</strong><small>exemplaires supplémentaires</small></div></section><section class="collection-progress-panel"><div class="collection-progress-title"><div><p class="eyebrow">ÉTAT DE LA COLLECTION</p><h2>TES RARETÉS</h2></div><strong>${uniqueCards.length} CARTES UNIQUES</strong></div><div class="collection-rarity-grid">${["common","rare","epic","legendary","icon"].map(r=>{const names={common:"COMMON",rare:"RARE",epic:"EPIC",legendary:"LEGENDARY",icon:"ULTRA RARE"};const owned=uniqueCards.filter(c=>c.rarity===r).length;return `<div class="collection-rarity-mini"><div><span>${names[r]}</span><b>${owned}</b></div><i><em style="width:${Math.min(100,owned/Math.max(1,state.catalog?.filter(c=>c.rarity===r).length||owned)*100)}%"></em></i></div>`}).join("")}</div></section><div class="collection-toolbar"><div class="filters">${filters.map(f=>`<button class="filter ${state.filter===f?"active":""}" data-filter="${f}">${f==="all"?"Toutes":f==="icon"?"Ultra Rare":f[0].toUpperCase()+f.slice(1)}</button>`).join("")}</div><div class="collection-tools"><input id="collectionSearch" class="collection-search" value="${esc(state.collectionSearch)}" placeholder="Rechercher joueur, club, pays..." /><select id="collectionSort" class="collection-sort"><option value="recent" ${state.collectionSort==="recent"?"selected":""}>Récent</option><option value="ovr" ${state.collectionSort==="ovr"?"selected":""}>OVR décroissant</option><option value="rarity" ${state.collectionSort==="rarity"?"selected":""}>Rareté</option><option value="name" ${state.collectionSort==="name"?"selected":""}>Nom A → Z</option></select></div></div>${sections||`<section class="collection-rarity-section"><div class="empty">AUCUNE CARTE NE CORRESPOND À TA RECHERCHE.</div></section>`}</div>`;
}
async function packs(){
 let poolOffers=[];
 try{const [m,p]=await Promise.all([api('/api/me'),api('/api/packs')]);state.user=m.user;state.packs=p.packs||[];poolOffers=p.pools||[];nav()}
 catch(e){state.user=null;const p=await api('/api/packs');state.packs=p.packs||[];poolOffers=p.pools||[];nav()}
 const packsList=state.packs;
 const categories=[['all','Tous les packs'],['standard','Standard'],['premium','Premium'],['special','Spécial'],['limited','Édition limitée']];
 const inferType=p=>{const s=(String(p.badge||'')+' '+String(p.name||'')).toLowerCase();if(/limit|édition|limited/.test(s))return'limited';if(/spécial|special|icône|hero|héros|légende/.test(s))return'special';if(/premium|champion|pro/.test(s))return'premium';return'standard'};
 const typeCounts=Object.fromEntries(categories.map(([key])=>[key,key==='all'?packsList.length:packsList.filter(p=>inferType(p)===key).length]));
 const featured=packsList.slice(0,4);
 const renderPack=(p,i,featuredCard=false)=>{const type=inferType(p),theme=type==='premium'?'purple':type==='limited'?'gold':type==='special'?'red':['blue','purple','gold','red'][i%4];return `<article class="shop-pack-card shop-pack-${theme}" data-shop-pack data-name="${esc((p.name||'')+' '+(p.description||'')+' '+(p.badge||'' )).toLowerCase()}" data-type="${type}" data-price="${Number(p.price)||0}">
   <div class="shop-pack-art"><span class="shop-pack-ribbon">${esc(p.badge||type.toUpperCase())}</span><div class="shop-pack-symbol" aria-hidden="true">${theme==='gold'?'✦':theme==='purple'?'◈':theme==='red'?'♛':'FV'}</div><small>FOOTVAULT</small><strong>${esc(p.name||'PACK')}</strong><span class="shop-pack-art-meta">${Number(p.cards)||0} CARTES</span><div class="shop-pack-orbit"></div></div>
   <div class="shop-pack-copy"><div class="shop-pack-title"><h3>${esc(p.name||'Pack')}</h3><span class="shop-pack-tag">${esc(p.badge||'PACK')}</span></div><p>${esc(p.description||'Ouvre ce pack pour obtenir de nouvelles cartes.')}</p><div class="shop-pack-guarantee"><span>▣ ${Number(p.cards)||0} cartes</span>${p.guarantee?'<span>✦ Garantie spéciale</span>':''}</div><div class="shop-pack-footer"><strong class="shop-pack-price"><span class="fc-coin" aria-hidden="true">FC</span> ${money(p.price)}</strong><button class="btn btn-gold" data-pack="${esc(p.id)}">OUVRIR <span aria-hidden="true">→</span></button></div></div>
 </article>`};
 return `<div class="page shop-page">
  <section class="shop-hero"><div class="shop-hero-copy"><p class="shop-kicker"><i></i> FOOTVAULT / BOUTIQUE OFFICIELLE</p><h1>PACKS<span>.</span></h1><h2>OUVRE, COLLECTIONNE, VIBRE.</h2><p>Découvre les packs et enrichis ta collection avec les cartes des plus grandes compétitions du football.</p><div class="shop-hero-meta"><span>✦ Des cartes à découvrir</span><span>▣ ${packsList.length} packs disponibles</span></div></div><div class="shop-hero-art" aria-hidden="true"><div class="shop-hero-glow"></div><div class="shop-hero-pack shop-hero-pack-back">FOOTVAULT <b>✦</b><strong>ELITE</strong></div><div class="shop-hero-pack shop-hero-pack-front">FOOTVAULT <b>FV</b><strong>PACK<br>STARS</strong></div><div class="shop-hero-card">FV</div></div><div class="shop-hero-wallet"><span class="fc-coin">FC</span><div><small>TON SOLDE</small><strong>${state.user?money(state.user.availableCoins??state.user.coins):'—'} <small>FC</small></strong></div></div></section>
  <div class="shop-layout"><aside class="shop-filters"><div class="shop-filter-head"><h2><span>☷</span> FILTRES</h2><button type="button" data-shop-reset>Réinitialiser</button></div><div class="shop-filter-group"><h3>Type de pack</h3>${categories.map(([key,label])=>`<label class="shop-check"><input type="checkbox" data-shop-type="${key}" ${state.packShopType===key?'checked':''}><span>${label}</span><b>${typeCounts[key]||0}</b></label>`).join('')}</div><div class="shop-filter-group"><h3>Prix maximum</h3><input class="shop-price-range" id="shopPriceRange" type="range" min="0" max="5000" step="50" value="${state.packShopMax}"><div class="shop-price-range-label"><span>0 FC</span><strong id="shopPriceValue">${money(state.packShopMax)} FC</strong></div></div><div class="shop-filter-group"><h3>Trier par</h3><select id="shopSort"><option value="recent" ${state.packShopSort==='recent'?'selected':''}>Les plus récents</option><option value="price-asc" ${state.packShopSort==='price-asc'?'selected':''}>Prix croissant</option><option value="price-desc" ${state.packShopSort==='price-desc'?'selected':''}>Prix décroissant</option><option value="name" ${state.packShopSort==='name'?'selected':''}>Nom A → Z</option></select></div></aside>
   <section class="shop-results"><div class="shop-search-row"><label class="shop-search"><span>⌕</span><input id="shopSearch" value="${esc(state.packShopSearch)}" placeholder="Rechercher un pack..."><kbd>⌕</kbd></label><a href="#packs" class="shop-all-link">Tous les packs <span>→</span></a></div>
    <div class="shop-section-heading"><div><p class="shop-kicker">À DÉCOUVRIR</p><h2>PACKS À LA UNE</h2><p>Choisis ton prochain pack et tente de nouvelles cartes.</p></div><span class="shop-result-count" id="shopResultCount">${packsList.length} packs</span></div>
    <div class="shop-pack-grid" id="shopPackGrid">${packsList.map((p,i)=>renderPack(p,i)).join('')||'<div class="empty">Aucun pack disponible pour le moment.</div>'}</div>
    <div class="shop-no-results" id="shopNoResults" hidden>Aucun pack ne correspond à ces filtres.</div>
   </section></div>
   ${poolOffers.length?`<section class="shop-pools-section"><div class="shop-section-heading"><div><p class="shop-kicker">TIRAGES DISPONIBLES</p><h2>PACKS SPÉCIAUX & POOLS</h2><p>Des tirages dédiés aux réserves de cartes configurées par le Créateur.</p></div><span class="shop-result-count">${poolOffers.length} pools</span></div><div class="shop-pool-grid">${poolOffers.map((p,i)=>`<article class="shop-pool-card shop-pool-${i%3}"><div class="shop-pool-art"><span>✦</span><small>FOOTVAULT / POOL</small><strong>${esc(p.name||'POOL')}</strong><b>${Number(p.cards)||0} CARTES / TIRAGE</b></div><div class="shop-pool-copy"><p class="shop-pack-tag">${esc(p.badge||'POOL')}</p><h3>${esc(p.name||'Pool')}</h3><p>${esc(p.description||'Un tirage dans cette réserve de cartes.')}</p><div class="shop-pack-footer"><strong class="shop-pack-price"><span class="fc-coin">FC</span> ${money(p.price)}</strong><button class="btn btn-gold" data-pool-draw="${esc(p.id)}">TIRER <span>→</span></button></div></div></article>`).join('')}</div></section>`:''}
  </div>`;
}

async function openPack(id){try{const d=await api('/api/packs/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packId:id})});state.user=d.user;showReveal(d.cards||[],d.pack);toast(`Pack ouvert · ${d.cards.length} cartes · +${d.cards.length*2} XP`);nav();await render()}catch(e){if(e.status===401){location.hash='auth?next=packs';return}toast(e.message)}}
async function openPool(id){try{const d=await api('/api/pools/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poolId:id})});state.user=d.user;showReveal(d.cards||[],d.pack);toast(`Tirage effectué · ${d.cards.length} cartes · +${d.cards.length*2} XP`);nav();await render()}catch(e){if(e.status===401){location.hash='auth?next=packs';return}toast(e.message)}}
function showReveal(cards,pack){
 const faces=cards.map((c,i)=>`<button class="reveal-card" type="button" aria-label="Révéler la carte ${esc(c.name||i+1)}" aria-pressed="false" data-reveal-card="${i}"><span class="reveal-card-inner"><span class="reveal-face reveal-back" aria-hidden="true">FV</span><span class="reveal-face reveal-front">${cardMarkup(c)}</span></span></button>`).join('');
 setModal(`<div class="modal-box pack-reveal-modal"><button class="modal-close" data-close aria-label="Fermer">×</button><p class="eyebrow">NOUVELLE OUVERTURE</p><h2 class="pack-reveal-title">${esc(pack?.name||'Pack ouvert')}</h2><div class="reveal-grid">${faces}</div><div class="reveal-controls"><span class="reveal-result">${cards.length} cartes ajoutées · +${cards.length*2} XP</span><button class="btn btn-outline" type="button" data-skip-reveal>PASSER L’ANIMATION</button><a class="btn btn-gold" href="#collection" data-close>VOIR MA COLLECTION</a></div></div>`);
 const revealCards=[...document.querySelectorAll('.reveal-card')];
 const skip=document.querySelector('[data-skip-reveal]');
 const revealOne=card=>{if(!card||card.classList.contains('flipped'))return;card.classList.add('flipped');card.setAttribute('aria-pressed','true');if(revealCards.every(x=>x.classList.contains('flipped'))&&skip){skip.textContent='TOUTES LES CARTES RÉVÉLÉES';skip.disabled=true;skip.classList.add('reveal-skip-done')}};
 revealCards.forEach(card=>card.addEventListener('click',()=>revealOne(card)));
 skip?.addEventListener('click',()=>{revealCards.forEach(revealOne);if(skip){skip.textContent='ANIMATION TERMINÉE';skip.disabled=true;skip.classList.add('reveal-skip-done')}});
}
async function vault(){
 try{const d=await api('/api/progression');state.user=d.user;state.progress=d}catch(e){if(e.status===401)return authView('login','vault');throw e}
 const collectionData=await api('/api/collection').catch(()=>({cards:[]}));const vaultCards=(collectionData.cards||[]).slice(-4).reverse();
 const p=state.progress,xpPct=Math.min(100,p.xpToNext?((p.currentXp||0)/p.xpToNext*100):0),claimed=p.daily.claimed,missions=p.missions||[],completedMissions=p.completedMissions||[],dailyTasks=p.dailyTasks||[],weeklyTasks=p.weeklyTasks||[],ready=missions.filter(m=>m.completed&&!m.claimed).length,completed=completedMissions.length;
 const taskHtml=(tasks,kind)=>tasks.map(t=>{const pct=Math.min(100,t.target?t.progress/t.target*100:0),isReady=t.completed&&!t.claimed,isClaimed=t.claimed;return '<article class="mission vault-mission '+(isReady?'is-ready ':'')+(isClaimed?'mission-completed':'')+'"><div class="mission-head"><div><p class="eyebrow">'+(kind==='daily'?'QUOTIDIENNE':'HEBDOMADAIRE')+'</p><h3>'+esc(t.title)+'</h3></div><b>+'+t.reward.coins+' FC<br>+'+t.reward.xp+' XP</b></div><p>'+esc(t.description)+'</p><div class="vault-mission-progress"><div class="progress"><i style="width:'+pct+'%"></i></div><span>'+t.progress+'/'+t.target+'</span></div>'+(isClaimed?'<span class="mission-completed-badge">✓ RÉCOMPENSE RÉCUPÉRÉE</span>':'<button class="btn '+(isReady?'btn-gold':'btn-outline')+'" data-task-kind="'+kind+'" data-task="'+esc(t.id)+'" '+(isReady?'':'disabled')+'>'+(isReady?'RÉCUPÉRER':'EN COURS')+'</button>')+'</article>'}).join('');
 const missionHtml=missions.map(m=>{const pct=Math.min(100,m.target?m.progress/m.target*100:0),isReady=m.completed&&!m.claimed;return '<article class="mission vault-mission '+(isReady?'is-ready':'')+'"><div class="mission-head"><div><p class="eyebrow">MISSION '+String(m.order||0).padStart(2,'0')+'</p><h3>'+esc(m.title)+'</h3></div><b>+'+m.reward.coins+' FC<br>+'+m.reward.xp+' XP</b></div><p>'+esc(m.description)+'</p><div class="vault-mission-progress"><div class="progress"><i style="width:'+pct+'%"></i></div><span>'+m.progress+'/'+m.target+'</span></div><button class="btn '+(isReady?'btn-gold':'btn-outline')+'" data-mission="'+esc(m.id)+'" '+(isReady?'':'disabled')+'>'+(isReady?'RÉCUPÉRER':'EN COURS')+'</button></article>'}).join('');
 const completedMissionHtml=completedMissions.map(m=>'<article class="mission vault-mission mission-completed"><div class="mission-head"><div><p class="eyebrow">MISSION '+String(m.order||0).padStart(2,'0')+' · TERMINÉE</p><h3>'+esc(m.title)+'</h3></div><b>+'+m.reward.coins+' FC<br>+'+m.reward.xp+' XP</b></div><p>'+esc(m.description)+'</p><div class="vault-mission-progress"><div class="progress"><i style="width:100%"></i></div><span>OBJECTIF ATTEINT</span></div><span class="mission-completed-badge">✓ RÉCOMPENSE RÉCUPÉRÉE</span></article>').join('');
 const dailyReady=dailyTasks.filter(t=>t.completed&&!t.claimed).length,weeklyReady=weeklyTasks.filter(t=>t.completed&&!t.claimed).length;
 return '<div class="page vault-page"><section class="vault-profile-dashboard"><div class="vault-profile-main"><div class="vault-avatar">'+esc(initials(p.user.username||p.user.displayName||'FV'))+'</div><div class="vault-profile-copy"><p class="eyebrow">TON ESPACE PERSONNEL</p><h1>'+esc(p.user.username||p.user.displayName||'MON VAULT')+'</h1><span>NIVEAU '+String(p.level).padStart(2,'0')+' · FOOTVAULT MEMBER</span></div><div class="vault-profile-badge">FV</div></div><div class="vault-profile-stats"><div><span>CARTES POSSÉDÉES</span><strong>'+Number(p.cardCount||0).toLocaleString('fr-FR')+'</strong></div><div><span>FOOTCOINS</span><strong>'+money(p.user.availableCoins??p.user.coins)+'</strong></div><div><span>ENCHÈRES GAGNÉES</span><strong>'+Number(p.auctionsWon||0).toLocaleString('fr-FR')+'</strong></div><div><span>MISSIONS VALIDÉES</span><strong>'+Number(completed||0).toLocaleString('fr-FR')+'</strong></div></div><div class="vault-profile-links"><a href="#collection">▣ MES CARTES <span>→</span></a><a href="#packs">✦ MES PACKS <span>→</span></a><a href="#market">⚒ MES ENCHÈRES <span>→</span></a><a href="#album">▤ MES COLLECTIONS <span>→</span></a><a href="#vault">◎ MISSIONS & RÉCOMPENSES <span>→</span></a></div></section><section class="vault-recent-panel"><div class="vault-recent-head"><div><p class="eyebrow">TON DERNIER BUTIN</p><h2>MES DERNIÈRES CARTES</h2></div><a href="#collection">VOIR TOUTES →</a></div><div class="vault-recent-cards">'+(vaultCards.length?vaultCards.map(c=>cardLink(c)).join(''):'<div class="empty">Tes prochaines cartes apparaîtront ici après une ouverture de pack.</div>')+'</div></section><section class="vault-command"><div class="vault-command-main"><div><p class="eyebrow">FOOTVAULT / MON VAULT</p><h1>TON <span>VAULT.</span></h1><p>Tout ce qui fait progresser ton compte, réuni dans un seul espace.</p></div><div class="vault-level"><span>NIVEAU</span><strong>'+String(p.level).padStart(2,'0')+'</strong><small>PROGRESSION ACTIVE</small></div></div><div class="vault-xp"><div class="vault-xp-head"><div><span>EXPÉRIENCE</span><strong>'+p.currentXp+' <em>/ '+p.xpToNext+' XP</em></strong></div><b>'+Math.round(xpPct)+'%</b></div><div class="xp-track vault-xp-track"><i style="width:'+xpPct+'%"></i></div></div></section>' +
 '<section class="vault-resource-section"><div class="vault-section-head"><div><p class="eyebrow">PORTEFEUILLE</p><h2>TES RESSOURCES</h2></div><span>'+String(p.cardCount).padStart(2,'0')+' CARTES DANS LE VAULT</span></div><div class="vault-resource-grid"><article class="vault-resource-card vault-resource-feature"><div class="vault-resource-icon">FC</div><div><span>FOOTCOINS DISPONIBLES</span><strong>'+money(p.user.availableCoins??p.user.coins)+'</strong><small>Solde utilisable immédiatement</small></div></article><article class="vault-resource-card"><span>FC RÉSERVÉS</span><strong>'+money(p.user.reservedCoins||0)+'</strong><small>Engagés dans tes opérations</small></article><article class="vault-resource-card"><span>GEMS</span><strong>'+money(p.user.gems)+'</strong><small>Ressource premium</small></article><article class="vault-resource-card"><span>CARTES</span><strong>'+String(p.cardCount).padStart(2,'0')+'</strong><small>Cartes possédées</small></article></div></section>' +
 '<section class="vault-grid-top"><article class="vault-daily-card"><div class="vault-card-kicker"><span>01 / BONUS QUOTIDIEN</span><b>'+(claimed?'RÉCUPÉRÉ':'DISPONIBLE')+'</b></div><div class="vault-daily-copy"><div><h2>'+(claimed?'À DEMAIN.':'TON BONUS EST PRÊT.')+'</h2><p>'+(claimed?'Le prochain bonus sera disponible à minuit.':'Récupère ta récompense quotidienne pour continuer ta progression.')+'</p></div><div class="vault-daily-reward"><strong>15</strong><span>FC</span><strong>+5</strong><span>XP</span></div></div><button class="btn '+(claimed?'btn-outline':'btn-gold')+'" id="daily" '+(claimed?'disabled':'')+'>'+(claimed?'BONUS DÉJÀ RÉCUPÉRÉ':'RÉCUPÉRER LE BONUS')+'</button></article><article class="vault-overview-card"><div class="vault-card-kicker"><span>02 / PROGRESSION</span><b>'+(ready+dailyReady+weeklyReady?ready+dailyReady+weeklyReady+' À RÉCUPÉRER':'SUIVI ACTIF')+'</b></div><div class="vault-overview-number">'+String(completed).padStart(2,'0')+'<small>MISSIONS<br>VALIDÉES</small></div><p>Les tâches quotidiennes et hebdomadaires se renouvellent automatiquement.</p><div class="vault-mini-stats"><span><b>'+dailyReady+'</b> QUOTIDIENNE'+(dailyReady>1?'S':'')+'</span><span><b>'+weeklyReady+'</b> HEBDOMADAIRE'+(weeklyReady>1?'S':'')+'</span></div></article></section>' +
 '<section class="section vault-missions-section"><div class="section-head vault-section-head"><div><p class="eyebrow">03 / TÂCHES QUOTIDIENNES</p><h2>OBJECTIFS DU JOUR</h2></div><p>Toutes les tâches sont disponibles dès le début. Elles se réinitialisent chaque jour à minuit.</p></div><div class="mission-grid vault-mission-grid">'+(taskHtml(dailyTasks,'daily')||'<div class="empty">Aucune tâche quotidienne.</div>')+'</div></section>' +
 '<section class="section vault-missions-section"><div class="section-head vault-section-head"><div><p class="eyebrow">04 / TÂCHES HEBDOMADAIRES</p><h2>OBJECTIFS DE LA SEMAINE</h2></div><p>Toutes les tâches sont disponibles dès le début. Elles se réinitialisent chaque lundi à minuit.</p></div><div class="mission-grid vault-mission-grid">'+(taskHtml(weeklyTasks,'weekly')||'<div class="empty">Aucune tâche hebdomadaire.</div>')+'</div></section>' +
 '<section class="section vault-missions-section"><div class="section-head vault-section-head"><div><p class="eyebrow">05 / MISSIONS ACTIVES</p><h2>MISSIONS FOOTVAULT</h2></div><p>Les objectifs permanents se débloquent progressivement. Termine une mission pour accéder à la suivante.</p></div><div class="mission-grid vault-mission-grid">'+(missionHtml||'<div class="empty">Aucune mission active pour le moment.</div>')+'</div></section>'+(completedMissions.length?'<section class="section vault-missions-section mission-completed-section"><div class="section-head vault-section-head"><div><p class="eyebrow">06 / HISTORIQUE</p><h2>MISSIONS TERMINÉES</h2></div><p>Retrouve ici les missions permanentes dont la récompense a déjà été récupérée.</p></div><div class="mission-grid vault-mission-grid">'+completedMissionHtml+'</div></section>':'')+'</div>';
}
async function logout(){
 if(logout.busy)return; logout.busy=true;
 try{
  const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
  if(!r.ok)throw new Error('La déconnexion a échoué.');
  state.user=null;state.cards=[];state.auctions=[];state.auctionHistory=[];
  toast('Déconnexion réussie.');
  location.hash='auth';
  await render();
 }catch(e){toast(e.message||'La déconnexion a échoué.')}finally{logout.busy=false}
}
async function daily(){try{const d=await api('/api/rewards/daily',{method:'POST'});state.user=d.user;toast(`+${d.reward.coins} FOOTCOINS · +${d.reward.xp} XP`);render()}catch(e){toast(e.message)}}
async function mission(id){try{const d=await api('/api/missions/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({missionId:id})});toast(`+${d.reward.coins} FOOTCOINS · +${d.reward.xp} XP`);render()}catch(e){toast(e.message)}}
async function task(kind,id){try{const d=await api('/api/tasks/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,taskId:id})});toast(`+${d.reward.coins} FOOTCOINS · +${d.reward.xp} XP`);render()}catch(e){toast(e.message)}}
async function album(){
 let d=null;
 const seasonId=route().q.get('season');
 try{d=await api('/api/album'+(seasonId?'?seasonId='+encodeURIComponent(seasonId):''));state.album=d;if(seasonId){const c=await api('/api/collection');state.user=c.user;state.cards=c.cards||[]}else{state.cards=[]}}
 catch(e){if(e.status===401)return authView('login','album');throw e}
 const competitions=d.album.competitions||[],competitionId=route().q.get('competition'),total=d.album.overallTotal||0,own=d.album.overallOwned||0;
 if(!competitionId){
  const overallPct=Math.round(own/Math.max(1,total)*100);
  return `<div class="page album-page"><section class="album-showcase"><div class="album-showcase-copy"><p class="eyebrow">FOOTVAULT / MON ALBUM</p><h1>MON <span>ALBUM</span></h1><p>Complète les collections et débloque des récompenses exclusives, compétition après compétition.</p></div><div class="album-showcase-trophy"><span>✦</span><b>FOOTVAULT<br>CHAMPIONS</b></div><div class="album-global-progress"><div><span>PROGRESSION GLOBALE</span><strong>${overallPct}%</strong></div><div class="album-global-track"><i style="width:${overallPct}%"></i></div><small>${own.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} cartes · ${competitions.length} compétitions</small></div></section><div class="album-heading-row"><div><p class="eyebrow">À TOI DE JOUER</p><h2>TES <span>COMPÉTITIONS</span></h2></div><span class="album-collection-count">${competitions.length} COLLECTIONS</span></div><section class="album-competitions-grid">${competitions.map((c,i)=>{const seasons=c.seasons||[],ct=seasons.reduce((n,s)=>n+(s.clubs||[]).reduce((m,cl)=>m+Number(cl.total||0),0),0),co=seasons.reduce((n,s)=>n+(s.clubs||[]).reduce((m,cl)=>m+Number(cl.owned||0),0),0),pct=Math.round(co/Math.max(1,ct)*100);return `<a class="competition-album-card album-comp-card ${c.status==='available'?'available':'locked'}" href="${c.status==='available'&&seasons.length?'#album?competition='+encodeURIComponent(c.id):'#album'}"><div class="album-comp-art album-comp-art-${i%5}">${c.logo_url?'<img class="album-comp-logo" src="'+esc(c.logo_url)+'" alt="Logo '+esc(c.name)+'" loading="lazy" onerror="this.style.display=\'none\'">':'<span>'+esc(c.tag)+'</span>'}<b>${String(i+1).padStart(2,'0')}</b></div><div class="album-comp-body"><div class="competition-album-top"><span class="competition-status ${c.status==='available'?'available':'upcoming-status'}">${c.status==='available'?'DISPONIBLE':'À VENIR'}</span><span class="album-comp-season-count">${seasons.length} SAISON${seasons.length>1?'S':''}</span></div><p class="eyebrow">${esc(c.country||'INTERNATIONAL')}</p><h2>${esc(c.name)}</h2><p>${esc(c.description||'De nouvelles éditions arriveront prochainement dans le Vault.')}</p><div class="album-comp-progress"><div><span>${co.toLocaleString('fr-FR')} / ${ct.toLocaleString('fr-FR')} CARTES</span><b>${pct}%</b></div><i><em style="width:${pct}%"></em></i></div><div class="competition-album-footer"><span>${seasons.length} ÉDITION${seasons.length>1?'S':''}</span><strong>${c.status==='available'?'EXPLORER →':'BIENTÔT'}</strong></div></div></a>`}).join('')}</section></div>`;
 }
 const comp=competitions.find(c=>c.id===competitionId);
 if(!comp)return '<div class="page"><div class="empty">Compétition introuvable.</div></div>';
 if(!seasonId){
  const seasonsRaw=comp.seasons||[];
  const seasonSort=route().q.get('sort')||'recent';
  const seasonMetrics=s=>{const clubs=s.clubs||[],total=clubs.reduce((n,cl)=>n+Number(cl.total||0),0),owned=clubs.reduce((n,cl)=>n+Number(cl.owned||0),0);return{year:Number(String(s.season||'').slice(0,4))||0,total,owned,pct:Math.round(owned/Math.max(1,total)*100),clubs:clubs.length};};
  const seasons=[...seasonsRaw].sort((a,b)=>{const A=seasonMetrics(a),B=seasonMetrics(b);switch(seasonSort){case'old':return A.year-B.year;case'pct-desc':return B.pct-A.pct||B.year-A.year;case'pct-asc':return A.pct-B.pct||B.year-A.year;case'cards-desc':return B.total-A.total||B.year-A.year;case'clubs-desc':return B.clubs-A.clubs||B.year-A.year;default:return B.year-A.year;}});
  const compTotal=seasons.reduce((n,s)=>n+(s.clubs||[]).reduce((m,cl)=>m+Number(cl.total||0),0),0);
  const compOwned=seasons.reduce((n,s)=>n+(s.clubs||[]).reduce((m,cl)=>m+Number(cl.owned||0),0),0);
  const compPct=Math.round(compOwned/Math.max(1,compTotal)*100);
  const completedSeasons=seasons.filter(s=>s.clubs?.length&&s.clubs.every(cl=>cl.total>0&&cl.complete)).length;
  const seasonCards=seasons.map((s,i)=>{
   const clubs=s.clubs||[],total=clubs.reduce((n,cl)=>n+Number(cl.total||0),0),owned=clubs.reduce((n,cl)=>n+Number(cl.owned||0),0),pct=Math.round(owned/Math.max(1,total)*100),available=s.status==='available';
   return `<a class="season-show-card season-show-card-${i%5} ${available?'available':'locked'}" href="${available?'#album?competition='+encodeURIComponent(comp.id)+'&season='+encodeURIComponent(s.id):'#album?competition='+encodeURIComponent(comp.id)}" aria-label="Explorer la saison ${esc(s.season)}">
    <div class="season-show-art"><div class="season-art-lights"></div><span class="season-art-tag" ${(/ligue\s*1|ligue-1|^l1$/i.test(String(comp.name||""))||/^l1$/i.test(String(comp.tag||""))||String(comp.id||"").toLowerCase().includes("ligue-1"))?'hidden':''}>${esc(comp.tag)}</span><span class="season-art-year">${esc(s.season)}</span><div class="season-art-crest">${comp.logo_url?'<img src="'+esc(comp.logo_url)+'" alt="Logo '+esc(comp.name)+'" loading="eager" onerror="this.style.display=\'none\';this.parentElement.textContent=\''+esc(comp.tag)+'\'">':esc(comp.tag)}</div><div class="season-art-glow"></div><div class="season-art-caption"><small>${esc(comp.name)}</small><strong>${esc(s.label||('Saison '+s.season))}</strong></div></div>
    <div class="season-show-meta"><span class="season-state ${available?'is-open':'is-locked'}">${available?'● DISPONIBLE':'◈ À VENIR'}</span><span>${clubs.length} CLUBS</span></div>
    <div class="season-show-progress"><div><span>${owned.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} CARTES</span><b>${pct}%</b></div><i><em style="width:${pct}%"></em></i></div>
    <div class="season-show-footer"><span>${pct===100?'ÉDITION COMPLÉTÉE':'PROGRESSION DE LA COLLECTION'}</span><strong>${available?'EXPLORER ↗':'BIENTÔT'}</strong></div>
   </a>`;
  }).join('');
  return `<div class="page album-season-page">
   <section class="season-hero">
    <div class="season-hero-copy"><p class="eyebrow">FOOTVAULT / ALBUM / ${esc(comp.tag)}</p><div class="season-breadcrumb"><a href="#album">ALBUM</a><span>›</span><b>${esc(comp.name)}</b></div><h1>LES <span>SAISONS.</span></h1><p>Revivez l’histoire de ${esc(comp.name)} à travers les éditions. Collectionne les cartes des clubs et joueurs, saison après saison.</p><div class="season-hero-pills"><span>✦ ${seasons.length} ÉDITIONS</span><span>▣ ${compTotal.toLocaleString('fr-FR')} CARTES AU TOTAL</span></div></div>
    <div class="season-hero-art" aria-hidden="true"><div class="season-hero-orbit"></div><div class="season-hero-cup">✦</div><div class="season-hero-mark">${esc(comp.tag)}</div><div class="season-hero-ribbon">FOOTVAULT · COLLECTION</div></div>
   </section>
   <div class="season-layout">
    <main class="season-main">
     <div class="season-toolbar"><div><p class="eyebrow">ARCHIVES DE LA COMPÉTITION</p><h2>CHOISIS TON <span>ÉDITION</span></h2></div><a class="btn btn-outline season-back-btn" href="#album">← COMPÉTITIONS</a></div>
     <div class="season-filter-strip"><span class="season-filter-active">▦ SAISONS</span><span>◈ CLUBS</span><span>♙ JOUEURS</span><span>✦ RÉCOMPENSES</span><label class="season-sort-control" for="seasonSortSelect">TRIER PAR <select id="seasonSortSelect" aria-label="Trier les saisons"><option value="recent" ${seasonSort==='recent'?'selected':''}>Année : plus récente</option><option value="old" ${seasonSort==='old'?'selected':''}>Année : plus ancienne</option><option value="pct-desc" ${seasonSort==='pct-desc'?'selected':''}>Complétion : décroissante</option><option value="pct-asc" ${seasonSort==='pct-asc'?'selected':''}>Complétion : croissante</option><option value="cards-desc" ${seasonSort==='cards-desc'?'selected':''}>Nombre de cartes</option><option value="clubs-desc" ${seasonSort==='clubs-desc'?'selected':''}>Nombre de clubs</option></select></label></div>
     <section class="season-show-grid">${seasonCards||'<div class="empty">Aucune saison configurée pour cette compétition.</div>'}</section>
    </main>
    <aside class="season-sidebar">
     <section class="season-side-card season-side-progress"><div class="season-side-heading"><span>PROGRESSION ${esc(comp.name.toUpperCase())}</span><b>◎</b></div><div class="season-side-ring" style="--season-pct:${compPct}%"><div><strong>${compPct}%</strong><small>COLLECTÉ</small></div></div><p>${compOwned.toLocaleString('fr-FR')} / ${compTotal.toLocaleString('fr-FR')} cartes</p><div class="season-side-divider"></div><div class="season-side-stat"><span>🏆 Éditions complétées</span><strong>${completedSeasons} / ${seasons.length}</strong></div></section>
     <section class="season-side-card"><div class="season-side-heading"><span>TA COLLECTION</span><b>✦</b></div><div class="season-side-metric"><strong>${seasons.length}</strong><span>SAISONS DISPONIBLES OU À VENIR</span></div><div class="season-side-metric"><strong>${seasons.reduce((n,s)=>n+(s.clubs||[]).length,0)}</strong><span>CLUBS À COLLECTIONNER</span></div></section>
     <section class="season-side-card season-side-rewards"><div class="season-side-heading"><span>RÉCOMPENSES DE COMPÉTITION</span><b>♜</b></div><div class="season-reward-row"><span class="season-reward-icon">✦</span><div><strong>Collection 25 %</strong><small>Pack de la compétition</small></div><b class="${compPct>=25?'reward-unlocked':''}">${compPct>=25?'✓':'🔒'}</b></div><div class="season-reward-row"><span class="season-reward-icon">♛</span><div><strong>Collection 50 %</strong><small>Carte exclusive</small></div><b class="${compPct>=50?'reward-unlocked':''}">${compPct>=50?'✓':'🔒'}</b></div><div class="season-reward-row"><span class="season-reward-icon">★</span><div><strong>Collection 100 %</strong><small>Trophée collector</small></div><b class="${compPct>=100?'reward-unlocked':''}">${compPct>=100?'✓':'🔒'}</b></div></section>
    </aside>
   </div>
  </div>`;
 }
 const season=comp.seasons.find(s=>s.id===seasonId);
 if(!season)return '<div class="page"><div class="empty">Saison introuvable.</div></div>';
 const complete=season.clubs.filter(c=>c.total>0&&c.complete).length;
 return `<div class="page">${viewHero('FOOTVAULT / ALBUM / '+esc(comp.tag)+' / '+esc(season.season),'LES <span>CLUBS.</span>','Complète les clubs de cette édition et récupère les récompenses associées.')}<div class="album-back"><a class="btn btn-outline" href="#album?competition=${encodeURIComponent(comp.id)}">← SAISONS</a></div><div class="album-summary"><div class="summary"><span>COMPÉTITION</span><strong>${esc(comp.name)}</strong></div><div class="summary"><span>ÉDITION</span><strong>${esc(season.label||season.season)}</strong></div><div class="summary"><span>CLUBS COMPLETS</span><strong>${complete}/${season.clubs.length}</strong></div></div><section class="album-season-progress"><div><p class="eyebrow">PROGRESSION DE L’ALBUM</p><h2>${season.clubs.reduce((n,c)=>n+c.owned,0)} / ${season.clubs.reduce((n,c)=>n+c.total,0)} CARTES</h2></div><strong>${Math.round(season.clubs.reduce((n,c)=>n+c.owned,0)/Math.max(1,season.clubs.reduce((n,c)=>n+c.total,0))*100)}%</strong><div class="album-season-track"><i style="width:${Math.min(100,season.clubs.reduce((n,c)=>n+c.owned,0)/Math.max(1,season.clubs.reduce((n,c)=>n+c.total,0))*100)}%"></i></div></section><section class="album-clubs-grid">${season.clubs.map(c=>{const done=c.total>0&&c.complete,claimed=(d.rewards.clubs.find(r=>r.seasonId===season.id&&r.clubId===c.id)||{}).claimed;return `<article class="album-club-card"><div class="album-club-head"><div class="album-club-identity">${c.logoUrl?'<img class="club-logo album-club-logo" src="'+esc(c.logoUrl)+'" alt="" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';this.nextElementSibling.classList.remove(\'is-hidden\')"><span class="club-logo-fallback is-hidden">'+esc((c.tag||c.name||'CL').slice(0,3))+'</span>':'<span class="club-logo-fallback">'+esc((c.tag||c.name||'CL').slice(0,3))+'</span>'}<div><p class="eyebrow">${esc(comp.tag)} / ${esc(season.season)} / ${esc(c.tag)}</p><h2>${esc(c.name)}</h2></div></div><strong>${c.owned}/${c.total}</strong></div><div class="progress"><i style="width:${c.total?c.owned/c.total*100:0}%"></i></div><div class="album-club-meta"><span>${done?'SET COMPLET':'PROGRESSION'}</span><b>250 FC · 25 XP</b></div><div class="album-cards">${c.cards.map(card=>{const owned=state.cards.find(o=>o.cardId===card.id);const href=owned?'#card?id='+encodeURIComponent(owned.instanceId):'#card?id='+encodeURIComponent(card.id);return `<a class="mini-card ${owned?'':'missing'}" href="${href}" title="Voir la carte"><strong>${esc(card.name)}</strong><small>${esc(card.rarityLabel||card.rarity)}</small></a>`}).join('')}</div><button class="btn ${done&&!claimed?'btn-gold':''}" data-album-season="${esc(season.id)}" data-album-club="${esc(c.id)}" ${done&&!claimed?'':'disabled'}>${claimed?'DÉJÀ RÉCUPÉRÉ':done?'RÉCUPÉRER LA RÉCOMPENSE':'SET INCOMPLET'}</button></article>`}).join('')}</section></div>`;
}
async function claimAlbum(seasonId,clubId){try{const d=await api('/api/album/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seasonId,clubId})});toast('Récompense récupérée · '+(d.reward?.coins||250)+' FOOTCOINS · '+(d.reward?.xp||25)+' XP');render()}catch(e){toast(e.message)}}async function cardDetail(id){try{const d=await api('/api/collection');state.user=d.user;let c=(d.cards||[]).find(x=>x.instanceId===id);if(!c){await loadCatalog();c=state.catalog.find(x=>x.id===id);if(c)c={...c,source:'ALBUM'};}if(!c){const detail=await api('/api/cards/'+encodeURIComponent(id));c={...detail.card,source:'ALBUM'};}if(!c)throw new Error('Carte introuvable.');const base=Number(c.ovr)||72;const labels=cardStatDefinitions(c.position);const stats=labels.map(([x,k])=>({x,v:Math.max(1,Math.min(99,Number(c[k]||base)))})),ov=base,value=rarityValue[c.rarity]+Math.max(0,ov-base)*25;return `<div class="page card-detail-page"><a class="card-detail-close" href="#vault" aria-label="Fermer">×</a>${viewHero('FOOTVAULT / PLAYER CARD',esc(c.name),'Carte unique de ta collection.') }<div class="detail-layout"><div class="detail-card">${cardMarkup(c)}</div><div class="detail-copy"><p class="eyebrow">ATTRIBUTS</p><h2>${esc(c.name)}</h2><p class="lead">Une carte ${esc(c.rarityLabel).toLowerCase()} de ${esc(c.club)}. Profil évalué à ${ov} OVR.</p><div class="facts"><div class="fact"><span>CLUB</span><strong>${esc(c.club)}</strong></div><div class="fact"><span>NATION</span><strong>${esc(c.nation)}</strong></div><div class="fact"><span>POSTE</span><strong>${esc(c.position)}</strong></div><div class="fact"><span>SAISON</span><strong>${esc(c.season)}</strong></div><div class="fact"><span>TYPE</span><strong>${c.isLimited?`LIMITED · ${esc(c.serialLabel||'—')}`:'STANDARD'}</strong></div><div class="fact"><span>SOURCE</span><strong>${String(c.source||'VAULT').startsWith('pack:')?'PACK':esc(c.source)}</strong></div></div><div class="panel"><div style="display:flex;justify-content:space-between"><span class="eyebrow">SIX ATTRIBUTS</span><strong style="font:900 28px var(--head);color:var(--gold2)">${ov} OVR</strong></div>${stats.map(s=>`<div class="stat-row"><span>${s.x}</span><div class="stat-track"><i style="width:${s.v}%"></i></div><strong>${s.v}</strong></div>`).join('')}</div><div class="value"><span>VAULT VALUE</span><strong>${money(value)} FC</strong><small>Valeur interne selon rareté et profil. Pas encore un prix de marché.</small></div>${c.acquiredAt?`<div class="panel" style="margin-top:12px"><div class="fact" style="border:0;padding:0"><span>ACQUISE LE</span><strong>${new Date(c.acquiredAt).toLocaleDateString('fr-FR')}</strong></div></div>`:'<div class="panel" style="margin-top:12px"><div class="fact" style="border:0;padding:0"><span>APERÇU ALBUM</span><strong>CARTE DU CATALOGUE</strong></div></div>'}</div></div></div>`}catch(e){if(e.status===401)return authView('login','card?id='+encodeURIComponent(id));return `<div class="page"><div class="empty">${esc(e.message)}</div></div>`}}
function authView(mode='login',next='vault'){state.authMode=mode;return `<div class="page auth"><section class="auth-box"><p class="eyebrow">FOOTVAULT / VOTRE ESPACE</p><h1>${mode==='register'?'CRÉER TON VAULT.':'CONNEXION.'}</h1><p class="lead" style="font-size:12px">${mode==='register'?'Crée ton compte et reçois immédiatement 1 000 FOOTCOINS, 50 GEMS et 3 cartes de bienvenue.':'Retrouve ta collection et ta progression.'}</p><form id="authForm"><div class="field" ${mode==='register'?'':'style="display:none"'}><label>Nom<input id="authName" autocomplete="name" ${mode==='register'?'required':''} maxlength="30"></label></div><div class="field"><label>Email<input id="authEmail" type="email" autocomplete="email" required></label></div><div class="field"><label>Mot de passe<input id="authPassword" type="password" minlength="8" required></label></div><button class="btn btn-gold" type="submit">${mode==='register'?'Créer mon compte':'Entrer dans mon Vault'}</button><div id="authMsg" class="notice" hidden></div></form><div class="auth-switch">${mode==='register'?'Déjà un compte ?':'Pas encore de compte ?'} <button id="switchAuth">${mode==='register'?'Se connecter':'Créer un compte'}</button></div></section></div>`}
async function submitAuth(e){e.preventDefault();const mode=state.authMode;const payload={email:$('#authEmail').value.trim(),password:$('#authPassword').value};if(mode==='register')payload.name=$('#authName').value.trim();const msg=$('#authMsg');try{const d=await api('/api/'+(mode==='register'?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});state.user=d.user;toast(mode==='register'?`Compte créé · ${money(d.user.coins)} FC · 3 cartes offertes`:'Connexion réussie');const next=route().q.get('next')||'vault';location.hash=next.startsWith('card?')?next:next;render()}catch(e){msg.textContent=e.message;msg.hidden=false}}
function adminLogDetails(d){if(!d||typeof d!=='object')return String(d||'—');const labels={resource:'Ressource',amount:'Montant',reason:'Motif',instanceId:'Carte',cardId:'Carte catalogue',fromUserId:'Ancien propriétaire',toUserId:'Nouveau propriétaire',role:'Rôle',previousRole:'Ancien rôle',action:'Action'};return Object.entries(d).map(([k,v])=>(labels[k]||k)+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' · ')||'—'}
function adminUserRow(x){const initials=String(x.name||'U').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase();return `<tr class="admin-user-row" data-user-role="${esc(x.role)}" data-user-coins="${Number(x.availableCoins)||0}" data-user-cards="${Number(x.cardCount)||0}" data-user-sales="${Number(x.activeSales)||0}" data-user-search="${esc((x.name+' '+x.email).toLowerCase())}"><td><button class="admin-user-link" data-admin-user="${esc(x.id)}"><span class="admin-user-avatar">${esc(initials)}</span><span class="admin-user-identity"><strong>${esc(x.name)}</strong><small>${esc(x.email)}</small></span></button></td><td><span class="admin-role ${x.role}">${esc(x.role)}</span></td><td><strong class="admin-user-currency">${money(x.availableCoins)} <small>FC</small></strong></td><td><span class="admin-user-metric">${Number(x.cardCount)||0}</span></td><td><span class="admin-user-metric">${Number(x.activeSales)||0}</span></td><td><span class="admin-user-metric">${Number(x.activeBids)||0}</span></td><td><button class="admin-user-open" data-admin-user="${esc(x.id)}" aria-label="Ouvrir le profil de ${esc(x.name)}">↗</button></td></tr>`}
async function refreshAdminUsers(q=''){
 try{const d=await api('/api/admin/users?q='+encodeURIComponent(q));const body=$('#adminUsersBody');if(body){body.innerHTML=(d.users||[]).map(adminUserRow).join('')||'<tr><td colspan="6">Aucun joueur trouvé.</td></tr>';document.querySelectorAll('[data-admin-user]').forEach(x=>x.onclick=()=>showAdminUser(x.dataset.adminUser));}}catch(e){toast(e.message)}
}
async function showAdminUser(id){
 try{
  await loadCatalog();
  const d=await api('/api/admin/users/'+encodeURIComponent(id)),u=d.user,cards=u.cards||[],sales=u.sales||[],bids=u.bids||[],isCreator=state.user?.role==='creator',canManage=state.user&&((state.user.role==='creator')||(state.user.role==='admin'&&u.role==='user'));
  const roleControls=isCreator&&u.role!=='creator'?`<section class="admin-user-section"><p class="eyebrow">HIÉRARCHIE</p><div class="admin-action-buttons"><button class="btn" data-admin-role="user">USER</button><button class="btn btn-gold" data-admin-role="admin">ADMIN</button></div></section>`:'';
  const moderation=canManage?`<div class="admin-moderation"><span class="admin-status">STATUT : <strong>${esc(u.accountStatus||'active')}</strong></span><div class="admin-action-buttons">${u.accountStatus==='banned'?'<button class="btn" data-admin-action="unblock">RÉACTIVER</button>':(u.accountStatus==='blocked'?'<button class="btn" data-admin-action="unblock">DÉBLOQUER</button>':'<button class="btn" data-admin-action="block">BLOQUER 24 H</button><button class="btn btn-danger" data-admin-action="ban">BANNIR</button>')}</div></div>`:''; 
  setModal(`<div class="modal-box admin-user-modal admin-user-drawer" data-admin-user-current="${esc(id)}"><button class="modal-close" data-close aria-label="Fermer">×</button><div class="admin-user-drawer-head"><div class="admin-user-avatar admin-user-avatar-large">${esc(String(u.name||'U').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase())}</div><div><p class="eyebrow">FICHE UTILISATEUR / ADMIN</p><h2>${esc(u.name)}</h2><p class="admin-user-email">${esc(u.email)}</p></div></div>${moderation}<div class="admin-user-summary"><div><span>RÔLE</span><strong>${esc(u.role)}</strong></div><div><span>FC DISPONIBLES</span><strong>${money(u.availableCoins)}</strong></div><div><span>FC RÉSERVÉS</span><strong>${money(u.reservedCoins)}</strong></div><div><span>GEMS</span><strong>${money(u.gems)}</strong></div><div><span>XP</span><strong>${money(u.xp)}</strong></div><div><span>PACKS OUVERTS</span><strong>${u.packsOpened}</strong></div></div>${roleControls}${canManage?`<section class="admin-user-section"><p class="eyebrow">RESSOURCES</p><div class="admin-resource-form"><select id="adminResource"><option value="coins">FOOTCOINS</option><option value="gems">GEMS</option></select><div class="admin-amount-control"><button type="button" class="amount-step" data-resource-step="-100">−</button><input id="adminAmount" type="text" inputmode="numeric" autocomplete="off" value="0" aria-label="Montant en FOOTCOINS ou GEMS"><button type="button" class="amount-step" data-resource-step="100">+</button></div><input id="adminReason" placeholder="Motif (obligatoire)"><button class="btn btn-gold" data-admin-resource>APPLIQUER</button></div></section>`:''}<section class="admin-user-section"><p class="eyebrow">COLLECTION / ${cards.length}</p><div class="admin-mini-list">${cards.slice(0,20).map(c=>`<div><strong>${esc(c.name)}</strong><span>${esc(c.rarity)} · ${c.is_limited?`${Number(c.serial)}/${Number(c.max_supply)}`:'STANDARD'} · ${esc(c.status)} ${canManage?'<button class="mini-action" data-remove-card="'+esc(c.instance_id)+'">RETIRER</button>':''}</span></div>`).join('')||'<small>Aucune carte.</small>'}</div>${canManage?`<div class="admin-card-grant"><select id="adminCardSelect">${state.catalog.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.rarityLabel)}</option>`).join('')}</select><button class="btn btn-gold" data-grant-card>AJOUTER LA CARTE</button></div><div class="admin-card-grant"><select id="adminTransferCard"><option value="">Choisir une carte</option>${cards.map(c=>`<option value="${esc(c.instance_id)}">${esc(c.name)} · ${esc(c.rarity)} · ${c.is_limited?`${Number(c.serial)}/${Number(c.max_supply)}`:'STANDARD'}</option>`).join('')}</select><select id="adminTransferTarget"><option value="">Destinataire</option>${state.adminUsers.filter(x=>x.id!==id).map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.role)}</option>`).join('')}</select><button class="btn" data-transfer-card>TRANSFÉRER</button></div>`:''}</section><section class="admin-user-section"><p class="eyebrow">VENTES / ${sales.length}</p><div class="admin-mini-list">${sales.slice(0,10).map(x=>`<div><strong>${esc(x.card_name)}</strong><span>${esc(x.status)} · ${money(x.current_bid)} FC</span></div>`).join('')||'<small>Aucune vente.</small>'}</div></section><section class="admin-user-section"><p class="eyebrow">OFFRES / ${bids.length}</p><div class="admin-mini-list">${bids.slice(0,10).map(x=>`<div><strong>${esc(x.card_name)}</strong><span>${money(x.amount)} FC · ${esc(x.status)}</span></div>`).join('')||'<small>Aucune offre.</small>'}</div></section></div>`);
 }catch(e){toast(e.message)}
}
function cardStatDefinitions(position=''){return String(position).toUpperCase()==='GK'?[['Plongeon','shooting'],['Prise de balle','passing'],['Jeu au pied','dribbling'],['Réflexes','defending'],['Vitesse','pace'],['Placement','physical']]:[['Vitesse','pace'],['Tir','shooting'],['Passe','passing'],['Dribble','dribbling'],['Défense','defending'],['Physique','physical']];}
function rememberAdminView(tab='cards'){
 state.adminReturn={tab};
 if(tab==='cards'){
  state.adminReturn.search=$('#adminCardSearch')?.value||'';
  state.adminReturn.rarity=$('#adminCardRarity')?.value||'';
  state.adminReturn.position=$('#adminCardPosition')?.value||'';
  state.adminReturn.club=$('#adminCardClub')?.value||'';
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
 setModal('<div class="modal-box admin-user-modal catalog-card-editor"><button class="modal-close" data-close>×</button><div class="catalog-editor-head"><div><p class="eyebrow">CRÉATEUR / '+(isNew?'NOUVELLE CARTE':'ÉDITION DE CARTE')+'</p><h2>'+(isNew?'AJOUTER UNE CARTE':esc(card.name))+'</h2><p class="catalog-editor-id">'+(isNew?'Création d’une nouvelle carte joueur':esc(card.id)+' · '+esc(card.club))+'</p></div><div class="catalog-ovr-badge"><span>OVR</span><strong id="catalogOvrPreview">'+Number(card.ovr||72)+'</strong></div></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">IDENTITÉ</p><span>Informations du joueur</span></div><div class="admin-card-edit-grid"><label>Nom<input id="catalogName" value="'+esc(card.name)+'"></label>'+'<label>Poste<select id="catalogPosition">'+positionOptions+'</select></label><label>N° de maillot<input id="catalogJerseyNumber" type="number" min="1" max="99" value="'+(card.jerseyNumber??'')+'" placeholder="Ex. 10"></label><label>Compétition<select id="catalogCompetition">'+(competitionOptions||'<option value="">Aucune compétition disponible</option>')+'</select></label><label>Club<select id="catalogClub" '+(currentCompetition?'':'disabled')+'></select></label><label>Saison<select id="catalogSeason" '+(initialClubId?'':'disabled')+'></select></label><label>Nation<input id="catalogNation" value="'+esc(card.nation)+'"></label><label>Rareté<select id="catalogRarity">'+rarityOptions+'</select></label></div><p class="catalog-context-help" id="catalogSeasonHelp">Choisis une compétition, puis un club : seules les saisons dans lesquelles ce club apparaît seront proposées.</p></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">ATTRIBUTS</p><span>Réglez les 6 statistiques du joueur</span></div><div class="catalog-stats-grid">'+statHtml+'</div><div class="catalog-ovr-editor"><div><span class="catalog-ovr-label">OVR GLOBAL</span><small>Évaluation générale de la carte</small></div><div class="catalog-ovr-control"><button type="button" class="stat-step" data-ovr-step="-1">−</button><input id="catalogOvr" type="range" min="1" max="99" value="'+Number(card.ovr||72)+'"><button type="button" class="stat-step" data-ovr-step="1">+</button><output id="catalogOvrValue">'+Number(card.ovr||72)+'</output></div></div></div><div class="catalog-editor-section"><div class="catalog-editor-section-head"><p class="eyebrow">ÉDITION</p><span>Distribution de la carte</span></div><div class="admin-card-edit-grid"><label>Type<select id="catalogDistribution" '+((Number(card.totalInstances||0)>0)?'disabled':'')+'><option value="STANDARD" '+(!card.isLimited?'selected':'')+'>STANDARD — illimitée</option><option value="LIMITED" '+(card.isLimited?'selected':'')+'>LIMITED — numérotée</option></select></label><label id="catalogMaxSupplyWrap">Quantité maximale<input id="catalogMaxSupply" type="number" min="'+Math.max(1,Number(card.totalInstances||0))+'" value="'+(card.maxSupply??'')+'"></label></div></div><div class="auction-dialog-actions catalog-editor-actions"><button class="btn btn-ghost" data-close>ANNULER</button>'+(isNew?'':`<button class="btn btn-danger" data-delete-catalog-card="${esc(card.id)}">SUPPRIMER</button>`)+'<button class="btn btn-gold" data-save-catalog-card>'+(isNew?"AJOUTER LA CARTE":"ENREGISTRER")+'</button></div></div>');

 const syncStat=id=>{const range=$('#'+id),out=$('#'+id+'Out');if(!range)return;const v=Math.max(1,Math.min(99,Number(range.value)||1));range.value=v;if(out)out.textContent=v;};
 statFields.forEach(([,id])=>$('#'+id)?.addEventListener('input',()=>syncStat(id))); const positionSelect=$('#catalogPosition'); const syncPositionLabels=()=>{const defs=cardStatDefinitions(positionSelect?.value||'');document.querySelectorAll('.catalog-stat-editor .catalog-stat-head label').forEach((label,i)=>{if(defs[i]){label.textContent=defs[i][0];label.htmlFor=defs[i][1]}})}; positionSelect?.addEventListener('change',syncPositionLabels); syncPositionLabels();
 document.querySelectorAll('[data-stat-step]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.stat,range=$('#'+id);if(range){range.value=Math.max(1,Math.min(99,Number(range.value||1)+Number(btn.dataset.statStep)));syncStat(id)}}));

 const ovr=$('#catalogOvr'),ovrPreview=$('#catalogOvrPreview'),ovrValue=$('#catalogOvrValue');
 const syncOvr=()=>{const v=Math.max(1,Math.min(99,Number(ovr?.value)||1));if(ovr)ovr.value=v;if(ovrPreview)ovrPreview.textContent=v;if(ovrValue)ovrValue.textContent=v;};
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
  const body={id:isNew?'':card.id,name:$('#catalogName').value,position:$('#catalogPosition').value,jerseyNumber:$('#catalogJerseyNumber').value,ovr:Number($('#catalogOvr').value),pace:Number($('#catalogPace').value),shooting:Number($('#catalogShooting').value),passing:Number($('#catalogPassing').value),dribbling:Number($('#catalogDribbling').value),defending:Number($('#catalogDefending').value),physical:Number($('#catalogPhysical').value),rarity:$('#catalogRarity').value,club:club.name,nation:$('#catalogNation').value,season:selectedSeason.season,competitionId,seasonId,isLimited,maxSupply:isLimited?$('#catalogMaxSupply').value:null};
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
  <button class="modal-close" data-close>×</button><p class="eyebrow">CRÉATEUR / SAISON</p><h2>${season?'MODIFIER':'CRÉER'} L’ÉDITION</h2>
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
async function admin(){
 const adminReturn=state.adminReturn||null; state.adminReturn=null;
 const [o,u,a,l,com,pk]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users'),api('/api/admin/auctions'),api('/api/admin/logs'),api('/api/admin/competitions'),api('/api/admin/packs')]);
 state.user=o.admin;
 const s=o.overview.stats;
 const users=u.users||[],auctions=a.auctions||[],logs=l.logs||[],competitions=com.competitions||[],clubs=com.clubs||[],packsData=pk.packs||[],poolsData=pk.pools||[];state.adminUsers=users;state.adminCompetitions=competitions;state.adminClubs=clubs;state.adminPacks=packsData;state.adminPools=poolsData;const cardsData=(await api('/api/admin/cards')).cards||[];state.adminCards=cardsData;
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
    ${competitions.map(c=>{const compCards=cardsData.filter(card=>(c.clubIds||[]).some(id=>String(state.adminClubs.find(cl=>String(cl.id)===String(id))?.name||"").toLowerCase()===String(card.club||"").toLowerCase())).length;return `<tr class="admin-competition-row" data-search="${esc([c.name,c.tag,c.country].join(" ").toLowerCase())}" data-status="${esc(c.status||"")}"><td><div class="admin-competition-identity">${c.logo_url?'<img src="'+esc(c.logo_url)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<span class="admin-competition-logo">'+esc((c.tag||c.name||"C").slice(0,3))+'</span>'}<div><strong>${esc(c.name)}</strong><small>${esc(c.description||"Compétition")}</small></div></div></td><td><span class="admin-code-pill">${esc(c.tag||"—")}</span></td><td><span class="admin-type-pill">${/cup|coupe|champions|europa/i.test(c.name)?"Coupe":"Championnat"}</span></td><td>${esc(c.country||"—")}</td><td><strong>${Number(c.seasonCount||0)}</strong></td><td><strong>${(c.clubIds||[]).length||"—"}</strong></td><td><span class="admin-status-dot ${c.status==="available"?"is-active":"is-upcoming"}">${c.status==="available"?"Active":"À venir"}</span></td><td><div class="admin-row-actions"><button class="btn btn-gold" data-edit-competition="${esc(c.id)}">↗ Gérer</button>${state.user?.role==="creator"?'<button class="btn btn-danger" data-delete-competition="'+esc(c.id)+'" aria-label="Supprimer '+esc(c.name)+'">⌫</button>':""}</div></td></tr>`}).join("")||'<tr><td colspan="8"><div class="admin-table-empty">Aucune compétition enregistrée.</div></td></tr>'}
    </tbody></table></div>
    <div class="admin-management-table-foot"><span id="adminCompetitionCount">${competitions.length} compétition${competitions.length>1?"s":""}</span><span>Gestion des éditions et des associations</span></div>
   </div>
  </section>
  <section class="admin-management-section admin-clubs-management">
   <header class="admin-management-heading"><div class="admin-management-icon shield">⬡</div><div><p class="eyebrow">CATALOGUE / ÉQUIPES</p><h2>Clubs</h2><p class="lead">Gérez les clubs et leurs rattachements aux compétitions.</p></div><div class="admin-management-heading-action">${state.user?.role==="creator"?'<button class="btn btn-ghost" data-new-club>＋ Ajouter un club</button>':""}</div></header>
   <div class="admin-management-table-card">
    <div class="admin-management-table-head admin-club-filter-head"><div><h3>Liste des clubs</h3><p>Filtrez par compétition, pays ou statut.</p></div><div class="admin-management-tools admin-club-tools"><select id="adminClubCompetition" aria-label="Filtrer par compétition"><option value="">Toutes les compétitions</option>${competitions.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("")}</select><select id="adminClubCountry" aria-label="Filtrer par pays"><option value="">Tous les pays</option>${[...new Set(clubs.map(c=>c.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr")).map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("")}</select><label class="admin-search-field"><span>⌕</span><input id="adminClubSearch" type="search" placeholder="Rechercher un club…"></label><div class="admin-club-total"><strong>${clubs.length}</strong><span>Clubs au total</span></div></div></div>
    <div class="admin-table-wrap"><table class="admin-table admin-management-table"><thead><tr><th>Club</th><th>Code</th><th>Compétitions</th><th>Pays</th><th>Cartes</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="adminClubsBody">
    ${clubs.map(c=>{const linkedCards=cardsData.filter(card=>String(card.club||"").toLowerCase()===String(c.name||"").toLowerCase()).length;return `<tr class="admin-club-row" data-search="${esc([c.name,c.tag,c.country,(c.competitionNames||[]).join(" ")].join(" ").toLowerCase())}" data-country="${esc(c.country||"")}" data-competitions="${esc((c.competitionIds||[]).join(","))}"><td><div class="admin-club-identity">${c.logo_url?'<img class="club-logo admin-club-logo" src="'+esc(c.logo_url)+'" alt="" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';this.nextElementSibling.classList.remove(\'is-hidden\')"><span class="club-logo-fallback is-hidden">'+esc((c.tag||c.name||"CL").slice(0,3))+'</span>':'<span class="club-logo-fallback">'+esc((c.tag||c.name||"CL").slice(0,3))+'</span>'}<strong>${esc(c.name)}</strong></div></td><td><span class="admin-code-pill">${esc(c.tag||"—")}</span></td><td><small>${esc((c.competitionNames||[]).join(" · ")||"Aucune")}</small></td><td>${esc(c.country||"—")}</td><td><strong>${linkedCards.toLocaleString("fr-FR")}</strong></td><td><span class="admin-status-dot ${(c.competitionIds||[]).length?"is-active":"is-upcoming"}">${(c.competitionIds||[]).length?"Actif":"Non lié"}</span></td><td><div class="admin-row-actions">${state.user?.role==="creator"?'<button class="btn btn-gold" data-edit-club="'+esc(c.id)+'">↗ Gérer</button> <button class="btn btn-danger" data-delete-club="'+esc(c.id)+'" aria-label="Supprimer '+esc(c.name)+'">⌫</button>':"—"}</div></td></tr>`}).join("")||'<tr><td colspan="7"><div class="admin-table-empty">Aucun club enregistré.</div></td></tr>'}
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
    <div class="catalog-admin-kpi"><span class="catalog-admin-kpi-icon">▤</span><div><small>CARTES AU CATALOGUE</small><strong>${cardsData.length.toLocaleString('fr-FR')}</strong><span>Fiches joueurs actives</span></div></div>
    <div class="catalog-admin-kpi limited"><span class="catalog-admin-kpi-icon">✦</span><div><small>ÉDITIONS LIMITÉES</small><strong>${cardsData.filter(c=>c.isLimited).length.toLocaleString('fr-FR')}</strong><span>Cartes à tirage limité</span></div></div>
    <div class="catalog-admin-kpi gold"><span class="catalog-admin-kpi-icon">▣</span><div><small>EXEMPLAIRES ÉMIS</small><strong>${cardsData.reduce((sum,c)=>sum+Number(c.totalInstances||0),0).toLocaleString('fr-FR')}</strong><span>Cartes distribuées</span></div></div>
    <div class="catalog-admin-kpi violet"><span class="catalog-admin-kpi-icon">♙</span><div><small>DÉTENTEURS CUMULÉS</small><strong>${cardsData.reduce((sum,c)=>sum+Number(c.owners||0),0).toLocaleString('fr-FR')}</strong><span>Possessions sur le catalogue</span></div></div>
   </div>
   <div class="catalog-admin-list-head"><div><p class="eyebrow">BIBLIOTHÈQUE</p><h3>Catalogue des joueurs</h3><p>Recherchez, filtrez et gérez chaque fiche joueur.</p></div><span class="catalog-admin-live"><i></i> SYNCHRONISÉ</span></div>
   <div class="catalog-filter-bar catalog-admin-filters">
    <div class="catalog-search-box"><span>⌕</span><input id="adminCardSearch" type="search" value="${esc(adminReturn?.search||"")}" placeholder="Rechercher un joueur, club, nation ou ID..." autocomplete="off"><button type="button" id="adminCardSearchClear" class="catalog-filter-clear" aria-label="Effacer">×</button></div>
    <div class="catalog-filter-selects">
     <select id="adminCardRarity"><option value="">Toutes les raretés</option>${[...new Set(cardsData.map(c=>c.rarity).filter(Boolean))].map(r=>`<option value="${esc(r)}" ${adminReturn?.rarity===r?"selected":""}>${esc(String(r).toUpperCase())}</option>`).join('')}</select>
     <select id="adminCardPosition"><option value="">Tous les postes</option>${[...new Set(cardsData.map(c=>c.position).filter(Boolean))].sort((a,b)=>{const order=["GK","LB","CB","RB","LWB","RWB","DM","CM","AM","LW","RW","ST"];const ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?999:ia)-(ib<0?999:ib)||String(a).localeCompare(String(b),"fr")}).map(p=>`<option value="${esc(p)}" ${adminReturn?.position===p?"selected":""}>${esc(p)}</option>`).join('')}</select>
     <select id="adminCardClub"><option value="">Tous les clubs</option>${[...new Set(cardsData.map(c=>c.club).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'fr')).map(cl=>`<option value="${esc(cl)}" ${adminReturn?.club===cl?"selected":""}>${esc(cl)}</option>`).join('')}</select>
    </div>
    <div class="catalog-filter-footer"><span id="adminCardCount">${cardsData.length} carte${cardsData.length>1?'s':''}</span><button type="button" id="adminCardReset" class="btn btn-ghost">RÉINITIALISER</button></div>
   </div>
   <div class="catalog-admin-table-wrap"><table class="admin-table catalog-admin-table"><thead><tr><th>CARTE / JOUEUR</th><th>RARETÉ</th><th>ÉDITION</th><th>EXEMPLAIRES</th><th>DÉTENTEURS</th><th>GESTION</th></tr></thead><tbody id="adminCardsBody">${cardsData.map(c=>{const initials=String(c.name||'?').trim().split(/\\s+/).slice(0,2).map(n=>n[0]||'').join('').toUpperCase();const rarityKey=String(c.rarity||'common').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9-]/g,'');return `<tr class="admin-card-row" data-card-search="${esc([c.name,c.club,c.nation,c.id,c.position].join(' ').toLowerCase())}" data-card-rarity="${esc(c.rarity||'')}" data-card-position="${esc(c.position||'')}" data-card-club="${esc(c.club||'')}"><td><div class="catalog-admin-player"><span class="catalog-admin-player-mark">${esc(initials)}</span><div><strong>${esc(c.name)}</strong><small>${esc([c.position,c.club,c.nation].filter(Boolean).join(' · '))}</small></div></div></td><td><span class="catalog-admin-rarity rarity-${rarityKey}">${esc(String(c.rarityLabel||c.rarity||'—').toUpperCase())}</span></td><td><span class="catalog-admin-edition ${c.isLimited?'is-limited':''}">${c.isLimited?'✦ ÉDITION LIMITÉE':'STANDARD'}</span>${c.isLimited?'<small class="catalog-admin-edition-count">Plafond : '+Number(c.maxSupply||0)+'</small>':''}</td><td><span class="catalog-admin-number">${Number(c.totalInstances||0).toLocaleString('fr-FR')}${c.isLimited?' / '+Number(c.maxSupply||0).toLocaleString('fr-FR'):''}</span></td><td><span class="catalog-admin-holder-count">♙ ${Number(c.owners||0).toLocaleString('fr-FR')}</span></td><td><div class="catalog-admin-row-actions"><button class="btn btn-gold" data-manage-catalog-card="${esc(c.id)}">GÉRER ↗</button><button class="btn btn-danger" data-delete-catalog-card="${esc(c.id)}" aria-label="Supprimer ${esc(c.name)}">×</button></div></td></tr>`}).join('')||'<tr><td colspan="6"><span class="catalog-empty-state">Aucune carte ne correspond aux filtres.</span></td></tr>'}</tbody></table></div>
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
 <div class="admin-tab-panel" data-admin-panel="logs">
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
async function market(){
 try{
  const [a,c,m]=await Promise.all([api('/api/auctions'),api('/api/collection').catch(()=>({cards:[],user:null})),api('/api/me').catch(()=>({user:null}))]);
  state.auctions=a.auctions||[];state.cards=c.cards||[];state.user=m.user||c.user||null;
 }catch(e){throw e}
 const now=Date.now();
 const fmtEnd=iso=>{const sec=Math.max(0,Math.floor((new Date(iso).getTime()-Date.now())/1000));if(sec<60)return sec+'s';const min=Math.floor(sec/60);if(min<60)return min+' min';const h=Math.floor(min/60),r=min%60;return h+'h'+(r?' '+r+'min':'')};
 const auctionCard=x=>{const c=x.card||{};const mine=state.user&&x.sellerId===state.user.id;const hasBid=!!x.currentBidderId;const min=hasBid?Math.ceil(x.currentBid*1.10):x.startingBid;const status=!mine&&x.isCurrentUserBidder?'<span class="auction-status status-leading">● TU ES MEILLEUR ENCHÉRISSEUR</span>':(!mine&&x.bidCount>0?'<span class="auction-status status-outbid">● TU AS ÉTÉ DÉPASSÉ</span>':(mine&&hasBid?'<span class="auction-status status-seller">● ENCHÈRE EN COURS</span>':''));const participationStatus=x.isCurrentUserWithdrawn?'<span class="auction-status status-outbid">● PARTICIPATION ABANDONNÉE</span>':status;const sellerAction=mine?(hasBid?'<button class="btn" disabled>ENCHÈRE EN COURS</button>':'<button class="btn btn-danger" data-cancel-auction="'+esc(x.id)+'">ANNULER L’ENCHÈRE</button>'):x.isCurrentUserWithdrawn?'<button class="btn" disabled>PARTICIPATION TERMINÉE</button>':x.isCurrentUserParticipant?'<div class="auction-action-row"><button class="btn btn-gold" data-bid="'+esc(x.id)+'" data-min="'+min+'">ENCHÉRIR</button><button class="btn btn-danger" data-withdraw-auction="'+esc(x.id)+'">SE RETIRER</button></div>':'<button class="btn btn-gold" data-bid="'+esc(x.id)+'" data-min="'+min+'">ENCHÉRIR</button>';return `<article class="auction-card"><div class="auction-card-visual">${cardMarkup(c)}<span class="auction-live">LIVE</span></div><div class="auction-copy"><div class="auction-top"><span class="eyebrow">${esc(c.rarityLabel||c.rarity)} · ${esc(c.club)}</span><strong class="auction-time" data-end="${esc(x.endsAt)}">${fmtEnd(x.endsAt)}</strong></div><h3>${esc(c.name)}</h3><p>${esc(c.position)} · ${esc(c.nation)} · ${c.isLimited?esc(c.serialLabel||'LIMITED'):'STANDARD'}</p>${participationStatus}<div class="auction-price"><span>ENCHÈRE ACTUELLE</span><b>${money(x.currentBid)} FC</b></div><div class="auction-meta"><span>${x.bidCount||0} offre${x.bidCount===1?'':'s'} · <button class="auction-link" data-bids="${esc(x.id)}">VOIR</button></span><span>Min. ${money(min)} FC</span></div>${x.referencePrice?`<div class="auction-reference">RÉFÉRENCE : <strong>${money(x.referencePrice)} FC</strong><small>médiane des enchères terminées</small></div>`:''}<div class="auction-actions">${sellerAction}</div></div></article>`};
 const mineCards=state.cards.filter(c=>c.source!=='welcome'&&c.tradeable!==false);
 return `<div class="page">${viewHero('FOOTVAULT / AUCTIONS','LES <span>ENCHÈRES.</span>','Achète et vends tes cartes aux enchères. Aucune commission, et les cartes de bienvenue restent verrouillées.',state.auctions.length,'ENCHÈRES ACTIVES')}
 <div class="auction-summary"><div><span>ACTIVES</span><strong>${state.auctions.length}</strong></div><div><span>TES ENCHÈRES</span><strong>${state.auctions.filter(x=>x.isCurrentUserBidder).length}</strong></div><div><span>FC DISPONIBLES</span><strong>${money(state.user?.availableCoins??state.user?.coins??0)}</strong></div></div><div class="auction-toolbar"><div><button class="filter active" data-auction-tab="live">Enchères actives</button><button class="filter" data-auction-tab="sell">Mes cartes</button><button class="filter" data-auction-tab="history">Historique</button></div><div class="auction-tools"><input id="auctionSearch" class="auction-search" placeholder="Rechercher une carte, un club..." /><select id="auctionRarity" class="auction-select"><option value="all">Toutes raretés</option><option value="common">Common</option><option value="rare">Rare</option><option value="epic">Epic</option><option value="legendary">Legendary</option><option value="icon">Ultra Rare</option></select><select id="auctionSort" class="auction-select"><option value="ending">Fin prochaine</option><option value="price">Prix croissant</option><option value="rarity">Rareté</option></select></div></div>
 <section id="auctionLive" class="auction-grid">${(()=>{let list=state.auctions.filter(x=>state.marketRarity==="all"||x.card?.rarity===state.marketRarity);const q=(state.auctionSearch||"").toLowerCase();if(q)list=list.filter(x=>[x.card?.name,x.card?.club,x.card?.nation,x.sellerName].some(v=>String(v||"").toLowerCase().includes(q)));list.sort((a,b)=>state.marketSort==="price"?Number(a.currentBid)-Number(b.currentBid):state.marketSort==="rarity"?(rarityOrder[b.card?.rarity]||0)-(rarityOrder[a.card?.rarity]||0):new Date(a.endsAt)-new Date(b.endsAt));return list.length?list.map(auctionCard).join(""):'<div class="empty">AUCUNE ENCHÈRE NE CORRESPOND AUX FILTRES.</div>'})()}</section>
 <section id="auctionSell" class="auction-sell" hidden>
  <div class="sell-market-head">
    <div><p class="eyebrow">TES CARTES ÉLIGIBLES</p><h2>CHOISIS TA <span>CARTE.</span></h2><p>Chaque carte peut être mise aux enchères individuellement. Les cartes non échangeables sont automatiquement exclues.</p></div>
    <div class="sell-duration-note"><span>DURÉES DISPONIBLES</span><strong>10 min · 30 min · 1 h · 3 h · 6 h · 12 h · 24 h</strong></div>
  </div>
  <div class="sell-card-grid">${mineCards.length?mineCards.map(c=>`<article class="sell-card">
    <div class="sell-card-visual">${cardMarkup(c)}</div>
    <div class="sell-card-body">
      <div class="sell-card-heading"><div><span class="sell-card-kicker">${esc(c.rarityLabel||c.rarity)} · ${esc(c.club)}</span><h3>${esc(c.name)}</h3></div><span class="sell-card-ovr">OVR <b>${Number(c.ovr||0)||'—'}</b></span></div>
      <div class="sell-card-specs"><span><small>POSTE</small><b>${esc(c.position)}</b></span><span><small>NATIONALITÉ</small><b>${esc(c.nation)}</b></span><span><small>NUMÉRO</small><b>${c.jerseyNumber==null?'—':esc(c.jerseyNumber)}</b></span></div>
      <div class="sell-card-footer"><p><strong>Carte éligible</strong><span>STANDARD · échangeable</span></p><button class="btn btn-gold" data-sell-card="${esc(c.instanceId)}">METTRE AUX ENCHÈRES <span>→</span></button></div>
    </div>
  </article>`).join(''):'<div class="empty">AUCUNE CARTE ÉLIGIBLE.</div>'}</div>
</section>
<section id="auctionHistory" class="auction-grid" hidden><div class="empty">L’historique sera chargé à l’ouverture de cet onglet.</div></section>
 </div>`
}
async function render(){shell();const {r,q}=route();let html='';try{if(r==='home')html=await home();else if(r==='collection')html=await collection();else if(r==='packs')html=await packs();else if(r==='vault')html=await vault();else if(r==='album')html=await album();else if(r==='card')html=await cardDetail(q.get('id'));else if(r==='auth')html=authView(q.get('mode')==='register'?'register':'login',q.get('next')||'vault');else if(r==='market')html=await market();else if(r==='admin')html=await admin();else html=home();app().innerHTML=html;bind();nav();}catch(e){app().innerHTML=`<div class="page"><div class="empty">${esc(e.message)}</div></div>`}}
async function loadAuctionHistory(){
 try{const d=await api('/api/auctions/history');state.auctionHistory=d.auctions||[];return state.auctionHistory}catch(e){toast(e.message);return[]}
}
async function showBidHistory(id){try{const d=await api('/api/auctions/'+encodeURIComponent(id)+'/bids');const bids=d.bids||[];const rows=bids.map(b=>'<div class="bid-row"><strong>'+esc(b.bidderName)+'</strong><span>'+money(b.amount)+' FC</span></div>').join('');setModal('<div class="modal-box auction-modal-box"><button class="modal-close" data-close>×</button><p class="eyebrow">FOOTVAULT / ENCHÈRES</p><h2>HISTORIQUE DES OFFRES</h2><div class="bid-history">'+(rows||'<div class="empty">Aucune offre.</div>')+'</div></div>')}catch(e){toast(e.message)}}function updateAuctionTimers(){document.querySelectorAll('.auction-time[data-end]').forEach(el=>{const sec=Math.max(0,Math.floor((new Date(el.dataset.end).getTime()-Date.now())/1000));if(sec<=0){el.textContent='TERMINÉE';return}if(sec<60)el.textContent=sec+' s';else if(sec<3600)el.textContent=Math.floor(sec/60)+' min';else{const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);el.textContent=h+' h'+(m?' '+m+' min':'')}})}function startAuctionTimer(){clearInterval(window.auctionTimer);if($('#auctionLive')){updateAuctionTimers();window.auctionTimer=setInterval(updateAuctionTimers,1000)}}function auctionSearchFilter(){
 const input=$('#auctionSearch');if(!input)return;
 const q=input.value.trim().toLowerCase();
 document.querySelectorAll('.auction-card').forEach(card=>card.style.display=!q||card.textContent.toLowerCase().includes(q)?'':'none');
}
function siteConfirmDialog({title,subtitle='',confirm='CONFIRMER'}){
 return new Promise(resolve=>{
  const safeTitle=esc(title).replace(/ \?/g,'&nbsp;?');setModal(`<div class="modal-box auction-modal-box"><button class="modal-close" data-close>×</button><p class="eyebrow">FOOTVAULT / CONFIRMATION</p><h2>${safeTitle}</h2>${subtitle?`<p class="auction-dialog-subtitle">${esc(subtitle)}</p>`:''}<div class="auction-dialog-actions"><button class="btn btn-ghost" id="siteConfirmCancel">ANNULER</button><button class="btn btn-gold" id="siteConfirmOk">${esc(confirm)}</button></div></div>`);
  const finish=v=>{closeModal();resolve(v)};
  $('#siteConfirmCancel').onclick=()=>finish(null);
  $('#siteConfirmOk').onclick=()=>finish(true);
 });
}
function auctionDialog({title,subtitle='',label='Valeur',value='',type='number',options=null,confirm='CONFIRMER'}){
 return new Promise(resolve=>{
  const isConfirm=type==='confirm';
  setModal(`<div class="modal-box auction-modal-box"><button class="modal-close" data-close>×</button><p class="eyebrow">FOOTVAULT / ENCHÈRES</p><h2>${esc(title)}</h2>${subtitle?`<p class="auction-dialog-subtitle">${esc(subtitle)}</p>`:''}${isConfirm?'':`<div class="auction-dialog-form">${options?`<label class="auction-field"><span>${esc(label)}</span><select id="auctionDialogValue">${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`:`<label class="auction-field"><span>${esc(label)}</span><input id="auctionDialogValue" type="${type}" value="${esc(value)}" min="1" inputmode="numeric" autocomplete="off"></label>`}</div>`}<div class="auction-dialog-actions"><button class="btn btn-ghost" id="auctionDialogCancel">ANNULER</button><button class="btn btn-gold" id="auctionDialogConfirm">${esc(confirm)}</button></div></div>`);
  const input=$('#auctionDialogValue');const finish=(v)=>{closeModal();resolve(v)};
  $('#auctionDialogCancel').onclick=()=>finish(null);
  $('#auctionDialogConfirm').onclick=()=>{if(!isConfirm&&!options&&(!input.value||Number(input.value)<1)){input.focus();return}finish(isConfirm?true:input.value)};
  if(input&&!options){input.focus();input.select();input.onkeydown=e=>{if(e.key==='Enter')$('#auctionDialogConfirm').click();if(e.key==='Escape')$('#auctionDialogCancel').click()}}
 });
}
async function bidAuction(id,min){
 const amount=await auctionDialog({title:'PLACER UNE ENCHÈRE',subtitle:`Minimum actuel : ${money(min)} FC. Une nouvelle offre doit respecter le minimum affiché.`,label:'Ton offre en FOOTCOINS',value:min});
 if(amount===null)return;
 try{const d=await api('/api/auctions/bid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id,amount:Number(amount)})});toast(`Enchère de ${money(d.auction.currentBid)} FC enregistrée`);render()}catch(e){toast(e.message)}
}
async function withdrawAuction(id){ const ok=await auctionDialog({title:'SE RETIRER DE L’ENCHÈRE ?',subtitle:'Après ton retrait, tu ne pourras plus enchérir sur cette enchère. Cette décision ne bloque aucune autre enchère de cette carte.',label:'Confirmation',type:'confirm',confirm:'SE RETIRER'}); if(ok===null)return; try{await api('/api/auctions/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id})});toast('Tu as quitté cette enchère.');render()}catch(e){toast(e.message)} }
async function cancelAuction(id){
 const ok=await auctionDialog({title:'ANNULER L’ENCHÈRE ?',subtitle:'La carte sera immédiatement remise dans ta collection. Cette action est possible uniquement tant qu’aucune offre n’a été placée.',label:'Confirmation',type:'confirm',confirm:'ANNULER L’ENCHÈRE'});
 if(ok===null)return;
 try{await api('/api/auctions/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auctionId:id})});toast('Enchère annulée · carte récupérée.');render()}catch(e){toast(e.message)}
}
async function createAuction(cardId){
 const start=await auctionDialog({title:'CRÉER UNE ENCHÈRE',subtitle:'Définis le montant de départ. Ta carte sera bloquée pendant l’enchère.',label:'Mise de départ en FOOTCOINS',value:100});
 if(start===null)return;
 const durations=[['10','10 minutes'],['30','30 minutes'],['60','1 heure'],['180','3 heures'],['360','6 heures'],['720','12 heures'],['1440','24 heures']];
 const duration=await auctionDialog({title:'DURÉE DE L’ENCHÈRE',subtitle:'Choisis combien de temps ton annonce restera active.',label:'Durée',value:'30',options:durations.map(([value,label])=>({value,label}))});
 if(duration===null)return;
 try{await api('/api/auctions/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardInstanceId:cardId,startingBid:Number(start),duration:Number(duration)})});toast('Enchère créée.');render()}catch(e){toast(e.message)}
}
document.addEventListener('click',e=>{const btn=e.target.closest('#logoutBtn,#mobileLogoutBtn');if(btn){e.preventDefault();e.stopPropagation();logout()}});
function showPoolEditor(pool=null){
 const p=pool||{id:'',name:'',type:'manual',config:{}};
 const cfg=p.config||{}, selectedCardIds=new Set((cfg.cardIds||[]).map(String));
 const cards=state.adminCards||[];
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
  if(results)results.innerHTML=filtered.map(c=>{const id=String(c.id),sel=selectedCardIds.has(id);return `<label class="pool-card-tile ${sel?'is-selected':''}"><input type="checkbox" value="${esc(id)}" data-pool-card ${sel?'checked':''}><span class="pool-check">✓</span><div class="pool-card-tile-info"><strong>${esc(c.name)}</strong><small>${esc(c.position||'—')} · ${esc(c.club||'—')} · ${esc(c.nation||'—')}</small><b>${esc(c.rarityLabel||c.rarity||'')} · OVR ${Number(c.ovr||0)}</b></div></label>`}).join('')||'<div class="empty">Aucune carte ne correspond aux filtres.</div>';
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
function showPackEditor(pack=null){
 const p=pack||{id:'',name:'',price:100,cards:5,badge:'',description:'',guarantee:'rare',guarantee_count:1,conditions:{},active:true};
 const cfg=p.conditions||{}, arr=v=>Array.isArray(v)?v.map(String):[];
 const selected={rarities:new Set(arr(cfg.rarities)),clubs:new Set(arr(cfg.clubs)),seasons:new Set(arr(cfg.seasons)),nations:new Set(arr(cfg.nations)),positions:new Set(arr(cfg.positions))};
 const cards=state.adminCards||[];
 const seasons=[...new Set(cards.map(c=>String(c.season||'')).filter(Boolean))].sort((a,b)=>b.localeCompare(a,'fr',{numeric:true}));
 const clubs=[...new Set(cards.map(c=>String(c.club||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const nations=[...new Set(cards.map(c=>String(c.nation||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const positions=[...new Set(cards.map(c=>String(c.position||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const multi=(id,values,set)=>'<div class="pack-condition-checks" id="'+id+'">'+values.map(v=>'<label><input type="checkbox" value="'+esc(v)+'" '+(set.has(v)?'checked':'')+'><span>'+esc(v.toUpperCase())+'</span></label>').join('')+'</div>';
 const select=(id,label,values,set,icon)=>'<label class="pack-select-field"><span>'+icon+' '+label+'</span><select id="'+id+'"><option value="">Tous</option>'+values.map(v=>'<option value="'+esc(v)+'" '+(set.size===1&&set.has(v)?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
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
     <label class="pack-switch-row"><input id="packActive" type="checkbox" ${p.active!==false?'checked':''}><span class="pack-switch"></span><span><b>Pack disponible</b><small>Le pack sera visible et achetable par les joueurs.</small></span></label>
    </section>
   </div>
   <div class="pack-editor-right">
    <section class="pack-editor-card"><h3><span>▣</span> SOURCE DU PACK</h3><p class="pack-help">Choisis une réserve de cartes (pool). Sans pool, les conditions ci-dessous s'appliquent au catalogue.</p><label class="pack-select-field"><span>▤ POOL DE CARTES</span><select id="packPool"><option value="">Catalogue selon conditions</option>${(state.adminPools||[]).map(v=>'<option value="'+esc(v.id)+'" '+(String(p.pool_id||'')===String(v.id)?'selected':'')+'>'+esc(v.name)+'</option>').join('')}</select></label></section><section class="pack-editor-card pack-conditions-card"><h3><span>⌖</span> CONDITIONS DU PACK</h3><p class="pack-help">Le pack tire directement dans le catalogue selon ces conditions. <b>Aucun pool n'est utilisé.</b></p>
     <div class="pack-condition-grid">
      <div class="pack-filter-box"><div class="pack-filter-title">RARETÉS AUTORISÉES</div>${multi('packRarities',['common','rare','epic','legendary','icon'],selected.rarities)}</div>
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
  const conditions={rarities:getChecked('packRarities'),positions:one('#packPosition'),clubs:one('#packClub'),nations:one('#packNation'),seasons:one('#packSeason'),minOvr:$('#packMinOvr').value===''?null:Number($('#packMinOvr').value),maxOvr:$('#packMaxOvr').value===''?null:Number($('#packMaxOvr').value),limitedOnly:$('#packLimitedOnly').checked,standardOnly:$('#packStandardOnly').checked};
  if(!$('#packName').value.trim())return toast('Le nom du pack est obligatoire.');
  if(conditions.limitedOnly&&conditions.standardOnly)return toast('Un pack ne peut pas être LIMITED et STANDARD uniquement.');
  if(conditions.minOvr!=null&&conditions.maxOvr!=null&&conditions.minOvr>conditions.maxOvr)return toast('L’OVR minimum ne peut pas dépasser l’OVR maximum.');
  try{await api('/api/admin/packs',{method:'POST',body:JSON.stringify({action:pack?'pack_update':'pack_create',id:p.id,name:$('#packName').value.trim(),price:Number($('#packPrice').value),cards:Number($('#packCards').value),badge:$('#packBadge').value.trim(),description:$('#packDescription').value.trim(),poolId:$('#packPool').value||null,conditions,guarantee:$('#packGuarantee').value,guaranteeCount:Number($('#packGuaranteeCount').value),active:$('#packActive').checked})});rememberAdminView('packs');closeModal();toast('Pack enregistré.');render()}catch(e){toast(e.message)}
 };
}
function applyShopFilters(){
 const grid=$('#shopPackGrid');if(!grid)return;
 const cards=[...grid.querySelectorAll('[data-shop-pack]')],q=String(state.packShopSearch||'').trim().toLowerCase();
 const visible=cards.filter(c=>(state.packShopType==='all'||c.dataset.type===state.packShopType)&&Number(c.dataset.price||0)<=Number(state.packShopMax)&&(!q||c.dataset.name.includes(q)));
 cards.forEach(c=>c.hidden=!visible.includes(c));
 if(state.packShopSort==='price-asc')visible.sort((a,b)=>Number(a.dataset.price)-Number(b.dataset.price));
 else if(state.packShopSort==='price-desc')visible.sort((a,b)=>Number(b.dataset.price)-Number(a.dataset.price));
 else if(state.packShopSort==='name')visible.sort((a,b)=>a.querySelector('h3').textContent.localeCompare(b.querySelector('h3').textContent,'fr'));
 visible.forEach(c=>grid.appendChild(c));
 const count=$('#shopResultCount');if(count)count.textContent=visible.length+' pack'+(visible.length>1?'s':'');
 const empty=$('#shopNoResults');if(empty)empty.hidden=visible.length>0;
}
function bind(){
 const seasonSortSelect=$('#seasonSortSelect');
 if(seasonSortSelect)seasonSortSelect.onchange=()=>{const r=route(),params=new URLSearchParams(r.q);params.set('sort',seasonSortSelect.value);location.hash='album?'+params.toString();};

 document.querySelectorAll('[data-admin-user]').forEach(x=>x.onclick=()=>showAdminUser(x.dataset.adminUser)); 
 document.querySelectorAll('[data-admin-action]').forEach(x=>x.onclick=async()=>{const action=x.dataset.adminAction,id=document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent;if(!id)return;try{await api('/api/admin/users/'+encodeURIComponent(id)+'/action',{method:'POST',body:JSON.stringify({action})});toast(action==='ban'?'Compte banni.':action==='block'?'Compte bloqué 24 h.':'Compte réactivé.');showAdminUser(id)}catch(e){toast(e.message)}});document.querySelectorAll('[data-admin-role]').forEach(x=>x.onclick=async()=>{const id=document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent;try{await api('/api/admin/users/'+encodeURIComponent(id)+'/role',{method:'POST',body:JSON.stringify({role:x.dataset.adminRole})});toast('Rôle modifié.');showAdminUser(id)}catch(e){toast(e.message)}});document.querySelectorAll('[data-resource-step]').forEach(x=>x.onclick=()=>{const input=$('#adminAmount');const current=Number(input?.value)||0;if(input)input.value=String(current+Number(x.dataset.resourceStep));});document.querySelectorAll('[data-admin-resource]').forEach(x=>x.onclick=async()=>{const id=document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent,amount=Number($('#adminAmount')?.value),reason=$('#adminReason')?.value;if(!reason||!Number.isInteger(amount)||amount===0)return toast('Montant et motif obligatoires.');try{await api('/api/admin/users/'+encodeURIComponent(id)+'/resources',{method:'POST',body:JSON.stringify({resource:$('#adminResource').value,amount,reason})});toast('Ressource modifiée.');showAdminUser(id)}catch(e){toast(e.message)}});document.querySelectorAll('[data-remove-card]').forEach(x=>x.onclick=async()=>{const id=document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent;try{await api('/api/admin/cards/remove',{method:'POST',body:JSON.stringify({instanceId:x.dataset.removeCard})});toast('Carte retirée.');showAdminUser(id)}catch(e){toast(e.message)}});document.querySelectorAll('[data-grant-card]').forEach(x=>x.onclick=async()=>{const id=document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent;try{await api('/api/admin/cards/grant',{method:'POST',body:JSON.stringify({userId:id,cardId:$('#adminCardSelect').value})});toast('Carte ajoutée.');showAdminUser(id)}catch(e){toast(e.message)}});document.querySelectorAll('[data-transfer-card]').forEach(x=>x.onclick=async()=>{const id=$('#adminTransferTarget')?.value,instanceId=$('#adminTransferCard')?.value;if(!id||!instanceId)return toast('Choisis une carte et un destinataire.');try{await api('/api/admin/cards/transfer',{method:'POST',body:JSON.stringify({instanceId,toUserId:id})});toast('Carte transférée.');showAdminUser(document.querySelector('[data-admin-user-current]')?.dataset.adminUserCurrent)}catch(e){toast(e.message)}});
 document.querySelectorAll('[data-manage-catalog-card]').forEach(x=>x.onclick=()=>{const card=state.adminCards.find(c=>c.id===x.dataset.manageCatalogCard);if(card){state.adminReturn={tab:"cards",search:$("#adminCardSearch")?.value||"",rarity:$("#adminCardRarity")?.value||"",position:$("#adminCardPosition")?.value||"",club:$("#adminCardClub")?.value||""};showCatalogCardEditor(card)}}); document.querySelectorAll('[data-new-catalog-card]').forEach(x=>x.onclick=()=>showCatalogCardEditor({id:"",name:"",position:"ST",jerseyNumber:null,club:"",nation:"France",rarity:"common",ovr:72,pace:72,shooting:72,passing:72,dribbling:72,defending:72,physical:72,isLimited:false,maxSupply:null,season:""},true)); document.querySelectorAll('[data-delete-catalog-card]').forEach(x=>x.onclick=async()=>{
  const card=state.adminCards.find(c=>String(c.id)===String(x.dataset.deleteCatalogCard));if(!card)return;
  try{
   const preview=await api('/api/admin/cards/delete',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cardId:x.dataset.deleteCatalogCard,confirm:false})});
   const owned=Number(preview.owned||0),total=Number(preview.total||0),auction=Number(preview.auction||0);
   const title=owned>0||total>0?'SUPPRIMER CE JOUEUR ?':'SUPPRIMER CETTE CARTE ?';
   let subtitle='';
   if(owned>0) subtitle='Il y a encore '+owned+' carte'+(owned>1?'s':'')+' possédée'+(owned>1?'s':'')+' par les joueurs. Supprimer « '+card.name+' » supprimera définitivement ces exemplaires de tous les comptes.';
   else if(total>0) subtitle='Il reste '+total+' exemplaire'+(total>1?'s':'')+' de cette carte en circulation. Ils seront tous supprimés.';
   else subtitle='Aucun exemplaire n’est actuellement possédé. Cette carte sera retirée du catalogue.';
   if(auction>0) subtitle+=' '+auction+' enchère'+(auction>1?'s':'')+' en cours sera'+(auction>1?'ont':'')+' également annulée'+(auction>1?'s':'')+' et les FC réservés seront restitués.';
   subtitle+=' Valider ?';
   const ok=await siteConfirmDialog({title,subtitle,confirm:'SUPPRIMER'});if(ok===null)return;
   const result=await api('/api/admin/cards/delete',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cardId:x.dataset.deleteCatalogCard,confirm:true})});
   rememberAdminView('cards');closeModal();toast(result.deletedInstances?'Joueur supprimé · '+result.deletedInstances+' carte'+(result.deletedInstances>1?'s':'')+' retirée'+(result.deletedInstances>1?'s':'')+'.':'Carte supprimée du catalogue.');render();
  }catch(e){toast(e.message)}
 });
 const cardSearch=$('#adminCardSearch'),cardRarity=$('#adminCardRarity'),cardPosition=$('#adminCardPosition'),cardClub=$('#adminCardClub'),cardCount=$('#adminCardCount'),cardReset=$('#adminCardReset'),cardClear=$('#adminCardSearchClear');
 const filterCards=()=>{const q=(cardSearch?.value||'').trim().toLowerCase(),rar=cardRarity?.value||'',pos=cardPosition?.value||'',club=cardClub?.value||'';let n=0;document.querySelectorAll('.admin-card-row').forEach(row=>{const ok=(!q||row.dataset.cardSearch.includes(q))&&(!rar||row.dataset.cardRarity===rar)&&(!pos||row.dataset.cardPosition===pos)&&(!club||row.dataset.cardClub===club);row.hidden=!ok;row.style.display=ok?'':'none';if(ok)n++});if(cardCount)cardCount.textContent=n+' carte'+(n>1?'s':'');};
 if(cardSearch){cardSearch.oninput=filterCards;cardSearch.onchange=filterCards;} [cardRarity,cardPosition,cardClub].forEach(el=>{if(el){el.onchange=filterCards;el.oninput=filterCards;}}); filterCards();
 cardClear?.addEventListener('click',()=>{if(cardSearch){cardSearch.value='';filterCards();cardSearch.focus()}});
 cardReset?.addEventListener('click',()=>{if(cardSearch)cardSearch.value='';if(cardRarity)cardRarity.value='';if(cardPosition)cardPosition.value='';if(cardClub)cardClub.value='';filterCards()});document.querySelectorAll('[data-new-pack]').forEach(x=>x.onclick=()=>showPackEditor());document.querySelectorAll('[data-pool-draw]').forEach(x=>x.onclick=()=>openPool(x.dataset.poolDraw));document.querySelectorAll('[data-edit-pack]').forEach(x=>x.onclick=()=>showPackEditor(state.adminPacks.find(v=>v.id===x.dataset.editPack)));document.querySelectorAll('[data-delete-pack]').forEach(x=>x.onclick=async()=>{const ok=await siteConfirmDialog({title:'SUPPRIMER CE PACK ?',subtitle:'Ce pack ne sera plus disponible. Cette action est définitive.',confirm:'SUPPRIMER'});if(ok===null)return;try{await api('/api/admin/packs',{method:'POST',body:JSON.stringify({action:'pack_delete',id:x.dataset.deletePack})});toast('Pack supprimé.');render();}catch(e){toast(e.message)}});document.querySelectorAll('[data-new-pool]').forEach(x=>x.onclick=()=>showPoolEditor());document.querySelectorAll('[data-edit-pool]').forEach(x=>x.onclick=()=>showPoolEditor(state.adminPools.find(v=>v.id===x.dataset.editPool)));document.querySelectorAll('[data-delete-pool]').forEach(x=>x.onclick=async()=>{const ok=await siteConfirmDialog({title:'SUPPRIMER CE POOL ?',subtitle:'Le pool doit ne plus être utilisé par un pack.',confirm:'SUPPRIMER'});if(ok===null)return;try{await api('/api/admin/packs',{method:'POST',body:JSON.stringify({action:'pool_delete',id:x.dataset.deletePool})});toast('Pool supprimé.');render();}catch(e){toast(e.message)}});
document.querySelectorAll('[data-new-competition]').forEach(x=>x.onclick=()=>showCompetitionEditor(null));document.querySelectorAll('[data-edit-competition]').forEach(x=>x.onclick=()=>showCompetitionEditor(state.adminCompetitions.find(v=>v.id===x.dataset.editCompetition)));document.querySelectorAll('[data-delete-competition]').forEach(x=>x.onclick=async()=>{try{await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:'delete',id:x.dataset.deleteCompetition})});toast('Compétition supprimée.');render()}catch(e){toast(e.message)}});document.querySelectorAll('[data-new-club]').forEach(x=>x.onclick=()=>showClubEditor(null));document.querySelectorAll('[data-edit-club]').forEach(x=>x.onclick=()=>showClubEditor(state.adminClubs.find(v=>v.id===x.dataset.editClub)));document.querySelectorAll('[data-delete-club]').forEach(x=>x.onclick=async()=>{const club=state.adminClubs.find(v=>String(v.id)===String(x.dataset.deleteClub));const ok=await siteConfirmDialog({title:'SUPPRIMER CE CLUB ?',subtitle:`Le club ${club?.name||''} sera retiré des compétitions et saisons. Les cartes déjà liées à ce club seront conservées et garderont leur référence historique. Cette action est définitive.`,confirm:'SUPPRIMER'});if(ok===null)return;try{await api('/api/admin/competitions',{method:'POST',body:JSON.stringify({action:'club_delete',id:x.dataset.deleteClub})});toast('Club supprimé.');render()}catch(e){toast(e.message)}});
 document.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-admin-panel]').forEach(p=>p.classList.toggle('active',p.dataset.adminPanel===b.dataset.adminTab))});
 const compSearch=$("#adminCompetitionSearch"),compStatus=$("#adminCompetitionStatus"),compCount=$("#adminCompetitionCount");
 const filterAdminCompetitions=()=>{const q=(compSearch?.value||"").trim().toLowerCase(),st=compStatus?.value||"";let n=0;document.querySelectorAll(".admin-competition-row").forEach(row=>{const ok=(!q||row.dataset.search.includes(q))&&(!st||row.dataset.status===st);row.hidden=!ok;row.style.display=ok?"":"none";if(ok)n++});if(compCount)compCount.textContent=n+" compétition"+(n>1?"s":"");};
 if(compSearch)compSearch.oninput=filterAdminCompetitions;if(compStatus)compStatus.onchange=filterAdminCompetitions;filterAdminCompetitions();
 const clubSearch=$("#adminClubSearch"),clubCompetition=$("#adminClubCompetition"),clubCountry=$("#adminClubCountry"),clubCount=$("#adminClubCount");
 const filterAdminClubs=()=>{const q=(clubSearch?.value||"").trim().toLowerCase(),co=clubCompetition?.value||"",country=clubCountry?.value||"";let n=0;document.querySelectorAll(".admin-club-row").forEach(row=>{const ids=(row.dataset.competitions||"").split(",");const ok=(!q||row.dataset.search.includes(q))&&(!co||ids.includes(co))&&(!country||row.dataset.country===country);row.hidden=!ok;row.style.display=ok?"":"none";if(ok)n++});if(clubCount)clubCount.textContent=n+" club"+(n>1?"s":"");};
 if(clubSearch)clubSearch.oninput=filterAdminClubs;[clubCompetition,clubCountry].forEach(el=>{if(el)el.onchange=filterAdminClubs});filterAdminClubs();
 const adminSearch=$('#adminUserSearch'),adminRoleFilter=$('#adminUserRoleFilter'),adminUserSort=$('#adminUserSort'),adminUserCount=$('#adminUserCount');
  const applyAdminUserView=()=>{const role=adminRoleFilter?.value||'',sort=adminUserSort?.value||'name',body=$('#adminUsersBody');if(!body)return;const rows=[...body.querySelectorAll('.admin-user-row')];rows.sort((a,b)=>sort==='coins'?Number(b.dataset.userCoins)-Number(a.dataset.userCoins):sort==='cards'?Number(b.dataset.userCards)-Number(a.dataset.userCards):sort==='sales'?Number(b.dataset.userSales)-Number(a.dataset.userSales):a.dataset.userSearch.localeCompare(b.dataset.userSearch,'fr'));let n=0;rows.forEach(row=>{const ok=!role||row.dataset.userRole===role;row.hidden=!ok;row.style.display=ok?'':'none';if(ok)n++;body.appendChild(row)});if(adminUserCount)adminUserCount.textContent=n+' compte'+(n>1?'s':'')+' affiché'+(n>1?'s':'')};
  if(adminSearch){let t;adminSearch.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{await refreshAdminUsers(adminSearch.value);applyAdminUserView()},250)}}
  if(adminRoleFilter)adminRoleFilter.onchange=applyAdminUserView;if(adminUserSort)adminUserSort.onchange=applyAdminUserView;applyAdminUserView();
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;render()});
 document.querySelectorAll('[data-shop-type]').forEach(x=>x.onchange=()=>{state.packShopType=x.checked?x.dataset.shopType:'all';document.querySelectorAll('[data-shop-type]').forEach(y=>{if(y!==x)y.checked=false});applyShopFilters()});
 const shopSearch=$('#shopSearch');if(shopSearch)shopSearch.oninput=()=>{state.packShopSearch=shopSearch.value;applyShopFilters()};
 const shopPrice=$('#shopPriceRange');if(shopPrice)shopPrice.oninput=()=>{state.packShopMax=Number(shopPrice.value);const label=$('#shopPriceValue');if(label)label.textContent=money(state.packShopMax)+' FC';applyShopFilters()};
 const shopSort=$('#shopSort');if(shopSort)shopSort.onchange=()=>{state.packShopSort=shopSort.value;applyShopFilters()};
 document.querySelector('[data-shop-reset]')?.addEventListener('click',()=>{state.packShopType='all';state.packShopSearch='';state.packShopMax=5000;state.packShopSort='recent';render()});
 document.querySelectorAll('[data-pack]').forEach(b=>b.onclick=()=>openPack(b.dataset.pack));
 const dailyBtn=$('#daily');if(dailyBtn)dailyBtn.onclick=daily;
 document.querySelectorAll('[data-mission]').forEach(b=>b.onclick=()=>mission(b.dataset.mission));document.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>task(b.dataset.taskKind,b.dataset.task));
 document.querySelectorAll('[data-album-season]').forEach(b=>b.onclick=()=>claimAlbum(b.dataset.albumSeason,b.dataset.albumClub));
 document.querySelectorAll('[data-bid]').forEach(b=>b.onclick=()=>bidAuction(b.dataset.bid,Number(b.dataset.min)));
 document.querySelectorAll('[data-sell-card]').forEach(b=>b.onclick=()=>createAuction(b.dataset.sellCard));
 document.querySelectorAll('[data-cancel-auction]').forEach(b=>b.onclick=()=>cancelAuction(b.dataset.cancelAuction));startAuctionTimer();document.querySelectorAll('[data-bids]').forEach(b=>b.onclick=()=>showBidHistory(b.dataset.bids));document.querySelectorAll('[data-withdraw-auction]').forEach(b=>b.onclick=()=>withdrawAuction(b.dataset.withdrawAuction));
 document.querySelectorAll('[data-auction-tab]').forEach(b=>b.onclick=async()=>{
   document.querySelectorAll('[data-auction-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
   const tab=b.dataset.auctionTab;
   $('#auctionLive').hidden=tab!=='live';$('#auctionSell').hidden=tab!=='sell';$('#auctionHistory').hidden=tab!=='history';
   if(tab==='history'){const rows=await loadAuctionHistory();$('#auctionHistory').innerHTML=rows.length?rows.map(x=>`<article class="panel"><div style="display:flex;justify-content:space-between;gap:15px"><div><p class="eyebrow">TERMINÉE</p><h3>${esc(x.card?.name||'Carte')}</h3><p>${esc(x.card?.club||'')} · ${esc(x.card?.rarityLabel||'')}</p></div><strong style="font:900 28px var(--head);color:var(--gold2)">${money(x.currentBid)} FC</strong></div><small style="color:var(--muted)">Vendeur : ${esc(x.sellerName||'—')} · ${x.currentBidderName?'Gagnant : '+esc(x.currentBidderName):'Aucune offre'}</small></article>`).join(''):'<div class="empty">AUCUNE HISTORIQUE.</div>';}
 });
 const search=$('#auctionSearch');if(search)search.oninput=e=>{state.auctionSearch=e.target.value;render()};const rarity=$('#auctionRarity');if(rarity)rarity.onchange=e=>{state.marketRarity=e.target.value;render()};const sort=$('#auctionSort');if(sort)sort.onchange=e=>{state.marketSort=e.target.value;render()};const collectionSearch=$('#collectionSearch');if(collectionSearch)collectionSearch.oninput=e=>{state.collectionSearch=e.target.value;const q=e.target.value.trim().toLowerCase();document.querySelectorAll('[data-collection-card-search]').forEach(card=>{card.closest('.collection-rarity-section')?.classList.remove('search-empty');card.hidden=!!q&&!card.dataset.collectionCardSearch.includes(q)});document.querySelectorAll('.collection-rarity-section').forEach(section=>{const visible=[...section.querySelectorAll('[data-collection-card-search]')].some(card=>!card.hidden);section.classList.toggle('search-empty',!!q&&!visible)});};const collectionSort=$('#collectionSort');if(collectionSort)collectionSort.onchange=e=>{state.collectionSort=e.target.value;render()};
 const form=$('#authForm');if(form)form.onsubmit=submitAuth;
 const sw=$('#switchAuth');if(sw)sw.onclick=()=>{const mode=state.authMode==='register'?'login':'register';location.hash=`auth?mode=${mode}`};
}
window.addEventListener('hashchange',render);window.addEventListener('load',async()=>{try{const d=await api('/api/me');state.user=d.user}catch{}render()});return{render}})();

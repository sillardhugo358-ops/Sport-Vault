// Amis et profils publics (pages « amis » et « joueur »). Chargé après app.js : aides par FVC.core, pages enregistrées dans FVC.pages.
// Serveur : /api/friends/*, /api/players/profile, /api/profile/visibility (lib/friends.js) ; il décide de tout, ici seulement l'affichage.
(()=>{
const {$,api,esc,render,toast,viewHero,cardMarkup}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const VIS={public:'Tous les joueurs',friends:'Mes amis seulement',private:'Moi seul'};
const section=(eyebrow,title,body)=>'<section class="section friends-section"><div class="section-head"><div><p class="eyebrow">'+eyebrow+'</p><h2>'+title+'</h2></div></div>'+body+'</section>';
const person=(p,actions)=>'<li class="friend-row"><a class="friend-name" href="#joueur?code='+encodeURIComponent(p.code)+'"><strong>'+esc(p.name)+'</strong><small>Niveau '+Number(p.level)+'</small></a><span class="friend-actions">'+actions+'</span></li>';
const list=(items,empty)=>items.length?'<ul class="friend-list">'+items.join('')+'</ul>':'<p class="friend-empty">'+empty+'</p>';

const RL={epic:'Epic',legendary:'Legendary',icon:'Icon'};
const when=d=>{const m=Math.max(1,Math.round((Date.now()-new Date(d))/60000));return m<60?m+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' j'};
const eventText=e=>{
  const who='<a href="#joueur?code='+encodeURIComponent(e.code)+'"><strong>'+esc(e.name)+'</strong></a>';
  if(e.kind==='card')return who+' a obtenu <strong>'+esc(e.label)+'</strong> <span class="rarity-tag rarity-'+esc(e.rarity)+'">'+esc(RL[e.rarity]||e.rarity)+'</span>'+(e.serial?' · édition limitée '+esc(e.serial):'');
  if(e.kind==='set')return who+' a terminé le set <strong>'+esc(e.label)+'</strong>';
  return who+' a débloqué le succès <strong>'+esc(e.label)+'</strong>';
};
const activityList=ev=>ev.length?'<ul class="friend-activity">'+ev.map(e=>'<li>'+eventText(e)+'<time datetime="'+esc(String(e.at))+'">il y a '+when(e.at)+'</time></li>').join('')+'</ul>':'<p class="friend-empty">Rien de marquant ces 14 derniers jours : cartes Epic ou mieux, sets terminés et succès apparaîtront ici.</p>';

// Rivalités d'album : jauge de complétion (cartes différentes du catalogue actif) de moi face à chaque rival épinglé (3 au plus).
const pctText=n=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:1})+' %';
const gauge=(label,n,total,pct)=>'<div class="rival-row"><span>'+esc(label)+'</span><progress max="'+Number(total)+'" value="'+Number(n)+'" aria-label="'+esc(label)+' : '+Number(n)+' cartes sur '+Number(total)+'"></progress><b>'+pctText(pct)+'</b></div>';
const rivalOff=(r)=>'<button class="btn btn-outline" type="button" data-friend-rival="'+esc(r.code)+'" data-on="0" aria-label="Retirer '+esc(r.name)+' de mes rivaux">Retirer</button>';
function rivalCard(r){
  const head='<div class="rival-head"><a class="friend-name" href="#joueur?code='+encodeURIComponent(r.code)+'"><strong>'+esc(r.name)+'</strong></a>'+rivalOff(r)+'</div>';
  if(r.hidden)return '<li class="rival-card">'+head+'<p class="friend-empty">Profil privé : comparaison indisponible.</p></li>';
  const lead=r.gap>0?'Tu mènes de '+r.gap+' carte'+(r.gap>1?'s':''):r.gap<0?esc(r.name)+' mène de '+(-r.gap)+' carte'+(-r.gap>1?'s':''):'Égalité parfaite';
  return '<li class="rival-card'+(r.gap>0?' is-ahead':r.gap<0?' is-behind':'')+'">'+head+'<p class="rival-lead" role="status">'+lead+'</p>'+gauge('Toi',r.you.cards,r.total,r.you.pct)+gauge(r.name,r.cards,r.total,r.pct)+'</li>';
}
const rivalsSection=(d)=>section('RIVALITÉS','Mes rivaux ('+d.rivals.length+'/'+d.limits.maxRivals+')',d.rivals.length?'<ul class="rival-list">'+d.rivals.map(rivalCard).join('')+'</ul>':'<p class="friend-empty">Épingle jusqu’à '+d.limits.maxRivals+' amis comme rivaux avec le bouton RIVAL de la liste « Mes amis » : tu verras toujours qui a le plus complété son album.</p>');

async function amis(){
  let d;
  let act={events:[]};
  try{[d,act]=await Promise.all([api('/api/friends'),api('/api/friends/activity').catch(()=>({events:[]}))])}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'amis'}));throw e}
  return '<div class="page friends-page">'+viewHero('AMIS','Collectionne avec tes amis.','Ajoute des joueurs avec leur code, découvre leur vitrine et échange avec eux.',String(d.friends.length),'AMI'+(d.friends.length>1?'S':''))
   +(d.friends.length?rivalsSection(d):'')
   +(d.friends.length?section('ACTIVITÉ','Activité de mes amis',activityList(act.events)):'')
   +section('MON CODE','Mon code joueur','<div class="panel friend-code-box"><strong class="trade-code" id="friendMyCode">'+esc(d.code)+'</strong><button class="btn btn-outline" type="button" data-friend-copy>Copier</button><p>C’est le même code que pour les échanges. Donne-le à un ami : il pourra te demander en ami, et tu accepteras.</p></div>')
   +section('AJOUTER','Ajouter un ami','<form class="panel friend-add" data-friend-add><label for="friendCode">Code du joueur</label><div class="friend-add-row"><input id="friendCode" name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="Ex. K7M2QX9P" required><button class="btn btn-gold" type="submit">Envoyer la demande</button></div></form>')
   +(d.incoming.length?section('DEMANDES','Demandes reçues ('+d.incoming.length+')',list(d.incoming.map(p=>person(p,'<button class="btn btn-gold" type="button" data-friend-act="accept" data-id="'+p.id+'">Accepter</button><button class="btn btn-outline" type="button" data-friend-act="decline" data-id="'+p.id+'">Refuser</button>')),'')):'')
   +section('MES AMIS','Mes amis ('+d.friends.length+')',list(d.friends.map(p=>person(p,'<a class="btn btn-outline" href="#trades?code='+encodeURIComponent(p.code)+'">Échanger</a><button class="btn btn-outline" type="button" data-friend-rival="'+esc(p.code)+'" data-on="'+(p.rival?'0':'1')+'" aria-pressed="'+(p.rival?'true':'false')+'">'+(p.rival?'RIVAL ✓':'RIVAL')+'</button><button class="btn btn-outline" type="button" data-friend-act="remove" data-id="'+p.id+'" aria-label="Retirer '+esc(p.name)+'">Retirer</button>')),'Aucun ami pour l’instant : saisis le code d’un joueur ci-dessus.'))
   +(d.outgoing.length?section('EN ATTENTE','Demandes envoyées ('+d.outgoing.length+')',list(d.outgoing.map(p=>person(p,'<button class="btn btn-outline" type="button" data-friend-act="cancel" data-id="'+p.id+'">Annuler</button>')),'')):'')
   +section('CONFIDENTIALITÉ','Qui voit mon profil ?','<div class="panel friend-visibility"><label for="friendVis">Mon profil est visible par</label><select id="friendVis" data-friend-vis>'+Object.entries(VIS).map(([k,v])=>'<option value="'+k+'"'+(d.visibility===k?' selected':'')+'>'+v+'</option>').join('')+'</select><p>Un profil montre ton niveau, ton rang, tes succès, ta vitrine de 5 cartes favorites, tes sets et albums terminés. Jamais ton solde ni ton e-mail.</p></div>')
   +'</div>';
}

async function joueur(q){
  const code=String(q.get('code')||'').toUpperCase();
  let d;
  try{d=await api('/api/players/profile?code='+encodeURIComponent(code))}
  catch(e){
    if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'joueur?code='+code}));
    if(e.status===403&&e.data?.player)return '<div class="page friends-page">'+viewHero('FOOTVAULT / JOUEUR',esc(e.data.player.name).toUpperCase(),'Ce profil n’est pas visible.')+relationBar(e.data.player)+'</div>';
    return '<div class="page friends-page">'+viewHero('FOOTVAULT / JOUEUR','JOUEUR <span>INTROUVABLE.</span>',e.message||'')+'</div>'
  }
  const p=d.player;
  const stats=[['Niveau',p.level],['Rang',p.rank?'#'+p.rank:'—'],['Succès',p.achievements],['Albums',p.albums]];
  return '<div class="page friends-page">'+viewHero('FOOTVAULT / JOUEUR',esc(p.name).toUpperCase(),'Membre depuis le '+new Date(p.memberSince).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}))+relationBar(p)
   +'<section class="section"><ul class="friend-stats">'+stats.map(([k,v])=>'<li><strong>'+esc(String(v))+'</strong><span>'+k+'</span></li>').join('')+'</ul></section>'
   +section('VITRINE','Cartes favorites',d.favorites.length?'<div class="friend-showcase">'+d.favorites.map(c=>'<div class="friend-showcase-card">'+cardMarkup(c)+'</div>').join('')+'</div>':'<p class="friend-empty">Aucune carte en vitrine.</p>')
   +(d.team?section('ÉQUIPE TYPE','Équipe type · '+esc(d.team.formation)+' · NOTE '+String(d.team.rating).replace('.',','),'<ul class="friend-sets team-public">'+d.team.players.map((x,i)=>'<li>'+(x?'<strong>'+x.ovr+'</strong> '+esc(x.name)+' <small>'+esc(x.position)+'</small>':'<small>poste vide</small>')+'</li>').join('')+'</ul>'):'')
   +((d.wishlist||[]).length?section('SOUHAITS','Cartes recherchées',`<ul class="friend-sets">${d.wishlist.map(w=>'<li>'+esc(w.name)+'</li>').join('')}</ul>`):'')
   +section('SETS','Sets terminés ('+p.sets.length+')',p.sets.length?'<ul class="friend-sets">'+p.sets.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p class="friend-empty">Aucun set terminé.</p>')
   +'</div>';
}
function relationBar(p){
  const code=esc(p.code);
  if(p.relation==='self')return '<p class="friend-relation">C’est ton profil. <a href="#amis">Gérer mes amis et ma confidentialité</a></p>';
  if(p.relation==='friend')return '<p class="friend-relation">Vous êtes amis. <a class="btn btn-outline" href="#trades?code='+encodeURIComponent(p.code)+'">Proposer un échange</a></p>';
  if(p.relation==='pending_out')return '<p class="friend-relation">Demande envoyée, en attente de réponse.</p>';
  if(p.relation==='pending_in')return '<p class="friend-relation">Ce joueur t’a demandé en ami. <a class="btn btn-gold" href="#amis">Répondre</a></p>';
  return '<p class="friend-relation"><button class="btn btn-gold" type="button" data-friend-ask="'+code+'">Demander en ami</button></p>';
}

document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-friend-copy],[data-friend-act],[data-friend-ask],[data-friend-rival]');if(!t)return;
  if(t.matches('[data-friend-copy]')){try{await navigator.clipboard.writeText($('#friendMyCode').textContent);toast('Code copié.')}catch{toast('Copie impossible : sélectionne le code à la main.')}return}
  t.disabled=true;
  try{
    if(t.dataset.friendRival){const on=t.dataset.on==='1';await post('/api/friends/rival',{code:t.dataset.friendRival,on});toast(on?'Rival ajouté.':'Rival retiré.')}
    else if(t.dataset.friendAsk){await post('/api/friends/request',{code:t.dataset.friendAsk});toast('Demande envoyée.')}
    else{const a=t.dataset.friendAct;await post('/api/friends/'+a,{id:t.dataset.id});toast({accept:'Ami ajouté.',decline:'Demande refusée.',cancel:'Demande annulée.',remove:'Ami retiré.'}[a]||'Fait.')}
    render();
  }catch(err){toast(err.message);t.disabled=false}
});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-friend-add]');if(!f)return;
  e.preventDefault();
  const btn=f.querySelector('button[type=submit]');if(btn.disabled)return;
  btn.disabled=true;
  try{await post('/api/friends/request',{code:f.code.value.trim().toUpperCase()});toast('Demande envoyée.');render()}
  catch(err){toast(err.message);btn.disabled=false}
});
document.addEventListener('change',async e=>{
  const s=e.target.closest('[data-friend-vis]');if(!s)return;
  s.disabled=true;
  try{await post('/api/profile/visibility',{visibility:s.value});toast('Confidentialité enregistrée.')}
  catch(err){toast(err.message)}
  s.disabled=false;
});
Object.assign(FVC.pages,{amis,joueur});
})();

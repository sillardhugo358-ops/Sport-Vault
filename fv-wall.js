// Mur des transferts (page « mur ») : ventes aux enchères terminées, visibles seulement pour les joueurs qui l'ont activé (opt-in, réciprocité).
// Chargé après app.js ; serveur : /api/transfer-wall/* (lib/transfer-wall.js), qui décide de tout (opt-in, pseudos, fenêtre de 14 jours).
(()=>{
const {api,esc,money,render,toast,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const RL={common:'Common',rare:'Rare',epic:'Epic',legendary:'Legendary',icon:'Icon'};
const when=d=>{const m=Math.max(1,Math.round((Date.now()-new Date(d))/60000));return m<60?m+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' j'};
const who=n=>n?'<strong>'+esc(n)+'</strong>':'<em>Un collectionneur</em>';
const row=x=>'<li class="wk-row wall-row"><div class="wk-main"><strong>'+esc(x.card.name)+'</strong> <span class="rarity-tag rarity-'+esc(x.card.rarity)+'">'+esc(RL[x.card.rarity]||x.card.rarity)+'</span><small>'+esc(x.card.club)+' · '+esc(x.card.season)+' · note '+Number(x.card.ovr)+(x.card.limited&&x.card.serial?' · édition limitée #'+Number(x.card.serial)+'/'+Number(x.card.maxSupply):'')+'</small><small>'+who(x.seller)+' → '+who(x.buyer)+' · il y a '+when(x.at)+'</small></div><div class="wk-actions"><b>'+money(x.price)+' FC</b></div></li>';
async function mur(){
  let d;
  try{d=await api('/api/transfer-wall')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'mur'}));throw e}
  const toggle='<div class="panel wall-optin"><p><strong>'+(d.optedIn?'Tu participes au mur.':'Le mur est désactivé pour toi.')+'</strong> '+(d.optedIn?'Ton pseudo apparaît sur tes ventes et achats aux enchères. Rien d’autre : ni solde, ni e-mail, ni code.':'Active-le pour voir les ventes récentes. En échange, ton pseudo apparaît sur tes ventes et achats aux enchères (rien d’autre : ni solde, ni e-mail, ni code). Tu peux le désactiver à tout moment.')+'</p><button class="btn '+(d.optedIn?'btn-outline':'btn-gold')+'" type="button" data-wall-toggle="'+(d.optedIn?'0':'1')+'">'+(d.optedIn?'Quitter le mur':'Activer le mur')+'</button></div>';
  return '<div class="page wk-page wall-page">'+viewHero('Mur des transferts','Ce qui se vend en ce moment.','Les ventes aux enchères des '+d.days+' derniers jours, entre joueurs qui ont choisi de les montrer. Un choix libre, jamais automatique.',String(d.items.length),d.optedIn?'Ventes récentes':'Mur désactivé')
   +'<section class="section">'+toggle+'</section>'
   +(d.optedIn?'<section class="section"><div class="section-head"><div><p class="eyebrow">Ventes récentes</p><h2>Derniers transferts</h2></div></div>'+(d.items.length?'<ul class="wk-list">'+d.items.map(row).join('')+'</ul>':'<p class="wk-note">Aucune vente à afficher pour le moment.</p>')+'</section>':'')+'</div>';
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-wall-toggle]');if(!t||!t.closest('.wall-page'))return;
  t.disabled=true;
  try{await post('/api/transfer-wall/optin',{on:t.dataset.wallToggle==='1'});toast(t.dataset.wallToggle==='1'?'Mur activé.':'Mur désactivé.')}
  catch(err){toast(err.message)}
  render();
});
FVC.pages.mur=mur;
})();

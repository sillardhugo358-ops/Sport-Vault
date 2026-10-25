// Statistiques de collection (page « statistiques ») : % complété par compétition et décennie, répartition par rareté et poste, valeur estimée.
// Chargé après app.js ; serveur : GET /api/collection/stats (lib/collection-stats.js). La valeur est indicative (médiane des ventes aux enchères).
(()=>{
const {esc,money,viewHero}=FVC.core;
const RL={icon:'Icon',legendary:'Legendary',epic:'Epic',rare:'Rare',common:'Common'};
const bar=(label,owned,total,pct)=>'<li class="stat-row"><div class="stat-head"><span>'+esc(label)+'</span><b>'+Number(pct).toLocaleString('fr-FR')+' %</b></div><div class="stat-bar" role="img" aria-label="'+esc(label)+' : '+owned+' sur '+total+' cartes"><i style="width:'+Math.min(100,Number(pct))+'%"></i></div><small>'+money(owned)+' / '+money(total)+' cartes</small></li>';
const count=(label,n,max,cls)=>'<li class="stat-row"><div class="stat-head"><span>'+esc(label)+'</span><b>'+money(n)+'</b></div><div class="stat-bar" aria-hidden="true"><i class="'+(cls||'')+'" style="width:'+(max?Math.round(n/max*100):0)+'%"></i></div></li>';
const section=(eyebrow,title,body)=>'<section class="section"><div class="section-head"><div><p class="eyebrow">'+eyebrow+'</p><h2>'+title+'</h2></div></div>'+body+'</section>';
async function statistiques(){
  let d;
  try{d=await FVC.core.api('/api/collection/stats')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'statistiques'}));throw e}
  const maxR=Math.max(1,...d.rarities.map(r=>r.unique)),maxP=Math.max(1,...d.positions.map(p=>p.unique));
  const v=d.value;
  return '<div class="page stats-page">'+viewHero('STATISTIQUES','Ta collection en chiffres.','Où en es-tu dans chaque compétition et chaque décennie, et ce que vaut ta collection.',money(d.totals.unique),'CARTES DIFFÉRENTES')
   +section('COMPLÉTION','Par compétition',d.competitions.length?'<ul class="stat-list">'+d.competitions.map(c=>bar(c.name,c.owned,c.total,c.pct)).join('')+'</ul>':'<p class="stat-empty">Aucune compétition à afficher.</p>')
   +section('COMPLÉTION','Par décennie',d.decades.length?'<ul class="stat-list">'+d.decades.map(c=>bar('Années '+c.decade,c.owned,c.total,c.pct)).join('')+'</ul>':'<p class="stat-empty">Aucune décennie à afficher.</p>')
   +section('RARETÉ','Cartes différentes par rareté','<ul class="stat-list">'+d.rarities.map(r=>count(RL[r.rarity],r.unique,maxR,'rarity-fill-'+r.rarity)).join('')+'</ul>')
   +section('POSTE','Cartes différentes par poste','<ul class="stat-list">'+d.positions.map(p=>count(p.position,p.unique,maxP)).join('')+'</ul>')
   +section('VALEUR','Valeur estimée (indicative)','<div class="panel stat-value"><strong>'+money(v.estimated)+' FC</strong><p>Médiane des dernières ventes aux enchères de chacune de tes cartes. '+money(v.priced)+' carte'+(v.priced>1?'s':'')+' estimée'+(v.priced>1?'s':'')+', '+money(v.unpriced)+' jamais vendue'+(v.unpriced>1?'s':'')+' aux enchères (non comptée'+(v.unpriced>1?'s':'')+'). Ce n’est pas un prix garanti.</p>'
    +(v.top.length?'<h3>Tes cartes les plus chères</h3><ul class="stat-top">'+v.top.map(c=>'<li><span>'+esc(c.name)+(c.copies>1?' ×'+c.copies:'')+'</span><b>'+money(c.price)+' FC</b></li>').join('')+'</ul>':'')+'</div>')
   +'</div>';
}
FVC.pages.statistiques=statistiques;
})();

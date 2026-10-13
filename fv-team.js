// Équipe type (page « equipe ») : un 11 composé de cartes possédées, dans une formation ; note d'équipe = moyenne des OVR (poste vide = 0).
// Chaque poste demande un POSTE EXACT (latéral gauche ≠ latéral droit). Chargé après app.js ; serveur : /api/team, /api/team/save
// (lib/team.js), qui valide tout (propriété, poste exact, doublons) et fournit les formations et les libellés.
(()=>{
const {$,api,esc,render,toast,setModal,closeModal,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const st={loaded:false,formations:[],rowsOf:{},labels:{},formation:'4-3-3',positions:[],slots:[],cards:[],dirty:false,busy:false,pick:-1};
const byId=()=>new Map(st.cards.map(c=>[c.cardId,c]));
const rating=()=>{const m=byId();return Math.round(st.slots.reduce((n,id)=>n+(m.get(id)?.ovr||0),0)/11*10)/10};
const filled=()=>st.slots.filter(Boolean).length;
const rowsOf=f=>st.rowsOf[f]||[];
function setFromServer(d){
  st.formations=d.formations;st.rowsOf=d.formationRows;st.labels=d.positionLabels;st.cards=d.cards;
  st.formation=d.lineup.formation;st.positions=d.lineup.positions;st.slots=d.lineup.slots.map(c=>c?c.cardId:null);st.dirty=false;st.loaded=true;
}
// Changer de formation : chaque joueur reste, s'il existe un poste identique libre (même poste exact) ; sinon son poste est libéré.
function changeFormation(f){
  const next=rowsOf(f).flat();if(next.length!==11)return;
  const m=byId(),pool={};
  st.slots.forEach((id,i)=>{if(id&&m.get(id))(pool[st.positions[i]]||=[]).push(id)});
  st.slots=next.map(p=>(pool[p]||[]).shift()||null);st.positions=next;st.formation=f;st.dirty=true;
}
// Meilleur 11 : pour chaque poste, la meilleure carte possédée de CE poste, sans doublon.
function autoFill(){
  const used=new Set();
  st.slots=st.positions.map(p=>{const c=st.cards.find(x=>x.position===p&&!used.has(x.cardId));if(c)used.add(c.cardId);return c?c.cardId:null});st.dirty=true;
}
const label=p=>st.labels[p]||p;
function slotHtml(i){
  const c=byId().get(st.slots[i]),pos=st.positions[i];
  return '<button class="team-slot'+(c?' is-filled rarity-'+esc(c.rarity):'')+'" type="button" data-team-slot="'+i+'" aria-label="'+(c?esc(c.name)+', '+esc(label(pos))+', note '+c.ovr+', changer':esc(label(pos))+', choisir une carte')+'">'
   +(c?'<span class="ts-ovr">'+c.ovr+'</span><span class="team-name">'+esc(c.name)+'</span><small>'+esc(pos)+'</small>':'<span class="ts-ovr ts-empty" aria-hidden="true">+</span><small>'+esc(pos)+'</small>')+'</button>';
}
// Liste « onze de départ » (ordre des postes : gardien d'abord) : chaque ligne ouvre le même choix de carte que le terrain.
function listHtml(){
  const m=byId();
  return '<div class="team-xi"><p class="team-xi-head"><span>ONZE DE DÉPART</span><b>'+filled()+'/11</b></p><ul class="team-xi-list">'
   +st.positions.map((pos,i)=>{const c=m.get(st.slots[i]);
     return '<li><button class="team-xi-row'+(c?' rarity-'+esc(c.rarity):' is-empty')+'" type="button" data-team-edit="'+i+'" aria-label="'+(c?esc(c.name)+', '+esc(label(pos))+', note '+c.ovr+', changer':esc(label(pos))+', choisir une carte')+'"><span class="xi-pos">'+esc(pos)+'</span>'
      +(c?'<span class="xi-main"><strong>'+esc(c.name)+'</strong><small>'+esc(c.club)+' · '+esc(c.season)+'</small></span><span class="xi-ovr">'+c.ovr+'</span>':'<span class="xi-main"><strong>Choisir un joueur</strong><small>'+esc(label(pos))+'</small></span><span class="xi-ovr xi-plus" aria-hidden="true">+</span>')+'</button></li>'}).join('')+'</ul></div>';
}
function pitchHtml(){
  // Rangées de l'arrière vers l'avant : on les affiche à l'envers (attaque en haut, gardien en bas) ; les index suivent l'ordre des postes.
  const rows=rowsOf(st.formation);let start=0;const idx=rows.map(r=>{const a=Array.from({length:r.length},(_,k)=>start+k);start+=r.length;return a});
  return '<div class="team-pitch" role="group" aria-label="Terrain, formation '+esc(st.formation)+'"><i class="team-markings" aria-hidden="true"></i>'
   +rows.map((_,k)=>rows.length-1-k).map(k=>'<div class="team-row">'+idx[k].map(slotHtml).join('')+'</div>').join('')+'</div>';
}
function statsHtml(){
  const m=byId(),avg=(from,to)=>{const ids=st.slots.slice(from,to).filter(Boolean);return ids.length?Math.round(ids.reduce((n,id)=>n+(m.get(id)?.ovr||0),0)/ids.length):'–'};
  const rows=rowsOf(st.formation),sizes=rows.map(r=>r.length),names=['Gardien','Défense','Milieu','Attaque','Attaque'];
  let a=0;const parts=sizes.map((n,k)=>{const html='<div class="team-stat"><small>'+names[k]+(k===3&&rows.length===5?' (ailiers)':k===4?' (pointe)':'')+'</small><b>'+avg(a,a+n)+'</b></div>';a+=n;return html});
  return '<div class="team-stats" aria-label="Notes moyennes par ligne">'+parts.join('')+'</div>';
}
async function equipe(){
  if(!st.loaded||!st.dirty){
    let d;try{d=await api('/api/team')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'equipe'}));throw e}
    if(!st.dirty)setFromServer(d);
  }
  return '<div class="page team-page">'+viewHero('FOOTVAULT / ÉQUIPE TYPE','TON <span>ÉQUIPE TYPE.</span>','Compose ton 11 avec tes cartes : chaque poste demande le poste exact (un latéral gauche ne joue pas à droite). La note d’équipe est la moyenne des OVR des 11 titulaires ; un poste vide compte 0. Ton équipe est visible sur ton profil.',String(rating()).replace('.',','),'NOTE D’ÉQUIPE')
   +'<section class="section team-board"><div class="team-toolbar"><label class="team-formation-field" for="teamFormation"><span>Formation</span><select id="teamFormation" data-team-formation>'+st.formations.map(f=>'<option'+(f===st.formation?' selected':'')+'>'+f+'</option>').join('')+'</select></label>'
   +'<div class="team-actions"><button class="btn btn-outline" type="button" data-team-auto>MEILLEUR 11</button><button class="btn btn-outline" type="button" data-team-clear>VIDER</button><button class="btn btn-gold" type="button" data-team-save'+(st.dirty&&!st.busy?'':' disabled')+'>ENREGISTRER</button></div>'
   +'<p class="team-count" role="status">'+filled()+' / 11 postes'+(st.dirty?' · <em>modifications non enregistrées</em>':'')+'</p></div>'
   +statsHtml()+'<div class="team-layout">'+pitchHtml()+listHtml()+'</div></section></div>';
}
function openPicker(i){
  st.pick=i;
  const pos=st.positions[i],used=new Set(st.slots.filter((id,j)=>id&&j!==i));
  const list=st.cards.filter(c=>c.position===pos&&!used.has(c.cardId));
  setModal('<div class="modal-box team-picker"><button class="modal-close" type="button" data-close aria-label="Fermer">×</button><h2>CHOISIR : '+esc(label(pos).toUpperCase())+'</h2>'
   +(st.slots[i]?'<button class="btn btn-outline" type="button" data-team-remove>RETIRER CE JOUEUR</button>':'')
   +(list.length?'<ul class="team-picker-list">'+list.slice(0,200).map(c=>'<li><button type="button" data-team-choose="'+esc(c.cardId)+'" class="rarity-'+esc(c.rarity)+'"><b>'+c.ovr+'</b><span>'+esc(c.name)+'</span><small>'+esc(c.club)+' · '+esc(c.season)+'</small></button></li>').join('')+'</ul>':'<p class="team-empty">Tu n’as aucune carte pour ce poste ('+esc(label(pos).toLowerCase())+').</p>')+'</div>');
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-team-slot],[data-team-edit],[data-team-choose],[data-team-remove],[data-team-auto],[data-team-clear],[data-team-save]');if(!t)return;
  if(t.dataset.teamSlot!==undefined)return openPicker(Number(t.dataset.teamSlot));
  if(t.dataset.teamEdit!==undefined)return openPicker(Number(t.dataset.teamEdit));
  if(t.dataset.teamChoose){st.slots[st.pick]=t.dataset.teamChoose;st.dirty=true;closeModal();return render()}
  if(t.matches('[data-team-remove]')){st.slots[st.pick]=null;st.dirty=true;closeModal();return render()}
  if(t.matches('[data-team-auto]')){autoFill();return render()}
  if(t.matches('[data-team-clear]')){st.slots=st.slots.map(()=>null);st.dirty=true;return render()}
  if(t.matches('[data-team-save]')){
    if(st.busy)return;st.busy=true;t.disabled=true;
    try{const r=await post('/api/team/save',{formation:st.formation,slots:st.slots});st.slots=r.lineup.slots.map(c=>c?c.cardId:null);st.dirty=false;toast('Équipe enregistrée.')}
    catch(err){toast(err.message)}
    finally{st.busy=false;render()}
  }
});
document.addEventListener('change',e=>{const s=e.target.closest('[data-team-formation]');if(!s)return;changeFormation(s.value);render()});
FVC.pages.equipe=equipe;
})();

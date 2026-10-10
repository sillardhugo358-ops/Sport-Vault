// Équipe type (page « equipe ») : un 11 composé de cartes possédées, dans une formation ; note d'équipe = moyenne des OVR (poste vide = 0).
// Chargé après app.js ; serveur : /api/team, /api/team/save (lib/team.js) qui valide tout (propriété, ligne du poste, doublons).
(()=>{
const {$,api,esc,money,render,toast,setModal,closeModal,viewHero}=FVC.core;
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const LABEL={GK:'Gardien',DEF:'Défenseur',MID:'Milieu',ATT:'Attaquant'};
const ROWS=['ATT','MID','DEF','GK'];
const st={loaded:false,formations:[],formation:'4-3-3',lines:[],slots:[],cards:[],dirty:false,busy:false,pick:-1};
const byId=()=>new Map(st.cards.map(c=>[c.cardId,c]));
const rating=()=>{const m=byId();return Math.round(st.slots.reduce((n,id)=>n+(m.get(id)?.ovr||0),0)/11*10)/10};
const filled=()=>st.slots.filter(Boolean).length;
function setFromServer(d){
  st.formations=d.formations;st.cards=d.cards;st.formation=d.lineup.formation;st.lines=d.lineup.lines;st.slots=d.lineup.slots.map(c=>c?c.cardId:null);st.dirty=false;st.loaded=true;
}
function changeFormation(f){
  const lines={'4-3-3':[4,3,3],'4-4-2':[4,4,2],'3-5-2':[3,5,2],'4-2-3-1':[4,5,1],'5-3-2':[5,3,2]}[f];if(!lines)return;
  const next=['GK',...Array(lines[0]).fill('DEF'),...Array(lines[1]).fill('MID'),...Array(lines[2]).fill('ATT')];
  const m=byId(),pool={GK:[],DEF:[],MID:[],ATT:[]};
  st.slots.forEach((id,i)=>{if(id&&m.get(id))pool[st.lines[i]].push(id)});
  st.slots=next.map(l=>pool[l].shift()||null);st.lines=next;st.formation=f;st.dirty=true;
}
function autoFill(){
  const used=new Set();
  st.slots=st.lines.map(l=>{const c=st.cards.find(x=>x.line===l&&!used.has(x.cardId));if(c)used.add(c.cardId);return c?c.cardId:null});st.dirty=true;
}
function slotHtml(i){
  const c=byId().get(st.slots[i]);
  return '<button class="team-slot'+(c?' is-filled rarity-'+esc(c.rarity):'')+'" type="button" data-team-slot="'+i+'" aria-label="'+(c?esc(c.name)+', note '+c.ovr+', changer':LABEL[st.lines[i]]+', choisir une carte')+'">'
   +(c?'<b>'+c.ovr+'</b><span>'+esc(c.name)+'</span><small>'+esc(c.position)+'</small>':'<b>+</b><span>'+LABEL[st.lines[i]]+'</span>')+'</button>';
}
function pitchHtml(){
  return '<div class="team-pitch">'+ROWS.map(l=>'<div class="team-row">'+st.lines.map((x,i)=>x===l?slotHtml(i):'').join('')+'</div>').join('')+'</div>';
}
async function equipe(){
  if(!st.loaded||!st.dirty){
    let d;try{d=await api('/api/team')}catch(e){if(e.status===401)return FVC.pages.auth(new URLSearchParams({next:'equipe'}));throw e}
    if(!st.dirty)setFromServer(d);
  }
  return '<div class="page team-page">'+viewHero('FOOTVAULT / ÉQUIPE TYPE','TON <span>ÉQUIPE TYPE.</span>','Compose ton 11 avec tes cartes. La note d’équipe est la moyenne des OVR des 11 titulaires ; un poste vide compte 0. Ton équipe est visible sur ton profil.',String(rating()).replace('.',','),'NOTE D’ÉQUIPE')
   +'<section class="section"><div class="panel team-tools"><label for="teamFormation">Formation</label><select id="teamFormation" data-team-formation>'+st.formations.map(f=>'<option'+(f===st.formation?' selected':'')+'>'+f+'</option>').join('')+'</select>'
   +'<button class="btn btn-outline" type="button" data-team-auto>MEILLEUR 11</button><button class="btn btn-outline" type="button" data-team-clear>VIDER</button>'
   +'<button class="btn btn-gold" type="button" data-team-save'+(st.dirty&&!st.busy?'':' disabled')+'>ENREGISTRER</button><span class="team-count" role="status">'+filled()+' / 11 postes'+(st.dirty?' · modifications non enregistrées':'')+'</span></div>'+pitchHtml()+'</section></div>';
}
function openPicker(i){
  st.pick=i;
  const line=st.lines[i],used=new Set(st.slots.filter((id,j)=>id&&j!==i));
  const list=st.cards.filter(c=>c.line===line&&!used.has(c.cardId));
  setModal('<div class="modal-box team-picker"><button class="modal-close" type="button" data-close aria-label="Fermer">×</button><h2>CHOISIR UN '+LABEL[line].toUpperCase()+'</h2>'
   +(st.slots[i]?'<button class="btn btn-outline" type="button" data-team-remove>RETIRER CE JOUEUR</button>':'')
   +(list.length?'<ul class="team-picker-list">'+list.slice(0,200).map(c=>'<li><button type="button" data-team-choose="'+esc(c.cardId)+'"><b>'+c.ovr+'</b><span>'+esc(c.name)+'</span><small>'+esc(c.club)+' · '+esc(c.position)+'</small></button></li>').join('')+'</ul>':'<p class="team-empty">Tu n’as aucune carte pour ce poste.</p>')+'</div>');
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-team-slot],[data-team-choose],[data-team-remove],[data-team-auto],[data-team-clear],[data-team-save]');if(!t)return;
  if(t.dataset.teamSlot!==undefined)return openPicker(Number(t.dataset.teamSlot));
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

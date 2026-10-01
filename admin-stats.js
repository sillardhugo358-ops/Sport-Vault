// Tableau de bord statistique (console admin, onglet « Tableau de bord »).
// Reçoit de app.js (bind) sa fonction api. Serveur : GET /api/admin/stats?days=N (lib/stats.js).
(()=>{
  const STYLE_ID='fv-admin-stats-style';
  const CSS=`
    .admin-stats{margin-top:18px}
    .admin-stats-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;text-align:left}
    .admin-stats-head>div{text-align:left}
    .admin-stats-periods{display:flex;gap:6px;flex-wrap:wrap}
    .admin-stats-periods button{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);font-weight:800;font-size:12px;cursor:pointer}
    .admin-stats-periods button.active{background:var(--gold);border-color:var(--gold);color:#111}
    .admin-stats-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
    .admin-stats-kpi{padding:12px 14px;border:1px solid rgba(55,113,174,.32);border-radius:11px;background:rgba(6,20,40,.68)}
    .admin-stats-kpi span{display:block;color:#83a4c7;font-size:10px;letter-spacing:.8px;font-weight:800;text-transform:uppercase}
    .admin-stats-kpi strong{display:block;margin-top:6px;color:#f4d56d;font:850 22px var(--head)}
    .admin-stats-kpi small{display:block;margin-top:2px;color:var(--muted);font-size:11px}
    .admin-stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:13px}
    .admin-stats-panel{padding:12px 16px 16px;border:1px solid rgba(55,113,174,.32);border-radius:11px;background:rgba(6,20,40,.68);min-width:0}
    .admin-stats-panel h4{margin:0 0 10px;font:800 15px var(--head);letter-spacing:.5px;text-transform:uppercase}
    .admin-stats-panel.wide{grid-column:1/-1}
    .admin-stats-chart{display:flex;align-items:flex-end;gap:3px;height:130px;padding-top:6px}
    .admin-stats-chart .col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;height:100%;position:relative}
    .admin-stats-chart .bar{border-radius:3px 3px 0 0;min-height:1px}
    .admin-stats-chart .bar.a{background:#6fa8d6}
    .admin-stats-chart .bar.b{background:var(--gold);margin-top:1px}
    .admin-stats-axis{display:flex;justify-content:space-between;color:var(--muted);font-size:10px;margin-top:4px}
    .admin-stats-legend{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
    .admin-stats-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
    .admin-stats-rows{display:grid;gap:7px}
    .admin-stats-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;font-size:13px;align-items:center}
    .admin-stats-row .track{grid-column:1/-1;height:6px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}
    .admin-stats-row .track b{display:block;height:100%;border-radius:99px;background:#6fa8d6}
    .admin-stats-row strong{font-variant-numeric:tabular-nums}
    .admin-stats-row .pos{color:var(--green)}.admin-stats-row .neg{color:var(--danger)}
    .admin-stats-note{font-size:11px;color:var(--muted);margin-top:10px}
    .admin-stats-empty{color:var(--muted);font-size:13px}
    .admin-stats .track b.r-common{background:#9a9d97}.admin-stats .track b.r-rare{background:#6fa8d6}.admin-stats .track b.r-epic{background:#b98fe0}.admin-stats .track b.r-legendary{background:#f0cf7c}.admin-stats .track b.r-icon{background:linear-gradient(90deg,#7fe0ff,#f3a6ff,#ffe38a)}
    @media(max-width:760px){.admin-stats-grid{grid-template-columns:1fr}.admin-stats-chart{height:100px;gap:2px}}
  `;
  const REASONS={signup:'Inscriptions',reward:'Récompenses',pack:'Packs',pool:'Pools',auction_buy:'Achats aux enchères',auction_sale:'Ventes aux enchères',admin:'Ajustements admin'};
  const CLAIMS={achievement:'Succès',daily:'Missions quotidiennes',weekly:'Missions hebdomadaires',monthly:'Missions mensuelles',mission:'Missions de progression',challenge:'Défis',album:'Albums',leaderboard:'Classement'};
  const KIND_LABEL={daily:'quotidienne',weekly:'hebdomadaire',monthly:'mensuelle'};
  const RARITIES=[['common','Common'],['rare','Rare'],['epic','Epic'],['legendary','Legendary'],['icon','Icon']];
  let api,days=14,loading=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('fr-FR');
  const sum=(rows,k)=>rows.reduce((s,r)=>s+Number(r[k]||0),0);
  const shortDay=d=>{const [,m,j]=String(d).split('-');return j+'/'+m;};
  const style=()=>{if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;document.head.appendChild(s)};

  function chart(series,a,b,labelA,labelB,colorB){
    const max=Math.max(1,...series.map(r=>Number(r[a]||0)+Number(r[b]||0)));
    const cols=series.map(r=>{const va=Number(r[a]||0),vb=Number(r[b]||0);return `<div class="col" title="${esc(shortDay(r.day))} — ${esc(labelA)} : ${fmt(va)} · ${esc(labelB)} : ${fmt(vb)}"><div class="bar b" style="height:${vb/max*100}%;${colorB?'background:'+colorB:''}"></div><div class="bar a" style="height:${va/max*100}%"></div></div>`;}).join('');
    const first=series[0]?.day,last=series[series.length-1]?.day;
    return `<div class="admin-stats-chart" role="img" aria-label="${esc(labelA)} et ${esc(labelB)} par jour">${cols}</div><div class="admin-stats-axis"><span>${esc(shortDay(first))}</span><span>max ${fmt(max)}</span><span>${esc(shortDay(last))}</span></div><div class="admin-stats-legend"><span><i style="background:#6fa8d6"></i>${esc(labelA)}</span><span><i style="background:${colorB||'var(--gold)'}"></i>${esc(labelB)}</span></div>`;
  }
  function bars(rows,label,value,cls,fmtValue=fmt){
    if(!rows.length)return '<p class="admin-stats-empty">Aucune donnée sur la période.</p>';
    const max=Math.max(1,...rows.map(r=>Number(r[value]||0)));
    return '<div class="admin-stats-rows">'+rows.map(r=>`<div class="admin-stats-row"><span>${esc(r[label])}</span><strong>${fmtValue(r[value],r)}</strong><div class="track"><b class="${cls?esc(cls(r)):''}" style="width:${Number(r[value]||0)/max*100}%"></b></div></div>`).join('')+'</div>';
  }

  // Export CSV de la série quotidienne (ouvert dans un tableur : séparateur « ; », UTF-8 avec BOM).
  function exportCsv(d){
    const cols=[['day','Jour'],['signups','Inscriptions'],['active','Joueurs actifs'],['packs','Packs ouverts'],['coins_in','FC gagnés'],['coins_out','FC dépensés'],['tasks','Missions récupérées'],['achievements','Succès récupérés'],['others','Autres récompenses']];
    const lines=[cols.map(c=>c[1]).join(';'),...(d.series||[]).map(r=>cols.map(([k])=>r[k]??0).join(';'))];
    const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='footvault-statistiques-'+d.days+'j.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function render(root,d){
    const s=d.series||[],eco=d.economy||{},m=d.market||{},ap=d.activePlayers||{};
    const rarityTotal=sum(d.rarity||[],'n');
    const rarityRows=RARITIES.map(([id,label])=>({label,id,n:(d.rarity||[]).find(r=>r.rarity===id)?.n||0}));
    const flowRows=(eco.byReason||[]).map(r=>({...r,label:REASONS[r.reason]||r.reason,net:Number(r.gained)-Number(r.spent)}));
    const pr=d.progress||{},ret=d.retention||{},circ=d.circulation||{};
    const claimRows=Object.entries(pr.byKind||{}).map(([k,n])=>({label:CLAIMS[k]||k,n})).sort((a,b)=>b.n-a.n);
    const retPct=ret.cohort?Math.round(ret.returned/ret.cohort*100):null;
    const weekLabel=k=>new Date(k+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    const lbRows=(d.leaderboard||[]).map(w=>({label:'Semaine du '+weekLabel(w.week_key),claimed:w.claimed,rewarded:w.rewarded,coins:w.coins}));
    const since=eco.ledgerSince?new Date(eco.ledgerSince).toLocaleDateString('fr-FR'):null;
    root.innerHTML=`
      <div class="admin-dashboard-section-head admin-stats-head"><div><p class="eyebrow">STATISTIQUES</p><h3>Activité et économie</h3></div>
        <div class="admin-stats-periods" role="group" aria-label="Période"><button type="button" data-stats-csv title="Télécharger la série quotidienne">⭳ CSV</button>${(d.periods||[7,14,30,90]).map(p=>`<button type="button" data-stats-days="${p}" class="${p===d.days?'active':''}" aria-pressed="${p===d.days}">${p} j</button>`).join('')}</div></div>
      <div class="admin-stats-kpis">
        <div class="admin-stats-kpi"><span>Joueurs actifs</span><strong>${fmt(ap.d1)}</strong><small>24 h · ${fmt(ap.d7)} sur 7 j · ${fmt(ap.d30)} sur 30 j</small></div>
        <div class="admin-stats-kpi"><span>Inscriptions</span><strong>${fmt(sum(s,'signups'))}</strong><small>sur ${d.days} jours</small></div>
        <div class="admin-stats-kpi"><span>Packs ouverts</span><strong>${fmt(sum(s,'packs'))}</strong><small>packs et pools, ${d.days} j</small></div>
        <div class="admin-stats-kpi"><span>FC distribués</span><strong>${fmt(eco.gained)}</strong><small>récompenses, ventes, admin</small></div>
        <div class="admin-stats-kpi"><span>FC dépensés</span><strong>${fmt(eco.spent)}</strong><small>packs, pools, achats</small></div>
        <div class="admin-stats-kpi"><span>Récompenses récupérées</span><strong>${fmt(pr.total)}</strong><small>missions, succès, défis, albums</small></div>
        <div class="admin-stats-kpi"><span>Retour à 7 jours</span><strong>${retPct==null?'—':retPct+' %'}</strong><small>${ret.cohort?fmt(ret.returned)+' sur '+fmt(ret.cohort)+' inscrits il y a 7 à 14 j':'pas encore de joueurs concernés'}</small></div>
        <div class="admin-stats-kpi"><span>FC en circulation</span><strong>${fmt(circ.total)}</strong><small>${fmt(circ.players)} joueurs · médiane ${fmt(circ.median)} FC</small></div>
        <div class="admin-stats-kpi"><span>Marché</span><strong>${fmt(m.sold)} vente${Number(m.sold)>1?'s':''}</strong><small>${fmt(m.volume)} FC · ${fmt(m.created)} mise${Number(m.created)>1?'s':''} en vente</small></div>
      </div>
      <div class="admin-stats-grid">
        <section class="admin-stats-panel"><h4>Joueurs actifs et inscriptions</h4>${chart(s,'active','signups','Joueurs actifs','Inscriptions','#8dbd91')}</section>
        <section class="admin-stats-panel"><h4>Flux de FOOTCOINS par jour</h4>${chart(s,'coins_in','coins_out','FC gagnés','FC dépensés','#d77c7c')}</section>
        <section class="admin-stats-panel"><h4>Packs les plus ouverts</h4>${bars((d.packs||[]).slice(0,10),'name','opens',null,(v,r)=>fmt(v)+' · '+fmt(r.coins)+' FC')}</section>
        <section class="admin-stats-panel"><h4>Raretés tirées (${fmt(rarityTotal)} cartes)</h4>${rarityTotal?bars(rarityRows,'label','n',r=>'r-'+r.id,(v)=>fmt(v)+' · '+(v/rarityTotal*100).toLocaleString('fr-FR',{maximumFractionDigits:1})+' %'):'<p class="admin-stats-empty">Aucune carte tirée sur la période.</p>'}</section>
        <section class="admin-stats-panel"><h4>FOOTCOINS par motif</h4>${flowRows.length?'<div class="admin-stats-rows">'+flowRows.map(r=>`<div class="admin-stats-row"><span>${esc(r.label)} <small style="color:var(--muted)">(${fmt(r.moves)})</small></span><strong class="${r.net>=0?'pos':'neg'}">${r.net>=0?'+':'−'}${fmt(Math.abs(r.net))}</strong></div>`).join('')+'</div>':'<p class="admin-stats-empty">Aucun mouvement sur la période.</p>'}</section>
        <section class="admin-stats-panel"><h4>Récompenses récupérées par jour</h4>${chart(s,'tasks','achievements','Missions','Succès','#8dbd91')}</section>
        <section class="admin-stats-panel"><h4>Récompenses par type</h4>${bars(claimRows,'label','n',null)}</section>
        <section class="admin-stats-panel"><h4>Succès les plus récupérés</h4>${bars(pr.topAchievements||[],'name','n',null)}</section>
        <section class="admin-stats-panel"><h4>Missions les plus récupérées</h4>${bars((pr.topMissions||[]).map(m=>({...m,name:m.name+' ('+(KIND_LABEL[m.kind]||m.kind)+')'})),'name','n',null)}</section>
        <section class="admin-stats-panel wide"><h4>Classement de la semaine : récompenses</h4>${lbRows.length?bars(lbRows,'label','claimed',null,(v,r)=>fmt(v)+' récupérée'+(v>1?'s':'')+' sur '+fmt(r.rewarded)+' · '+fmt(r.coins)+' FC'):'<p class="admin-stats-empty">Aucune semaine figée pour le moment (la première l’est le lundi suivant le lancement).</p>'}</section>
        <section class="admin-stats-panel"><h4>Plus gros dépensiers</h4>${bars(d.topSpenders||[],'name','spent',null,v=>fmt(v)+' FC')}</section>
      </div>
      <p class="admin-stats-note">Jours en heure de Paris. ${since?'Journal des FOOTCOINS tenu depuis le '+esc(since)+' : les mouvements antérieurs n’y figurent pas.':'Journal des FOOTCOINS encore vide.'}</p>`;
    const csv=root.querySelector('[data-stats-csv]');if(csv)csv.onclick=()=>exportCsv(d);
    root.querySelectorAll('[data-stats-days]').forEach(b=>b.onclick=()=>{days=Number(b.dataset.statsDays);load(root);});
  }

  async function load(root){
    if(loading)return;loading=true;
    root.setAttribute('aria-busy','true');
    try{render(root,await api('/api/admin/stats?days='+days));}
    catch(e){root.innerHTML='<p class="admin-stats-empty">Impossible de charger les statistiques : '+esc(e.message)+' <button class="btn btn-outline" type="button" data-stats-retry>RÉESSAYER</button></p>';const b=root.querySelector('[data-stats-retry]');if(b)b.onclick=()=>load(root);}
    finally{loading=false;root.removeAttribute('aria-busy');}
  }

  window.mountAdminStats=function(helpers){
    ({api}=helpers);
    const root=document.getElementById('adminStatsMount');
    if(!root||root.dataset.ready==='1')return;
    root.dataset.ready='1';style();
    root.innerHTML='<p class="admin-stats-empty">Chargement des statistiques…</p>';
    load(root);
  };
})();

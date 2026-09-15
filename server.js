const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const ROOT=__dirname;
const DB=path.join(ROOT,'data.json');
const PORT=Number(process.env.PORT||3000);
const sessions=new Map();

const players=[
{id:'P001',n:'Lucas Martin',o:88,p:'ATT',r:'common',c:'FC Paris',f:'France',pac:91,sho:84,pas:76,dri:88,def:35,phy:72},
{id:'P002',n:'Noah Diallo',o:86,p:'MID',r:'common',c:'Lyon',f:'France',pac:77,sho:73,pas:91,dri:86,def:61,phy:69},
{id:'P003',n:'Ethan Costa',o:84,p:'DEF',r:'common',c:'Marseille',f:'Portugal',pac:78,sho:42,pas:72,dri:58,def:89,phy:85},
{id:'P004',n:'Milan Rossi',o:90,p:'ATT',r:'rare',c:'Monaco',f:'Italy',pac:93,sho:89,pas:79,dri:91,def:31,phy:75},
{id:'P005',n:'Hugo Leroy',o:89,p:'MID',r:'rare',c:'Lille',f:'France',pac:81,sho:70,pas:94,dri:89,def:68,phy:73},
{id:'P006',n:'Enzo Silva',o:91,p:'ATT',r:'epic',c:'Nice',f:'Brazil',pac:95,sho:91,pas:82,dri:94,def:28,phy:79},
{id:'P007',n:'Adam Benali',o:92,p:'DEF',r:'epic',c:'Paris FC',f:'France',pac:85,sho:44,pas:83,dri:61,def:94,phy:91},
{id:'P008',n:'Alex Moreno',o:96,p:'ATT',r:'legendary',c:'FC Paris',f:'France',pac:98,sho:94,pas:88,dri:96,def:44,phy:83},
{id:'P009',n:'Victor Kane',o:95,p:'ATT',r:'legendary',c:'Monaco',f:'England',pac:94,sho:97,pas:80,dri:89,def:33,phy:91},
{id:'P010',n:'Marco Bellini',o:97,p:'MID',r:'icon',c:'Marseille',f:'Italy',pac:87,sho:82,pas:98,dri:96,def:76,phy:81},
{id:'P011',n:'Julien Morel',o:87,p:'GK',r:'common',c:'Lorient',f:'France',pac:51,sho:18,pas:65,dri:24,def:82,phy:84},
{id:'P012',n:'Samuel Okoro',o:85,p:'DEF',r:'common',c:'Nantes',f:'Nigeria',pac:82,sho:36,pas:68,dri:54,def:87,phy:86},
{id:'P013',n:'Rayan Haddad',o:88,p:'MID',r:'rare',c:'Rennes',f:'France',pac:86,sho:66,pas:88,dri:90,def:55,phy:68},
{id:'P014',n:'Leo Martins',o:89,p:'ATT',r:'rare',c:'Strasbourg',f:'Brazil',pac:90,sho:86,pas:74,dri:92,def:30,phy:70},
{id:'P015',n:'Thomas Girard',o:93,p:'DEF',r:'epic',c:'Lens',f:'France',pac:79,sho:48,pas:84,dri:57,def:96,phy:93}
];

const PACKS={starter:{count:5,cost:100},pro:{count:8,cost:250},legend:{count:5,cost:500}};
const SUPPLY={common:1000,rare:500,epic:250,legendary:100,icon:25};
const clubs=[...new Set(players.map(p=>p.c))];

function db(){
  if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify({users:{},market:[],trades:[],counters:{}},null,2));
  const d=JSON.parse(fs.readFileSync(DB,'utf8'));
  d.users??={}; d.market??=[]; d.trades??=[]; d.counters??={};
  return d;
}
function save(d){fs.writeFileSync(DB,JSON.stringify(d,null,2));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6){req.destroy();reject(new Error('payload too large'));}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch(e){reject(e);}});req.on('error',reject);});}
function out(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1).trim())]}));}
function currentUser(req){const sid=cookies(req).fv_session;const id=sessions.get(sid);if(!id)return null;const d=db();return d.users[id]||null;}
function need(req,res){const u=currentUser(req);if(!u){out(res,401,{error:'Authentification requise'});return null;}return u;}
function safe(u){return{id:u.id,name:u.name,email:u.email,createdAt:u.createdAt,coins:u.coins,gems:u.gems,xp:u.xp,lastDaily:u.lastDaily||null};}
function session(res,id){const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,id);res.setHeader('Set-Cookie',`fv_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [salt,key]=String(stored).split(':');const a=crypto.scryptSync(password,salt,64);const b=Buffer.from(key,'hex');return crypto.timingSafeEqual(a,b);}catch{return false;}}
function emailVariants(email){const e=String(email||'').trim().toLowerCase();return[e,e.replace(/\./g,'\\.'),e.replace(/s/g,'x').replace(/\./g,'\\.')];}
function findUserByEmail(d,email){const variants=emailVariants(email);return Object.values(d.users).find(u=>variants.includes(String(u.email||'').trim().toLowerCase()));}
function level(xp){return{level:Math.floor((xp||0)/500)+1,into:(xp||0)%500,next:500};}
function pick(rarity,excluded=new Set()){
  let pool=players.filter(p=>p.r===rarity&&!excluded.has(p.id));
  if(!pool.length)pool=players.filter(p=>p.r===rarity);
  return pool[crypto.randomInt(pool.length)];
}
function draw(type,excluded){
  const r=Math.random();
  if(type==='legend'&&r<0.30)return pick('legendary',excluded);
  if(r<0.02)return pick('icon',excluded);
  if(r<0.12)return pick('legendary',excluded);
  if(r<0.32)return pick('epic',excluded);
  if(r<0.62)return pick('rare',excluded);
  return pick('common',excluded);
}
function drawUniquePack(type,count,d){
  const cards=[];const used=new Set();
  for(let i=0;i<count;i++){
    const p=draw(type,used);used.add(p.id);cards.push(cardFromPlayer(p,d.__uid,d,type));
  }
  if(type==='starter'&&!cards.some(c=>['rare','epic','legendary','icon'].includes(c.rarity))){
    const i=cards.findIndex(c=>c.rarity==='common');
    const p=pick('rare',used);used.add(p.id);
    cards[i]=cardFromPlayer(p,d.__uid,d,type);
  }
  if(type==='legend'&&!cards.some(c=>c.rarity==='legendary')){
    const i=cards.findIndex(c=>c.rarity!=='legendary');
    const p=pick('legendary',used);used.add(p.id);
    cards[i]=cardFromPlayer(p,d.__uid,d,type);
  }
  delete d.__uid;
  return cards;
}
function cardFromPlayer(p,uid,d,pack){const n=(d.counters[p.id]||0)+1;d.counters[p.id]=n;return{id:crypto.randomUUID(),playerId:p.id,player:p.n,rarity:p.r,serial:n,maxSupply:SUPPLY[p.r],serialLabel:`#${String(n).padStart(4,'0')}/${SUPPLY[p.r]}`,season:'2026/27',club:p.c,nation:p.f,ownerId:uid,acquiredAt:new Date().toISOString(),status:'collection',source:'pack',pack};}
function staticFile(req,res){
  let pathname=decodeURIComponent(new URL(req.url,'http://x').pathname);if(pathname==='/')pathname='/index.html';
  const file=path.join(ROOT,path.normalize(pathname));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||!fs.statSync(file).isFile())return out(res,404,{error:'Not found'});
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');
  try{
    if(req.method==='POST'&&u.pathname==='/api/register'){
      const b=await body(req),name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
      if(name.length<2||name.length>30||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return out(res,400,{error:'Nom, email valide et mot de passe de 8 caractères minimum requis.'});
      const d=db();if(Object.values(d.users).some(v=>String(v.email||'').trim().toLowerCase()===email))return out(res,409,{error:'Cet email est déjà utilisé.'});
      const id=crypto.randomUUID();d.users[id]={id,name,email,password:hashPassword(password),inventory:[],history:[],coins:1000,gems:50,xp:0,lastDaily:null,albumClaims:{},createdAt:new Date().toISOString()};save(d);session(res,id);return out(res,201,{user:safe(d.users[id])});
    }
    if(req.method==='POST'&&u.pathname==='/api/login'){
      const b=await body(req),d=db(),email=String(b.email||'').trim().toLowerCase(),x=findUserByEmail(d,email);
      if(!x||!verifyPassword(String(b.password||''),x.password))return out(res,401,{error:'Email ou mot de passe incorrect.'});
      if(x.email!==email){x.email=email;d.users[x.id]=x;save(d);}session(res,x.id);return out(res,200,{user:safe(x)});
    }
    if(req.method==='POST'&&u.pathname==='/api/logout'){const sid=cookies(req).fv_session;sessions.delete(sid);res.setHeader('Set-Cookie','fv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return out(res,200,{ok:true});}
    if(req.method==='GET'&&u.pathname==='/api/me'){const x=currentUser(req);return out(res,x?200:401,x?{user:safe(x)}:{error:'Non connecté'});}
    if(req.method==='GET'&&u.pathname==='/api/state'){
      const x=need(req,res);if(!x)return;
      return out(res,200,{user:safe(x),level:level(x.xp),players,inventory:x.inventory||[],history:x.history||[]});
    }
    if(req.method==='POST'&&u.pathname==='/api/claim-daily'){
      const x=need(req,res);if(!x)return;const d=db(),today=new Date().toISOString().slice(0,10);
      if(x.lastDaily===today)return out(res,409,{error:'Récompense déjà récupérée aujourd’hui.'});
      x.lastDaily=today;x.coins=(x.coins||0)+150;x.xp=(x.xp||0)+25;d.users[x.id]=x;save(d);return out(res,200,{reward:{coins:150,xp:25},user:safe(x)});
    }
    if(req.method==='POST'&&u.pathname==='/api/open-pack'){
      const x=need(req,res);if(!x)return;const b=await body(req),type=PACKS[b.type]?b.type:'starter',cfg=PACKS[type],d=db();
      if((x.coins||0)<cfg.cost)return out(res,402,{error:`Fonds insuffisants. Il vous faut ${cfg.cost} FOOTCOINS.`});
      x.coins-=cfg.cost;d.__uid=x.id;const cards=drawUniquePack(type,cfg.count,d);
      x.inventory.push(...cards);x.history.unshift(...cards.map(c=>({id:c.id,cardId:c.id,player:c.player,rarity:c.rarity,serial:c.serialLabel,pack:type,at:c.acquiredAt})));x.history=x.history.slice(0,50);x.xp=(x.xp||0)+cards.length*20;d.users[x.id]=x;save(d);
      return out(res,200,{cards,inventory:x.inventory,players,user:safe(x),level:level(x.xp)});
    }
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const x=need(req,res);if(!x)return;const q=String(u.searchParams.get('q')||'').toLowerCase(),r=String(u.searchParams.get('rarity')||'all'),d=db();
      return out(res,200,{listings:d.market.filter(v=>v.status==='active'&&(!q||String(v.player).toLowerCase().includes(q))&&(r==='all'||v.rarity===r))});
    }
    if(req.method==='POST'&&u.pathname==='/api/market/list'){
      const x=need(req,res);if(!x)return;const b=await body(req),price=Number(b.price),c=x.inventory.find(v=>v.id===String(b.cardId));
      if(!c||!Number.isInteger(price)||price<10||price>100000)return out(res,400,{error:'Carte ou prix invalide.'});
      const d=db();x.inventory=x.inventory.filter(v=>v.id!==c.id);c.status='market';const listing={...c,id:crypto.randomUUID(),cardId:c.id,sellerId:x.id,sellerName:x.name,price,createdAt:new Date().toISOString(),status:'active'};d.market.unshift(listing);d.users[x.id]=x;save(d);return out(res,201,{listing,user:safe(x)});
    }
    if(req.method==='POST'&&u.pathname==='/api/market/cancel'){
      const x=need(req,res);if(!x)return;const b=await body(req),d=db(),m=d.market.find(v=>v.id===b.id&&v.status==='active');
      if(!m||m.sellerId!==x.id)return out(res,404,{error:'Annonce introuvable.'});m.status='cancelled';x.inventory.push({...m,id:m.cardId,ownerId:x.id,status:'collection'});d.users[x.id]=x;save(d);return out(res,200,{ok:true,user:safe(x)});
    }
    if(req.method==='POST'&&u.pathname==='/api/market/buy'){
      const x=need(req,res);if(!x)return;const b=await body(req),d=db(),m=d.market.find(v=>v.id===b.id&&v.status==='active');
      if(!m)return out(res,404,{error:'Annonce introuvable ou déjà vendue.'});if(m.sellerId===x.id)return out(res,400,{error:'Vous ne pouvez pas acheter votre propre annonce.'});if(x.coins<m.price)return out(res,402,{error:'Fonds insuffisants.'});
      const s=d.users[m.sellerId];if(!s)return out(res,409,{error:'Vendeur introuvable.'});x.coins-=m.price;s.coins=(s.coins||0)+Math.floor(m.price*.95);m.status='sold';m.buyerId=x.id;m.soldAt=new Date().toISOString();x.inventory.push({...m,id:m.cardId,ownerId:x.id,status:'collection',acquiredAt:new Date().toISOString()});d.users[x.id]=x;d.users[s.id]=s;save(d);return out(res,200,{ok:true,item:m,user:safe(x),card:m});
    }
    if(req.method==='GET'&&u.pathname==='/api/my-market'){const x=need(req,res);if(!x)return;return out(res,200,{listings:db().market.filter(v=>v.sellerId===x.id).slice(0,50)});}
    if(req.method==='GET'&&u.pathname==='/api/user-cards'){const x=need(req,res);if(!x)return;const email=String(u.searchParams.get('email')||'').trim().toLowerCase(),d=db(),t=findUserByEmail(d,email);if(!t)return out(res,404,{error:'Collectionneur introuvable.'});return out(res,200,{user:{id:t.id,name:t.name},cards:t.inventory||[]});}
    if(req.method==='GET'&&u.pathname==='/api/rankings'){
      const x=need(req,res);if(!x)return;const rankings=Object.values(db().users).map(v=>({id:v.id,name:v.name,unique:new Set((v.inventory||[]).map(c=>c.playerId||c.player)).size,owned:(v.inventory||[]).length,level:level(v.xp||0).level})).sort((a,b)=>b.unique-a.unique||b.owned-a.owned).slice(0,20);return out(res,200,{rankings});
    }
    if(req.method==='GET'&&u.pathname==='/api/album'){
      const x=need(req,res);if(!x)return;const inv=x.inventory||[],unique=new Set(inv.map(c=>c.playerId)),grouped={};players.forEach(p=>(grouped[p.c]??=[]).push(p));
      const clubAlbums=Object.entries(grouped).map(([name,ps])=>({id:name,name,competition:'Ligue 1',season:'2026/27',total:ps.length,owned:ps.filter(p=>unique.has(p.id)).length,complete:ps.every(p=>unique.has(p.id)),players:ps.map(p=>({id:p.id,name:p.n,rarity:p.r,owned:unique.has(p.id),count:inv.filter(c=>c.playerId===p.id).length,player:p}))}));
      const ligue={id:'ligue-1',name:'Ligue 1',season:'2026/27',total:players.length,owned:players.filter(p=>unique.has(p.id)).length,complete:players.every(p=>unique.has(p.id)),clubs:clubAlbums};
      return out(res,200,{competitions:[ligue,{id:'premier-league',name:'Premier League',season:'2026/27',locked:true,total:380,owned:0,complete:false},{id:'laliga',name:'LaLiga',season:'2026/27',locked:true,total:340,owned:0,complete:false},{id:'bundesliga',name:'Bundesliga',season:'2026/27',locked:true,total:320,owned:0,complete:false},{id:'serie-a',name:'Serie A',season:'2026/27',locked:true,total:320,owned:0,complete:false},{id:'champions-league',name:'Champions League',season:'2026/27',locked:true,total:230,owned:0,complete:false},{id:'icons',name:'Icons & Legends',season:'Toutes éditions',locked:true,total:200,owned:0,complete:false}],clubs:clubAlbums});
    }
    if(req.method==='POST'&&u.pathname==='/api/album/claim'){
      const x=need(req,res);if(!x)return;const b=await body(req),kind=String(b.kind||''),id=String(b.id||''),d=db();x.albumClaims??={};
      if(x.albumClaims[`${kind}:${id}`])return out(res,409,{error:'Récompense déjà récupérée.'});
      let reward=null;const inv=x.inventory||[],unique=new Set(inv.map(c=>c.playerId));
      if(kind==='club'){const ps=players.filter(p=>p.c===id);if(!ps.length||!ps.every(p=>unique.has(p.id)))return out(res,400,{error:'Club non complété.'});reward={coins:250,xp:75};}
      else if(kind==='competition'&&id==='ligue-1'){if(!players.every(p=>unique.has(p.id)))return out(res,400,{error:'Ligue 1 non complétée.'});reward={coins:1000,xp:250};}
      else return out(res,400,{error:'Récompense indisponible.'});
      x.albumClaims[`${kind}:${id}`]=new Date().toISOString();x.coins=(x.coins||0)+reward.coins;x.xp=(x.xp||0)+reward.xp;d.users[x.id]=x;save(d);return out(res,200,{reward,user:safe(x),level:level(x.xp)});
    }
    if(req.method==='GET'&&u.pathname==='/api/trades'){
      const x=need(req,res);if(!x)return;const d=db();return out(res,200,{trades:d.trades.filter(t=>t.fromId===x.id||t.toId===x.id)});
    }
    if(req.method==='POST'&&u.pathname==='/api/trades'){
      const x=need(req,res);if(!x)return;const b=await body(req),d=db(),email=String(b.email||'').trim().toLowerCase(),target=findUserByEmail(d,email),offer=x.inventory.find(c=>c.id===String(b.offerCardId));
      if(!target||target.id===x.id||!offer)return out(res,400,{error:'Collectionneur ou carte d’échange invalide.'});
      const want=target.inventory.find(c=>c.id===String(b.wantCardId));if(!want)return out(res,400,{error:'La carte demandée est introuvable.'});
      const trade={id:crypto.randomUUID(),fromId:x.id,fromName:x.name,toId:target.id,toName:target.name,offerCardId:offer.id,wantCardId:want.id,status:'pending',createdAt:new Date().toISOString()};d.trades.unshift(trade);save(d);return out(res,201,{trade});
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/trades/')){
      const x=need(req,res);if(!x)return;const action=u.pathname.split('/').pop(),b=await body(req),d=db(),t=d.trades.find(v=>v.id===b.id&&v.status==='pending');
      if(!t||t.toId!==x.id)return out(res,404,{error:'Échange introuvable.'});
      if(action==='decline'){t.status='declined';save(d);return out(res,200,{trade:t});}
      if(action==='accept'){
        const from=d.users[t.fromId],offer=(from.inventory||[]).find(c=>c.id===t.offerCardId),want=(x.inventory||[]).find(c=>c.id===t.wantCardId);if(!from||!offer||!want)return out(res,409,{error:'Les cartes de cet échange ne sont plus disponibles.'});
        from.inventory=from.inventory.filter(c=>c.id!==offer.id);x.inventory=x.inventory.filter(c=>c.id!==want.id);offer.ownerId=x.id;want.ownerId=from.id;from.inventory.push({...want,status:'collection'});x.inventory.push({...offer,status:'collection'});t.status='accepted';t.acceptedAt=new Date().toISOString();d.users[from.id]=from;d.users[x.id]=x;save(d);return out(res,200,{trade:t});
      }
      return out(res,400,{error:'Action invalide.'});
    }
    if(req.method==='POST'&&u.pathname==='/api/reset'){
      const x=need(req,res);if(!x)return;const d=db();x.inventory=[];x.history=[];x.coins=1000;x.gems=50;x.xp=0;x.lastDaily=null;x.albumClaims={};d.users[x.id]=x;save(d);return out(res,200,{ok:true,user:safe(x),level:level(0)});
    }
    return staticFile(req,res);
  }catch(e){console.error(e);if(!res.headersSent)out(res,500,{error:'Erreur serveur'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`SPORT VAULT running on ${PORT}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const PUBLIC_PORT=Number(process.env.PORT||3000),LEGACY_PORT=PUBLIC_PORT===3000?3001:PUBLIC_PORT+1,DB=path.join(__dirname,'data.json');
const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(LEGACY_PORT)},stdio:'inherit'});
child.on('exit',code=>{if(code!==0)process.exitCode=code||1});
function readBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6){req.destroy();reject(new Error('payload too large'))}});req.on('end',()=>resolve(s));req.on('error',reject)})}
function db(){if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify({users:{},market:[],trades:[],counters:{}},null,2));const d=JSON.parse(fs.readFileSync(DB,'utf8'));d.users??={};d.market??=[];d.trades??=[];d.counters??={};return d}
function save(d){fs.writeFileSync(DB,JSON.stringify(d,null,2))}
function hash(p,s=crypto.randomBytes(16).toString('hex')){return s+':'+crypto.scryptSync(p,s,64).toString('hex')}
function safe(u){return{id:u.id,name:u.name,email:u.email,createdAt:u.createdAt,coins:u.coins,gems:u.gems,xp:u.xp,lastDaily:u.lastDaily||null}}
function candidates(email){const e=String(email||'').trim().toLowerCase(),set=new Set([e,e.replace(/\./g,'\\.'),e.replace(/s/g,'x'),e.replace(/s/g,'x').replace(/\./g,'\\.')]);return [...set]}
function findUser(email){const d=db(),c=candidates(email);return Object.values(d.users).find(u=>c.includes(String(u.email||'').toLowerCase()))||null}
function requestBackend(method,url,body,headers={}){return new Promise((resolve,reject)=>{const payload=body===undefined?null:Buffer.from(body);const opts={hostname:'127.0.0.1',port:LEGACY_PORT,path:url,method,headers:{...headers,host:`127.0.0.1:${LEGACY_PORT}`}};if(payload){opts.headers['content-length']=payload.length;opts.headers['content-type']='application/json'}const r=http.request(opts,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))});r.on('error',reject);if(payload)r.end(payload);else r.end()})}
function reply(res,status,headers,body){const h={...headers};delete h['content-length'];res.writeHead(status,h);res.end(body)}
const server=http.createServer(async(req,res)=>{try{
if(req.method==='POST'&&req.url==='/api/register'){
 const raw=await readBody(req),b=JSON.parse(raw||'{}'),name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
 if(name.length<2||name.length>30||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8){reply(res,400,{'Content-Type':'application/json; charset=utf-8'},Buffer.from(JSON.stringify({error:'Nom, email valide et mot de passe de 8 caractères minimum requis.'})));return}
 if(findUser(email)){reply(res,409,{'Content-Type':'application/json; charset=utf-8'},Buffer.from(JSON.stringify({error:'Cet email est déjà utilisé.'})));return}
 const d=db(),id=crypto.randomUUID();d.users[id]={id,name,email,password:hash(password),inventory:[],history:[],coins:1000,gems:50,xp:0,lastDaily:null,albumClaims:{},createdAt:new Date().toISOString()};save(d);
 const login=await requestBackend('POST','/api/login',JSON.stringify({email,password}),{'accept':'application/json'});
 if(login.status<200||login.status>=300){delete d.users[id];save(d);reply(res,500,{'Content-Type':'application/json; charset=utf-8'},Buffer.from(JSON.stringify({error:'Compte créé mais ouverture de session impossible. Réessayez.'})));return}
 reply(res,201,{...login.headers,'Content-Type':'application/json; charset=utf-8'},login.body);return;
}
if(req.method==='POST'&&req.url==='/api/login'){
 const raw=await readBody(req),b=JSON.parse(raw||'{}'),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
 const u=findUser(email),loginEmail=u?u.email:email;
 const login=await requestBackend('POST','/api/login',JSON.stringify({email:loginEmail,password}),{'accept':'application/json'});
 reply(res,login.status,{...login.headers,'Content-Type':'application/json; charset=utf-8'},login.body);return;
}
let body; if(req.method!=='GET'&&req.method!=='HEAD')body=await readBody(req).catch(()=>null);const r=await requestBackend(req.method,req.url,body,{...req.headers});reply(res,r.status,r.headers,r.body);
}catch(e){if(!res.headersSent)reply(res,500,{'Content-Type':'application/json; charset=utf-8'},Buffer.from(JSON.stringify({error:'Erreur serveur.'})));else res.end()}});
server.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`SPORT VAULT auth gateway running on ${PUBLIC_PORT}, backend on ${LEGACY_PORT}`));
process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));
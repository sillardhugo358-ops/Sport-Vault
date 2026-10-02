const {spawn}=require('node:child_process');
const {execFile}=require('node:child_process');
const path=require('node:path');

const child=spawn(process.execPath,['-r','./security-bootstrap.js','server.js'],{stdio:'inherit',env:process.env});
let imported=false;
let timer=null;

async function syncWhenReady(){
  if(imported||!process.env.DATABASE_URL)return;
  try{
    const {Pool}=require('pg');
    const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:1,connectionTimeoutMillis:2000});
    const r=await db.query("SELECT to_regclass('public.catalog_cards') AS cards,to_regclass('public.competitions') AS competitions,to_regclass('public.competition_seasons') AS seasons,to_regclass('public.clubs') AS clubs,(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='catalog_cards' AND column_name='rarity_locked') AS rarity_locked");
    await db.end();
    if(r.rows[0]?.cards&&r.rows[0]?.competitions&&r.rows[0]?.seasons&&r.rows[0]?.clubs&&r.rows[0]?.rarity_locked){
      imported=true;
      clearInterval(timer);
      execFile(process.execPath,[path.join(__dirname,'scripts','import-ligue1-2026-27.js')],{env:process.env},(error,stdout,stderr)=>{
        if(stdout)process.stdout.write(stdout);
        if(stderr)process.stderr.write(stderr);
        if(error)console.error('[FOOTVAULT] Ligue 1 sync process failed:',error.message);
        // Puis les 4 championnats européens (sauté si déjà à jour).
        execFile(process.execPath,[path.join(__dirname,'scripts','import-europe.js')],{env:process.env,maxBuffer:4*1024*1024},(error2,stdout2,stderr2)=>{
          if(stdout2)process.stdout.write(stdout2);
          if(stderr2)process.stderr.write(stderr2);
          if(error2)console.error('[FOOTVAULT] Europe import process failed:',error2.message);
          // Puis Coupe du monde et Ligue des Nations (sauté si déjà à jour).
          execFile(process.execPath,[path.join(__dirname,'scripts','import-international.js')],{env:process.env,maxBuffer:4*1024*1024},(error3,stdout3,stderr3)=>{
            if(stdout3)process.stdout.write(stdout3);
            if(stderr3)process.stderr.write(stderr3);
            if(error3)console.error('[FOOTVAULT] International import process failed:',error3.message);
            // Puis la Ligue des Champions (sauté si déjà à jour).
            execFile(process.execPath,[path.join(__dirname,'scripts','import-ldc.js')],{env:process.env,maxBuffer:4*1024*1024},(error4,stdout4,stderr4)=>{
              if(stdout4)process.stdout.write(stdout4);
              if(stderr4)process.stderr.write(stderr4);
              if(error4)console.error('[FOOTVAULT] Champions League import process failed:',error4.message);
              // Puis les logos de clubs du dossier club-logos/ (sans fichier, aucun effet).
              execFile(process.execPath,[path.join(__dirname,'scripts','sync-club-logos.js')],{env:process.env},(error5,stdout5,stderr5)=>{
                if(stdout5)process.stdout.write(stdout5);
                if(stderr5)process.stderr.write(stderr5);
                if(error5)console.error('[FOOTVAULT] Club logos sync process failed:',error5.message);
              });
            });
          });
        });
      });
    }
  }catch{}
}
timer=setInterval(syncWhenReady,1500);
syncWhenReady();

child.on('exit',(code,signal)=>{
  if(timer)clearInterval(timer);
  if(signal)process.kill(process.pid,signal);
  else process.exit(code===null?1:code);
});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
process.on('SIGINT',()=>child.kill('SIGINT'));

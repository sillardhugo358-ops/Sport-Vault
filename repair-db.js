const fs=require('node:fs');
const path=require('node:path');

const DB=path.join(__dirname,'data.json');
const WELCOME_COINS=1000;
const WELCOME_GEMS=50;
const WELCOME_VERSION=1;

function shouldRepair(u){
  return Number(u?.coins||0)===0 &&
    Number(u?.gems||0)===0 &&
    Number(u?.xp||0)===0 &&
    !(u?.inventory||[]).length &&
    !(u?.history||[]).length &&
    !u?.lastDaily;
}

function repairState(state){
  let repaired=0;
  for(const u of Object.values(state.users||{})){
    if(shouldRepair(u)){
      u.coins=WELCOME_COINS;
      u.gems=WELCOME_GEMS;
      u.albumClaims??={};
      u.missionClaims??={};
      u.welcomeGrantVersion=WELCOME_VERSION;
      repaired++;
    }
  }
  return repaired;
}

async function main(){
  if(process.env.DATABASE_URL){
    const {Pool}=require('pg');
    const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:2});
    try{
      await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);
      const result=await pool.query('SELECT data FROM app_state WHERE id=1');
      let state=result.rows[0]?.data||{users:{},market:[],trades:[],counters:{}};
      const repaired=repairState(state);
      if(repaired){
        await pool.query(`INSERT INTO app_state (id,data,updated_at) VALUES (1,$1::jsonb,now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`,[JSON.stringify(state)]);
      }
      console.log(`SPORT VAULT startup repair: ${repaired} compte(s) réinitialisé(s).`);
    }finally{await pool.end();}
    return;
  }

  let state={users:{},market:[],trades:[],counters:{}};
  if(fs.existsSync(DB)){
    try{state=JSON.parse(fs.readFileSync(DB,'utf8'));}catch{state={users:{},market:[],trades:[],counters:{}};}
  }
  state.users??={};state.market??=[];state.trades??=[];state.counters??={};
  const repaired=repairState(state);
  fs.writeFileSync(DB,JSON.stringify(state,null,2));
  console.log(`SPORT VAULT startup repair: ${repaired} compte(s) réinitialisé(s).`);
}

main().catch(err=>{console.error('SPORT VAULT repair error:',err);process.exit(1);});

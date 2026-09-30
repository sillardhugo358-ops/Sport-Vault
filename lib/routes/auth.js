'use strict';

// Comptes : inscription, connexion, déconnexion, profil.
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const crypto = require('node:crypto');
const { json, readBody } = require('../http');
const { clientIp } = require('../client-ip');
const { recordCoins } = require('../ledger');

function createAuthRoutes({ createSession, currentUser, destroySession, expiryDate, findUserByEmail, getPool, grantWelcomeCards, hashPassword, loginFailure, loginStatus, loginSuccess, markRegistration, memory, registrationAllowed, safeUser, securityEvent, sessionCookie, validPassword, verifyPassword }) {
 return async function authRoutes(req, res, url) {
if(req.method==='GET'&&url.pathname==='/api/me'){const user=await currentUser(req);return json(res,user?200:401,user?{user:safeUser(user)}:{error:'Non connecté'});}
if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
if(req.method==='POST'&&url.pathname==='/api/register'){
  const ip=clientIp(req),body=await readBody(req),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(name.length<2||name.length>30||!/^\S+@\S+\.\S+$/.test(email)||!validPassword(password))return json(res,400,{error:'Nom, email valide et mot de passe de 10 à 128 caractères avec au moins une lettre et un chiffre requis.'});
  if(getPool()){
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      const adminEmails=String(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!adminEmails.includes(email)&&!(await registrationAllowed(ip,client))){await client.query('ROLLBACK');return json(res,429,{error:'Création de compte limitée : une inscription est autorisée toutes les 72 heures depuis cette connexion.'});}
      const exists=await client.query('SELECT 1 FROM users WHERE email=$1',[email]);
      if(exists.rowCount){await client.query('ROLLBACK');return json(res,409,{error:'Cet email est déjà utilisé.'});}
      const id=crypto.randomUUID(),passwordHash=hashPassword(password),now=new Date();
      await client.query('INSERT INTO users(id,name,email,password_hash,coins,gems,xp,packs_opened,created_at) VALUES($1,$2,$3,$4,1000,50,0,0,$5)',[id,name,email,passwordHash,now]);
      await recordCoins(client,id,1000,'signup');
      const welcomeCards=await grantWelcomeCards(id,client);
      await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);
      const realUser=(await client.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
      const token=crypto.randomBytes(32).toString('hex');
      await client.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,id,expiryDate()]);
      await client.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[id,ip,'registration_success',JSON.stringify({email})]);
      await client.query('COMMIT');
      res.setHeader('Set-Cookie',sessionCookie(token));
      return json(res,201,{user:safeUser(realUser),welcomeCards});
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  if(!(await registrationAllowed(ip)))return json(res,429,{error:'Création de compte limitée à une fois toutes les 72 heures.'});
  if(await findUserByEmail(email))return json(res,409,{error:'Cet email est déjà utilisé.'});
  const user={id:crypto.randomUUID(),name,email,password_hash:hashPassword(password),coins:1000,gems:50,xp:0,packs_opened:0,createdAt:new Date().toISOString()};
  memory.users.set(user.id,user);
  const welcomeCards=await grantWelcomeCards(user.id);
  await markRegistration(ip);
  const token=await createSession(user.id);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,201,{user:safeUser(user),welcomeCards});
 }
if(req.method==='POST'&&url.pathname==='/api/login'){
  const ip=clientIp(req),body=await readBody(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),status=await loginStatus(ip,email);
  if(status.blocked)return json(res,429,{error:'Trop de tentatives incorrectes. Connexion temporairement bloquée pendant 15 minutes.'});
  const user=await findUserByEmail(email);
  if(user?.account_status==='banned')return json(res,403,{error:'Ce compte a été banni.'});
  if(user?.account_status==='blocked'&&user.blocked_until&&new Date(user.blocked_until)>new Date())return json(res,403,{error:'Ce compte est temporairement bloqué jusqu’au '+new Date(user.blocked_until).toLocaleString('fr-FR')+'.'});
  if(!user||!verifyPassword(password,user.password_hash)){
    await loginFailure(ip,email);
    await securityEvent(user?.id||null,ip,'login_failure',{email,attempt:Number(status.attempts||0)+1});
    const left=Math.max(0,5-(status.attempts+1));
    return json(res,401,{error:left?'Email ou mot de passe incorrect. Il reste '+left+' tentative(s).':'Trop de tentatives incorrectes. Connexion bloquée pendant 15 minutes.'});
  }
  await loginSuccess(ip,email);
  await securityEvent(user.id,ip,'login_success');
  const token=await createSession(user.id);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,200,{user:safeUser(user)});
 }
if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
  return false;
 };
}

module.exports = { createAuthRoutes };

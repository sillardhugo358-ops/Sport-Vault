'use strict';

// Comptes et sessions : mots de passe, cookies de session, limites
// d'inscription et de connexion, rôles. db() renvoie le pool PostgreSQL
// courant (null en mode mémoire) ; memory sert de stockage sans base.

const crypto = require("node:crypto");

const SESSION_DAYS = 2/24;

function createAuth({ db, memory }) {
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1).trim())];}));}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [salt,hex]=String(stored).split(':');const actual=crypto.scryptSync(password,salt,64);const expected=Buffer.from(hex,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}catch{return false;}}
function validPassword(password){return typeof password==='string'&&password.length>=10&&password.length<=128&&/[A-Za-z]/.test(password)&&/[0-9]/.test(password);}
function safeUser(user){const coins=Number(user.coins||0),reservedCoins=Number(user.reserved_coins||0);return{id:user.id,name:user.name,email:user.email,role:user.role||'user',coins,gems:Number(user.gems),xp:Number(user.xp),reservedCoins,availableCoins:Math.max(0,coins-reservedCoins),createdAt:user.createdAt||user.created_at,accountStatus:user.account_status||'active',blockedUntil:user.blocked_until||null,dailyClaimedAt:user.daily_claimed_at||user.dailyClaimedAt||null};}
function sessionCookie(token){return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`;}
function expiryDate(){return new Date(Date.now()+SESSION_DAYS*86400_000);}
async function findUserByEmail(email){if(db()){const r=await db().query('SELECT * FROM users WHERE email=$1',[email]);return r.rows[0]||null;}for(const u of memory.users.values())if(u.email===email)return u;return null;}
async function getUserById(id){if(db()){const r=await db().query('SELECT * FROM users WHERE id=$1',[id]);return r.rows[0]||null;}return memory.users.get(id)||null;}
async function cleanupSessions(){if(!db())return;try{await db().query('DELETE FROM sessions WHERE expires_at<=now()')}catch(e){console.error('SPORT VAULT session cleanup error:',e.message)}}
function roleLevel(role){return role==='creator'?3:role==='admin'?2:1}
function canManage(actor,target){return roleLevel(actor.role)>roleLevel(target.role)}
function isAdmin(user){return !!user&&(user.role==='admin'||user.role==='creator')}
async function requireAdmin(req){const user=await currentUser(req);return isAdmin(user)?user:null}
async function currentUser(req){const token=cookies(req).fv_session;if(!token)return null;if(db()){const r=await db().query("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now() AND (u.account_status='active' OR (u.account_status='blocked' AND u.blocked_until<=now()))",[token]);return r.rows[0]||null;}const s=memory.sessions.get(token);if(!s||s.expiresAt<=Date.now()){memory.sessions.delete(token);return null;}const u=memory.users.get(s.userId);return u&&u.accountStatus!=='banned'&&!(u.accountStatus==='blocked'&&u.blockedUntil>Date.now())?u:null;}
async function createSession(userId){const token=crypto.randomBytes(32).toString('hex'),expires=expiryDate();if(db()){await db().query('DELETE FROM sessions WHERE expires_at<=now()');await db().query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,userId,expires]);}else memory.sessions.set(token,{userId,expiresAt:expires.getTime()});return token;}
async function destroySession(req,res){const token=cookies(req).fv_session;if(token){if(db())await db().query('DELETE FROM sessions WHERE token=$1',[token]);else memory.sessions.delete(token);}res.setHeader('Set-Cookie','fv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');}
async function registrationAllowed(ip,client){if(client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ip]);const r=await client.query('SELECT last_created_at FROM registration_limits WHERE ip=$1',[ip]);return !r.rowCount||Date.now()-new Date(r.rows[0].last_created_at).getTime()>=72*3600_000}const last=memory.reg?.get(ip);return !last||Date.now()-last>=72*3600_000}
async function markRegistration(ip,client){if(client)await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);else memory.reg.set(ip,Date.now())}
async function loginStatus(ip,email){if(db()){const r=await db().query('SELECT failed_attempts,blocked_until FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);if(!r.rowCount)return{blocked:false,attempts:0};const x=r.rows[0];return{blocked:x.blocked_until&&new Date(x.blocked_until)>new Date(),attempts:Number(x.failed_attempts)}}const x=memory.login?.get(ip+':'+email);return x?{blocked:x.blockedUntil>Date.now(),attempts:x.attempts}:{blocked:false,attempts:0}}
async function loginFailure(ip,email){if(db()){await db().query("INSERT INTO login_limits(ip,email,failed_attempts,blocked_until,updated_at) VALUES($1,$2,1,NULL,now()) ON CONFLICT(ip,email) DO UPDATE SET failed_attempts=login_limits.failed_attempts+1,blocked_until=CASE WHEN login_limits.failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE login_limits.blocked_until END,updated_at=now()",[ip,email]);return}const key=ip+':'+email,x=memory.login?.get(key)||{attempts:0,blockedUntil:0};x.attempts++;if(x.attempts>=5)x.blockedUntil=Date.now()+15*60_000;memory.login.set(key,x)}
async function loginSuccess(ip,email){if(db())await db().query('DELETE FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);else memory.login?.delete(ip+':'+email)}

return { cookies, hashPassword, verifyPassword, validPassword, safeUser, sessionCookie, expiryDate, findUserByEmail, getUserById, cleanupSessions, roleLevel, canManage, isAdmin, requireAdmin, currentUser, createSession, destroySession, registrationAllowed, markRegistration, loginStatus, loginFailure, loginSuccess };
}

module.exports = { createAuth, SESSION_DAYS };

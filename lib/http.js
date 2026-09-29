'use strict';

// Réponses JSON et lecture du corps des requêtes, partagées par server.js et lib/routes/.
// json() renvoie true : une route qui a répondu le signale au routeur.

const zlib = require('node:zlib');

// Réponses JSON volumineuses (catalogue admin, album) compressées en gzip si le navigateur l'accepte.
function json(res,status,data){const body=JSON.stringify(data),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};if(body.length>32768&&/\bgzip\b/.test(String(res.req?.headers['accept-encoding']||''))){zlib.gzip(body,{level:1},(err,gz)=>{if(err){res.writeHead(status,headers);res.end(body);return;}res.writeHead(status,{...headers,'Content-Encoding':'gzip','Vary':'Accept-Encoding'});res.end(gz);});return true;}res.writeHead(status,headers);res.end(body);return true;}

async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Payload too large');}return JSON.parse(body||'{}');}

module.exports = { json, readBody };

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'server2.js');
let source = fs.readFileSync(file, 'utf8');

const replacements = [
  [
    "function publicCard(card){const serial=Number(card.serial),maxSupply=Number(card.max_supply||card.maxSupply);return {instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,rarityLabel:RARITIES[card.rarity]?.label||card.rarity,serial,maxSupply,serialLabel:`${serial}/${maxSupply}`,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}",
    "function publicCard(card){const serial=Number(card.serial||0),maxSupply=Number(card.max_supply||card.maxSupply);const numbered=card.rarity==='icon';return {instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,rarityLabel:RARITIES[card.rarity]?.label||card.rarity,serial:numbered?serial:null,maxSupply,serialLabel:numbered?`#${serial}/${maxSupply}`:'CLASSIC',acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}"
  ],
  [
    "function buildInstance(card,ownerId,source='pack'){const rarity=RARITIES[card.rarity];return {instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,serial:Math.floor(Math.random()*rarity.supply)+1,maxSupply:rarity.supply,acquiredAt:new Date().toISOString(),source,status:'owned'};}",
    "function buildInstance(card,ownerId,source='pack'){const rarity=RARITIES[card.rarity];const numbered=card.rarity==='icon';return {instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,serial:numbered?Math.floor(Math.random()*rarity.supply)+1:0,maxSupply:rarity.supply,acquiredAt:new Date().toISOString(),source,status:'owned'};}"
  ],
  [
    "async function getUserCards(ownerId){if(pool){const r=await pool.query(\"SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' ORDER BY acquired_at DESC\",[ownerId]);return r.rows.map(publicCard)}return [...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard)}",
    "async function getUserCards(ownerId){if(pool){const r=await pool.query(\"SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' AND source<>'welcome' ORDER BY acquired_at DESC\",[ownerId]);return r.rows.map(publicCard)}return [...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned'&&c.source!=='welcome').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard)}"
  ],
  [
    "async function grantWelcomeCards(userId){const existing=await getUserCards(userId);if(existing.length)return existing;const cards=[];for(const card of CARD_CATALOG.filter(c=>c.rarity==='common').slice(0,3)){const instance=buildInstance(card,userId,'welcome');await createCardInstance(instance);cards.push(publicCard(instance))}return cards}",
    "async function grantWelcomeCards(userId){return getUserCards(userId)}"
  ]
];

for (const [from, to] of replacements) {
  if (source.includes(from)) source = source.replace(from, to);
}

fs.writeFileSync(file, source);
require(file);

'use strict';

// Génère une paire de clés VAPID pour les notifications push. À exécuter une seule fois, sur votre ordinateur :
//   node scripts/generate-vapid-keys.js
// Puis, dans Render > Environment : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (secrète, ne jamais la committer ni la partager)
// et VAPID_SUBJECT (par exemple mailto:votre-adresse@exemple.com). Garder les mêmes clés ensuite : les changer désabonne tout le monde.

const { generateVapidKeys } = require('../lib/push');
const k = generateVapidKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('VAPID_SUBJECT=mailto:votre-adresse@exemple.com');

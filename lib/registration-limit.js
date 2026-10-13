'use strict';

// Limite d'inscriptions par connexion (IP) : au plus `perWindow` comptes par fenêtre de `windowHours` h. Une seule par IP bloquait
// des joueurs légitimes (réseau mobile partagé, domicile ou école). Réglable : REGISTRATIONS_PER_WINDOW, REGISTRATION_WINDOW_HOURS.
const REGISTRATION = {
  perWindow: Math.max(1, Number.parseInt(process.env.REGISTRATIONS_PER_WINDOW, 10) || 5),
  windowHours: Math.max(1, Number.parseInt(process.env.REGISTRATION_WINDOW_HOURS, 10) || 72)
};
const REGISTRATION_MESSAGE = `Trop de comptes ont déjà été créés depuis cette connexion (${REGISTRATION.perWindow} au maximum toutes les ${REGISTRATION.windowHours} heures). Réessaie plus tard ou depuis un autre réseau ; si tu partages ta connexion (école, réseau mobile…), contacte-nous.`;

module.exports = { REGISTRATION, REGISTRATION_MESSAGE };

# Audit de sécurité des routes sensibles — 5 octobre 2026

Périmètre : `server.js`, `security-bootstrap.js`, `lib/auth.js`, `lib/routes/*.js`, `lib/auctions.js`, `lib/rewards.js`. Lecture du code et tests ; aucun accès à la production ni à ses journaux.

## Ce qui est déjà en place (vérifié dans le code)
- **Administration** : les 40 routes `/api/admin/*` appellent `requireAdmin` (rôle `admin` ou `creator`) avant tout traitement ; test `test/admin.test.js` (refus 403 pour un joueur).
- **Session** : jeton aléatoire de 256 bits, cookie `HttpOnly`, `SameSite=Lax`, `Secure` ajouté derrière HTTPS (`security-bootstrap.js`), expiration côté serveur (2 h en production), comptes bannis/bloqués refusés à chaque requête (`currentUser`).
- **Mots de passe** : scrypt avec sel, comparaison à temps constant, 10 caractères minimum.
- **Limites** : 180 requêtes/min/IP, 20 connexions ou inscriptions par 15 min, blocage 15 min après 5 échecs (IP + e-mail), 1 inscription par 72 h et par IP, plafonds sur les ouvertures de packs et les enchères.
- **CSRF** : requêtes d'écriture refusées si l'en-tête `Origin` ne correspond pas au site, en plus de `SameSite=Lax`.
- **En-têtes** : CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`.
- **Récompenses** : chaque récompense passe par `reward_claims` (insertion `ON CONFLICT DO NOTHING` dans la transaction qui crédite les FOOTCOINS) : pas de double attribution, même en rafale.
- **Enchères** : verrous `FOR UPDATE` sur l'enchère et sur le compte, FOOTCOINS réservés, vendeur ne pouvant pas enchérir, paliers calculés côté serveur.
- **Fichiers publics** : liste blanche stricte (`isPublicFile`) ; `server.js`, `lib/`, `data/`, `.env` renvoient 404 (contrôlé à chaque `production.yml`).

## Corrigé dans cette PR
1. **Jeton d'import interne** (`/api/internal/historical-import`) comparé avec `!==` : remplacé par une comparaison à temps constant (`lib/routes/internal.js`).
2. **Corps de requête invalide** : un JSON mal formé ou un corps de plus de 1 Mo provoquait une erreur serveur 500 (journalisée comme incident). Ils renvoient maintenant 400 / 413 avec un message clair (`lib/http.js`, `server.js`). Tests dans `test/routes.test.js`.

## Recommandations restantes (non faites ici)
| Priorité | Sujet | Détail |
|---|---|---|
| Haute | Mot de passe de la base | À changer côté Aiven puis dans `DATABASE_URL` (Render) : action du propriétaire. |
| Moyenne | `sslmode=no-verify` | La connexion à Aiven est chiffrée mais le certificat n'est pas vérifié. **Code prêt depuis le 05/10/2026** (`lib/db-ssl.js`) : il reste à fournir le *CA certificate* d'Aiven dans la variable Render `DATABASE_CA_CERT` (procédure et retour arrière dans `SAUVEGARDE.md`). |
| Basse | CSP `script-src 'unsafe-inline'` | Nécessaire tant que l'interface contient des scripts et styles en ligne ; à retirer en les déplaçant dans des fichiers. |
| Basse | Jetons de session en clair en base | Durée de vie de 2 h seulement ; les stocker hachés forcerait une reconnexion générale. |
| Basse | Historique d'enchère public | `/api/auctions/:id/bids` expose le pseudo des enchérisseurs (comportement voulu pour un marché) : à confirmer. |

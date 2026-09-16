# FOOTVAULT — SPORT VAULT

**COLLECT THE GAME.**

Reconstruction complète de l'expérience FOOTVAULT : une interface unique, premium et mobile-first pour collectionner les cartes de football.

## Fonctionnalités

- Compte et session serveur
- 1 000 FOOTCOINS + 50 GEMS à la création
- 3 cartes de bienvenue
- Collection personnelle persistante
- 24 cartes du catalogue / 5 raretés
- Packs Starter, Pro et Legend avec tirages côté serveur
- Révélation animée des cartes
- XP et niveaux
- Bonus quotidien : 150 FC + 25 XP
- Missions avec progression réelle et protection anti-double récompense
- Album par club avec récompense de 250 FC + 75 XP
- Fiche détaillée : OVR, 6 attributs, Vault Value, édition, source et date d'acquisition
- Market préparé pour une prochaine brique
- Interface responsive téléphone / tablette / ordinateur
- Anciennes URLs conservées via redirections vers l'application

## Architecture

Le navigateur ne constitue jamais la source de vérité pour l'économie ou les cartes. Les comptes, soldes, sessions, instances de cartes et récompenses sont gérés par `server.js`, avec PostgreSQL sur Render lorsque `DATABASE_URL` est disponible.

L'interface FOOTVAULT est maintenant une SPA légère servie par Node, avec navigation par hash pour éviter les multiplications de pages et les fenêtres/panneaux persistants.

## Local

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

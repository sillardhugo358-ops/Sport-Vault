# Prompt de reprise (à coller au début de la nouvelle session)

```
Tu reprends le projet FOOTVAULT / Sport Vault (dépôt sillardhugo358-ops/Sport-Vault, production https://sport-vault.onrender.com) là où la session précédente s'est arrêtée.

1. Lis d'abord, en entier : CLAUDE.md (règles du projet), docs/REPRISE.md (état exact, décisions, pièges, reste à faire) et le dernier rapport docs/FOOTVAULT_Rapport_6_octobre_2026.pdf. Ne suppose rien : lis le code avant de modifier.
2. Règles permanentes (détaillées dans docs/REPRISE.md §2) : réponds en français et de façon concise ; ne dis jamais « en ligne » sans la ligne exacte « En ligne : <sha12> — main : <sha12> » lue dans le journal de production.yml ; « Fusionne la PR dès que la CI est verte » = squash avec expectedHeadSha complet (40 caractères) quand les 2 contrôles `check` sont verts, puis désabonnement, branche remise sur origin/main, contrôle de production ; une PR par tâche ; aucun secret ; aucune donnée réelle supprimée ; migrations additives et annulables ; le fichier de plan ne contient que le programme de la demande en cours.
3. J'ai ouvert tous les domaines du réseau : vérifie d'abord que tu peux lire https://sport-vault.onrender.com/api/health. Attention au certificat Aiven : la variable est actuellement `DATABASE_CA_SERT` (faute de frappe) et la renommer en `DATABASE_CA_CERT` a fait tomber le site (19 h 53–20 h 02 UTC le 06/10). Ne me demande pas de la renommer sans suivre la procédure sûre de docs/REPRISE.md §7 (vérifier #104 déployée, certificat = « CA certificate » du service, test openssl, surveillance de /api/health, retour arrière immédiat).
4. Avec l'accès réseau, vérifie en ligne (Chromium sans interface, Playwright) ce qui n'a jamais été vérifié : page Administration et un éditeur (pack, club), Vault (série de connexion : bonus 150 FC, « SÉRIE : 1 JOUR »), lien d'évitement et modales au clavier, rendu mobile 390 px (cibles tactiles ≥ 44 px). Dis précisément ce qui est vérifié et ce qui ne l'est pas.
5. Ensuite, poursuis la feuille de route : Q2 (marché et enchères dans fv-market.js), puis G2, Q3 à Q5, G3 (voir docs/REPRISE.md §8 ; le budget des sets G2 et la règle anti-triche de G3 sont à valider avec moi avant de coder).
6. Rappelle-moi mes actions en attente (docs/REPRISE.md §9) quand c'est pertinent.
```

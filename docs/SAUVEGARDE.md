# Sauvegarde et restauration de la base FOOTVAULT

La base de production est un PostgreSQL 18 hébergé sur Render (`sport-vault-db`, plan **free**). Le dépôt ne contient aucun mécanisme de sauvegarde automatique : cette procédure est à lancer manuellement.

## ⚠️ À vérifier sur le tableau de bord Render

Render limite la durée de vie des bases **free** : d'après sa documentation (à confirmer sur https://render.com/docs/free, que je n'ai pas pu consulter depuis cette session), elles expirent environ 30 jours après leur création, avec un court délai de grâce, puis sont supprimées. Les bases free n'ont pas non plus de sauvegardes automatiques.

1. Ouvrir https://dashboard.render.com → base **sport-vault-db**.
2. Noter la **date d'expiration** si elle est affichée.
3. Décider : passer sur un plan payant (sauvegardes incluses) ou faire des sauvegardes manuelles régulières.

## Faire une sauvegarde

Prérequis : outils clients PostgreSQL **version 18 ou plus** (`pg_dump`, `pg_restore`, `psql`). Le script refuse de continuer avec une version plus ancienne que le serveur.

1. Sur Render, base **sport-vault-db** → *Connect* → copier l'**External Database URL**.
2. Depuis la racine du dépôt :

   ```bash
   DATABASE_URL="postgresql://…" ./scripts/backup-db.sh
   ```

3. Le fichier est créé dans `backups/footvault-AAAAMMJJ-HHMMSS.dump`. Le dossier `backups/` et les fichiers `*.dump` sont ignorés par Git.

Le script ne fait que lire la base. Il affiche à la fin le nombre de tables sauvegardées et un comptage de contrôle (`users`, `card_instances`, `catalog_cards`).

**Ne jamais committer ni partager ce fichier** : il contient les comptes, e-mails et hachages de mots de passe. Le ranger dans un stockage privé (disque chiffré, drive personnel).

## Vérifier qu'une sauvegarde est restaurable

Tester sur une base **vide et séparée**, jamais sur la production :

```bash
createdb footvault_restore_test
pg_restore --no-owner -d footvault_restore_test backups/footvault-….dump
psql footvault_restore_test -c "SELECT count(*) FROM users; SELECT count(*) FROM catalog_cards;"
```

Les comptages doivent correspondre à ceux affichés par le script au moment de la sauvegarde.

## Restaurer en production (en cas de perte)

1. Créer une nouvelle base PostgreSQL sur Render.
2. `pg_restore --no-owner -d "<External URL de la nouvelle base>" backups/footvault-….dump`
3. Brancher la variable `DATABASE_URL` du service web sur la nouvelle base, puis redéployer.
4. Vérifier `https://sport-vault.onrender.com/api/health` : `"storage":"postgres"`.

## Ce qui a été testé

Le 29/09/2026, sur une base PostgreSQL 16 locale de test (pas la production) : démarrage de l'application sur base vide, sauvegarde avec `scripts/backup-db.sh`, restauration dans une seconde base. Résultat : 23 tables et 478 cartes restaurées. La sauvegarde de la production n'a **pas** été faite : elle nécessite l'URL de la base, que seul le propriétaire du compte Render possède.

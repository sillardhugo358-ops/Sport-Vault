# Sauvegarde et restauration de la base FOOTVAULT

La base de production est un PostgreSQL hébergé sur **Aiven** (offre gratuite, sans date d'expiration, 1 Go, 20 connexions max) depuis le 29/09/2026. **Aiven gratuit ne fait aucune sauvegarde automatique** : cette procédure est à lancer manuellement, idéalement chaque semaine.

## Connexion à la base

Dans la console Aiven : service PostgreSQL → *Overview* → *Connection information*.

| Usage | Adresse à utiliser |
|---|---|
| Variable `DATABASE_URL` du service web Render | *Service URI* en remplaçant `?sslmode=require` par **`?sslmode=no-verify`** |
| pgAdmin, `psql`, `pg_dump`, `scripts/backup-db.sh` | *Service URI* tel quel (`?sslmode=require`) ; le script accepte aussi `no-verify` |

Pourquoi `no-verify` côté application : avec la version de `pg` utilisée, `sslmode=require` impose la vérification complète du certificat, et le certificat d'Aiven est signé par sa propre autorité, inconnue de Node.js (erreur `self-signed certificate in certificate chain`). `no-verify` garde la connexion chiffrée sans vérifier l'identité du serveur, comme c'était le cas avec la base Render. Amélioration prévue : fournir le *CA certificate* d'Aiven à l'application pour une vérification complète.

Dans pgAdmin (Windows), si l'enregistrement du serveur plante avec `access violation writing 0x0000…`, ajouter dans l'onglet *Parameters* : **GSS encryption mode = disable** et **SSL mode = require**.

## Historique : migration depuis Render

L'ancienne base Render (`sport-vault-db`, plan free) **expire le 15/10/2026**. Migration faite le 29/09/2026 : sauvegarde de 18h46 restaurée sur Aiven (23 tables, 3 utilisateurs, 334 cartes possédées, 6 938 cartes au catalogue), puis `DATABASE_URL` basculée ; `/api/health` renvoie `"ok":true,"storage":"postgres","cards":6938`. L'ancienne base reste disponible pour un retour arrière jusqu'à son expiration.

## Faire une sauvegarde

Prérequis : outils clients PostgreSQL **version 18 ou plus** (`pg_dump`, `pg_restore`, `psql`). Le script refuse de continuer avec une version plus ancienne que le serveur.

1. Dans la console Aiven, copier le **Service URI**.
2. Depuis la racine du dépôt :

   ```bash
   DATABASE_URL="postgresql://…" ./scripts/backup-db.sh
   ```

3. Le fichier est créé dans `backups/footvault-AAAAMMJJ-HHMMSS.dump`. Le dossier `backups/` et les fichiers `*.dump` sont ignorés par Git.

Le script ne fait que lire la base. Il affiche à la fin le nombre de tables sauvegardées et un comptage de contrôle (`users`, `card_instances`, `catalog_cards`).

**Ne jamais committer ni partager ce fichier** : il contient les comptes, e-mails et hachages de mots de passe. Le ranger dans un stockage privé (disque chiffré, drive personnel).

### Depuis Windows (sans Git Bash)

1. Installer PostgreSQL **18** depuis https://www.postgresql.org/download/windows/ (seuls les *Command Line Tools* sont nécessaires).
2. Dans PowerShell :

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" --format=custom --no-owner --no-privileges `
     --file "$HOME\Documents\footvault-$(Get-Date -Format yyyyMMdd-HHmmss).dump" `
     "postgresql://…?sslmode=require"
   & "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" --list "$HOME\Documents\footvault-….dump" | Select-String "TABLE DATA" | Measure-Object
   ```

   La dernière commande doit compter **23** tables.

   Adresse de connexion : le *Service URI* Aiven (avec `sslmode=require`).

## Vérifier qu'une sauvegarde est restaurable

Tester sur une base **vide et séparée**, jamais sur la production :

```bash
createdb footvault_restore_test
pg_restore --no-owner -d footvault_restore_test backups/footvault-….dump
psql footvault_restore_test -c "SELECT count(*) FROM users; SELECT count(*) FROM catalog_cards;"
```

Les comptages doivent correspondre à ceux affichés par le script au moment de la sauvegarde.

## Restaurer en production (en cas de perte)

1. Créer une nouvelle base PostgreSQL (Aiven ou autre).
2. `pg_restore --no-owner --no-privileges -d "<adresse de la nouvelle base>" backups/footvault-….dump` (ou pgAdmin : clic droit sur la base, dans *Databases* → *Restore…*, *Do not save* Owner et Privileges).
3. Vérifier les comptages (`users`, `card_instances`, `catalog_cards`).
4. Mettre la nouvelle adresse dans `DATABASE_URL` du service web Render (avec `sslmode=no-verify` pour Aiven), puis redéployer.
5. Vérifier `https://sport-vault.onrender.com/api/health` : `"ok":true` et `"storage":"postgres"`.

## Ce qui a été testé

Le 29/09/2026, sur une base PostgreSQL 16 locale de test (pas la production) : démarrage de l'application sur base vide, sauvegarde avec `scripts/backup-db.sh`, restauration dans une seconde base. Résultat : 23 tables et 478 cartes restaurées. La sauvegarde de la production n'a **pas** été faite : elle nécessite l'URL de la base, que seul le propriétaire du compte Render possède.

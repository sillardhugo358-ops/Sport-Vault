# Sauvegarde et restauration de la base FOOTVAULT

La base de production est un PostgreSQL hébergé sur **Aiven** (offre gratuite, sans date d'expiration, 1 Go, 20 connexions max) depuis le 29/09/2026. **Aiven gratuit ne fait aucune sauvegarde automatique.** Depuis le 30/09/2026, le dépôt en fait une chaque lundi (GitHub Actions, voir « Sauvegarde automatique » ci-dessous) une fois deux secrets configurés ; la procédure manuelle reste valable.

## Connexion à la base

Dans la console Aiven : service PostgreSQL → *Overview* → *Connection information*.

| Usage | Adresse à utiliser |
|---|---|
| Variable `DATABASE_URL` du service web Render | *Service URI* en remplaçant `?sslmode=require` par **`?sslmode=no-verify`** |
| pgAdmin, `psql`, `pg_dump`, `scripts/backup-db.sh` | *Service URI* tel quel (`?sslmode=require`) ; le script accepte aussi `no-verify` |

Pourquoi `no-verify` côté application : avec la version de `pg` utilisée, `sslmode=require` impose la vérification complète du certificat, et le certificat d'Aiven est signé par sa propre autorité, inconnue de Node.js (erreur `self-signed certificate in certificate chain`). `no-verify` garde la connexion chiffrée sans vérifier l'identité du serveur, comme c'était le cas avec la base Render. Vérification complète du certificat (disponible depuis le 05/10/2026, `lib/db-ssl.js`) : fournir à l'application le *CA certificate* d'Aiven. **Ce certificat est public, ce n'est pas un secret.**

1. Console Aiven > le service PostgreSQL > *Overview* > *CA certificate* > **Download** (fichier `ca.pem`).
2. Render > le service web > *Environment* > ajouter la variable **`DATABASE_CA_CERT`** et y coller tout le contenu du fichier (de `-----BEGIN CERTIFICATE-----` à `-----END CERTIFICATE-----`). Les retours à la ligne peuvent être remplacés par `\n`.
3. Laisser `DATABASE_URL` telle quelle : le paramètre `sslmode` y est ignoré dès que `DATABASE_CA_CERT` est présent (la vérification complète du certificat et du nom du serveur s'applique alors).
   Vérification après le redéploiement : `/api/health` annonce `"databaseTls": "verified"` (au lieu de `"unverified"`), et l'étape « Santé du serveur et de la base » de `production.yml` l'affiche (« TLS de la base : verified »). Si le certificat est invalide, le serveur refuse de démarrer.
4. Enregistrer : Render redéploie. Contrôle : `production.yml` doit rester vert (« Santé du serveur et de la base »).
5. **Retour arrière** : supprimer la variable `DATABASE_CA_CERT` et redéployer (retour à `no-verify`).

Si le certificat est faux ou périmé, l'application refuse de se connecter (le déploiement échoue, l'ancienne version reste en ligne) : c'est voulu, une connexion non vérifiée ne doit pas se faire en silence. Les scripts exécutés à la main (`scripts/*.js`) lisent les mêmes variables ; `scripts/backup-db.sh` et pgAdmin utilisent `sslmode=require` comme avant.

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

## Sauvegarde automatique (GitHub Actions)

Le workflow `.github/workflows/backup.yml` sauvegarde la base **chaque lundi à 06:17 (heure de Paris, été)** et à la demande (onglet *Actions* > *Sauvegarde de la base* > *Run workflow*). Il ne fait que lire la base. Chaque archive est ensuite **restaurée dans une base PostgreSQL 18 jetable** (détruite aussitôt) : l'exécution échoue si la restauration échoue, si le catalogue restauré diffère de la production ou si une table essentielle (`users`, `card_instances`) est vide ou incomplète. L'archive est enfin **chiffrée (AES-256) avant d'être déposée** dans GitHub, conservée 90 jours.

### À faire une fois

Dans GitHub : *Settings* > *Secrets and variables* > *Actions* > *New repository secret* :

| Secret | Valeur |
|---|---|
| `BACKUP_DATABASE_URL` | le *Service URI* Aiven (tel quel) |
| `BACKUP_PASSPHRASE` | une longue phrase de passe **gardée hors de GitHub** (gestionnaire de mots de passe). Sans elle, les archives sont illisibles |

Tant que ces secrets manquent, le workflow s'arrête avec un avertissement, sans erreur. Lancer ensuite une première sauvegarde à la main et vérifier qu'elle est verte.

### Récupérer et déchiffrer une archive

1. *Actions* > *Sauvegarde de la base* > l'exécution voulue > *Artifacts* : télécharger `footvault-AAAAMMJJ-HHMMSS` (zip contenant le `.dump.gpg`).
2. Déchiffrer (gpg est fourni avec Git pour Windows, ou Gpg4win) :

   ```bash
   gpg --output footvault.dump --decrypt footvault-AAAAMMJJ-HHMMSS.dump.gpg
   ```

3. Le fichier `footvault.dump` se restaure comme une sauvegarde manuelle (sections suivantes).

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

Le 29/09/2026, sur une base PostgreSQL 16 locale de test (pas la production) : démarrage de l'application sur base vide, sauvegarde avec `scripts/backup-db.sh`, restauration dans une seconde base. Résultat : 23 tables et 478 cartes restaurées. La sauvegarde de production du 29/09/2026 (pgAdmin, PostgreSQL 18) a été lue et vérifiée hors outils PostgreSQL (23 tables), puis restaurée sur Aiven avec des comptages identiques (voir « Historique » ci-dessus).

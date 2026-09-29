#!/usr/bin/env bash
# Sauvegarde complète de la base PostgreSQL FOOTVAULT (Aiven).
#
# Usage :
#   DATABASE_URL="<Service URI Aiven>" ./scripts/backup-db.sh
#
# Produit backups/footvault-AAAAMMJJ-HHMMSS.dump (format custom pg_dump),
# puis vérifie que l'archive est lisible avec pg_restore --list.
# Lecture seule côté base : aucune donnée n'est modifiée.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Erreur : DATABASE_URL n'est pas définie." >&2
  echo "Copiez le « Service URI » depuis la console Aiven (Overview > Connection information)." >&2
  exit 1
fi

# L'application utilise sslmode=no-verify (option propre à node-postgres) ;
# les outils PostgreSQL ne la connaissent pas et attendent sslmode=require.
DATABASE_URL="${DATABASE_URL/sslmode=no-verify/sslmode=require}"

for bin in pg_dump pg_restore psql; do
  command -v "$bin" >/dev/null || { echo "Erreur : $bin est introuvable. Installez les outils clients PostgreSQL." >&2; exit 1; }
done

# pg_dump doit être au moins de la même version majeure que le serveur.
server_major=$(psql "$DATABASE_URL" -Atc "SHOW server_version_num" | cut -c1-2)
client_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
if [ "$client_major" -lt "$server_major" ]; then
  echo "Erreur : pg_dump $client_major est plus ancien que le serveur PostgreSQL $server_major." >&2
  echo "Installez les outils clients PostgreSQL $server_major ou plus récents." >&2
  exit 1
fi

out_dir="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$out_dir"
file="$out_dir/footvault-$(date +%Y%m%d-%H%M%S).dump"

echo "Sauvegarde en cours vers $file ..."
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$file"

tables=$(pg_restore --list "$file" | grep -c ' TABLE DATA ' || true)
echo "Sauvegarde terminée : $(du -h "$file" | cut -f1), $tables tables avec données."
echo "Comptage de contrôle dans la base :"
psql "$DATABASE_URL" -Atc "SELECT 'users', count(*) FROM users UNION ALL SELECT 'card_instances', count(*) FROM card_instances UNION ALL SELECT 'catalog_cards', count(*) FROM catalog_cards" | sed 's/|/ : /'
echo "Conservez ce fichier hors du dépôt (il contient des données personnelles et des hachages de mots de passe)."

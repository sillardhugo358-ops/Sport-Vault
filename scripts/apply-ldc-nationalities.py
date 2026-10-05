#!/usr/bin/env python3
"""Complète les nationalités de data/ldc-1991-2026.json.gz depuis le classeur « LDC_Joueurs_1991-92_2023-24 ».

Classeur : onglet « Participations » (saison, joueur, poste, club, joueur_id, club_id, season_id, nationalite).
Rapprochement : (saison, club, joueur_id) ; le joueur_id du classeur est le playerId du catalogue, le club se
rapproche par vote (chaque club_id du classeur ↔ index de club du catalogue d'après les noms de joueurs communs).
Le nom du joueur est vérifié sur chaque ligne rapprochée.

Règles (CLAUDE.md : jamais d'écrasement sans accord) :
  - une nationalité VIDE du catalogue est remplie avec celle du classeur (si le classeur en donne une) ;
  - une nationalité déjà renseignée n'est JAMAIS écrasée ; si elle diffère de celle du classeur, le cas est écrit
    dans docs/NATIONALITES-LDC-CONFLITS.csv pour relecture ;
  - toutes les nationalités sont ramenées au nom français de lib/nations.js (« Spain » -> « Espagne »).
Aucun identifiant, aucune note, aucun autre champ ne change : les identifiants de cartes (fv-c-…) ne dépendent pas
de la nationalité. Les saisons 2024-25 et 2025-26 ne sont pas dans le classeur.

Usage : python3 scripts/apply-ldc-nationalities.py <classeur.xlsx> [--dry-run]
Annulation : git checkout data/ldc-1991-2026.json.gz (et relancer l'import au démarrage).
"""
import collections
import csv
import gzip
import json
import os
import re
import subprocess
import sys
import unicodedata

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'ldc-1991-2026.json.gz')
REPORT = os.path.join(ROOT, 'docs', 'NATIONALITES-LDC-RAPPORT.csv')
CONFLICTS = os.path.join(ROOT, 'docs', 'NATIONALITES-LDC-CONFLITS.csv')


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '', s.lower())


def french_nations():
    """Table de lib/nations.js (source unique des noms français)."""
    out = subprocess.run(['node', '-e', "console.log(JSON.stringify(require('./lib/nations').NATION_FR))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def season_key(label):
    """'1991-92' -> '1991-1992' ; '1999-00' -> '1999-2000'."""
    start, end = label.split('-')
    year = int(start)
    stop = (year // 100) * 100 + int(end)
    if stop <= year:
        stop += 100
    return f'{start}-{stop}'


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    workbook, dry = sys.argv[1], '--dry-run' in sys.argv
    fr_table = french_nations()
    fr = lambda v: fr_table.get(str(v).strip(), str(v).strip()) if v else ''

    doc = json.loads(gzip.open(DATA).read().decode('utf-8'))
    col = {c: i for i, c in enumerate(doc['columns'])}
    rows, clubs = doc['rows'], doc['clubs']
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    part = [r for r in wb['Participations'].iter_rows(min_row=2, values_only=True) if r[0]]

    by_player = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by_player[(r[col['season']], r[col['playerId']])].append(i)
    vote = collections.defaultdict(collections.Counter)
    for p in part:
        for i in by_player.get((season_key(p[0]), p[4]), []):
            if norm(rows[i][col['name']]) == norm(p[1]):
                vote[p[5]][rows[i][col['club']]] += 1
    club_of = {cid: v.most_common(1)[0][0] for cid, v in vote.items()}
    index = {(r[col['season']], r[col['club']], r[col['playerId']]): i for i, r in enumerate(rows) if r[col['playerId']]}

    filled, same, kept, unmatched, empty_in_file = [], 0, [], [], 0
    seen = set()
    for p in part:
        i = index.get((season_key(p[0]), club_of.get(p[5]), p[4]))
        if i is None or norm(rows[i][col['name']]) != norm(p[1]) or norm(clubs[rows[i][col['club']]]) != norm(clubs[club_of[p[5]]]):
            unmatched.append(p)
            continue
        seen.add(i)
        new, row = fr(p[7]), rows[i]
        if not new:
            empty_in_file += 1
            continue
        current = fr(row[col['nation']])
        if not current:
            filled.append((i, new))
        elif norm(current) == norm(new):
            same += 1
        else:
            kept.append((p[0], clubs[row[col['club']]], row[col['name']], current, new))

    normalised = 0
    for i, new in filled:
        rows[i][col['nation']] = new
    for r in rows:      # tout en français, sans changer le fond
        value = r[col['nation']]
        if value and fr(value) != value:
            r[col['nation']] = fr(value)
            normalised += 1

    empty_after = sum(1 for r in rows if not r[col['nation']])
    unknown = collections.Counter(r[col['nation']] for r in rows if r[col['nation']] and r[col['nation']] not in set(fr_table.values()))
    print(f'Participations : {len(part)} ; rapprochées : {len(part) - len(unmatched)} ; sans correspondance : {len(unmatched)}')
    print(f'Nationalités remplies : {len(filled)} ; déjà identiques : {same} ; conflits gardés : {len(kept)} ; vides dans le classeur : {empty_in_file}')
    print(f'Noms passés en français : {normalised} ; cartes encore sans nationalité : {empty_after} / {len(rows)}')
    print('Pays hors table lib/nations.js :', dict(unknown) or 'aucun')
    if unmatched:
        sys.exit('Lignes sans correspondance : arrêt (rien écrit).')
    if dry:
        return print('Rapport à sec : rien n\'est écrit.')

    out = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    with open(DATA, 'wb') as f:
        with gzip.GzipFile(fileobj=f, mode='wb', mtime=0, compresslevel=9) as g:
            g.write(out)
    per_country = collections.Counter(n for _, n in filled)
    with open(REPORT, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['nationalité', 'cartes remplies'])
        w.writerows(per_country.most_common())
    with open(CONFLICTS, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['saison', 'club', 'joueur', 'nationalité actuelle (gardée)', 'nationalité du classeur'])
        w.writerows(sorted(kept))
    print('Écrit :', DATA, REPORT, CONFLICTS)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Relèvement léger des notes de la Ligue des Champions (04/10/2026, choix du propriétaire).

Les notes du classeur d'origine (data/ldc-1991-2026.json.gz, généré par build-ldc-data.py) sont relevées par une courbe
croissante par segments : l'ordre des joueurs est conservé, aucun écart ne s'inverse, les notes >= 92 ne bougent pas.
Les 6 statistiques de la carte sont mises à l'échelle (nouvelle note / ancienne) puis bornées à 1..99.
Les identifiants de cartes (fv-c-…) ne dépendent pas des notes : ils restent identiques, l'import met simplement à jour
notes, statistiques et raretés (barème officiel) et resynchronise les exemplaires déjà possédés.

Résultat attendu (21 446 cartes) : médiane 73 -> 76, Common 66,0 % -> 55,2 %, Rare 18,5 % -> 23,0 %, Epic 12,3 % -> 17,4 %.

Usage : python3 scripts/lift-ldc-ratings.py            (une seule fois : refuse de rejouer si le fichier porte déjà "lift")
Si le fichier est régénéré depuis le classeur (build-ldc-data.py), relancer ce script ensuite.
Annulation : git revert du commit qui modifie le fichier de données (la note d'origine est conservée en 15e colonne « ovrOrig »).
"""
import gzip
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'ldc-1991-2026.json.gz')
LIFT = [(54, 58), (66, 70), (78, 80), (88, 89), (92, 92)]
NAME = 'legere-2026-10-04'


def half_up(x):
    return math.floor(x + 0.5)           # arrondi « demi vers le haut » (= Math.round de JavaScript, utilisé par les tests)


def lift(ovr):
    if ovr >= LIFT[-1][0]:
        return ovr
    if ovr <= LIFT[0][0]:
        return ovr + LIFT[0][1] - LIFT[0][0]
    for (x0, y0), (x1, y1) in zip(LIFT, LIFT[1:]):
        if x0 <= ovr <= x1:
            return half_up(y0 + (y1 - y0) * (ovr - x0) / (x1 - x0))
    return ovr


def main():
    doc = json.loads(gzip.open(DATA).read().decode('utf-8'))
    if doc.get('lift'):
        sys.exit('Déjà relevé (' + str(doc['lift']['name']) + ') : rien à faire.')
    cols = doc['columns']
    io = cols.index('ovr')
    stat_idx = [cols.index(c) for c in ('pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical')]
    for r in doc['rows']:
        old = r[io]
        new = lift(old)
        factor = new / old
        for i in stat_idx:
            r[i] = max(1, min(99, half_up(r[i] * factor)))
        r[io] = new
        r.append(old)                                   # ovrOrig (15e colonne, ignorée par l'import)
    doc['columns'] = cols + ['ovrOrig']
    doc['lift'] = {'name': NAME, 'curve': LIFT}
    out = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    with open(DATA, 'wb') as f:
        with gzip.GzipFile(fileobj=f, mode='wb', mtime=0, compresslevel=9) as g:
            g.write(out)
    ovr = sorted(r[io] for r in doc['rows'])
    print(len(ovr), 'cartes relevées ; médiane', ovr[len(ovr) // 2], '; max', ovr[-1])


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Génère data/international-2026.json.gz (Coupe du monde 1930-2026 et Ligue des Nations 2019-2025)
à partir des deux classeurs fournis, en appliquant les règles de correction des notes « hors sol ».

Usage :
  python3 scripts/build-international-data.py coupes_du_monde_effectifs_notes.xlsx ligue_des_nations_effectifs_notes.xlsx

Produit aussi docs/CORRECTIONS-NOTES-CDM-LDN.csv : chaque note modifiée (ancienne -> nouvelle, règle).
Le fichier JSON est lu par scripts/import-international.js (identifiants stables, import sans doublon).

Règles de correction (calibrées sur le catalogue existant : note maximale 94, 0,14 % des cartes >= 92) :
  R1  plafond global de 94 pour toutes les cartes ;
  R2  Coupe du monde 1930-2022 : hors liste « légendes », plafond de 91 (note gonflée par le parcours
      de la sélection ou les buts, pas par le niveau du joueur) ;
  R3  corrections ciblées de cas nettement hors sol (CIBLES) ;
  les six statistiques de la carte sont mises à l'échelle (nouvelle note / ancienne note) pour rester
  cohérentes avec la note affichée.
Autres nettoyages : âge négatif -> valeur absolue ; numéro ou âge absents -> vides.
"""
import csv
import gzip
import json
import os
import sys
import unicodedata

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'international-2026.json.gz')
REPORT = os.path.join(ROOT, 'docs', 'CORRECTIONS-NOTES-CDM-LDN.csv')
CAP = 94
CAP_NON_LEGEND = 91


def norm(s):
    return unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().strip()


# Joueurs au niveau de pointe réellement exceptionnel : gardés jusqu'à 94 (R2).
LEGENDS = {norm(n) for n in [
    'Pelé', 'Diego Maradona', 'Lionel Messi', 'Johan Cruyff', 'Franz Beckenbauer', 'Zinedine Zidane',
    'Ronaldo', 'Cristiano Ronaldo', 'Gerd Müller', 'Ferenc Puskás', 'Eusébio', 'Lev Yashin',
    'Michel Platini', 'Marco van Basten', 'Roberto Baggio', 'Kylian Mbappé', 'Andrés Iniesta',
    'Manuel Neuer', 'Paolo Maldini', 'Lothar Matthäus', 'Gianluigi Buffon', 'Ronaldinho', 'Romário',
]}
# Notes plafonnées individuellement (R3) : performance de tournoi sans rapport avec le niveau de carrière.
CIBLES = {norm('Salvatore Schillaci'): 86, norm('Grzegorz Lato'): 87, norm('Gary Lineker'): 88,
          norm('Careca'): 88, norm('Davor Šuker'): 89, norm('Rob Rensenbrink'): 90}

CORRECTIONS = []


def corrected(comp, edition, team, name, ovr, historical):
    """Renvoie la note corrigée et enregistre la correction."""
    new, rule = ovr, ''
    key = norm(name)
    if historical and key not in LEGENDS and new > CAP_NON_LEGEND:
        new, rule = CAP_NON_LEGEND, 'R2 plafond 91 hors légendes'
    if historical and key in CIBLES and new > CIBLES[key]:
        new, rule = CIBLES[key], 'R3 correction ciblée'
    if new > CAP:
        new, rule = CAP, 'R1 plafond 94'
    if new != ovr:
        CORRECTIONS.append([comp, edition, team, name, ovr, new, rule])
    return new


def stats(row6, position, factor):
    c = [int(v) for v in row6]
    if position == 'GK':            # PLO, ARR, JAP, RÉF, VIT, PLA -> colonnes communes comme les 4 championnats
        c = [c[4], c[0], c[1], c[2], c[3], c[5]]  # pace, shooting, passing, dribbling, defending, physical
    return [max(1, min(99, round(v * factor))) for v in c]


def sub_position(position, s):
    """DF -> CB ; MF -> DM / CM / AM selon les stats ; FW -> ST (les côtés ne sont pas dans les sources)."""
    if position == 'GK':
        return 'GK'
    pace, shoot, pas, dri, de, phy = s
    if position == 'DF':
        return 'CB'
    if position == 'MF':
        if de - shoot >= 8:
            return 'DM'
        if shoot - de >= 8:
            return 'AM'
        return 'CM'
    return 'ST'


def build(cdm_path, nl_path):
    teams, rows = [], []

    def team_index(name):
        if name not in teams:
            teams.append(name)
        return teams.index(name)

    wb = openpyxl.load_workbook(cdm_path, read_only=True, data_only=True)
    # 1930-2022 : Édition, Sélection, N°, Joueur, Poste, Âge, Matchs, Buts, Général, 6 stats, Rareté
    for r in wb['Hommes 1930-2022'].iter_rows(min_row=2, values_only=True):
        edition, team, number, name, pos, age, ovr = r[0], r[1], r[2], r[3], r[4], r[5], r[8]
        new = corrected('coupe-du-monde', edition, team, name, int(ovr), True)
        s = stats(r[9:15], pos, new / int(ovr))
        age = abs(int(age)) if age is not None else None
        rows.append(['coupe-du-monde', str(edition), team_index(team), name, sub_position(pos, s), number, age, new] + s)
    # 2026 : Édition, Sélection, N°, Joueur, Poste, Âge, Sél., Buts int., Club, Général, 6 stats, Rareté
    for r in wb['Coupe du monde 2026'].iter_rows(min_row=2, values_only=True):
        edition, team, number, name, pos, age, ovr = r[0], r[1], r[2], r[3], r[4], r[5], r[9]
        new = corrected('coupe-du-monde', edition, team, name, int(ovr), False)
        s = stats(r[10:16], pos, new / int(ovr))
        rows.append(['coupe-du-monde', str(edition), team_index(team), name, sub_position(pos, s), number,
                     int(age) if age is not None else None, new] + s)

    wl = openpyxl.load_workbook(nl_path, read_only=True, data_only=True)
    season = {2019: '2018-2019', 2021: '2020-2021', 2023: '2022-2023', 2025: '2024-2025'}
    for r in wl['Phases finales 2019-2025'].iter_rows(min_row=2, values_only=True):
        edition, team, number, name, pos, age, ovr = r[0], r[1], r[2], r[3], r[4], r[5], r[9]
        new = corrected('ligue-des-nations', edition, team, name, int(ovr), False)
        s = stats(r[10:16], pos, new / int(ovr))
        rows.append(['ligue-des-nations', season[int(edition)], team_index(team), name, sub_position(pos, s), number,
                     int(age) if age is not None else None, new] + s)
    return teams, rows


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    teams, rows = build(sys.argv[1], sys.argv[2])
    doc = {
        'source': 'coupes_du_monde_effectifs_notes.xlsx + ligue_des_nations_effectifs_notes.xlsx',
        'competitions': ['coupe-du-monde', 'ligue-des-nations'],
        'teams': teams,
        'columns': ['competition', 'season', 'team', 'name', 'position', 'number', 'age', 'ovr', 'pace', 'shooting',
                    'passing', 'dribbling', 'defending', 'physical'],
        'rows': rows,
    }
    with gzip.GzipFile(OUT, 'wb', mtime=0) as f:   # mtime=0 : fichier reproductible (même contrôle d'intégrité)
        f.write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['Compétition', 'Édition', 'Sélection', 'Joueur', 'Note du fichier', 'Note retenue', 'Règle'])
        w.writerows(sorted(CORRECTIONS, key=lambda c: (c[0], int(c[1]), -c[4], c[3])))
    by_rule = {}
    for c in CORRECTIONS:
        by_rule[c[6]] = by_rule.get(c[6], 0) + 1
    print(f'{len(rows)} cartes, {len(teams)} sélections, {len(CORRECTIONS)} notes corrigées {by_rule}')


if __name__ == '__main__':
    main()

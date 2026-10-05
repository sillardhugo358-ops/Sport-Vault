'use strict';

// Nationalités : une seule orthographe, en français (CLAUDE.md : « renseignées de façon cohérente »).
// Toute variante connue (nom anglais, code FIFA à 3 lettres, graphie sans accent) est ramenée
// au nom français. Une valeur inconnue est conservée telle quelle (jamais inventée).

const FR = {
  // Europe
  'Albania': 'Albanie', 'ALB': 'Albanie', 'Armenia': 'Arménie', 'ARM': 'Arménie', 'Austria': 'Autriche', 'AUT': 'Autriche',
  'Azerbaijan': 'Azerbaïdjan', 'Belarus': 'Biélorussie', 'Belgium': 'Belgique', 'BEL': 'Belgique',
  'Bosnia': 'Bosnie-Herzégovine', 'Bosnia-Herzegovina': 'Bosnie-Herzégovine', 'Bosnia and Herzegovina': 'Bosnie-Herzégovine', 'BIH': 'Bosnie-Herzégovine',
  'Bulgaria': 'Bulgarie', 'BUL': 'Bulgarie', 'Croatia': 'Croatie', 'CRO': 'Croatie', 'Cyprus': 'Chypre',
  'Czech Republic': 'Tchéquie', 'Czechia': 'Tchéquie', 'CZE': 'Tchéquie', 'Denmark': 'Danemark', 'DEN': 'Danemark',
  'England': 'Angleterre', 'ENG': 'Angleterre', 'Estonia': 'Estonie', 'EST': 'Estonie', 'Faroe Islands': 'Îles Féroé',
  'Finland': 'Finlande', 'FIN': 'Finlande', 'FRA': 'France', 'Georgia': 'Géorgie', 'GEO': 'Géorgie',
  'Germany': 'Allemagne', 'GER': 'Allemagne', 'Gibraltar': 'Gibraltar', 'Greece': 'Grèce', 'GRE': 'Grèce',
  'Hungary': 'Hongrie', 'HUN': 'Hongrie', 'Iceland': 'Islande', 'ISL': 'Islande', 'Ireland': 'Irlande', 'IRL': 'Irlande',
  'Italy': 'Italie', 'ITA': 'Italie', 'Kazakhstan': 'Kazakhstan', 'Kosovo': 'Kosovo', 'KOS': 'Kosovo', 'Latvia': 'Lettonie',
  'Liechtenstein': 'Liechtenstein', 'Lithuania': 'Lituanie', 'LTU': 'Lituanie', 'Luxembourg': 'Luxembourg', 'LUX': 'Luxembourg',
  'Malta': 'Malte', 'Moldova': 'Moldavie', 'Montenegro': 'Monténégro', 'MNE': 'Monténégro', 'Netherlands': 'Pays-Bas', 'NED': 'Pays-Bas',
  'North Macedonia': 'Macédoine du Nord', 'MKD': 'Macédoine du Nord', 'Northern Ireland': 'Irlande du Nord', 'NIR': 'Irlande du Nord',
  'Norway': 'Norvège', 'NOR': 'Norvège', 'Poland': 'Pologne', 'POL': 'Pologne', 'POR': 'Portugal', 'Portugal': 'Portugal',
  'Romania': 'Roumanie', 'ROU': 'Roumanie', 'Russia': 'Russie', 'RUS': 'Russie', 'San Marino': 'Saint-Marin',
  'Scotland': 'Écosse', 'SCO': 'Écosse', 'Serbia': 'Serbie', 'SRB': 'Serbie', 'Slovakia': 'Slovaquie', 'SVK': 'Slovaquie',
  'Slovenia': 'Slovénie', 'SVN': 'Slovénie', 'Spain': 'Espagne', 'ESP': 'Espagne', 'Sweden': 'Suède', 'SWE': 'Suède',
  'Switzerland': 'Suisse', 'SUI': 'Suisse', 'Turkey': 'Turquie', 'Türkiye': 'Turquie', 'TUR': 'Turquie',
  'Ukraine': 'Ukraine', 'UKR': 'Ukraine', 'Wales': 'Pays de Galles', 'WAL': 'Pays de Galles',
  // Afrique
  'Algeria': 'Algérie', 'ALG': 'Algérie', 'Angola': 'Angola', 'ANG': 'Angola', 'Benin': 'Bénin', 'BEN': 'Bénin',
  'Burkina Faso': 'Burkina Faso', 'BFA': 'Burkina Faso', 'Burundi': 'Burundi', 'Cameroon': 'Cameroun', 'CMR': 'Cameroun',
  'Cape Verde': 'Cap-Vert', 'CPV': 'Cap-Vert', 'Central African Republic': 'République centrafricaine', 'Chad': 'Tchad',
  'Comoros': 'Comores', 'COM': 'Comores', 'Congo': 'Congo', "Cote d'Ivoire": "Côte d'Ivoire", 'CIV': "Côte d'Ivoire",
  'DR Congo': 'RD Congo', 'COD': 'RD Congo', 'Egypt': 'Égypte', 'EGY': 'Égypte', 'Equatorial Guinea': 'Guinée équatoriale', 'EQG': 'Guinée équatoriale',
  'Eritrea': 'Érythrée', 'Gabon': 'Gabon', 'GAB': 'Gabon', 'Gambia': 'Gambie', 'The Gambia': 'Gambie', 'GAM': 'Gambie',
  'Ghana': 'Ghana', 'GHA': 'Ghana', 'Guinea': 'Guinée', 'GUI': 'Guinée', 'Guinea-Bissau': 'Guinée-Bissau', 'GNB': 'Guinée-Bissau',
  'Kenya': 'Kenya', 'KEN': 'Kenya', 'Liberia': 'Liberia', 'Libya': 'Libye', 'Madagascar': 'Madagascar', 'Mali': 'Mali', 'MLI': 'Mali',
  'Mauritania': 'Mauritanie', 'MTN': 'Mauritanie', 'Morocco': 'Maroc', 'MAR': 'Maroc', 'Mozambique': 'Mozambique', 'MOZ': 'Mozambique',
  'Namibia': 'Namibie', 'Niger': 'Niger', 'NIG': 'Niger', 'Nigeria': 'Nigeria', 'NGA': 'Nigeria', 'Senegal': 'Sénégal', 'SEN': 'Sénégal',
  'Sierra Leone': 'Sierra Leone', 'SLE': 'Sierra Leone', 'South Africa': 'Afrique du Sud', 'Tanzania': 'Tanzanie', 'Tanzanie': 'Tanzanie',
  'Togo': 'Togo', 'TOG': 'Togo', 'Tunisia': 'Tunisie', 'TUN': 'Tunisie', 'Uganda': 'Ouganda', 'Zambia': 'Zambie', 'ZAM': 'Zambie', 'Zimbabwe': 'Zimbabwe',
  // Amériques
  'Antigua and Barbuda': 'Antigua-et-Barbuda', 'ARG': 'Argentine', 'Argentina': 'Argentine', 'Barbados': 'Barbade', 'Bermuda': 'Bermudes',
  'Bolivia': 'Bolivie', 'Brazil': 'Brésil', 'BRA': 'Brésil', 'Canada': 'Canada', 'CAN': 'Canada', 'Chile': 'Chili', 'CHI': 'Chili',
  'Colombia': 'Colombie', 'COL': 'Colombie', 'Costa Rica': 'Costa Rica', 'Cuba': 'Cuba', 'Curacao': 'Curaçao', 'CUW': 'Curaçao',
  'Dominican Republic': 'République dominicaine', 'DOM': 'République dominicaine', 'Ecuador': 'Équateur', 'ECU': 'Équateur',
  'French Guiana': 'Guyane', 'Grenada': 'Grenade', 'Guadeloupe': 'Guadeloupe', 'GLP': 'Guadeloupe', 'Guyana': 'Guyana',
  'Haiti': 'Haïti', 'Honduras': 'Honduras', 'Jamaica': 'Jamaïque', 'JAM': 'Jamaïque', 'Martinique': 'Martinique', 'Mexico': 'Mexique', 'MEX': 'Mexique',
  'Montserrat': 'Montserrat', 'Panama': 'Panama', 'Paraguay': 'Paraguay', 'PAR': 'Paraguay', 'Peru': 'Pérou',
  'St. Kitts & Nevis': 'Saint-Christophe-et-Niévès', 'St. Lucia': 'Sainte-Lucie', 'Suriname': 'Suriname', 'SUR': 'Suriname',
  'Trinidad and Tobago': 'Trinité-et-Tobago', 'United States': 'États-Unis', 'USA': 'États-Unis', 'Uruguay': 'Uruguay', 'URU': 'Uruguay',
  'Venezuela': 'Venezuela', 'VEN': 'Venezuela',
  // Asie, Océanie, Moyen-Orient
  'Afghanistan': 'Afghanistan', 'Australia': 'Australie', 'AUS': 'Australie', 'Bangladesh': 'Bangladesh', 'China': 'Chine',
  'Indonesia': 'Indonésie', 'IDN': 'Indonésie', 'Iran': 'Iran', 'Iraq': 'Irak', 'Israel': 'Israël', 'ISR': 'Israël',
  'Japan': 'Japon', 'JPN': 'Japon', 'Jordan': 'Jordanie', 'Korea, North': 'Corée du Nord', 'Korea, South': 'Corée du Sud',
  'South Korea': 'Corée du Sud', 'KOR': 'Corée du Sud', 'Lebanon': 'Liban', 'Malaysia': 'Malaisie', 'MAS': 'Malaisie',
  'New Zealand': 'Nouvelle-Zélande', 'NZL': 'Nouvelle-Zélande', 'Oman': 'Oman', 'Palästina': 'Palestine', 'Palestine': 'Palestine',
  'Philippines': 'Philippines', 'Qatar': 'Qatar', 'Saudi Arabia': 'Arabie saoudite', 'Syria': 'Syrie', 'Thailand': 'Thaïlande', 'THA': 'Thaïlande',
  'Uzbekistan': 'Ouzbékistan', 'UZB': 'Ouzbékistan',
  // Sélections nationales (Coupe du monde, Ligue des Nations), dont les anciennes équipes disparues
  'Ivory Coast': "Côte d'Ivoire", 'Kuwait': 'Koweït', 'North Korea': 'Corée du Nord', 'Republic of Ireland': 'Irlande',
  'El Salvador': 'Salvador', 'United Arab Emirates': 'Émirats arabes unis', 'Curaçao': 'Curaçao',
  'West Germany': "Allemagne de l'Ouest", 'East Germany': "Allemagne de l'Est", 'Soviet Union': 'URSS',
  'Yugoslavia': 'Yougoslavie', 'Czechoslovakia': 'Tchécoslovaquie', 'Zaire': 'Zaïre',
  'Serbia and Montenegro': 'Serbie-et-Monténégro', 'Dutch East Indies': 'Indes orientales néerlandaises',
  // Graphies françaises longues du classeur des nationalités de la Ligue des Champions.
  'République démocratique du Congo': 'RD Congo', 'République du Congo': 'Congo'
};

// Nom français d'une nationalité ; valeur inchangée si inconnue ou déjà française.
function frenchNation(value) {
  const v = String(value ?? '').trim();
  return FR[v] || v;
}

module.exports = { frenchNation, NATION_FR: FR };

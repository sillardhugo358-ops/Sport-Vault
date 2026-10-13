'use strict';

// Génère theme-light.css (thème « jour ») à partir des feuilles de style existantes : chaque règle qui utilise un fond sombre ou un
// texte clair est recopiée sous `html[data-theme="light"]` avec des couleurs adaptées (fonds sombres -> clairs, textes clairs -> sombres,
// bordures et ombres atténuées). Les cartes (art), les fenêtres de révélation et le terrain de l'équipe type restent tels quels.
// Utilisation : `node scripts/build-light-theme.js` écrit le fichier ; `require('./build-light-theme').build()` renvoie le texte
// (test/theme-light.test.js vérifie que le fichier commité est à jour). Le fichier n'est chargé que par les joueurs en thème jour.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['styles.css', 'styles-2.css', 'styles-3.css', 'styles-4.css', 'styles-5.css', 'styles-6.css'];
const OUT = path.join(ROOT, 'theme-light.css');
const P = 'html[data-theme="light"]';

// Sélecteurs laissés sombres : art des cartes, révélations de packs, terrain de l'équipe type, logo, éditeur de cartes.
const KEEP_DARK = /tcg-card|\.v4-|reveal-|pack-reveal|\.rv-|hero-card|team-pitch|team-markings|team-slot|ts-ovr|brand-icon|notif-banner|\.toast|spin-|wheel|tcg-|card-art|card-stage|detail-card/;

const VARS = `${P}{color-scheme:light;--bg:#f2f5fa;--panel:#ffffff;--panel2:#e9eff8;--text:#0c1a2e;--muted:#4a607c;--line:rgba(30,70,125,.2);--gold:#c99a1e;--gold2:#8a6200;--green:#117a57;--danger:#c1263d;--r-common:#5d6a79;--r-rare:#1e6fc4;--r-epic:#7a4bb2;--r-legendary:#9c6d00;--focus:0 0 0 2px #f2f5fa,0 0 0 4px #8a6200}`;

// --- Couleurs ---------------------------------------------------------------------------------------------------------------------
function hexToRgb(h) {
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16), a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}
function toHsl({ r, g, b, a }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l, a };
}
function fromHsl({ h, s, l, a }) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a };
}
const fmt = ({ r, g, b, a }) => a >= 0.995 ? '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') : `rgba(${r},${g},${b},${+a.toFixed(3)})`;
const NAMED = { white: '#ffffff', black: '#000000' };

// Reconnaît une couleur au début de `s` ; renvoie { len, rgb } ou null.
const COLOR_RE = /^(#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b)/;
function parseColor(tok) {
  if (tok[0] === '#') return hexToRgb(tok);
  if (/^(white|black)$/.test(tok)) return hexToRgb(NAMED[tok]);
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(tok);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.some(p => p.startsWith('var(') || p === 'from')) return null;
  const num = p => p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p);
  const alpha = parts[3] != null ? num(parts[3]) : 1;
  if (m[1].startsWith('rgb')) return { r: Math.round(parts[0].endsWith('%') ? num(parts[0]) * 255 : +parts[0]), g: Math.round(parts[1].endsWith('%') ? num(parts[1]) * 255 : +parts[1]), b: Math.round(parts[2].endsWith('%') ? num(parts[2]) * 255 : +parts[2]), a: alpha };
  return fromHsl({ h: parseFloat(parts[0]), s: num(parts[1]), l: num(parts[2]), a: alpha });
}
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// Fond : les fonds sombres deviennent clairs ; les voiles blancs translucides deviennent des voiles bleu nuit ; le reste ne change pas.
function mapBg(c) {
  const k = toHsl(c);
  if (c.a < 0.02) return c;
  if (k.l >= 0.88 && k.s < 0.3 && c.a < 0.6) return { r: 14, g: 40, b: 80, a: +clamp(c.a * 1.1, 0, 0.5).toFixed(3) };
  if (k.l < 0.4) return fromHsl({ h: k.h, s: k.s * 0.45, l: 0.985 - k.l * 0.3, a: c.a });
  return c;
}
// Texte : les textes clairs deviennent sombres, les accents (or, vert, rouge clair) deviennent des tons soutenus ; les textes sombres restent.
function mapText(c) {
  const k = toHsl(c);
  if (c.a < 0.02 || k.l < 0.45) return c;
  if (k.s > 0.5 && k.l > 0.55 && k.l < 0.88) return fromHsl({ h: k.h, s: k.s * 0.9, l: 0.3, a: c.a });
  const l = k.l >= 0.9 ? 0.1 : 0.1 + (0.9 - k.l) * (0.3 / 0.45);
  return fromHsl({ h: k.h, s: Math.min(k.s, k.l >= 0.88 ? 0.35 : 0.45), l, a: c.a });
}
// Bordures : traits blancs ou bleutés translucides -> traits bleu nuit ; bordures sombres opaques -> claires.
function mapBorder(c) {
  const k = toHsl(c);
  if (c.a < 0.02) return c;
  if (k.l > 0.8 && k.s < 0.35) return { r: 14, g: 40, b: 80, a: +clamp(c.a < 1 ? c.a * 1.5 : 0.2, 0, 0.45).toFixed(3) };
  if (c.a < 1 && k.l >= 0.4) return fromHsl({ h: k.h, s: k.s, l: k.s > 0.4 && k.l > 0.5 ? 0.38 : k.l * 0.7, a: +clamp(c.a * 1.6, 0, 0.75).toFixed(3) });
  if (k.l < 0.4) return fromHsl({ h: k.h, s: k.s * 0.4, l: 0.9 - k.l * 0.2, a: c.a });
  return c;
}
function mapShadow(c) {
  const k = toHsl(c);
  if (k.l < 0.12) return { r: 20, g: 40, b: 70, a: +(c.a * 0.45).toFixed(3) };
  return c;
}
const MAPPERS = {
  background: mapBg, 'background-color': mapBg, 'background-image': mapBg,
  color: mapText, fill: mapText, stroke: mapText, 'caret-color': mapText,
  border: mapBorder, 'border-color': mapBorder, 'border-top': mapBorder, 'border-right': mapBorder, 'border-bottom': mapBorder, 'border-left': mapBorder,
  'border-top-color': mapBorder, 'border-right-color': mapBorder, 'border-bottom-color': mapBorder, 'border-left-color': mapBorder,
  outline: mapBorder, 'outline-color': mapBorder, 'border-block': mapBorder, 'border-inline': mapBorder,
  'box-shadow': mapShadow, 'text-shadow': mapShadow
};

// Variables personnalisées (hors jeu principal, déjà fixé dans VARS) : le sens de la couleur se devine d'après le nom.
const MANUAL_VARS = /^--(bg|panel2?|text|muted|line|gold2?|green|danger|r-[a-z]+|focus|radius|head|body)$/;
function customMapper(prop) {
  if (MANUAL_VARS.test(prop) || /^--(rv|rp|rc|num|rarity-accent)/.test(prop)) return null;
  if (/line|border/.test(prop)) return mapBorder;
  if (/bg|card|panel|surface/.test(prop)) return mapBg;
  if (/white|text|grey|gray|muted|gold|accent|ink/.test(prop)) return mapText;
  return null;
}
function mapValue(value, mapper) {
  let out = '', i = 0;
  while (i < value.length) {
    const rest = value.slice(i), m = COLOR_RE.exec(rest);
    if (m && (i === 0 || !/[\w#-]/.test(value[i - 1]))) {
      const rgb = parseColor(m[0]);
      out += rgb ? fmt(mapper(rgb)) : m[0];
      i += m[0].length;
    } else { out += value[i]; i++; }
  }
  return out;
}

// --- Analyse du CSS ------------------------------------------------------------------------------------------------------------------
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

// Découpe une liste séparée par `sep` en ignorant ce qui est entre parenthèses, crochets ou guillemets.
function splitTop(s, sep) {
  const parts = []; let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Lit des blocs « prélude { corps } » au niveau courant.
function readBlocks(css) {
  const blocks = []; let i = 0;
  while (i < css.length) {
    let j = i, depth = 0, q = '', paren = 0;
    for (; j < css.length; j++) {
      const ch = css[j];
      if (q) { if (ch === q && css[j - 1] !== '\\') q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '(') paren++;
      if (ch === ')') paren--;
      if (ch === '{' && paren <= 0) break;
      if (ch === ';' && paren <= 0 && depth === 0) break;
    }
    if (j >= css.length) break;
    if (css[j] === ';') { i = j + 1; continue; }
    const prelude = css.slice(i, j).trim();
    let k = j + 1; depth = 1; q = ''; paren = 0;
    for (; k < css.length && depth; k++) {
      const ch = css[k];
      if (q) { if (ch === q && css[k - 1] !== '\\') q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '(') paren++;
      if (ch === ')') paren--;
      if (ch === '{' && paren <= 0) depth++;
      if (ch === '}' && paren <= 0) depth--;
    }
    blocks.push({ prelude, body: css.slice(j + 1, k - 1) });
    i = k;
  }
  return blocks;
}

function themeDeclarations(body) {
  const decls = splitTop(body, ';').map(d => d.trim()).filter(Boolean).map(d => {
    const idx = d.indexOf(':');
    return idx < 0 ? null : { prop: d.slice(0, idx).trim().toLowerCase(), value: d.slice(idx + 1).trim() };
  }).filter(Boolean);
  // Fond coloré (ni sombre ni clair) : le texte blanc posé dessus ne doit pas devenir sombre.
  const coloredBg = decls.some(d => /^background/.test(d.prop) && (d.value.match(new RegExp(COLOR_RE.source.replace('^', ''), 'g')) || []).some(tok => {
    const c = parseColor(tok); if (!c || c.a < 0.5) return false; const k = toHsl(c); return k.s > 0.35 && k.l > 0.22 && k.l < 0.78;
  }));
  const out = [];
  for (const d of decls) {
    const mapper = d.prop.startsWith('--') ? customMapper(d.prop) : MAPPERS[d.prop];
    if (!mapper) continue;
    if (mapper === mapText && coloredBg) continue;
    if (/var\(/.test(d.value) && !COLOR_RE.test(d.value.replace(/var\([^)]*\)/g, '').trim())) continue;
    const mapped = mapValue(d.value, mapper);
    if (mapped !== d.value) out.push(`${d.prop}:${mapped}`);
  }
  return out;
}

function prefixSelector(sel) {
  sel = sel.trim();
  if (/^:root$/.test(sel)) return P;
  if (!sel || /^html\b/.test(sel)) return null;
  if (KEEP_DARK.test(sel)) return null;
  if (/^(body|\*)/.test(sel) && sel === '*') return null;
  return `${P} ${sel}`;
}

function convert(css, nested = false) {
  let out = '';
  for (const b of readBlocks(css)) {
    if (b.prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(b.prelude)[1];
      if (name === 'media' || name === 'supports') {
        const inner = convert(b.body, true);
        if (inner) out += `${b.prelude}{${inner}}\n`;
      }
      continue;
    }
    const decls = themeDeclarations(b.body);
    if (!decls.length) continue;
    const sels = splitTop(b.prelude, ',').map(prefixSelector).filter(Boolean);
    if (!sels.length) continue;
    out += `${sels.join(',')}{${decls.join(';')}}\n`;
  }
  return out;
}

function build() {
  let body = '';
  for (const f of SOURCES) body += convert(stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  return `/* Thème « jour » — GÉNÉRÉ par scripts/build-light-theme.js à partir de styles*.css : ne pas modifier à la main. */\n${VARS}\n${body}${EXTRA}`;
}

// Retouches manuelles après génération (éléments qui jouent avec un dégradé de texte, logos, etc.).
const EXTRA = `${P} .brand-copy b{background:linear-gradient(90deg,#7a5a00,#b98a14 48%,#7a5a00);-webkit-background-clip:text;background-clip:text;color:transparent}
${P} .header{background:rgba(255,255,255,.9)}
${P} .nav a{color:#44566f}
${P} .nav a:hover,${P} .nav a.active{color:#0c1a2e}
${P} .btn{background:#ffffff;color:#0c1a2e;border-color:rgba(30,70,125,.28)}
${P} .btn-gold{background:linear-gradient(135deg,#e2b84e,#f2d683);border-color:#c99a1e;color:#111}
${P} .btn-outline{background:transparent;color:#0c1a2e}
${P} .modal{background:rgba(12,26,46,.55)}
${P} .modal-box{background:#ffffff;color:#0c1a2e}
${P} .ambient{opacity:.05}
${P} .team-pitch{background:repeating-linear-gradient(180deg,#2f8a53 0 12.5%,#287a48 12.5% 25%)}
${P} .fvh-comp-logo{color:#7a5a00}
${P} .pack-reveal-modal,${P} .wk-reveal{color:#f4f7ff}
`;

if (require.main === module) {
  const text = build();
  fs.writeFileSync(OUT, text);
  console.log('theme-light.css : ' + (text.length / 1024).toFixed(0) + ' Ko');
}

module.exports = { build, OUT };

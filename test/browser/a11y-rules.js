'use strict';

// Règles d'accessibilité maison, sans dépendance, exécutées dans la page (page.evaluate).
// Chaque règle renvoie le nombre d'éléments en défaut et quelques exemples (sélecteur court) pour le journal.
// Rôle : mesurer la dette (test/browser/a11y.test.js) et empêcher qu'elle augmente.

function collectViolations(opts) {
  const out = {};
  const add = (rule, el, extra = '') => { (out[rule] ||= { count: 0, samples: [] }).count++; if (out[rule].samples.length < 3) out[rule].samples.push(short(el) + extra); };
  const short = el => {
    const id = el.id ? '#' + el.id : '', cls = el.classList?.length ? '.' + [...el.classList].slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' « ' + txt + ' »' : '');
  };
  const visible = el => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const text = el => (el.textContent || '').trim();
  const byIdText = ids => String(ids || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
  const name = el => {
    if (el.getAttribute('aria-label')?.trim()) return true;
    if (byIdText(el.getAttribute('aria-labelledby'))) return true;
    if (el.getAttribute('title')?.trim()) return true;
    if (text(el)) return true;
    if ([...el.querySelectorAll('img[alt]')].some(i => i.getAttribute('alt').trim())) return true;
    if (el.querySelector('svg title')) return true;
    return false;
  };
  const root = document.body;

  // 1. Images sans attribut alt (alt="" est valide : image décorative).
  for (const img of root.querySelectorAll('img')) if (!img.hasAttribute('alt')) add('img-sans-alt', img);

  // 2. Boutons et liens sans nom accessible.
  for (const el of root.querySelectorAll('button, [role=button], a[href]')) {
    if (!visible(el) && !el.closest('.modal')) continue;
    if (!name(el)) add('bouton-sans-nom', el);
  }

  // 3. Champs de formulaire sans étiquette.
  for (const el of root.querySelectorAll('input, select, textarea')) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || !visible(el)) continue;
    const labelled = el.labels?.length || el.getAttribute('aria-label')?.trim() || byIdText(el.getAttribute('aria-labelledby')) || el.getAttribute('title')?.trim();
    if (!labelled) add('champ-sans-etiquette', el);
  }

  // 4. Éléments cliquables non natifs : un attribut data-* d'action sur un élément qui n'est ni bouton, ni lien, ni champ,
  // sans role ni tabindex, et qui n'est pas dans un élément interactif.
  const NATIVE = 'a[href], button, input, select, textarea, summary, label, option, [role=button], [role=link], [role=tab], [tabindex]';
  // Ancêtres interactifs : le conteneur #app, focalisable par le script (tabindex=-1), n'en fait pas partie.
  const ANCESTORS = 'a[href], button, summary, label, [role=button], [role=link], [role=tab]';
  const ACTION = /^data-(?!admin-panel)(open|toggle|claim|edit|del|remove|select|buy|bid|save|close|show|view|go|sell|cancel|withdraw|filter|tab|page|sort|skip|reveal|flip|fav|route|admin|season|club|card|pack|pool|user|role|action)/;
  for (const el of root.querySelectorAll('*')) {
    if (el.matches(NATIVE) || el.closest(ANCESTORS)) continue;
    if (!visible(el)) continue;
    if ([...el.attributes].some(a => ACTION.test(a.name)) || el.hasAttribute('onclick')) add('clic-sans-semantique', el);
  }

  // 5. Cibles tactiles de moins de 44 px (seulement sur mobile).
  if (opts.mobile) {
    for (const el of root.querySelectorAll('button, [role=button], a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')) {
      if (!visible(el)) continue;
      if (el.matches('a') && el.closest('p, li, td, span:not([class])') && getComputedStyle(el).display === 'inline') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) add('cible-tactile-44px', el, ' [' + Math.round(r.width) + '×' + Math.round(r.height) + ' px]');
    }
  }

  // 6. Un seul titre h1 visible par page.
  const h1 = [...root.querySelectorAll('h1')].filter(visible).length;
  if (h1 !== 1) add('h1-non-unique', document.querySelector('#app') || root);

  // 7. Identifiants dupliqués.
  const seen = new Map();
  for (const el of root.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1);
  for (const [id, n] of seen) if (n > 1) add('id-duplique', document.getElementById(id));

  // 8. Document : langue et titre.
  if (!document.documentElement.getAttribute('lang')) add('document-sans-lang', document.documentElement);
  if (!document.title.trim()) add('document-sans-titre', document.documentElement);
  return out;
}

module.exports = { collectViolations };

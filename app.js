(function () {
  'use strict';

  var DATA = window.TANDEM_DATA;
  var app = document.getElementById('app');
  if (!DATA || !DATA.tree) {
    app.innerHTML = '<section class="card notice">Données introuvables : lance <code>python3 scripts/build.py</code> pour générer <code>data/bundle.js</code>.</section>';
    return;
  }

  var TREE = DATA.tree;
  var MESSAGES = DATA.messages || {};
  var MAX = (TREE.meta && TREE.meta.message_max_chars) || 500;
  var HISTORY_SIZE = 10;
  var TYPE_MS = 550; // effet machine à écrire : 0,6 s maximum en tout
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var CONTEXTS = [
    { id: 'party', tab: 'Fête' },
    { id: 'profile', tab: 'Profil' },
    { id: 'chat', tab: 'Chat' }
  ];
  var TIER_ORDER = [1, 2, 3, 'variable'];
  var KEYS = {
    context: 'tandem-report.context',
    addDate: 'tandem-report.addDate',
    theme: 'tandem-report.theme'
  };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var narrow = window.matchMedia('(max-width: 899px)');

  function $(id) { return document.getElementById(id); }
  var el = {
    name: $('name'), contexts: $('contexts'), leaves: $('leaves'), composer: $('composer'),
    path: $('path'), leafInfo: $('leaf-info'), unverified: $('unverified'),
    modeDirect: $('mode-direct'), modeFree: $('mode-free'), templateFields: $('template-fields'),
    variantRow: $('variant-row'), variants: $('variants'), addDate: $('add-date'), date: $('date'),
    details: $('details'), generate: $('generate'), nameHint: $('name-hint'),
    outputBlock: $('output-block'), output: $('output'), counter: $('counter'), limitMsg: $('limit-msg'),
    editedHint: $('edited-hint'), copy: $('copy'), themeToggle: $('theme-toggle'),
    gravityToggle: $('gravity-toggle'), gravity: $('gravity'), gravityBody: $('gravity-body'),
    ignoredNote: $('ignored-note')
  };

  var state = {
    context: null,
    groups: [],      // groupes de feuilles du contexte actif
    entry: null,     // feuille sélectionnée { key, leaf, path, group }
    mode: null,      // 'templates' | 'free' | 'direct'
    variant: {},     // variante choisie, par feuille
    history: {},     // ids des derniers messages montrés, par feuille
    template: null,  // message type affiché
    edited: false,   // message retouché à la main
    fullText: '',
    typing: null,
    copyTimer: null,
    copiedText: null // texte du dernier « Copié », tant que le retour est affiché
  };

  // --- Utilitaires -------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Libellé à deux versions : le CSS affiche celle du thème actif.
  function dual(tandem, term) {
    return '<span class="t-tandem">' + esc(tandem) + '</span><span class="t-term">' + esc(term) + '</span>';
  }

  function currentName() { return el.name.value.trim(); }

  function withName(label, fallback) {
    var name = currentName();
    return String(label).split('{name}').join(name || fallback || '{name}');
  }

  function tierText(tier) { return tier === 'variable' ? 'Variable' : 'Tier ' + tier; }
  function sevText(tier) { return tier === 'variable' ? 'SEV-?' : 'SEV-' + tier; }
  function tierClass(tier) { return 'tier-' + (tier === undefined ? 'none' : tier); }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // " on 31 October 2026" (format anglais d MMMM yyyy), ou "" sans date.
  function whenString() {
    if (!el.addDate.checked) return '';
    var parts = (el.date.value || todayISO()).split('-');
    var y = parts[0], m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d) return '';
    return ' on ' + d + ' ' + MONTHS[m - 1] + ' ' + y;
  }

  function compose(template) {
    var text = template.split('{name}').join(currentName()).split('{when}').join(whenString());
    var details = el.details.value.trim().replace(/\s+/g, ' ');
    if (details) {
      if (!/[.!?…]["'’”»)\]]*$/.test(details)) details += '.';
      text += ' ' + details;
    }
    return text;
  }

  // --- Arbre : feuilles d'un contexte, regroupées par sous-menu -------------

  function sortKey(leaf, i) {
    if (leaf.type === 'unknown') return [2, i];
    if (typeof leaf.rank === 'number') return [0, leaf.rank];
    return [1, i];
  }

  function makeGroup(title, nodes, basePath, ctx) {
    var leaves = [];
    (function flatten(list, path) {
      list.forEach(function (node) {
        if (node.type === 'menu') flatten(node.children || [], path.concat(node.label));
        else if (node.type === 'ref') {
          var shared = TREE.shared[node.ref];
          if (shared) flatten(shared.children || [], path.concat(node.label));
        } else if (node.type !== 'ignored') {
          leaves.push({ key: ctx + ':' + node.id, leaf: node, path: path.concat(node.label), group: title });
        }
      });
    })(nodes, basePath);
    leaves = leaves
      .map(function (e, i) { return { e: e, k: sortKey(e.leaf, i) }; })
      .sort(function (a, b) { return a.k[0] - b.k[0] || a.k[1] - b.k[1]; })
      .map(function (x) { return x.e; });
    return { title: title, entries: leaves };
  }

  function buildGroups(ctxId) {
    var node = TREE.root.children.filter(function (c) { return c.id === ctxId; })[0];
    if (!node) return [];
    var base = ['Signaler', node.label];
    var groups = [];
    var loose = [];
    (node.children || []).forEach(function (child) {
      if (child.type === 'menu') {
        groups.push(makeGroup(child.label, child.children || [], base.concat(child.label), ctxId));
      } else if (child.type === 'ref') {
        var shared = TREE.shared[child.ref];
        if (shared) groups.push(makeGroup(child.label, shared.children || [], base.concat(child.label), ctxId));
      } else if (child.type !== 'ignored') {
        loose.push(child);
      }
    });
    if (loose.length) groups.push(makeGroup(groups.length ? 'Autres options' : null, loose, base, ctxId));
    return groups;
  }

  function allEntries() {
    return state.groups.reduce(function (acc, g) { return acc.concat(g.entries); }, []);
  }

  // --- Rendu : contextes, feuilles, rappel de gravité -------------------

  function renderContexts() {
    el.contexts.innerHTML = CONTEXTS.map(function (c) {
      return '<button type="button" class="ctx" data-ctx="' + c.id + '" aria-pressed="false">' + esc(c.tab) + '</button>';
    }).join('');
  }

  function leafMeta(leaf) {
    if (leaf.type === 'unknown') return 'pas encore exploré';
    if (leaf.type === 'direct') return 'sans message';
    var file = MESSAGES[leaf.id];
    var n = file && file.messages ? file.messages.length : 0;
    return n ? n + ' message' + (n > 1 ? 's' : '') + ' type' + (n > 1 ? 's' : '') : 'à rédiger';
  }

  function renderLeaves() {
    el.leaves.innerHTML = state.groups.map(function (g) {
      var buttons = g.entries.map(function (e) {
        var leaf = e.leaf;
        var unknown = leaf.type === 'unknown';
        var badge = unknown ? '' :
          '<span class="tier-badge">' + dual(tierText(leaf.tier), sevText(leaf.tier)) + '</span>';
        var rank = typeof leaf.rank === 'number' ? '<span class="rank" title="Rang de gravité">#' + leaf.rank + '</span>' : '<span class="rank rank-none">–</span>';
        return '<button type="button" class="leaf ' + tierClass(leaf.tier) + (unknown ? ' is-unknown' : '') + '"' +
          ' data-key="' + esc(e.key) + '"' + (unknown ? ' disabled' : '') + ' aria-pressed="false">' +
          rank +
          '<span class="leaf-text"><span class="leaf-label">' + esc(withName(leaf.label, '…')) + '</span>' +
          '<span class="leaf-meta">' + esc(leafMeta(leaf)) + '</span></span>' +
          badge + '</button>';
      }).join('');
      var title = g.title ? '<h2 class="group-title">' + esc(g.title) + '</h2>' : '';
      return '<div class="group">' + title + '<div class="leaf-list">' + buttons + '</div></div>';
    }).join('');
    markSelectedLeaf();
  }

  function markSelectedLeaf() {
    var key = state.entry && state.entry.key;
    Array.prototype.forEach.call(el.leaves.querySelectorAll('.leaf'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-key') === key));
    });
  }

  function labelForNodeId(id) {
    var found = null;
    (function walk(node) {
      if (found) return;
      if (node.id === id) { found = node.label; return; }
      (node.children || []).forEach(walk);
    })(TREE.root);
    if (!found && TREE.shared[id]) found = TREE.shared[id].label;
    if (id === 'party') found = 'Fête';
    return withName(found || id, '…');
  }

  function renderGravity() {
    var meta = TREE.meta || {};
    var tiers = meta.tiers || {};
    var seen = {};
    var entries = allEntries().filter(function (e) {
      if (e.leaf.type === 'unknown' || e.leaf.tier === undefined || seen[e.leaf.id]) return false;
      seen[e.leaf.id] = true;
      return true;
    });

    var html = TIER_ORDER.map(function (tier) {
      var items = entries.filter(function (e) { return e.leaf.tier === tier; });
      if (!items.length) return '';
      items.sort(function (a, b) { return (a.leaf.rank || 99) - (b.leaf.rank || 99); });
      return '<section class="tier-section ' + tierClass(tier) + '">' +
        '<h3 class="tier-title">' + dual(tierText(tier), sevText(tier)) +
        ' <span class="tier-desc">' + esc(tiers[tier] || '') + '</span></h3>' +
        '<ul class="tier-list">' + items.map(function (e) {
          var rank = typeof e.leaf.rank === 'number' ? '#' + e.leaf.rank : '–';
          var where = e.group ? ' <span class="where">' + esc(e.group) + '</span>' : '';
          return '<li><span class="rank">' + rank + '</span><div><strong>' + esc(withName(e.leaf.label, '…')) + '</strong>' + where +
            '<p>' + esc(e.leaf.note || '') + '</p></div></li>';
        }).join('') + '</ul></section>';
    }).join('');

    var ev = meta.evidence_strength;
    if (ev && ev.note) {
      var order = (ev.order || []).map(labelForNodeId).join(' › ');
      html += '<section class="evidence"><h3>Force de la preuve</h3>' +
        (order ? '<p class="evidence-order">De la plus forte à la plus faible : ' + esc(order) + '</p>' : '') +
        '<p>' + esc(ev.note) + '</p></section>';
    }
    if (meta.notes && meta.notes.length) {
      html += '<details class="notes"><summary>Remarques sur l\'arbre</summary><ul>' +
        meta.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></details>';
    }
    el.gravityBody.innerHTML = html;
  }

  function setContext(ctxId) {
    if (!CONTEXTS.some(function (c) { return c.id === ctxId; })) ctxId = CONTEXTS[0].id;
    state.context = ctxId;
    state.groups = buildGroups(ctxId);
    store.set(KEYS.context, ctxId);
    Array.prototype.forEach.call(el.contexts.querySelectorAll('.ctx'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-ctx') === ctxId));
    });
    renderLeaves();
    renderGravity();
    selectEntry(null);
  }

  // --- Composer --------------------------------------------------------

  function selectEntry(key) {
    stopTyping();
    var entry = key ? allEntries().filter(function (e) { return e.key === key; })[0] : null;
    state.entry = entry || null;
    state.template = null;
    state.edited = false;
    state.fullText = '';
    el.output.value = '';
    markSelectedLeaf();

    if (!entry) { el.composer.hidden = true; return; }
    var leaf = entry.leaf;
    var file = MESSAGES[leaf.id];
    state.mode = leaf.type === 'direct' ? 'direct' : (file && file.messages && file.messages.length ? 'templates' : 'free');

    el.composer.hidden = false;
    el.composer.className = 'card composer ' + tierClass(leaf.tier);
    renderPath();
    el.leafInfo.innerHTML = '<span class="tier-badge">' + dual(tierText(leaf.tier), sevText(leaf.tier)) + '</span> ' +
      (typeof leaf.rank === 'number' ? '<span class="rank">#' + leaf.rank + '</span> ' : '') + esc(leaf.note || '');
    el.unverified.hidden = leaf.verified !== false || state.mode === 'direct';
    el.modeDirect.hidden = state.mode !== 'direct';
    el.modeFree.hidden = state.mode !== 'free';
    el.templateFields.hidden = state.mode !== 'templates';
    el.outputBlock.hidden = state.mode === 'direct';
    el.output.readOnly = false;
    el.output.placeholder = state.mode === 'free' ? 'Écris ton message ici (en anglais de préférence)…' : 'Le message généré apparaîtra ici.';

    renderVariants(file);
    updateControls();

    if (state.mode === 'templates' && currentName()) generate();
    if (narrow.matches) el.composer.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPath() {
    if (!state.entry) return;
    el.path.innerHTML = state.entry.path.map(function (p) {
      return '<span class="crumb">' + esc(withName(p, '{name}')) + '</span>';
    }).join('<span class="sep" aria-hidden="true"> › </span>');
  }

  function renderVariants(file) {
    var variants = file && file.variants ? Object.keys(file.variants) : [];
    el.variantRow.hidden = variants.length < 2;
    if (variants.length < 2) { el.variants.innerHTML = ''; return; }
    var leafId = state.entry.leaf.id;
    if (variants.indexOf(state.variant[leafId]) < 0) state.variant[leafId] = variants[0];
    el.variants.innerHTML = variants.map(function (v) {
      var on = state.variant[leafId] === v;
      return '<button type="button" class="seg" role="radio" data-variant="' + esc(v) + '" aria-checked="' + on + '">' +
        esc(file.variants[v]) + '</button>';
    }).join('');
  }

  function pickTemplate() {
    var leafId = state.entry.leaf.id;
    var file = MESSAGES[leafId];
    var variant = state.variant[leafId];
    var pool = file.messages.filter(function (m) { return !variant || !file.variants || m.variant === variant; });
    if (!pool.length) pool = file.messages;
    var history = state.history[leafId] || [];
    var candidates = pool.filter(function (m) { return history.indexOf(m.id) < 0; });
    if (!candidates.length) {
      // Petit lot : on évite au moins de remontrer le même message.
      var last = history[history.length - 1];
      candidates = pool.length > 1 ? pool.filter(function (m) { return m.id !== last; }) : pool;
    }
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    history = history.filter(function (id) { return id !== pick.id; }).concat(pick.id).slice(-HISTORY_SIZE);
    state.history[leafId] = history;
    return pick;
  }

  function generate() {
    if (state.mode !== 'templates' || !currentName()) return;
    state.template = pickTemplate();
    state.edited = false;
    showText(compose(state.template.text), useTypewriter());
    updateControls();
  }

  // Les champs mettent le message à jour tant qu'il n'a pas été retouché à la main.
  function refreshOutput() {
    if (state.mode === 'templates' && state.template && !state.edited) {
      showText(compose(state.template.text), false);
    }
    updateControls();
  }

  // --- Effet machine à écrire (thème Terminal uniquement) ----------------

  function useTypewriter() {
    return document.documentElement.getAttribute('data-theme') === 'terminal' && !reduceMotion.matches;
  }

  function showText(text, animate) {
    stopTyping();
    state.fullText = text;
    if (!animate || !text) { el.output.value = text; updateCounter(); return; }
    var start = null;
    el.output.readOnly = true;
    el.output.classList.add('is-typing');
    el.output.value = '';
    var step = function (now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / TYPE_MS);
      el.output.value = text.slice(0, Math.ceil(text.length * t));
      if (t < 1) state.typing = requestAnimationFrame(step);
      else stopTyping();
    };
    state.typing = requestAnimationFrame(step);
    updateCounter();
  }

  function stopTyping() {
    if (state.typing === null) return;
    cancelAnimationFrame(state.typing);
    state.typing = null;
    el.output.value = state.fullText;
    el.output.readOnly = false;
    el.output.classList.remove('is-typing');
    updateCounter();
  }

  // --- Compteur, boutons, copie -----------------------------------------

  function currentText() { return state.typing !== null ? state.fullText : el.output.value; }

  function updateCounter() {
    var len = currentText().length;
    var over = len > MAX;
    el.counter.textContent = len + ' / ' + MAX;
    el.counter.classList.toggle('is-over', over);
    el.limitMsg.textContent = over
      ? 'Trop long de ' + (len - MAX) + ' caractère' + (len - MAX > 1 ? 's' : '') + ' : ' +
        (state.mode === 'free' || state.edited ? 'raccourcis ton message.' : 'raccourcis les détails.')
      : '';
    el.copy.disabled = !len || over;
    // Le retour « Copié » ne vaut que pour le texte réellement copié.
    if (state.copiedText !== null && currentText() !== state.copiedText) resetCopyLabel();
  }

  function resetCopyLabel() {
    clearTimeout(state.copyTimer);
    state.copiedText = null;
    el.copy.classList.remove('is-copied', 'is-failed');
    el.copy.innerHTML = dual('Copier', '> copy');
  }

  function targetArg() {
    var name = currentName();
    if (!name) return '<name>';
    return /\s/.test(name) ? '"' + name + '"' : name;
  }

  function updateControls() {
    var hasName = !!currentName();
    el.generate.disabled = !hasName;
    el.nameHint.hidden = hasName;
    el.generate.innerHTML = state.template
      ? dual('Autre message', '> report.regenerate --target ' + targetArg())
      : dual('Générer le message', '> report.generate --target ' + targetArg());
    el.editedHint.hidden = !(state.mode === 'templates' && state.edited);
    if (state.copiedText === null) el.copy.innerHTML = dual('Copier', '> copy');
    updateCounter();
  }

  function copyFallback(text) {
    var ta = el.output;
    var wasReadOnly = ta.readOnly;
    ta.readOnly = false;
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.setSelectionRange(text.length, text.length);
    ta.readOnly = wasReadOnly;
    return ok;
  }

  function copy() {
    stopTyping();
    var text = el.output.value;
    if (!text || text.length > MAX) return;
    var done = function (ok) {
      clearTimeout(state.copyTimer);
      state.copiedText = text;
      el.copy.classList.toggle('is-copied', ok);
      el.copy.classList.toggle('is-failed', !ok);
      el.copy.innerHTML = ok
        ? dual('Copié ✓', '> copied to clipboard_')
        : dual('Copie impossible : sélectionne le texte', '> copy failed: select manually');
      state.copyTimer = setTimeout(resetCopyLabel, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(copyFallback(text)); });
    } else {
      done(copyFallback(text));
    }
  }

  // --- Thème -------------------------------------------------------------

  function applyTheme(theme) {
    stopTyping();
    document.documentElement.setAttribute('data-theme', theme);
    el.themeToggle.setAttribute('aria-pressed', String(theme === 'terminal'));
    store.set(KEYS.theme, theme);
  }

  // --- Événements --------------------------------------------------------

  el.contexts.addEventListener('click', function (e) {
    var b = e.target.closest('.ctx');
    if (b && b.getAttribute('data-ctx') !== state.context) setContext(b.getAttribute('data-ctx'));
  });

  el.leaves.addEventListener('click', function (e) {
    var b = e.target.closest('.leaf');
    if (b && !b.disabled) selectEntry(b.getAttribute('data-key'));
  });

  el.variants.addEventListener('click', function (e) {
    var b = e.target.closest('.seg');
    if (!b || !state.entry) return;
    var leafId = state.entry.leaf.id;
    if (state.variant[leafId] === b.getAttribute('data-variant')) return;
    state.variant[leafId] = b.getAttribute('data-variant');
    renderVariants(MESSAGES[leafId]);
    if (state.template) generate();
  });

  el.name.addEventListener('input', function () {
    renderPath();
    Array.prototype.forEach.call(el.leaves.querySelectorAll('.leaf'), function (b) {
      var entry = allEntries().filter(function (x) { return x.key === b.getAttribute('data-key'); })[0];
      if (entry) b.querySelector('.leaf-label').textContent = withName(entry.leaf.label, '…');
    });
    refreshOutput();
  });

  el.addDate.addEventListener('change', function () {
    el.date.disabled = !el.addDate.checked;
    store.set(KEYS.addDate, el.addDate.checked ? '1' : '0');
    refreshOutput();
  });
  el.date.addEventListener('input', refreshOutput);
  el.details.addEventListener('input', refreshOutput);

  el.output.addEventListener('input', function () {
    if (state.mode === 'templates' && state.template) state.edited = true;
    state.fullText = el.output.value;
    updateControls();
  });

  el.generate.addEventListener('click', generate);
  el.copy.addEventListener('click', copy);

  // Un tap ou une touche interrompt l'effet machine à écrire.
  document.addEventListener('pointerdown', stopTyping, true);
  document.addEventListener('keydown', stopTyping, true);

  el.themeToggle.addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'terminal' ? 'tandem' : 'terminal');
  });

  el.gravityToggle.addEventListener('click', function () {
    var open = el.gravityToggle.getAttribute('aria-expanded') !== 'true';
    el.gravityToggle.setAttribute('aria-expanded', String(open));
    el.gravity.classList.toggle('is-open', open);
  });

  // --- Démarrage ---------------------------------------------------------

  var ignored = TREE.root.children.filter(function (c) { return c.type === 'ignored'; }).map(function (c) { return c.label; });
  if (ignored.length) el.ignoredNote.textContent = ignored.join(' et ') + ' : hors périmètre pour l\'instant.';

  el.date.value = todayISO();
  el.date.max = todayISO();
  el.addDate.checked = store.get(KEYS.addDate) === '1';
  el.date.disabled = !el.addDate.checked;
  applyTheme(document.documentElement.getAttribute('data-theme') === 'terminal' ? 'terminal' : 'tandem');
  renderContexts();
  setContext(store.get(KEYS.context));
})();

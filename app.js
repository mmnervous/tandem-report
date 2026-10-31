(function () {
  'use strict';

  var DATA = window.TANDEM_DATA;
  var root = document.documentElement;
  if (!DATA || !DATA.tree) {
    document.getElementById('app').innerHTML = '<section class="notice">Données introuvables : lance <code>python3 scripts/build.py</code> pour générer <code>data/bundle.js</code>.</section>';
    return;
  }

  var TREE = DATA.tree;
  var MESSAGES = DATA.messages || {};
  var MAX = (TREE.meta && TREE.meta.message_max_chars) || 500;
  var NEAR = MAX - 50;
  var HISTORY_SIZE = 10;
  var COPIED_MS = 1800;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var CONTEXTS = [
    { id: 'party', tab: 'Fête' },
    { id: 'profile', tab: 'Profil' },
    { id: 'chat', tab: 'Chat' }
  ];
  var TIER_ORDER = [1, 2, 3, 'variable'];
  var THEMES = [
    { id: 'tandem', name: 'Sobre' },
    { id: 'spectre', name: 'Spectre' }
  ];
  var KEYS = {
    context: 'tandem-report.context',
    addDate: 'tandem-report.addDate',
    theme: 'tandem-report.theme',
    tally: 'tandem-report.tally'   // { d: date du jour, n: copies } : jamais le nom ni le message
  };
  var COUNT_MS = 260;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopMq = window.matchMedia('(min-width: 900px)');
  function isDesktop() { return desktopMq.matches; }

  function $(id) { return document.getElementById(id); }
  var el = {
    app: $('app'), name: $('name'), nameClear: $('name-clear'), themeToggle: $('theme-toggle'),
    contexts: $('contexts'), sections: $('sections'), unknown: $('unknown'), ignoredNote: $('ignored-note'),
    gravityOpen: $('gravity-open'), gravityOpenTop: $('gravity-open-top'),
    msg: $('msg'), msgEmpty: $('msg-empty'), msgBody: $('msg-body'),
    back: $('back'), backLabel: $('back-label'), tierChip: $('tier-chip'),
    path: $('path'), title: $('msg-title'), note: $('note'), unverified: $('unverified'),
    direct: $('direct'), directBack: $('direct-back'), variants: $('variants'),
    ticket: $('ticket'), ghost: $('ghost'), status: $('status'), output: $('output'), counter: $('counter'),
    edited: $('edited'), restore: $('restore'), limitMsg: $('limit-msg'),
    options: $('options'), dateChip: $('date-chip'), date: $('date'),
    detailsChip: $('details-chip'), details: $('details'),
    actionbar: $('actionbar'), reroll: $('reroll'), copy: $('copy'), topbar: document.querySelector('.topbar'),
    gravity: $('gravity'), gravityTitle: $('gravity-title'), gravityBody: $('gravity-body'),
    gravityClose: $('gravity-close'), live: $('live'),
    themeColor: document.querySelector('meta[name="theme-color"]')
  };
  el.gravityInline = el.msgEmpty.querySelector('.gravity-inline');
  el.copyLabel = el.copy.querySelector('.copy-label');
  el.statusText = el.status.querySelector('.status-text');

  var state = {
    context: null,
    entries: [],          // feuilles connues (message/direct) du contexte actif
    unknown: [],          // feuilles « pas encore explorées » du contexte actif
    entry: null,          // feuille ouverte { key, leaf, path, group }
    mode: null,           // 'templates' | 'free' | 'direct'
    variant: {},          // variante choisie, par feuille
    history: {},          // ids des derniers messages montrés, par feuille
    drafts: {},           // texte libre en cours, par feuille (mode free)
    template: null,       // message type affiché
    edited: false,        // message retouché à la main
    copiedText: null,     // texte du dernier « Copié », tant que le retour est affiché
    copyOk: true,
    copyTimer: null,
    copiedName: null,     // nom au moment de la dernière copie réussie
    redrawArmed: false,   // après une copie, un nouveau nom tire un nouveau message
    copiedLeaves: {},     // feuilles déjà copiées pour ce nom (pastilles « copié ✓ »)
    freshSticker: null,   // pastille qui vient d'apparaître : seule elle s'anime
    pushedHash: false,
    listScrollY: 0,
    wasOver: false,
    detailsOpen: false,
    gravityTrigger: null,
    copiedAt: '',         // « 14:32 · 3ᵉ aujourd'hui », affiché par le voyant
    shownLen: 0,          // valeur affichée par le compteur (pour l'animation)
    countAnim: null
  };

  // --- Utilitaires -------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentName() { return el.name.value.trim(); }

  function withName(label, fallback) {
    return String(label).split('{name}').join(currentName() || fallback || '…');
  }

  function tierText(tier) { return tier === 'variable' ? 'Variable' : 'Tier ' + tier; }
  function tierShort(tier) { return tier === 'variable' ? 'Var.' : 'T' + tier; }
  function tierClass(tier) { return 'tier-' + tier; }
  function tierDesc(tier) { return (TREE.meta && TREE.meta.tiers && TREE.meta.tiers[tier]) || ''; }
  function ctxTab(id) { return CONTEXTS.filter(function (c) { return c.id === id; })[0].tab; }

  function announce(text) {
    el.live.textContent = '';
    setTimeout(function () { el.live.textContent = text; }, 30);
  }

  // Relance une animation CSS à base de classe (sans effet si mouvement réduit).
  function restart(node, cls) {
    if (reduceMotion.matches) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function isSpectre() { return root.getAttribute('data-theme') === 'spectre'; }
  function fx() { return isSpectre() && !reduceMotion.matches; }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dateOn() { return el.dateChip.getAttribute('aria-pressed') === 'true'; }

  // " on 31 October 2026" (format anglais d MMMM yyyy), ou "" sans date.
  function whenString() {
    if (!dateOn()) return '';
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

  // Clé lue dans l'URL ; '' si le hash est vide ou mal formé.
  function hashKey() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; }
  }

  function setHash(key, push) {
    try {
      if (push) location.hash = key;
      else location.replace('#' + key);
    } catch (e) { /* URL non modifiable : sans conséquence */ }
  }

  // --- Arbre : feuilles d'un contexte ----------------------------------------

  function collect(nodes, path, group, ctx, out) {
    nodes.forEach(function (node) {
      if (node.type === 'menu') {
        collect(node.children || [], path.concat(node.label), node.label, ctx, out);
      } else if (node.type === 'ref') {
        var shared = TREE.shared[node.ref];
        if (shared) collect(shared.children || [], path.concat(node.label), node.label, ctx, out);
      } else if (node.type !== 'ignored') {
        out.push({ key: ctx + ':' + node.id, leaf: node, path: path.concat(node.label), group: group });
      }
    });
    return out;
  }

  function entriesFor(ctx) {
    var node = TREE.root.children.filter(function (c) { return c.id === ctx; })[0];
    if (!node) return [];
    return collect(node.children || [], ['Signaler', node.label], null, ctx, []);
  }

  function findEntry(key) {
    var ctx = String(key).split(':')[0];
    if (!CONTEXTS.some(function (c) { return c.id === ctx; })) return null;
    return entriesFor(ctx).filter(function (e) { return e.key === key && e.leaf.type !== 'unknown'; })[0] || null;
  }

  function modeOf(leaf) {
    if (leaf.type === 'direct') return 'direct';
    var file = MESSAGES[leaf.id];
    return file && file.messages && file.messages.length ? 'templates' : 'free';
  }

  // Sections par tier, triées par rang (les feuilles sans rang à la fin, dans l'ordre de l'arbre).
  function sectionsOf(entries) {
    return TIER_ORDER.map(function (tier) {
      var list = entries
        .map(function (e, i) { return { e: e, i: i }; })
        .filter(function (x) { return x.e.leaf.tier === tier; })
        .sort(function (a, b) {
          var ra = typeof a.e.leaf.rank === 'number' ? a.e.leaf.rank : Infinity;
          var rb = typeof b.e.leaf.rank === 'number' ? b.e.leaf.rank : Infinity;
          return (ra === rb ? 0 : ra < rb ? -1 : 1) || a.i - b.i;
        })
        .map(function (x) { return x.e; });
      return { tier: tier, entries: list };
    }).filter(function (s) { return s.entries.length; });
  }

  // --- Liste « Choisir » -------------------------------------------------------

  function renderContexts() {
    el.contexts.innerHTML = CONTEXTS.map(function (c) {
      return '<button type="button" class="ctx" data-ctx="' + c.id + '" aria-pressed="' + (c.id === state.context) + '">' + esc(c.tab) + '</button>';
    }).join('');
  }

  // Pastille d'état selon la règle de la minorité : on marque ce qui est rare.
  function statusFor(leaf, counts) {
    if (leaf.type === 'direct') return { cls: 'none', text: 'sans message' };
    var mode = modeOf(leaf);
    if (counts.templates <= counts.free) return mode === 'templates' ? { cls: 'ready', text: 'prêt' } : null;
    return mode === 'free' ? { cls: 'none', text: 'à écrire' } : null;
  }

  function rowHTML(e, counts) {
    var leaf = e.leaf;
    var hasRank = typeof leaf.rank === 'number';
    var status = statusFor(leaf, counts);
    var copied = !!state.copiedLeaves[leaf.id];
    var chips = (status ? '<span class="chip-s chip-' + status.cls + '">' + status.text + '</span>' : '') +
      (copied ? '<span class="chip-s chip-copied' + (leaf.id === state.freshSticker ? ' is-fresh' : '') + '">copié ✓</span>' : '');
    var label = withName(leaf.label);
    var aria = (hasRank ? 'Rang ' + leaf.rank + ', ' : '') + tierText(leaf.tier) + ', ' + tierDesc(leaf.tier) + ' : ' + label +
      (e.group ? ' (' + e.group + ')' : '') + (status ? ', ' + (status.text === 'prêt' ? 'messages prêts' : status.text) : '') +
      (copied ? ', copié' : '');
    return '<button type="button" class="row ' + tierClass(leaf.tier) + '" data-key="' + esc(e.key) + '" tabindex="-1" aria-pressed="false" aria-label="' + esc(aria) + '">' +
      '<span class="rank" aria-hidden="true"><span class="rank-n">' + (hasRank ? leaf.rank : '–') + '</span></span>' +
      '<span class="row-text"><span class="row-label">' + esc(label) + '</span>' +
      (e.group ? '<span class="row-tag">' + esc(e.group) + '</span>' : '') + '</span>' +
      (chips ? '<span class="row-chips">' + chips + '</span>' : '') +
      '</button>';
  }

  function rowByKey(key) {
    return Array.prototype.filter.call(el.sections.querySelectorAll('.row'), function (b) {
      return b.getAttribute('data-key') === key;
    })[0] || null;
  }

  function renderList() {
    var a = document.activeElement;
    var focusedKey = a && a.classList && a.classList.contains('row') && el.sections.contains(a) ? a.getAttribute('data-key') : null;
    var counts = { templates: 0, free: 0 };
    state.entries.forEach(function (e) {
      if (e.leaf.type === 'message') counts[modeOf(e.leaf)] += 1;
    });
    el.sections.innerHTML = sectionsOf(state.entries).map(function (s) {
      return '<section class="tier-sec ' + tierClass(s.tier) + '">' +
        '<h2 class="tier-head"><span class="tier-tag">' + tierText(s.tier) + '</span><span class="tier-desc"> · ' + esc(tierDesc(s.tier)) + '</span></h2>' +
        '<div class="rows">' + s.entries.map(function (e) { return rowHTML(e, counts); }).join('') + '</div></section>';
    }).join('');
    state.freshSticker = null;
    markSelectedRow();
    var r = focusedKey && rowByKey(focusedKey);
    if (r) { setRowTabStop(r); r.focus({ preventScroll: true }); }
  }

  function renderUnknown() {
    var n = state.unknown.length;
    el.unknown.hidden = !n;
    if (!n) return;
    el.unknown.querySelector('summary').textContent = 'Pas encore explorés (' + n + ')';
    el.unknown.querySelector('.unknown-body').innerHTML = state.unknown.map(function (e) {
      return '<p><strong>' + esc(withName(e.leaf.label)) + '</strong>' + (e.group ? ' <span class="row-tag">' + esc(e.group) + '</span>' : '') +
        (e.leaf.note ? ' · ' + esc(e.leaf.note) : '') + '</p>';
    }).join('');
  }

  // Tabulation « itinérante » : une seule ligne est atteignable par Tab, les flèches passent aux autres.
  function setRowTabStop(row) {
    Array.prototype.forEach.call(el.sections.querySelectorAll('.row'), function (b) { b.tabIndex = b === row ? 0 : -1; });
  }

  function markSelectedRow() {
    var key = state.entry && state.entry.key;
    var rows = el.sections.querySelectorAll('.row');
    var selected = null;
    Array.prototype.forEach.call(rows, function (b) {
      var on = b.getAttribute('data-key') === key;
      b.setAttribute('aria-pressed', String(on));
      if (on) selected = b;
    });
    if (rows.length) setRowTabStop(selected || rows[0]);
  }

  function setContext(ctx, opts) {
    opts = opts || {};
    if (!CONTEXTS.some(function (c) { return c.id === ctx; })) ctx = CONTEXTS[0].id;
    var changed = ctx !== state.context;
    state.context = ctx;
    if (changed) state.listScrollY = 0;
    store.set(KEYS.context, ctx);
    root.setAttribute('data-ctx', ctx);
    var all = entriesFor(ctx);
    state.entries = all.filter(function (e) { return e.leaf.type !== 'unknown'; });
    state.unknown = all.filter(function (e) { return e.leaf.type === 'unknown'; });
    renderContexts();
    renderList();
    renderUnknown();
    renderEmptyPane();
    updateThemeColor();
    if (changed && !opts.keepEntry && state.entry) {
      deselect();
      if (location.hash) setHash('', false);
    }
  }

  // --- Rappel de gravité -------------------------------------------------------

  function labelForNodeId(id) {
    if (id === 'party') return 'Fête';
    var found = null;
    (function walk(node) {
      if (found) return;
      if (node.id === id) { found = node.label; return; }
      (node.children || []).forEach(walk);
    })(TREE.root);
    if (!found && TREE.shared[id]) found = TREE.shared[id].label;
    return withName(found || id);
  }

  function gravityHTML(ctx, currentKey) {
    var meta = TREE.meta || {};
    var entries = entriesFor(ctx).filter(function (e) { return e.leaf.type !== 'unknown' && e.leaf.tier !== undefined; });
    var html = sectionsOf(entries).map(function (s) {
      return '<section class="g-tier ' + tierClass(s.tier) + '">' +
        '<h3 class="tier-head"><span class="tier-tag">' + tierText(s.tier) + '</span><span class="tier-desc"> · ' + esc(tierDesc(s.tier)) + '</span></h3>' +
        '<ul class="g-list">' + s.entries.map(function (e) {
          var current = e.key === currentKey;
          return '<li><button type="button" class="g-row ' + tierClass(e.leaf.tier) + (current ? ' is-current' : '') + '" data-key="' + esc(e.key) + '"' +
            (current ? ' aria-current="true"' : '') + '>' +
            '<span class="g-rank">' + (typeof e.leaf.rank === 'number' ? '#' + e.leaf.rank : '–') + '</span>' +
            '<span class="g-text"><strong>' + esc(withName(e.leaf.label)) + '</strong>' +
            (e.group ? ' <span class="row-tag">' + esc(e.group) + '</span>' : '') +
            (e.leaf.note ? '<span class="g-note">' + esc(e.leaf.note) + '</span>' : '') + '</span></button></li>';
        }).join('') + '</ul></section>';
    }).join('');

    var ev = meta.evidence_strength;
    if (ev && ev.note) {
      var order = (ev.order || []).map(labelForNodeId).join(' › ');
      html += '<section class="evidence"><h3>Force de la preuve</h3>' +
        (order ? '<p class="evidence-order">De la plus forte à la plus faible : ' + esc(order) + '</p>' : '') +
        '<p>' + esc(ev.note) + '</p></section>';
    }
    var notes = (meta.notes || []).slice();
    if (el.ignoredNote.textContent) notes.push(el.ignoredNote.textContent);
    notes.push('Cette page ne communique jamais avec Tandem : elle produit du texte que tu colles toi-même dans l\'app.');
    html += '<details class="notes"><summary>Remarques sur l\'arbre</summary><ul>' +
      notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></details>';
    return html;
  }

  function renderEmptyPane() {
    el.gravityInline.innerHTML = gravityHTML(state.context, null);
  }

  function openGravity(trigger, focusKey) {
    state.gravityTrigger = trigger || null;
    el.gravityTitle.textContent = 'Rappel de gravité · ' + ctxTab(state.context);
    el.gravityBody.innerHTML = gravityHTML(state.context, focusKey);
    if (typeof el.gravity.showModal === 'function') {
      if (!el.gravity.open) el.gravity.showModal();
    } else {
      el.gravity.setAttribute('open', '');
      el.gravity.classList.add('is-open');
    }
    var current = focusKey && el.gravityBody.querySelector('.is-current');
    if (current) current.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function closeGravity() {
    if (typeof el.gravity.close === 'function' && el.gravity.open) el.gravity.close();
    else {
      el.gravity.removeAttribute('open');
      el.gravity.classList.remove('is-open');
      onGravityClosed();
    }
  }

  function onGravityClosed() {
    var t = state.gravityTrigger;
    state.gravityTrigger = null;
    if (t && document.contains(t) && t.offsetParent !== null) t.focus({ preventScroll: true });
  }

  // --- Vue « Message » ---------------------------------------------------------

  function saveDraft() {
    if (state.entry && state.mode === 'free') state.drafts[state.entry.leaf.id] = el.output.value;
  }

  function openEntry(key, opts) {
    opts = opts || {};
    var entry = findEntry(key);
    if (!entry) return false;
    var ctx = key.split(':')[0];
    if (ctx !== state.context) setContext(ctx, { keepEntry: true });

    saveDraft();
    state.entry = entry;
    state.mode = modeOf(entry.leaf);
    state.template = null;
    state.edited = false;
    state.wasOver = false;
    resetCopyLabel();
    if (state.mode === 'templates' && currentName()) state.template = pickTemplate();
    el.output.value = state.mode === 'free' ? (state.drafts[entry.leaf.id] || '') : '';

    renderMsg();
    render(true);
    markSelectedRow();
    el.msgEmpty.hidden = true;
    el.msgBody.hidden = false;

    if (isDesktop()) {
      setHash(key, false);
    } else {
      var wasMsg = el.app.getAttribute('data-view') === 'msg';
      if (!wasMsg) state.listScrollY = window.scrollY;
      el.app.setAttribute('data-view', 'msg');
      window.scrollTo(0, 0);
      if (opts.push !== false && location.hash !== '#' + key) {
        // Changer de feuille dans la vue Message ne crée pas d'entrée d'historique :
        // un seul retour ramène toujours à la liste.
        if (wasMsg) setHash(key, false);
        else { state.pushedHash = true; setHash(key, true); }
      }
    }
    autogrow(); // la vue est maintenant affichée : la hauteur se mesure correctement

    if (opts.focus !== false) {
      if (state.mode === 'templates' && !currentName()) el.name.focus();
      else if (state.mode === 'free') el.output.focus({ preventScroll: true });
      else el.title.focus({ preventScroll: true });
    }
    if (state.mode !== 'direct') restart(el.ticket, 'is-new');
    return true;
  }

  function showList() {
    el.app.setAttribute('data-view', 'pick');
    state.pushedHash = false;
    window.scrollTo(0, state.listScrollY);
    var row = state.entry && el.sections.querySelector('.row[aria-pressed="true"]');
    if (row) row.focus({ preventScroll: true });
  }

  function deselect() {
    saveDraft();
    state.entry = null;
    state.template = null;
    resetCopyLabel();
    markSelectedRow();
    el.msgBody.hidden = true;
    el.msgEmpty.hidden = false;
    el.app.setAttribute('data-view', 'pick');
    state.pushedHash = false;
  }

  function goBack() {
    if (state.pushedHash) {
      state.pushedHash = false;
      history.back(); // hashchange → showList
    } else {
      setHash('', false);
      showList();
    }
  }

  function renderPath() {
    if (!state.entry) return;
    var crumbs = state.entry.path.slice(0, -1);
    el.path.innerHTML = '<span class="sr-only">Chemin dans l\'app : </span>' + crumbs.map(function (p) {
      return '<span class="crumb">' + esc(withName(p)) + '</span>';
    }).join('<span class="sep" aria-hidden="true"> › </span>') + '<span class="sep" aria-hidden="true"> ›</span>';
    el.title.textContent = withName(state.entry.leaf.label);
  }

  function renderMsg() {
    var entry = state.entry;
    var leaf = entry.leaf;
    var mode = state.mode;
    var hasRank = typeof leaf.rank === 'number';

    el.backLabel.textContent = ctxTab(state.context);
    el.tierChip.className = 'tier-chip ' + tierClass(leaf.tier);
    el.tierChip.textContent = tierShort(leaf.tier) + (hasRank ? ' · #' + leaf.rank : '');
    el.tierChip.setAttribute('aria-label', tierText(leaf.tier) + (hasRank ? ', rang ' + leaf.rank : '') + ' : voir le rappel de gravité');
    el.msgBody.className = 'msg-body ' + tierClass(leaf.tier);
    renderPath();
    el.note.textContent = [tierDesc(leaf.tier), leaf.note].filter(Boolean).join(' · ');
    el.unverified.hidden = !(leaf.verified === false && mode !== 'direct');

    el.direct.hidden = mode !== 'direct';
    el.directBack.hidden = mode !== 'direct';
    el.ticket.hidden = mode === 'direct';
    el.options.hidden = mode !== 'templates';
    el.actionbar.hidden = mode === 'direct';
    el.reroll.hidden = mode !== 'templates';
    el.actionbar.classList.toggle('is-single', mode === 'free');
    el.output.placeholder = mode === 'free' ? 'Pas encore de messages types : écris le tien (en anglais de préférence)…' : '';
    renderVariants();
    syncDetails();
  }

  function renderVariants() {
    var file = MESSAGES[state.entry.leaf.id];
    var keys = state.mode === 'templates' && file && file.variants ? Object.keys(file.variants) : [];
    el.variants.hidden = keys.length < 2;
    if (keys.length < 2) { el.variants.innerHTML = ''; return; }
    var leafId = state.entry.leaf.id;
    if (keys.indexOf(state.variant[leafId]) < 0) state.variant[leafId] = keys[0];
    el.variants.innerHTML = keys.map(function (v) {
      var on = state.variant[leafId] === v;
      return '<button type="button" class="seg" role="radio" data-variant="' + esc(v) + '" aria-checked="' + on + '">' + esc(file.variants[v]) + '</button>';
    }).join('');
  }

  function pickTemplate() {
    var leafId = state.entry.leaf.id;
    var file = MESSAGES[leafId];
    var variant = state.variant[leafId];
    if (!variant && file.variants) variant = state.variant[leafId] = Object.keys(file.variants)[0];
    var pool = file.messages.filter(function (m) { return !variant || m.variant === variant; });
    if (!pool.length) pool = file.messages;
    var history = state.history[leafId] || [];
    var candidates = pool.filter(function (m) { return history.indexOf(m.id) < 0; });
    if (!candidates.length) {
      // Petit lot : on évite au moins de remontrer le même message.
      var last = history[history.length - 1];
      candidates = pool.length > 1 ? pool.filter(function (m) { return m.id !== last; }) : pool;
    }
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    state.history[leafId] = history.filter(function (id) { return id !== pick.id; }).concat(pick.id).slice(-HISTORY_SIZE);
    return pick;
  }

  // Met à jour le message à partir du gabarit, tant qu'il n'a pas été retouché à la main.
  function render(animate) {
    if (!state.entry) return;
    if (state.mode === 'templates') {
      var ghost = !currentName() && !state.edited;
      el.ghost.hidden = !ghost;
      el.output.hidden = ghost;
      if (state.template && !state.edited) el.output.value = ghost ? '' : compose(state.template.text);
    } else {
      el.ghost.hidden = true;
      el.output.hidden = false;
    }
    el.edited.hidden = !(state.mode === 'templates' && state.edited);
    autogrow();
    updateCounter(animate);
  }

  function autogrow() {
    if (el.output.hidden) return;
    el.output.style.height = 'auto';
    el.output.style.height = Math.max(el.output.scrollHeight + 2, 150) + 'px';
  }

  function countText(v) {
    return v + ' / ' + MAX + (v > MAX && isSpectre() ? ' · ' + (v - MAX) + ' de trop' : '');
  }

  function stopCount() {
    if (state.countAnim === null) return;
    cancelAnimationFrame(state.countAnim);
    state.countAnim = null;
    el.counter.textContent = countText(state.shownLen);
  }

  // Le compteur « monte » jusqu'à la nouvelle valeur (thème Spectre, 260 ms, interrompu par un tap).
  function showCount(len, animate) {
    stopCount();
    var from = state.shownLen;
    state.shownLen = len;
    if (!animate || !fx() || from === len) { el.counter.textContent = countText(len); return; }
    var start = null;
    var step = function (now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / COUNT_MS);
      var v = Math.round(from + (len - from) * (1 - Math.pow(1 - t, 3)));
      el.counter.textContent = countText(v);
      if (t < 1) state.countAnim = requestAnimationFrame(step);
      else state.countAnim = null;
    };
    state.countAnim = requestAnimationFrame(step);
  }

  function updateCounter(animate) {
    var len = el.output.hidden ? 0 : el.output.value.length;
    var over = len > MAX;
    var near = !over && len >= NEAR;
    showCount(len, animate);
    el.counter.classList.toggle('is-over', over);
    el.counter.classList.toggle('is-near', near);
    el.ticket.style.setProperty('--fill', String(Math.min(len / MAX, 1)));
    el.ticket.setAttribute('data-level', over ? 'over' : len >= NEAR ? 'near' : 'ok');
    if (over && !state.wasOver) restart(el.counter, 'nudge');
    state.wasOver = over;
    var extra = len - MAX;
    el.limitMsg.textContent = over
      ? 'Trop long de ' + extra + ' caractère' + (extra > 1 ? 's' : '') + ' : ' +
        (state.mode === 'free' || state.edited ? 'raccourcis ton message.' : 'raccourcis les détails.')
      : near ? 'Presque plein' : '';
    el.limitMsg.classList.toggle('is-near', near);
    if (state.copiedText !== null && el.output.value !== state.copiedText) resetCopyLabel();
    updateCopy();
  }

  function copyState() {
    if (state.copiedText !== null) return state.copyOk ? 'copied' : 'failed';
    var len = el.output.hidden ? 0 : el.output.value.length;
    if (state.mode === 'templates' && !currentName() && !state.edited) return 'need-name';
    if (!len) return 'empty';
    if (len > MAX) return 'over';
    return 'ready';
  }

  function updateCopy() {
    var s = copyState();
    var label = {
      'need-name': 'Ajoute le nom',
      empty: 'Copier',
      over: 'Trop long (−' + (el.output.value.length - MAX) + ')',
      ready: 'Copier',
      copied: 'Copié',
      failed: 'Copie impossible : sélectionne le texte'
    }[s];
    if (el.copyLabel.textContent !== label) el.copyLabel.textContent = label;
    el.copy.setAttribute('data-state', s);
    el.copy.setAttribute('aria-disabled', String(s === 'need-name' || s === 'empty' || s === 'over'));
    updateStatus(s);
  }

  // Voyant du message (affiché dans le thème Spectre).
  function updateStatus(s) {
    var map = {
      'need-name': ['wait', 'En attente d\'un nom'],
      empty: ['wait', 'En attente du message'],
      over: ['over', 'Trop long'],
      ready: ['ready', 'Prêt à copier'],
      copied: ['copied', 'Copié · ' + state.copiedAt],
      failed: ['over', 'Copie bloquée']
    }[s];
    el.status.setAttribute('data-state', map[0]);
    if (el.statusText.textContent !== map[1]) el.statusText.textContent = map[1];
  }

  function resetCopyLabel() {
    clearTimeout(state.copyTimer);
    state.copiedText = null;
    el.copy.classList.remove('is-copied', 'is-failed');
    el.ticket.classList.remove('is-filed');
  }

  // Nombre de copies du jour : seulement une date et un nombre.
  function bumpTally() {
    var today = todayISO();
    var tally = null;
    try { tally = JSON.parse(store.get(KEYS.tally) || 'null'); } catch (e) { tally = null; }
    var n = tally && tally.d === today && typeof tally.n === 'number' ? tally.n + 1 : 1;
    store.set(KEYS.tally, JSON.stringify({ d: today, n: n }));
    return n;
  }

  function copyFallback(text) {
    var ta = el.output;
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.setSelectionRange(text.length, text.length);
    return ok;
  }

  function copy() {
    if (!state.entry || state.mode === 'direct') return;
    var s = copyState();
    if (s === 'need-name') { el.name.focus(); return; }
    if (s === 'empty') { el.output.focus(); return; }
    if (s === 'over') {
      (state.mode === 'templates' && state.detailsOpen && el.details.value.trim() && !state.edited ? el.details : el.output).focus();
      return;
    }
    var text = el.output.value;
    var leafId = state.entry.leaf.id;
    el.ticket.classList.remove('is-new');
    var done = function (ok) {
      clearTimeout(state.copyTimer);
      state.copiedText = text;
      state.copyOk = ok;
      if (ok) {
        var n = bumpTally();
        var now = new Date();
        state.copiedAt = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') +
          ' · ' + n + (n === 1 ? 'ʳᵉ' : 'ᵉ') + ' du jour';
        state.copiedName = currentName();
        state.redrawArmed = state.mode === 'templates';
        if (!state.copiedLeaves[leafId]) state.freshSticker = leafId;
        state.copiedLeaves[leafId] = true;
        announce('Message copié');
        if (fx()) {
          try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* pas de vibration */ }
          restart(el.ticket, 'is-filed');
          restart(el.status, 'is-ping');
        }
        renderList();
      } else {
        el.output.focus();
        el.output.select();
      }
      updateCopy();
      restart(el.copy, ok ? 'is-copied' : 'is-failed');
      state.copyTimer = setTimeout(function () { resetCopyLabel(); updateCopy(); }, COPIED_MS);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(copyFallback(text)); });
        return;
      }
    } catch (e) { /* on passe au repli */ }
    done(copyFallback(text));
  }

  // --- Champs ---------------------------------------------------------------

  function onName() {
    var name = currentName();
    el.nameClear.hidden = !el.name.value;
    if (state.copiedName !== null && name !== state.copiedName) state.copiedLeaves = {};
    renderList();
    renderUnknown();
    renderPath();
    if (el.gravity.open) el.gravityBody.innerHTML = gravityHTML(state.context, null);
    if (!state.entry || state.mode !== 'templates') return;
    var drew = false;
    if (!state.template && name) {
      state.template = pickTemplate();
      state.redrawArmed = false; // un tirage neuf suffit pour la nouvelle personne
      drew = true;
      restart(el.ticket, 'is-new');
    } else if (state.redrawArmed && name && name !== state.copiedName && !state.edited) {
      // Nouvelle personne après une copie : jamais deux fois le même texte par accident.
      state.template = pickTemplate();
      state.redrawArmed = false;
      drew = true;
      announce('Nouveau message tiré');
      restart(el.ticket, 'is-new');
    }
    render(drew);
  }

  function setDate(on) {
    el.dateChip.setAttribute('aria-pressed', String(on));
    el.dateChip.textContent = on ? '✓ Date' : '＋ Date';
    el.date.hidden = !on;
    store.set(KEYS.addDate, on ? '1' : '0');
  }

  function syncDetails() {
    var n = el.details.value.trim().length;
    if (n) state.detailsOpen = true;
    el.details.hidden = !state.detailsOpen;
    el.detailsChip.setAttribute('aria-expanded', String(state.detailsOpen));
    el.detailsChip.textContent = n ? 'Détails · ' + n : '＋ Détails';
    el.detailsChip.classList.toggle('is-on', state.detailsOpen);
  }

  // --- Thème -------------------------------------------------------------------

  function updateThemeColor() {
    var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (el.themeColor && bg) el.themeColor.setAttribute('content', bg);
  }

  function applyTheme(id, fromToggle) {
    var current = THEMES.filter(function (t) { return t.id === id; })[0] || THEMES[0];
    var other = THEMES.filter(function (t) { return t.id !== current.id; })[0];
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', current.id);
    void getComputedStyle(root).color; // styles recalculés sans transition
    root.classList.remove('theme-switching');
    store.set(KEYS.theme, current.id);
    el.themeToggle.setAttribute('aria-label', 'Thème actuel : ' + current.name + '. Passer au thème ' + other.name + '.');
    el.themeToggle.title = 'Passer au thème ' + other.name;
    el.themeToggle.setAttribute('data-next', other.id);
    updateThemeColor();
    if (fromToggle && fx()) restart(el.topbar, 'is-sweep');
    if (state.entry) { autogrow(); updateCounter(); }
  }

  // --- Événements ----------------------------------------------------------------

  el.contexts.addEventListener('click', function (e) {
    var b = e.target.closest('.ctx');
    if (b) setContext(b.getAttribute('data-ctx'));
  });

  el.sections.addEventListener('click', function (e) {
    var b = e.target.closest('.row');
    if (b) openEntry(b.getAttribute('data-key'));
  });

  function onGravityRow(e) {
    var b = e.target.closest('.g-row');
    if (!b) return;
    state.gravityTrigger = null; // le focus va à la feuille ouverte, pas au bouton d'ouverture
    if (el.gravity.open) closeGravity();
    openEntry(b.getAttribute('data-key'));
  }
  el.gravityBody.addEventListener('click', onGravityRow);
  el.gravityInline.addEventListener('click', onGravityRow);

  el.gravityOpen.addEventListener('click', function () { openGravity(el.gravityOpen); });
  el.gravityOpenTop.addEventListener('click', function () { openGravity(el.gravityOpenTop); });
  el.tierChip.addEventListener('click', function () { openGravity(el.tierChip, state.entry && state.entry.key); });
  el.gravityClose.addEventListener('click', closeGravity);
  el.gravity.addEventListener('close', onGravityClosed);
  el.gravity.addEventListener('click', function (e) { if (e.target === el.gravity) closeGravity(); });

  el.back.addEventListener('click', goBack);
  el.directBack.addEventListener('click', goBack);
  el.ghost.addEventListener('click', function () { el.name.focus(); });

  el.variants.addEventListener('click', function (e) {
    var b = e.target.closest('.seg');
    if (!b || !state.entry) return;
    var leafId = state.entry.leaf.id;
    if (state.variant[leafId] === b.getAttribute('data-variant')) return;
    state.variant[leafId] = b.getAttribute('data-variant');
    renderVariants();
    if (currentName()) {
      state.template = pickTemplate();
      state.edited = false;
      restart(el.ticket, 'is-new');
    } else {
      state.template = null;
    }
    render(true);
  });

  el.reroll.addEventListener('click', function () {
    if (!state.entry || state.mode !== 'templates') return;
    state.template = pickTemplate();
    state.edited = false;
    render(true);
    restart(el.ticket, 'is-new');
    restart(el.reroll, 'is-spinning');
  });

  el.restore.addEventListener('click', function () {
    state.edited = false;
    render();
    (el.output.hidden ? el.name : el.output).focus();
  });

  el.output.addEventListener('input', function () {
    if (state.mode === 'templates' && state.template) state.edited = true;
    el.edited.hidden = !(state.mode === 'templates' && state.edited);
    autogrow();
    updateCounter();
  });

  el.copy.addEventListener('click', copy);

  el.name.addEventListener('input', onName);
  el.name.addEventListener('focus', function () {
    if (state.redrawArmed && el.name.value) el.name.setSelectionRange(0, el.name.value.length);
  });
  el.name.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.name.blur(); });
  el.nameClear.addEventListener('click', function () {
    el.name.value = '';
    onName();
    el.name.focus();
  });

  el.dateChip.addEventListener('click', function () {
    setDate(!dateOn());
    render();
  });
  el.date.addEventListener('input', render);

  el.detailsChip.addEventListener('click', function () {
    if (state.detailsOpen && el.details.value.trim()) { el.details.focus(); return; }
    state.detailsOpen = !state.detailsOpen;
    syncDetails();
    if (state.detailsOpen) el.details.focus();
  });
  el.details.addEventListener('input', function () {
    syncDetails();
    render();
  });

  el.themeToggle.addEventListener('click', function () {
    applyTheme(el.themeToggle.getAttribute('data-next'), true);
  });

  window.addEventListener('hashchange', function () {
    var key = hashKey();
    if (!key) {
      if (isDesktop()) { if (state.entry) deselect(); }
      else if (el.app.getAttribute('data-view') === 'msg') showList();
      return;
    }
    if (state.entry && state.entry.key === key) {
      if (!isDesktop()) el.app.setAttribute('data-view', 'msg');
      return;
    }
    if (!openEntry(key, { push: false, focus: false })) setHash('', false);
  });

  // Un tap ou une touche interrompt l'animation d'arrivée du message.
  function interrupt(e) {
    el.ticket.classList.remove('is-new');
    stopCount();
    if (!e || !el.copy.contains(e.target)) {
      el.copy.classList.remove('is-copied');
      el.ticket.classList.remove('is-filed');
      el.status.classList.remove('is-ping');
      var fresh = el.sections.querySelector('.chip-copied.is-fresh');
      if (fresh) fresh.classList.remove('is-fresh');
    }
  }
  document.addEventListener('pointerdown', interrupt, true);
  el.output.addEventListener('focus', interrupt);

  // Raccourcis clavier (surtout sur ordinateur).
  document.addEventListener('keydown', function (e) {
    interrupt(e);
    var t = e.target;
    var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      el.name.focus();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.entry) {
      e.preventDefault();
      copy();
    } else if (e.key === 'Escape' && isDesktop() && state.entry && !el.gravity.open && (el.msg.contains(t) || t === document.body)) {
      var row = rowByKey(state.entry.key);
      deselect();
      setHash('', false);
      if (row) row.focus({ preventScroll: true });
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && t.classList && t.classList.contains('row')) {
      e.preventDefault();
      var rows = Array.prototype.slice.call(el.sections.querySelectorAll('.row'));
      var next = rows[rows.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { setRowTabStop(next); next.focus(); }
    }
  });

  window.addEventListener('resize', function () { if (state.entry) autogrow(); });

  // :active sur iOS.
  document.addEventListener('touchstart', function () {}, { passive: true });

  // --- Démarrage -------------------------------------------------------------------

  var ignored = TREE.root.children.filter(function (c) { return c.type === 'ignored'; }).map(function (c) { return c.label; });
  if (ignored.length) el.ignoredNote.textContent = ignored.join(' et ') + ' : hors périmètre pour l\'instant.';

  el.date.value = todayISO();
  el.date.max = todayISO();
  setDate(store.get(KEYS.addDate) === '1');
  applyTheme(root.getAttribute('data-theme'));

  var startKey = hashKey();
  if (startKey && findEntry(startKey)) {
    setContext(startKey.split(':')[0]);
    openEntry(startKey, { push: false, focus: false });
  } else {
    setContext(store.get(KEYS.context));
    if (location.hash) setHash('', false);
  }
})();

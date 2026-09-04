/* Nestbau v2.0 – Rezept-Import: Posteingang und Editor.
 *
 * Bewusst ohne Framework und ohne direkte Firebase-Aufrufe im UI-Teil:
 * die Anbindung steckt komplett im Adapter (siehe firebaseAdapter unten).
 * Dadurch laesst sich die Oberflaeche mit Testdaten oeffnen, ohne dass ein
 * Firebase-Projekt laufen muss – und die App kann den Adapter austauschen,
 * wenn sich am Backend etwas aendert.
 *
 * Einbinden:
 *   <link rel="stylesheet" href="recipe-import.css">
 *   <script src="recipe-import.js"></script>
 *   NestbauRecipeImport.mount(container, NestbauRecipeImport.firebaseAdapter({...}));
 */

window.NestbauRecipeImport = (function () {
  'use strict';

  // Spiegelt die Server-Tabelle in functions/lib/recipeUnits.js. Wenn dort
  // etwas geaendert wird, muss es hier mitgezogen werden – sonst zeigt die
  // Vorschau andere Naehrwerte als das gespeicherte Rezept.
  const UNIT_GRAMS = {
    g: 1, kg: 1000, mg: 0.001, ml: 1, cl: 10, dl: 100, l: 1000,
    el: 15, tl: 5, msp: 0.5, prise: 1, stk: 100, bund: 50, zehe: 5,
    scheibe: 25, stange: 100, blatt: 2, dose: 400, packung: 250,
    becher: 200, tasse: 240, glas: 200, handvoll: 30, schuss: 10,
    kugel: 50, wuerfel: 10
  };

  const UNIT_LABELS = {
    g: 'g', kg: 'kg', mg: 'mg', ml: 'ml', cl: 'cl', dl: 'dl', l: 'l',
    el: 'EL', tl: 'TL', msp: 'Msp.', prise: 'Prise', stk: 'Stück',
    bund: 'Bund', zehe: 'Zehe', scheibe: 'Scheibe', stange: 'Stange',
    blatt: 'Blatt', dose: 'Dose', packung: 'Packung', becher: 'Becher',
    tasse: 'Tasse', glas: 'Glas', handvoll: 'Handvoll', schuss: 'Schuss',
    kugel: 'Kugel', wuerfel: 'Würfel'
  };

  const CATEGORIES = [
    { id: 'breakfast', label: 'Frühstück', emoji: '🥐' },
    { id: 'main', label: 'Mittag-/Abendessen', emoji: '🍽️' },
    { id: 'snack', label: 'Snack', emoji: '🥨' },
    { id: 'dessert', label: 'Dessert', emoji: '🍰' },
    { id: 'drink', label: 'Getränk', emoji: '🥤' }
  ];

  const STATUS = {
    pending: { label: 'Wartet', tone: 'wait' },
    parsing: { label: 'Wird gelesen', tone: 'wait' },
    ready: { label: 'Bereit', tone: 'ok' },
    failed: { label: 'Fehlgeschlagen', tone: 'err' },
    committed: { label: 'Übernommen', tone: 'done' }
  };

  // --------------------------------------------------------------- Helpers

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function toGrams(amount, unit) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    const factor = UNIT_GRAMS[unit || 'stk'];
    return factor == null ? null : value * factor;
  }

  function round1(value) { return Math.round(value * 10) / 10; }

  function formatAmount(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    const num = Number(value);
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100).replace('.', ',');
  }

  function relativeTime(millis) {
    if (!millis) return '';
    const diff = Date.now() - millis;
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'gerade eben';
    if (minutes < 60) return `vor ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `vor ${hours} h`;
    return new Date(millis).toLocaleDateString('de-CH');
  }

  /** Naehrwerte live aus den aktuell zugeordneten Zutaten rechnen. */
  function computeNutrition(rows, ingredientsById, servings) {
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    let matchedGrams = 0;
    let totalGrams = 0;
    let missing = 0;

    for (const row of rows) {
      const grams = toGrams(row.amount, row.unit);
      if (grams != null) totalGrams += grams;

      const doc = row.ingredientId ? ingredientsById.get(row.ingredientId) : null;
      if (!doc || grams == null) { missing += 1; continue; }

      const nutrition = doc.nutrition || {};
      const basis = Number(nutrition.basisG) > 0 ? Number(nutrition.basisG) : 100;
      const factor = grams / basis;
      totals.kcal += (Number(nutrition.kcal) || 0) * factor;
      totals.protein += (Number(nutrition.protein) || 0) * factor;
      totals.fat += (Number(nutrition.fat) || 0) * factor;
      totals.carbs += (Number(nutrition.carbs) || 0) * factor;
      matchedGrams += grams;
    }

    const perServing = servings > 0 ? {
      kcal: Math.round(totals.kcal / servings),
      protein: round1(totals.protein / servings),
      fat: round1(totals.fat / servings),
      carbs: round1(totals.carbs / servings)
    } : null;

    return {
      total: {
        kcal: Math.round(totals.kcal),
        protein: round1(totals.protein),
        fat: round1(totals.fat),
        carbs: round1(totals.carbs)
      },
      perServing,
      totalWeightG: totalGrams > 0 ? Math.round(totalGrams) : null,
      coverage: totalGrams > 0 ? matchedGrams / totalGrams : 0,
      missing
    };
  }

  // ----------------------------------------------------------------- Editor

  function buildEditorState(record) {
    const parsed = record.parsed || {};
    const matches = record.matches || [];

    return {
      title: parsed.title || '',
      description: parsed.description || '',
      servings: parsed.servings || '',
      timeMinutes: parsed.timeMinutes || '',
      totalWeightG: parsed.totalWeightG || '',
      categories: [...(record.categories || [])],
      notes: parsed.notes || '',
      prep: (parsed.prep || []).join('\n'),
      steps: (parsed.steps || []).join('\n'),
      utensils: [...(parsed.utensils || [])],
      favorite: false,
      rows: (parsed.ingredients || []).map((item, index) => {
        const match = matches[index] || {};
        return {
          name: item.name || '',
          amount: item.amount,
          unit: item.unit || 'g',
          note: item.note || '',
          raw: item.raw || '',
          // "" = nicht zuordnen, "new" = neu anlegen, sonst Zutat-ID
          ingredientId: match.ingredientId || '',
          confidence: match.confidence || 0,
          candidates: match.candidates || []
        };
      })
    };
  }

  function renderAllergyBanner(warnings) {
    if (!warnings || !warnings.length) return null;

    return h('div', { class: 'nbi-allergy' },
      h('div', { class: 'nbi-allergy-head' }, '⚠️ Allergie-Hinweis'),
      h('ul', {},
        warnings.map((warning) => h('li', {},
          h('strong', { text: warning.label }),
          ` – betrifft ${warning.members.map((m) => m.displayName).join(', ')}`,
          h('span', {
            class: `nbi-cert ${warning.certainty}`,
            text: warning.certainty === 'confirmed' ? 'bestätigt' : 'vermutet'
          }),
          h('div', { class: 'nbi-allergy-src', text: `aus: ${warning.ingredients.join(', ')}` })
        ))
      ),
      h('p', { class: 'nbi-allergy-foot', text: 'Vermutete Treffer stammen aus Stichworten im Zutatennamen, nicht aus der Zutaten-Datenbank.' })
    );
  }

  function renderEditor(record, adapter, options) {
    const state = buildEditorState(record);
    const ingredients = adapter.getIngredients();
    const ingredientsById = new Map(ingredients.map((doc) => [doc.id, doc]));
    const overlay = h('div', { class: 'nbi-overlay' });
    let nutritionBox;

    const close = () => overlay.remove();

    function refreshNutrition() {
      const result = computeNutrition(state.rows, ingredientsById, Number(state.servings) || 0);
      const coverage = Math.round(result.coverage * 100);
      nutritionBox.replaceChildren(
        h('div', { class: 'nbi-nut-head' },
          'Nährwerte',
          h('span', {
            class: `nbi-coverage ${coverage >= 80 ? 'good' : coverage >= 40 ? 'mid' : 'low'}`,
            text: `${coverage}% der Menge zugeordnet`
          })
        ),
        h('div', { class: 'nbi-nut-grid' },
          h('div', {}, h('b', { text: `${result.total.kcal} kcal` }), h('span', { text: 'gesamt' })),
          h('div', {}, h('b', { text: `${result.total.protein} g` }), h('span', { text: 'Protein' })),
          h('div', {}, h('b', { text: `${result.total.fat} g` }), h('span', { text: 'Fett' })),
          h('div', {}, h('b', { text: `${result.total.carbs} g` }), h('span', { text: 'Kohlenhydrate' }))
        ),
        result.perServing
          ? h('div', { class: 'nbi-nut-serving', text: `Pro Portion: ${result.perServing.kcal} kcal · ${result.perServing.protein} g Protein · ${result.perServing.fat} g Fett · ${result.perServing.carbs} g KH` })
          : h('div', { class: 'nbi-nut-serving', text: 'Portionen eintragen für die Pro-Portion-Angabe.' }),
        result.missing
          ? h('div', { class: 'nbi-nut-warn', text: `${result.missing} Zutat(en) ohne Zuordnung oder ohne Menge – die fehlen in der Summe.` })
          : null
      );
    }

    function ingredientRow(row, index) {
      const select = h('select', {
        class: 'nbi-link',
        onchange: (event) => {
          row.ingredientId = event.target.value;
          select.className = `nbi-link ${row.ingredientId === 'new' ? 'is-new' : row.ingredientId ? 'is-linked' : 'is-open'}`;
          refreshNutrition();
        }
      });

      select.append(h('option', { value: '', text: '– nicht zuordnen –' }));
      select.append(h('option', { value: 'new', text: `+ "${row.name}" neu anlegen` }));

      // Vorschlaege des Servers zuerst, danach die ganze Datenbank.
      const suggested = new Set((row.candidates || []).map((c) => c.ingredientId));
      if (suggested.size) {
        const group = h('optgroup', { label: 'Vorschläge' });
        for (const candidate of row.candidates) {
          group.append(h('option', {
            value: candidate.ingredientId,
            text: `${candidate.name} (${Math.round(candidate.score * 100)}%)`
          }));
        }
        select.append(group);
      }
      const rest = h('optgroup', { label: 'Alle Zutaten' });
      for (const doc of ingredients) {
        if (suggested.has(doc.id)) continue;
        rest.append(h('option', { value: doc.id, text: doc.name }));
      }
      select.append(rest);
      select.value = row.ingredientId || '';
      select.className = `nbi-link ${row.ingredientId === 'new' ? 'is-new' : row.ingredientId ? 'is-linked' : 'is-open'}`;

      const unitSelect = h('select', {
        class: 'nbi-unit',
        onchange: (event) => { row.unit = event.target.value; refreshNutrition(); }
      }, Object.entries(UNIT_LABELS).map(([id, label]) => h('option', { value: id, text: label })));
      unitSelect.value = row.unit || 'g';

      return h('div', { class: 'nbi-ing-row' },
        h('input', {
          class: 'nbi-amount', type: 'text', inputmode: 'decimal',
          value: formatAmount(row.amount), placeholder: '–', 'aria-label': 'Menge',
          oninput: (event) => {
            const value = event.target.value.replace(',', '.').trim();
            row.amount = value === '' ? null : Number(value);
            refreshNutrition();
          }
        }),
        unitSelect,
        h('input', {
          class: 'nbi-name', type: 'text', value: row.name, 'aria-label': 'Zutat',
          oninput: (event) => { row.name = event.target.value; }
        }),
        select,
        h('button', {
          class: 'nbi-icon-btn', title: 'Zeile entfernen', type: 'button',
          onclick: (event) => {
            state.rows.splice(state.rows.indexOf(row), 1);
            event.target.closest('.nbi-ing-row').remove();
            refreshNutrition();
          }
        }, '×'),
        row.note ? h('div', { class: 'nbi-ing-note', text: row.note }) : null,
        row.ingredientId === '' && row.confidence > 0
          ? h('div', { class: 'nbi-ing-hint', text: `unsicherer Treffer (${Math.round(row.confidence * 100)}%) – bitte prüfen` })
          : null
      );
    }

    const rowsBox = h('div', { class: 'nbi-ings' }, state.rows.map(ingredientRow));

    const categoryChips = h('div', { class: 'nbi-chips' }, CATEGORIES.map((category) => {
      const chip = h('button', {
        type: 'button',
        class: `nbi-chip ${state.categories.includes(category.id) ? 'active' : ''}`,
        onclick: () => {
          const index = state.categories.indexOf(category.id);
          if (index >= 0) state.categories.splice(index, 1);
          else state.categories.push(category.id);
          chip.classList.toggle('active');
        }
      }, `${category.emoji} ${category.label}`);
      return chip;
    }));

    const field = (label, key, attrs) => h('label', { class: 'nbi-field' },
      h('span', { text: label }),
      h('input', Object.assign({
        type: 'text',
        value: state[key] == null ? '' : state[key],
        oninput: (event) => { state[key] = event.target.value; if (key === 'servings') refreshNutrition(); }
      }, attrs || {}))
    );

    const area = (label, key, rows, hint) => h('label', { class: 'nbi-field' },
      h('span', { text: label }),
      hint ? h('em', { class: 'nbi-hint', text: hint }) : null,
      h('textarea', {
        rows: String(rows),
        oninput: (event) => { state[key] = event.target.value; }
      }, state[key] || '')
    );

    const errorBox = h('div', { class: 'nbi-msg' });

    async function save() {
      errorBox.className = 'nbi-msg';
      errorBox.textContent = '';

      if (!state.title.trim()) {
        errorBox.className = 'nbi-msg err show';
        errorBox.textContent = 'Bitte einen Titel eintragen.';
        return;
      }

      // Neu anzulegende Zutaten sammeln und im Rezept per Platzhalter verlinken.
      const createIngredients = [];
      const recipeIngredients = state.rows.map((row) => {
        let ingredientId = row.ingredientId || null;
        if (ingredientId === 'new') {
          const key = `n${createIngredients.length}`;
          createIngredients.push({ key, name: row.name });
          ingredientId = `new:${key}`;
        }
        return {
          ingredientId,
          name: row.name,
          amount: row.amount,
          unit: row.unit,
          note: row.note || null
        };
      });

      const recipe = {
        title: state.title.trim(),
        description: state.description.trim(),
        servings: Number(state.servings) || null,
        timeMinutes: Number(state.timeMinutes) || null,
        totalWeightG: Number(state.totalWeightG) || null,
        categories: state.categories,
        ingredients: recipeIngredients,
        prep: state.prep.split('\n').map((s) => s.trim()).filter(Boolean),
        steps: state.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        utensils: state.utensils,
        notes: state.notes.trim(),
        favorite: state.favorite
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Wird übernommen...';
      try {
        const result = await adapter.commit(record.id, recipe, createIngredients);
        close();
        if (options.onCommitted) options.onCommitted(result && result.recipeId, recipe);
      } catch (error) {
        errorBox.className = 'nbi-msg err show';
        errorBox.textContent = error && error.message ? error.message : 'Übernehmen fehlgeschlagen.';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Als Rezept übernehmen';
      }
    }

    const saveBtn = h('button', { class: 'nbi-btn primary', type: 'button', onclick: save }, 'Als Rezept übernehmen');

    const utensilBox = h('div', { class: 'nbi-tags' });
    function renderUtensils() {
      utensilBox.replaceChildren(
        ...state.utensils.map((name, index) => h('span', { class: 'nbi-tag' }, name,
          h('button', {
            type: 'button', title: 'Entfernen',
            onclick: () => { state.utensils.splice(index, 1); renderUtensils(); }
          }, '×'))),
        h('input', {
          class: 'nbi-tag-input', type: 'text', placeholder: '+ Utensil, Enter',
          onkeydown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const value = event.target.value.trim();
            if (!value) return;
            state.utensils.push(value.slice(0, 60));
            event.target.value = '';
            renderUtensils();
            utensilBox.querySelector('.nbi-tag-input').focus();
          }
        })
      );
    }
    renderUtensils();

    const source = record.source || {};
    const parser = record.parser || {};

    const panel = h('div', { class: 'nbi-panel', role: 'dialog', 'aria-label': 'Import bearbeiten' },
      h('header', { class: 'nbi-panel-head' },
        h('div', {},
          h('h2', { text: 'Import prüfen' }),
          h('p', { class: 'nbi-source' },
            source.siteName || 'Unbekannte Quelle',
            source.author ? ` · ${source.author}` : '',
            parser.engine ? ` · ${parser.engine === 'jsonld' ? 'strukturierte Daten' : parser.engine === 'ai' ? 'KI-Parsing' : parser.engine}` : ''
          )
        ),
        h('button', { class: 'nbi-icon-btn big', type: 'button', title: 'Schliessen', onclick: close }, '×')
      ),

      h('div', { class: 'nbi-panel-body' },
        renderAllergyBanner(record.allergyWarnings),

        (parser.warnings || []).length
          ? h('div', { class: 'nbi-warnings' },
            h('b', { text: 'Hinweise des Parsers' }),
            h('ul', {}, parser.warnings.map((warning) => h('li', { text: warning })))
          )
          : null,

        h('div', { class: 'nbi-top' },
          record.image && record.image.url
            ? h('img', { class: 'nbi-photo', src: record.image.url, alt: '' })
            : h('div', { class: 'nbi-photo empty', text: '🍲' }),
          h('div', { class: 'nbi-top-fields' },
            field('Titel', 'title'),
            field('Kurzbeschreibung', 'description'),
            h('div', { class: 'nbi-triple' },
              field('Portionen', 'servings', { inputmode: 'numeric' }),
              field('Zeit (Minuten)', 'timeMinutes', { inputmode: 'numeric' }),
              field('Gesamtgewicht (g)', 'totalWeightG', { inputmode: 'numeric' })
            )
          )
        ),

        h('h3', { text: 'Kategorien' }),
        categoryChips,

        h('h3', { text: 'Zutaten' }),
        h('p', { class: 'nbi-hint', text: 'Rechts jede Zeile einer Zutat aus der Datenbank zuordnen – nur zugeordnete Zutaten zählen für die Nährwerte.' }),
        rowsBox,
        h('button', {
          class: 'nbi-btn ghost small', type: 'button',
          onclick: () => {
            const row = { name: '', amount: null, unit: 'g', note: '', ingredientId: '', confidence: 0, candidates: [] };
            state.rows.push(row);
            rowsBox.append(ingredientRow(row, state.rows.length - 1));
          }
        }, '+ Zutat ergänzen'),

        (nutritionBox = h('div', { class: 'nbi-nutrition' })),

        h('h3', { text: 'Zubereitung' }),
        area('Vorbereitung', 'prep', 4, 'Ein Schritt pro Zeile'),
        area('Zubereitung', 'steps', 8, 'Ein Schritt pro Zeile'),

        h('h3', { text: 'Utensilien' }),
        utensilBox,

        area('Notizen', 'notes', 3),
        errorBox
      ),

      h('footer', { class: 'nbi-panel-foot' },
        h('button', {
          class: 'nbi-btn ghost', type: 'button',
          onclick: async () => {
            if (!window.confirm('Diesen Import verwerfen?')) return;
            await adapter.remove(record.id);
            close();
          }
        }, 'Verwerfen'),
        h('div', { class: 'nbi-spacer' }),
        h('button', { class: 'nbi-btn ghost', type: 'button', onclick: close }, 'Abbrechen'),
        saveBtn
      )
    );

    refreshNutrition();
    overlay.append(panel);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', function onEscape(event) {
      if (event.key !== 'Escape') return;
      document.removeEventListener('keydown', onEscape);
      close();
    });

    return overlay;
  }

  // ------------------------------------------------------------ Posteingang

  function renderCard(record, adapter, options) {
    const status = STATUS[record.status] || STATUS.pending;
    const parsed = record.parsed || {};
    const source = record.source || {};
    const busy = record.status === 'pending' || record.status === 'parsing';

    const actions = h('div', { class: 'nbi-card-actions' });

    if (record.status === 'ready') {
      actions.append(h('button', {
        class: 'nbi-btn primary small', type: 'button',
        onclick: () => document.body.append(renderEditor(record, adapter, options))
      }, 'Prüfen & übernehmen'));
    }
    if (record.status === 'failed') {
      actions.append(h('button', {
        class: 'nbi-btn ghost small', type: 'button',
        onclick: async (event) => {
          event.target.disabled = true;
          event.target.textContent = 'Läuft...';
          try { await adapter.retry(record.id); } catch { /* Status zeigt den Fehler */ }
        }
      }, 'Erneut versuchen'));
    }
    if (record.status !== 'committed') {
      actions.append(h('button', {
        class: 'nbi-btn ghost small', type: 'button',
        onclick: async () => {
          if (!window.confirm('Diesen Import verwerfen?')) return;
          await adapter.remove(record.id);
        }
      }, 'Verwerfen'));
    }

    const warningCount = (record.allergyWarnings || []).length;

    return h('article', { class: `nbi-card ${busy ? 'busy' : ''}` },
      record.image && record.image.url
        ? h('img', { class: 'nbi-thumb', src: record.image.url, alt: '', loading: 'lazy' })
        : h('div', { class: 'nbi-thumb empty', text: source.type === 'instagram' ? '📸' : '🍲' }),

      h('div', { class: 'nbi-card-body' },
        h('div', { class: 'nbi-card-top' },
          h('h3', { class: 'nbi-card-title', text: parsed.title || record.raw?.title || 'Ohne Titel' }),
          h('span', { class: `nbi-status ${status.tone}`, text: status.label })
        ),
        h('p', { class: 'nbi-card-meta' },
          source.siteName || 'Unbekannte Quelle',
          parsed.servings ? ` · ${parsed.servings} Portionen` : '',
          parsed.timeMinutes ? ` · ${parsed.timeMinutes} min` : '',
          (parsed.ingredients || []).length ? ` · ${parsed.ingredients.length} Zutaten` : '',
          record.createdAt ? ` · ${relativeTime(record.createdAt)}` : ''
        ),
        warningCount
          ? h('p', { class: 'nbi-card-allergy', text: `⚠️ ${warningCount} Allergie-Hinweis${warningCount > 1 ? 'e' : ''}` })
          : null,
        record.status === 'failed' && record.error
          ? h('p', { class: 'nbi-card-error', text: record.error.message })
          : null,
        actions
      )
    );
  }

  function mount(container, adapter, options = {}) {
    const list = h('div', { class: 'nbi-list' });
    const empty = h('div', { class: 'nbi-empty' },
      h('p', { text: 'Noch keine Importe.' }),
      h('p', { class: 'nbi-hint', text: 'Mit dem Nestbau-Clipper eine Rezeptseite oder einen Instagram-Beitrag speichern – oder unten eine Adresse einfügen.' })
    );

    const urlInput = h('input', {
      type: 'url', class: 'nbi-url', placeholder: 'https://... Rezept-Adresse einfügen',
      'aria-label': 'Rezept-Adresse'
    });
    const urlMsg = h('div', { class: 'nbi-msg' });
    const urlBtn = h('button', {
      class: 'nbi-btn primary', type: 'button',
      onclick: async () => {
        const url = urlInput.value.trim();
        urlMsg.className = 'nbi-msg';
        if (!/^https?:\/\//i.test(url)) {
          urlMsg.className = 'nbi-msg err show';
          urlMsg.textContent = 'Bitte eine vollständige http(s)-Adresse einfügen.';
          return;
        }
        urlBtn.disabled = true;
        urlBtn.textContent = 'Wird geladen...';
        try {
          await adapter.importUrl(url);
          urlInput.value = '';
          urlMsg.className = 'nbi-msg ok show';
          urlMsg.textContent = 'Import angelegt.';
        } catch (error) {
          urlMsg.className = 'nbi-msg err show';
          urlMsg.textContent = error && error.message ? error.message : 'Import fehlgeschlagen.';
        } finally {
          urlBtn.disabled = false;
          urlBtn.textContent = 'Importieren';
        }
      }
    }, 'Importieren');

    container.replaceChildren(
      h('div', { class: 'nbi-root' },
        h('div', { class: 'nbi-urlbar' }, urlInput, urlBtn),
        urlMsg,
        list
      )
    );

    const unsubscribe = adapter.listImports((records) => {
      const visible = records.filter((record) => record.status !== 'committed');
      if (!visible.length) {
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...visible.map((record) => renderCard(record, adapter, options)));
      }
      if (options.onCount) options.onCount(visible.filter((r) => r.status === 'ready').length);
    });

    return { destroy: () => { if (unsubscribe) unsubscribe(); container.replaceChildren(); } };
  }

  // ---------------------------------------------------------------- Adapter

  /**
   * Bindet die UI an Firestore + Callable Functions.
   * Erwartet die modularen Firebase-SDK-Funktionen als `sdk`, damit dieses
   * Modul selbst kein Import-Statement braucht (die App laedt das SDK ohnehin).
   */
  function firebaseAdapter({ sdk, db, functions, householdId, getIngredients }) {
    const {
      collection, query, orderBy, limit, onSnapshot, httpsCallable
    } = sdk;

    const importsRef = () => collection(db, 'households', householdId, 'recipeImports');
    const call = (name, data) => httpsCallable(functions, name)(Object.assign({ householdId }, data))
      .then((result) => result.data)
      .catch((error) => { throw new Error(error.message || 'Serverfehler'); });

    return {
      getIngredients,

      listImports(callback) {
        const q = query(importsRef(), orderBy('createdAt', 'desc'), limit(50));
        return onSnapshot(q, (snapshot) => {
          callback(snapshot.docs.map((doc) => {
            const data = doc.data();
            return Object.assign({ id: doc.id }, data, {
              createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null
            });
          }));
        });
      },

      commit: (importId, recipe, createIngredients) => call('commitRecipeImport', { importId, recipe, createIngredients }),
      remove: (importId) => call('deleteRecipeImport', { importId }),
      retry: (importId) => call('retryRecipeImport', { importId }),
      importUrl: (url) => call('importRecipeFromUrl', { url })
    };
  }

  return { mount, firebaseAdapter, computeNutrition, CATEGORIES, UNIT_LABELS, UNIT_GRAMS };
})();

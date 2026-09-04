/* Testdaten fuer demo.html – laesst die Import-Oberflaeche ohne Firebase
   laufen. Nicht deployen; dient zum Ansehen und fuer schnelle UI-Aenderungen. */

(function () {
  'use strict';

  const ingredients = [
    { id: 'i1', name: 'Mehl', nutrition: { basisG: 100, kcal: 348, protein: 10, fat: 1, carbs: 72 }, allergens: ['gluten'] },
    { id: 'i2', name: 'Butter', nutrition: { basisG: 100, kcal: 741, protein: 0.7, fat: 82, carbs: 0.6 }, allergens: ['lactose'] },
    { id: 'i3', name: 'Ei', nutrition: { basisG: 100, kcal: 155, protein: 13, fat: 11, carbs: 1.1 }, allergens: ['eggs'] },
    { id: 'i4', name: 'Zucker', nutrition: { basisG: 100, kcal: 400, protein: 0, fat: 0, carbs: 100 }, allergens: [] },
    { id: 'i5', name: 'Milch', nutrition: { basisG: 100, kcal: 65, protein: 3.3, fat: 3.6, carbs: 4.8 }, allergens: ['lactose'] },
    { id: 'i6', name: 'Zwiebel', nutrition: { basisG: 100, kcal: 40, protein: 1.1, fat: 0.1, carbs: 9.3 }, allergens: [] },
    { id: 'i7', name: 'Olivenöl', nutrition: { basisG: 100, kcal: 884, protein: 0, fat: 100, carbs: 0 }, allergens: [] },
    { id: 'i8', name: 'Salz', nutrition: { basisG: 100, kcal: 0, protein: 0, fat: 0, carbs: 0 }, allergens: [] },
    { id: 'i9', name: 'Haselnüsse', nutrition: { basisG: 100, kcal: 644, protein: 15, fat: 62, carbs: 11 }, allergens: ['nuts'] }
  ];

  const records = [
    {
      id: 'imp1',
      status: 'ready',
      createdAt: Date.now() - 4 * 60 * 1000,
      source: { type: 'web', siteName: 'bettybossi.ch', url: 'https://example.test/nusstorte', author: 'Betty Bossi' },
      raw: { title: 'Engadiner Nusstorte' },
      image: null,
      parsed: {
        title: 'Engadiner Nusstorte',
        description: 'Klassische Bündner Nusstorte mit Karamell und Haselnüssen.',
        servings: 12,
        timeMinutes: 95,
        totalWeightG: null,
        ingredients: [
          { name: 'Mehl', amount: 300, unit: 'g', note: null, raw: '300 g Mehl' },
          { name: 'Butter', amount: 150, unit: 'g', note: 'kalt, in Stücken', raw: '150 g Butter' },
          { name: 'Zucker', amount: 250, unit: 'g', note: null, raw: '250 g Zucker' },
          { name: 'Haselnüsse', amount: 250, unit: 'g', note: 'grob gehackt', raw: '250 g Haselnüsse' },
          { name: 'Rahm', amount: 2, unit: 'dl', note: null, raw: '2 dl Rahm' },
          { name: 'Ei', amount: 1, unit: 'stk', note: 'zum Bestreichen', raw: '1 Ei' }
        ],
        prep: ['Ofen auf 180 Grad vorheizen.', 'Springform mit Backpapier auslegen.'],
        steps: [
          'Mehl, Zucker und Butter zu einem Mürbeteig verarbeiten, 30 Minuten kühl stellen.',
          'Zucker karamellisieren, Rahm zugeben und aufkochen.',
          'Haselnüsse untermischen und abkühlen lassen.',
          'Zwei Drittel des Teigs auswallen, Form auslegen, Füllung einfüllen.',
          'Mit dem restlichen Teig zudecken, mit Ei bestreichen und 45 Minuten backen.'
        ],
        utensils: ['Springform 24 cm', 'Backpapier'],
        notes: 'Schmeckt am zweiten Tag besser.'
      },
      matches: [
        { ingredientId: 'i1', confidence: 1, candidates: [] },
        { ingredientId: 'i2', confidence: 1, candidates: [] },
        { ingredientId: 'i4', confidence: 1, candidates: [] },
        { ingredientId: 'i9', confidence: 0.9, candidates: [{ ingredientId: 'i9', name: 'Haselnüsse', score: 0.9 }] },
        { ingredientId: null, confidence: 0.34, candidates: [{ ingredientId: 'i5', name: 'Milch', score: 0.34 }] },
        { ingredientId: 'i3', confidence: 1, candidates: [] }
      ],
      nutrition: { coverage: 0.82 },
      allergyWarnings: [
        {
          allergen: 'nuts', label: 'Nuesse/Schalenfruechte', certainty: 'confirmed',
          ingredients: ['Haselnüsse'], members: [{ uid: 'u2', displayName: 'Partnerin' }]
        },
        {
          allergen: 'gluten', label: 'Gluten', certainty: 'suspected',
          ingredients: ['Mehl'], members: [{ uid: 'u2', displayName: 'Partnerin' }]
        }
      ],
      categories: ['dessert'],
      parser: { engine: 'jsonld', confidence: 0.95, warnings: ['Foto konnte nicht uebernommen werden: HTTP 403'] }
    },
    {
      id: 'imp2',
      status: 'ready',
      createdAt: Date.now() - 26 * 60 * 1000,
      source: { type: 'instagram', siteName: 'Instagram', url: 'https://instagram.com/p/xyz', author: 'kochenmitkarl' },
      raw: { title: 'One-Pot Pasta' },
      image: null,
      parsed: {
        title: 'One-Pot Pasta mit Zwiebeln',
        description: 'Schnelles Feierabendessen aus einem Topf.',
        servings: 2,
        timeMinutes: 20,
        totalWeightG: null,
        ingredients: [
          { name: 'Zwiebel', amount: 2, unit: 'stk', note: 'in Ringen', raw: '2 Zwiebeln' },
          { name: 'Olivenöl', amount: 2, unit: 'el', note: null, raw: '2 EL Olivenöl' },
          { name: 'Spaghetti', amount: 250, unit: 'g', note: null, raw: '250 g Spaghetti' },
          { name: 'Salz', amount: null, unit: null, note: 'nach Geschmack', raw: 'Salz' }
        ],
        prep: [],
        steps: [
          'Zwiebeln im Öl glasig dünsten.',
          'Spaghetti und 600 ml Wasser zugeben, 11 Minuten offen kochen.',
          'Salzen und sofort servieren.'
        ],
        utensils: ['Grosse Pfanne'],
        notes: ''
      },
      matches: [
        { ingredientId: 'i6', confidence: 0.9, candidates: [] },
        { ingredientId: 'i7', confidence: 1, candidates: [] },
        { ingredientId: null, confidence: 0, candidates: [] },
        { ingredientId: 'i8', confidence: 1, candidates: [] }
      ],
      nutrition: { coverage: 0.4 },
      allergyWarnings: [
        {
          allergen: 'gluten', label: 'Gluten', certainty: 'suspected',
          ingredients: ['Spaghetti'], members: [{ uid: 'u2', displayName: 'Partnerin' }]
        }
      ],
      categories: ['main'],
      parser: {
        engine: 'ai', model: 'claude-opus-5', confidence: 0.72,
        warnings: ['Portionen waren nicht angegeben und wurden aus der Wassermenge geschaetzt.']
      }
    },
    {
      id: 'imp3',
      status: 'parsing',
      createdAt: Date.now() - 20 * 1000,
      source: { type: 'web', siteName: 'chefkoch.de' },
      raw: { title: 'Zürcher Geschnetzeltes' },
      parsed: null, matches: null, allergyWarnings: [], categories: [], parser: null
    },
    {
      id: 'imp4',
      status: 'failed',
      createdAt: Date.now() - 3 * 60 * 60 * 1000,
      source: { type: 'web', siteName: 'kochblog.example' },
      raw: { title: 'Unbekannte Seite' },
      parsed: null, matches: null, allergyWarnings: [], categories: [],
      error: { message: 'KI-Parsing fehlgeschlagen (RateLimitError) – Rohtext bleibt erhalten.' },
      parser: null
    }
  ];

  let listeners = [];
  const notify = () => listeners.forEach((cb) => cb(records));

  const adapter = {
    getIngredients: () => ingredients,
    listImports(callback) {
      listeners.push(callback);
      setTimeout(() => callback(records), 0);
      return () => { listeners = listeners.filter((cb) => cb !== callback); };
    },
    async commit(importId, recipe, createIngredients) {
      const record = records.find((r) => r.id === importId);
      if (record) record.status = 'committed';
      notify();
      console.log('commit', { importId, recipe, createIngredients });
      return { recipeId: 'demo-recipe' };
    },
    async remove(importId) {
      const index = records.findIndex((r) => r.id === importId);
      if (index >= 0) records.splice(index, 1);
      notify();
    },
    async retry(importId) {
      const record = records.find((r) => r.id === importId);
      if (record) record.status = 'parsing';
      notify();
    },
    async importUrl(url) {
      records.unshift({
        id: `imp${Date.now()}`,
        status: 'pending',
        createdAt: Date.now(),
        source: { type: 'web', siteName: new URL(url).hostname, url },
        raw: { title: url },
        parsed: null, matches: null, allergyWarnings: [], categories: [], parser: null
      });
      notify();
    }
  };

  window.NestbauRecipeImport.mount(document.getElementById('app'), adapter, {
    onCommitted: (recipeId) => console.log('uebernommen als', recipeId),
    onCount: (count) => console.log('offene Importe:', count)
  });
})();

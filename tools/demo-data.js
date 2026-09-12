/**
 * Demo-Datensatz fuer die Play-Store-Screenshots.
 *
 * Bewusst kein Zufall und keine Platzhalter wie "Test 1": die Screenshots sollen
 * zeigen, wie die App bei echter Nutzung aussieht. Alle Daten sind relativ zum
 * heutigen Datum berechnet, damit Kalender und Menueplan bei jedem Lauf gefuellt
 * sind. Waehrungsformat der App ist CHF.
 */
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function key(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

const ING = {
  hafer:      { id: "i-hafer",   name: "Haferflocken",  cats: ["staerkebeilagen"], kcal: 372, protein: 13.5, fat: 7,   carbs: 59 },
  banane:     { id: "i-banane",  name: "Banane",        cats: ["obst"],            kcal: 89,  protein: 1.1,  fat: 0.3, carbs: 23 },
  joghurt:    { id: "i-joghurt", name: "Naturjoghurt",  cats: ["milchprodukte"],   kcal: 61,  protein: 3.5,  fat: 3.3, carbs: 4.7 },
  linsen:     { id: "i-linsen",  name: "Rote Linsen",   cats: ["huelsenfruechte"], kcal: 353, protein: 25,   fat: 1.1, carbs: 60 },
  karotte:    { id: "i-karotte", name: "Karotte",       cats: ["gemuese"],         kcal: 41,  protein: 0.9,  fat: 0.2, carbs: 10 },
  kokosmilch: { id: "i-kokos",   name: "Kokosmilch",    cats: ["milchprodukte"],   kcal: 197, protein: 2,    fat: 21,  carbs: 3 },
  poulet:     { id: "i-poulet",  name: "Pouletbrust",   cats: ["gefluegel"],       kcal: 165, protein: 31,   fat: 3.6, carbs: 0 },
  reis:       { id: "i-reis",    name: "Basmatireis",   cats: ["staerkebeilagen"], kcal: 349, protein: 8.1,  fat: 0.9, carbs: 78 },
  brokkoli:   { id: "i-brok",    name: "Brokkoli",      cats: ["gemuese"],         kcal: 34,  protein: 2.8,  fat: 0.4, carbs: 7 },
  olivenoel:  { id: "i-oel",     name: "Olivenöl",     cats: ["oele_fette"],      kcal: 884, protein: 0,    fat: 100, carbs: 0 }
};

const ingredients = Object.values(ING).map(function (i) {
  return {
    id: i.id, name: i.name, categoryIds: i.cats, baseGrams: 100,
    kcal: i.kcal, protein: i.protein, fat: i.fat, carbs: i.carbs,
    aminoAcids: [], vitamins: [], allergyIds: [], iron: 0, minerals: "", fiber: 0,
    description: "", photo: null
  };
});

const recipes = [
  {
    id: "r-porridge", title: "Overnight Oats mit Banane",
    desc: "Am Abend angerührt, am Morgen fertig – reicht für zwei.",
    categories: ["fruehstueck"], time: 10, portions: 2, totalWeight: 520,
    season: null, favorite: true, notes: "", utensils: ["Zwei Gläser", "Löffel"],
    prep: ["Banane in Scheiben schneiden."],
    steps: [
      "Haferflocken und Joghurt verrühren.",
      "Bananenscheiben unterheben.",
      "Über Nacht in den Kühlschrank stellen."
    ],
    ingredients: [
      { ingredientId: "i-hafer", amount: 120, unit: "g" },
      { ingredientId: "i-joghurt", amount: 300, unit: "g" },
      { ingredientId: "i-banane", amount: 1, unit: "stueck" }
    ],
    photo: null
  },
  {
    id: "r-linsen", title: "Rote Linsen mit Kokos",
    desc: "Ein Topf, 25 Minuten, hält sich zwei Tage im Kühlschrank.",
    categories: ["mittagabend"], time: 25, portions: 2, totalWeight: 900,
    season: "herbst", favorite: true, notes: "Mit Reis servieren.",
    utensils: ["Topf", "Schneidebrett"],
    prep: ["Karotten schälen und würfeln."],
    steps: [
      "Karotten in Öl andünsten.",
      "Linsen und Kokosmilch zugeben.",
      "20 Minuten köcheln lassen.",
      "Mit Salz und Kreuzkümmel abschmecken."
    ],
    ingredients: [
      { ingredientId: "i-linsen", amount: 200, unit: "g" },
      { ingredientId: "i-karotte", amount: 250, unit: "g" },
      { ingredientId: "i-kokos", amount: 400, unit: "ml" },
      { ingredientId: "i-oel", amount: 1, unit: "el" }
    ],
    photo: null
  },
  {
    id: "r-poulet", title: "Poulet mit Brokkoli und Reis",
    desc: "Der Standard unter der Woche.",
    categories: ["mittagabend"], time: 30, portions: 2, totalWeight: 800,
    season: null, favorite: false, notes: "", utensils: ["Pfanne", "Topf"],
    prep: ["Reis abwiegen.", "Brokkoli in Röschen teilen."],
    steps: [
      "Reis aufsetzen.",
      "Poulet in der Pfanne anbraten.",
      "Brokkoli acht Minuten dämpfen.",
      "Alles zusammen anrichten."
    ],
    ingredients: [
      { ingredientId: "i-poulet", amount: 300, unit: "g" },
      { ingredientId: "i-reis", amount: 160, unit: "g" },
      { ingredientId: "i-brok", amount: 300, unit: "g" }
    ],
    photo: null
  },
  {
    id: "r-bowl", title: "Joghurt-Bowl mit Beeren",
    desc: "Schneller Snack nach dem Sport.",
    categories: ["snack"], time: 5, portions: 1, totalWeight: 250,
    season: "sommer", favorite: false, notes: "", utensils: ["Schüssel"],
    prep: [],
    steps: ["Joghurt in die Schüssel geben.", "Banane und Haferflocken darüber."],
    ingredients: [
      { ingredientId: "i-joghurt", amount: 200, unit: "g" },
      { ingredientId: "i-banane", amount: 1, unit: "stueck" }
    ],
    photo: null
  }
];

const events = [
  { id: "e-1", title: "Wocheneinkauf", allday: false, date: key(0), start: "17:30", end: "18:30",
    location: "Coop Bahnhof", desc: "", category: "haushalt", assignee: "both", reminder: "30", recur: null },
  { id: "e-2", title: "Zahnarzt", allday: false, date: key(1), start: "09:00", end: "10:00",
    location: "Praxis Dr. Meier", desc: "", category: "privat", assignee: "a", reminder: "1440", recur: null },
  { id: "e-3", title: "Elternabend", allday: false, date: key(2), start: "19:00", end: "21:00",
    location: "Schulhaus Nord", desc: "", category: "schule", assignee: "b", reminder: "1440", recur: null },
  { id: "e-4", title: "Waschtag", allday: true, date: key(3), start: null, end: null,
    location: "", desc: "", category: "haushalt", assignee: "both", reminder: null, recur: "weekly" },
  { id: "e-5", title: "Abgabe Quartalsbericht", allday: false, date: key(5), start: "14:00", end: "15:00",
    location: "", desc: "", category: "arbeit", assignee: "a", reminder: "1440", recur: null },
  { id: "e-6", title: "Brunch bei Sarah", allday: false, date: key(6), start: "11:00", end: "14:00",
    location: "Seestrasse 12", desc: "", category: "privat", assignee: "both", reminder: "10080", recur: null },
  { id: "e-7", title: "Miete überweisen", allday: true, date: key(9), start: null, end: null,
    location: "", desc: "", category: "wichtig", assignee: "a", reminder: "1440", recur: "monthly" }
];

const lists = [
  { id: "l-aufgaben", name: "Aufgaben", kind: "todo", items: [
    { id: "t-1", title: "Bad putzen", assignee: "b", category: "haushalt", done: false, date: key(0), time: null },
    { id: "t-2", title: "Rechnung Krankenkasse einzahlen", assignee: "a", category: "wichtig", done: false, date: key(1), time: null },
    { id: "t-3", title: "Pflanzen giessen", assignee: "both", category: "haushalt", done: true, date: key(0), time: null },
    { id: "t-4", title: "Velo zum Service bringen", assignee: "a", category: "privat", done: false, date: key(4), time: null },
    { id: "t-5", title: "Geschenk für Sarah besorgen", assignee: "b", category: "privat", done: false, date: key(5), time: null }
  ] },
  { id: "l-einkaufen", name: "Einkäufe", kind: "shopping", items: [
    { id: "s-1", title: "Haferflocken (500 g)", assignee: "both", done: false, date: null, time: null, grams: 500 },
    { id: "s-2", title: "Naturjoghurt (1 kg)", assignee: "both", done: false, date: null, time: null, grams: 1000 },
    { id: "s-3", title: "Rote Linsen (400 g)", assignee: "both", done: true, date: null, time: null, grams: 400 },
    { id: "s-4", title: "Waschmittel", assignee: "both", done: false, date: null, time: null }
  ] },
  { id: "l-geschenke", name: "Geschenke", kind: "todo", items: [] },
  { id: "l-haushalt", name: "Haushalt", kind: "todo", items: [
    { id: "h-1", title: "Filter Dunstabzug wechseln", assignee: "both", category: "haushalt", done: false, date: key(7), time: null },
    { id: "h-2", title: "Keller aufräumen", assignee: "both", category: "haushalt", done: false, date: key(12), time: null }
  ] },
  { id: "l-arbeit", name: "Arbeit", kind: "todo", items: [
    { id: "a-1", title: "Quartalsbericht fertigstellen", assignee: "a", category: "arbeit", done: false, date: key(5), time: null }
  ] }
];

const subscriptions = [
  { id: "f-1", name: "Miete", amount: 1850, frequency: "monthly", billingDay: 1, billingMonth: 0, category: "haushalt", assignee: "both" },
  { id: "f-2", name: "Krankenkasse", amount: 412.5, frequency: "monthly", billingDay: 5, billingMonth: 0, category: "versicherung", assignee: "a" },
  { id: "f-3", name: "Handyabo", amount: 39.9, frequency: "monthly", billingDay: 12, billingMonth: 0, category: "abo", assignee: "b" },
  { id: "f-4", name: "Streaming", amount: 17.9, frequency: "monthly", billingDay: 20, billingMonth: 0, category: "abo", assignee: "both" },
  { id: "f-5", name: "Hausratversicherung", amount: 280, frequency: "yearly", billingDay: 15, billingMonth: 2, category: "versicherung", assignee: "both" },
  { id: "f-6", name: "Serafe (Radio/TV)", amount: 335, frequency: "quarterly", billingDay: 10, billingMonth: 0, category: "haushalt", assignee: "both" },
  { id: "f-7", name: "Ferienkasse", amount: 600, frequency: "halbjaehrlich", billingDay: 1, billingMonth: 5, category: "urlaub", assignee: "both" }
];

const menuPlan = {};
[
  [0, { fruehstueck: ["r-porridge"], mittagessen: ["r-poulet"], abendessen: ["r-linsen"], snacks: ["r-bowl"] }],
  [1, { fruehstueck: ["r-porridge"], mittagessen: ["r-linsen"], abendessen: ["r-poulet"], snacks: [] }],
  [2, { fruehstueck: [], mittagessen: ["r-poulet"], abendessen: ["r-linsen"], snacks: ["r-bowl"] }],
  [3, { fruehstueck: ["r-porridge"], mittagessen: [], abendessen: ["r-poulet"], snacks: [] }]
].forEach(function (pair) {
  const day = {};
  Object.keys(pair[1]).forEach(function (slot) {
    day[slot] = pair[1][slot].map(function (id) { return { type: "recipe", id: id, qty: 1 }; });
  });
  menuPlan[key(pair[0])] = day;
});

module.exports = {
  people: { a: { name: "Jonas", color: "flame" }, b: { name: "Lea", color: "teal" } },
  lists: lists,
  activeListId: "l-aufgaben",
  events: events,
  subscriptions: subscriptions,
  ingredients: ingredients,
  ingredientCategories: [],
  ingredientGroups: [],
  recipes: recipes,
  customDishCategories: [],
  menuPlan: menuPlan
};

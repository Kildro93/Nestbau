/**
 * Integrationstests: die App wird in jsdom vollstaendig gebootet und
 * ueber das DOM bedient -- so, wie eine Nutzerin sie bedienen wuerde.
 *
 * Alles JS steckt in einer IIFE in index.html, interne Funktionen sind
 * von aussen nicht erreichbar. Getestet wird deshalb das beobachtbare
 * Verhalten: Rendering, Tab-Wechsel, Formulare, Persistenz.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, realErrors } from "../helpers/load-app.mjs";

const STORAGE_KEY = "nestbau-state-v1";

test("App bootet ohne Laufzeitfehler", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  const errs = realErrors(app.errors);
  assert.deepEqual(errs, [], "Fehler beim Start:\n" + JSON.stringify(errs, null, 2));
});

test("alle fuenf Views und Tabs sind nach dem Start im DOM", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  const views = [...app.document.querySelectorAll(".view")].map((v) => v.id);
  assert.deepEqual(views, [
    "view-heute", "view-aufgaben", "view-kalender", "view-finanzen", "view-kochbuch",
  ]);

  const tabs = [...app.document.querySelectorAll(".tab-btn")].map((b) => b.dataset.view);
  assert.deepEqual(tabs, ["heute", "aufgaben", "kalender", "finanzen", "kochbuch"]);
});

test("genau eine View ist beim Start sichtbar", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  const aktiv = [...app.document.querySelectorAll(".view")].filter((v) => v.classList.contains("active"));
  assert.equal(aktiv.length, 1, "es muss genau eine View aktiv sein");
  assert.equal(aktiv[0].id, "view-heute", "Startansicht soll 'Heute' sein");
});

test("Tab-Wechsel schaltet View und Button-Zustand um", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  for (const ziel of ["aufgaben", "kalender", "finanzen", "kochbuch", "heute"]) {
    await app.click(`.tab-btn[data-view="${ziel}"]`);

    const aktiveViews = [...app.document.querySelectorAll(".view.active")].map((v) => v.id);
    assert.deepEqual(aktiveViews, [`view-${ziel}`], `Wechsel auf "${ziel}" hat die View nicht umgeschaltet`);

    const aktiveTabs = [...app.document.querySelectorAll(".tab-btn.active")].map((b) => b.dataset.view);
    assert.deepEqual(aktiveTabs, [ziel], `Tab-Button "${ziel}" ist nicht als aktiv markiert`);
  }

  assert.deepEqual(realErrors(app.errors), [], "Tab-Wechsel hat Fehler erzeugt");
});

test("Aufgabe anlegen landet in der Liste und im localStorage", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  await app.click('.tab-btn[data-view="aufgaben"]');
  await app.click("#open-task-overlay");

  await app.fill("#task-title", "Testaufgabe Milch kaufen");
  const form = app.document.getElementById("task-form");
  form.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));

  const state = app.readState();
  assert.ok(state, "nach dem Anlegen muss State persistiert sein");

  const alleItems = state.lists.flatMap((l) => l.items || []);
  const gefunden = alleItems.find((i) => i.title === "Testaufgabe Milch kaufen");
  assert.ok(gefunden, "die angelegte Aufgabe steckt nicht im State: " +
    JSON.stringify(alleItems.map((i) => i.title)));

  const sichtbar = app.document.getElementById("task-list").textContent;
  assert.match(sichtbar, /Testaufgabe Milch kaufen/, "die Aufgabe wird nicht in der Liste gerendert");
});

test("Abo anlegen erscheint in Finanzen und aktualisiert die Summen", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  await app.click('.tab-btn[data-view="finanzen"]');

  await app.fill("#sub-name", "Testabo Netflix");
  await app.fill("#sub-amount", "20");
  await app.fill("#sub-frequency", "monthly");

  const form = app.document.getElementById("sub-form");
  form.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));

  const state = app.readState();
  const abo = (state.subscriptions || []).find((s) => s.name === "Testabo Netflix");
  assert.ok(abo, "Abo wurde nicht gespeichert: " + JSON.stringify(state.subscriptions));
  assert.equal(Number(abo.amount), 20);

  const monatlich = app.document.getElementById("fin-monthly").textContent;
  assert.match(monatlich, /20/, `Monatssumme zeigt "${monatlich}", erwartet wurden 20 CHF`);
});

test("Liste anlegen erzeugt eine neue Liste im State", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  await app.click('.tab-btn[data-view="aufgaben"]');
  await app.click("#new-list-btn");
  await app.fill("#new-list-name", "Testliste Garten");

  const form = app.document.getElementById("new-list-form");
  form.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));

  const state = app.readState();
  assert.ok(state.lists.some((l) => l.name === "Testliste Garten"),
    "neue Liste fehlt im State: " + state.lists.map((l) => l.name).join(", "));
});

test("gespeicherter State wird beim Neustart wieder geladen", async (t) => {
  const vorbereitet = {
    people: { a: { name: "Ich", color: "flame" }, b: { name: "Partnerin", color: "teal" } },
    lists: [{ id: "l-1", name: "Wiederhergestellt", kind: "todo", items: [
      { id: "i-1", title: "Persistierte Aufgabe", done: false, assignee: "a" },
    ] }],
    activeListId: "l-1",
    events: [], subscriptions: [], ingredients: [], ingredientCategories: [],
    ingredientGroups: [], recipes: [], menuPlan: {},
  };
  const app = await loadApp({ state: vorbereitet });
  t.after(() => app.teardown());

  await app.click('.tab-btn[data-view="aufgaben"]');
  const text = app.document.getElementById("task-list").textContent;
  assert.match(text, /Persistierte Aufgabe/, "vorhandener localStorage-State wurde nicht uebernommen");
});

test("beschaedigter localStorage-Inhalt legt die App nicht lahm", async (t) => {
  // Regressionsschutz: ein halb geschriebener Eintrag darf nicht zum Totalausfall fuehren.
  const app = await loadApp();
  t.after(() => app.teardown());

  app.window.localStorage.setItem(STORAGE_KEY, "{kaputt-kein-json");
  const zweite = await loadApp({ url: "http://localhost:3000/index.html" });
  t.after(() => zweite.teardown());
  zweite.window.localStorage.setItem(STORAGE_KEY, "{kaputt-kein-json");

  const dritte = await loadApp();
  t.after(() => dritte.teardown());
  assert.ok(dritte.document.querySelector(".view.active"), "App rendert nach kaputtem State keine View mehr");
});

test("Einstellungen-Overlay laesst sich oeffnen und schliessen", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  const overlay = app.document.getElementById("settings-overlay");
  assert.ok(overlay, "settings-overlay fehlt");

  // Die App steuert Overlays ueber style.display, nicht ueber eine CSS-Klasse.
  await app.click("#close-settings"); // definierter Ausgangszustand
  assert.equal(overlay.style.display, "none");

  await app.click("#open-settings");
  assert.equal(overlay.style.display, "flex", "Overlay oeffnet sich nicht");

  await app.click("#close-settings");
  assert.equal(overlay.style.display, "none", "Overlay laesst sich nicht schliessen");
});

test("Backup-Export liefert den vollstaendigen State als JSON", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  await app.click('.tab-btn[data-view="aufgaben"]');
  await app.click("#open-task-overlay");
  await app.fill("#task-title", "Backup-Kandidat");
  app.document.getElementById("task-form")
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));

  const roh = app.window.localStorage.getItem(STORAGE_KEY);
  assert.ok(roh, "kein State zum Exportieren");

  const wieder = JSON.parse(roh);
  assert.ok(wieder.lists.flatMap((l) => l.items || []).some((i) => i.title === "Backup-Kandidat"),
    "der Export enthaelt die neue Aufgabe nicht -- Sicherung waere unvollstaendig");
});

test("kein Tab-Wechsel erzeugt Konsolenfehler", async (t) => {
  const app = await loadApp();
  t.after(() => app.teardown());

  for (const ziel of ["heute", "aufgaben", "kalender", "finanzen", "kochbuch"]) {
    await app.click(`.tab-btn[data-view="${ziel}"]`);
  }
  const errs = realErrors(app.errors);
  assert.deepEqual(errs, [], "Fehler beim Durchklicken:\n" + JSON.stringify(errs, null, 2));
});

// Nestbau Rezept-Clipper – Service Worker.
//
// Haelt Token und Endpunkt, injiziert den passenden Extraktor und schickt das
// Ergebnis an die Cloud Function. Das Token liegt bewusst NUR hier (und nicht
// im Content-Script), damit eine kompromittierte Website es nicht auslesen kann.

const DEFAULTS = {
  endpoint: 'https://europe-west1-nestbau-app.cloudfunctions.net/clipRecipe',
  appUrl: 'https://nestbau-app.web.app'
};

const MENU_ID = 'nestbau-save-recipe';

// ------------------------------------------------------------------ Config

async function getConfig() {
  const stored = await chrome.storage.local.get(['endpoint', 'appUrl', 'token', 'householdId', 'label']);
  return {
    endpoint: stored.endpoint || DEFAULTS.endpoint,
    appUrl: stored.appUrl || DEFAULTS.appUrl,
    token: stored.token || '',
    householdId: stored.householdId || null,
    label: stored.label || ''
  };
}

async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

// ----------------------------------------------------------------- Anzeige

function notify(title, message, isError) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: String(message || '').slice(0, 300),
    priority: isError ? 2 : 0
  });
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// -------------------------------------------------------------- Extraktion

function extractorFor(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      return 'content/extract-instagram.js';
    }
  } catch { /* ungueltige URL -> Standard-Extraktor */ }
  return 'content/extract-web.js';
}

function isClippable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * Liest die aktive Seite aus und schickt sie an Nestbau.
 * Gibt immer ein Ergebnisobjekt zurueck statt zu werfen – der Popup soll
 * jeden Fehler im Klartext anzeigen koennen.
 */
async function clipTab(tab) {
  const config = await getConfig();

  if (!config.token) {
    return { ok: false, code: 'not_paired', error: 'Noch nicht mit Nestbau verbunden.' };
  }
  if (!tab || !isClippable(tab.url)) {
    return { ok: false, code: 'bad_page', error: 'Diese Seite kann nicht gelesen werden.' };
  }

  let payload;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [extractorFor(tab.url)]
    });
    payload = injection && injection.result;
  } catch (error) {
    return { ok: false, code: 'inject_failed', error: `Seite nicht lesbar: ${error.message}` };
  }

  if (!payload || (!payload.text && !(payload.jsonLd || []).length)) {
    return {
      ok: false,
      code: 'empty',
      error: payload && payload.sourceType === 'instagram'
        ? 'Keine Caption gefunden. Beitrag ganz oeffnen und kurz warten, dann erneut versuchen.'
        : 'Auf dieser Seite wurde kein Rezepttext gefunden.'
    };
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // 401 heisst: Token getrennt oder abgelaufen -> lokal aufraeumen,
      // sonst versucht der Nutzer es zehnmal mit demselben toten Token.
      if (response.status === 401) await chrome.storage.local.remove('token');
      return {
        ok: false,
        code: response.status === 401 ? 'not_paired' : 'server',
        error: body.error || `Serverfehler (HTTP ${response.status}).`
      };
    }

    return {
      ok: true,
      importId: body.importId,
      title: payload.title || body.title || 'Rezept',
      structured: Boolean(payload.hasStructuredData),
      appUrl: config.appUrl
    };
  } catch (error) {
    return { ok: false, code: 'network', error: `Keine Verbindung zu Nestbau: ${error.message}` };
  }
}

// ------------------------------------------------------------- Kontextmenue

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Rezept zu Nestbau speichern',
      contexts: ['page', 'selection', 'image', 'link']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const result = await clipTab(tab);
  if (result.ok) {
    await flashBadge('OK', '#1c7d70');
    notify('Rezept gespeichert', `"${result.title}" wird in Nestbau verarbeitet.`, false);
  } else {
    await flashBadge('!', '#b5342a');
    notify('Import fehlgeschlagen', result.error, true);
  }
});

// ---------------------------------------------------------------- Messaging

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'clip') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await clipTab(tab);
      if (result.ok) await flashBadge('OK', '#1c7d70');
      sendResponse(result);
    })();
    return true;   // asynchrone Antwort
  }

  if (message.type === 'getStatus') {
    (async () => {
      const config = await getConfig();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse({
        paired: Boolean(config.token),
        label: config.label,
        appUrl: config.appUrl,
        endpoint: config.endpoint,
        pageUrl: tab ? tab.url : null,
        pageTitle: tab ? tab.title : null,
        clippable: Boolean(tab && isClippable(tab.url)),
        instagram: Boolean(tab && isClippable(tab.url) && extractorFor(tab.url).includes('instagram'))
      });
    })();
    return true;
  }

  if (message.type === 'setConfig') {
    (async () => {
      const patch = {};
      if (typeof message.endpoint === 'string') patch.endpoint = message.endpoint.trim();
      if (typeof message.appUrl === 'string') patch.appUrl = message.appUrl.trim().replace(/\/+$/, '');
      if (typeof message.token === 'string') patch.token = message.token.trim();
      if (typeof message.label === 'string') patch.label = message.label.trim();
      await setConfig(patch);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'unpair') {
    (async () => {
      await chrome.storage.local.remove(['token', 'householdId', 'label']);
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

/**
 * Token-Uebergabe von der Nestbau-Web-App (Seite /clipper-connect.html).
 * Nur Origins aus externally_connectable im Manifest koennen hier landen –
 * eine beliebige Website kann der Extension also kein Token unterschieben.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'nestbau-clipper-pair') {
    sendResponse({ ok: false, error: 'Unbekannte Nachricht.' });
    return false;
  }

  const token = String(message.token || '').trim();
  if (!token.startsWith('nb1_')) {
    sendResponse({ ok: false, error: 'Ungueltiges Token.' });
    return false;
  }

  (async () => {
    const patch = { token, label: String(message.label || 'Browser').slice(0, 60) };
    if (message.householdId) patch.householdId = String(message.householdId).slice(0, 60);
    if (message.endpoint) patch.endpoint = String(message.endpoint).slice(0, 400);
    if (sender && sender.origin) patch.appUrl = sender.origin;
    await setConfig(patch);
    await flashBadge('OK', '#1c7d70');
    notify('Nestbau verbunden', 'Der Clipper ist jetzt mit deinem Haushalt verknuepft.', false);
    sendResponse({ ok: true });
  })();
  return true;
});

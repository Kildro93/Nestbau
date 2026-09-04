// Nestbau Rezept-Clipper – Popup-Logik.
// Enthaelt bewusst keine Netzwerk- oder Token-Logik: alles laeuft ueber
// Nachrichten an den Service Worker, damit das Token nie in ein Fenster
// gelangt, das eine Website beeinflussen koennte.

const el = (id) => document.getElementById(id);

const saveBtn = el('saveBtn');
const connectBtn = el('connectBtn');
const msg = el('msg');

let status = null;

function showMessage(text, kind, linkUrl, linkText) {
  msg.className = `msg show ${kind}`;
  msg.textContent = text;
  if (linkUrl) {
    msg.append(' ');
    const link = document.createElement('a');
    link.href = linkUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = linkText || 'In Nestbau oeffnen';
    msg.append(link);
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function render() {
  el('pageTitle').textContent = status.pageTitle || 'Unbenannte Seite';
  el('pageHost').textContent = hostOf(status.pageUrl) || 'Keine Webseite';
  el('deviceLabel').textContent = status.paired ? (status.label || 'verbunden') : 'nicht verbunden';

  const tag = el('pageTag');
  if (status.instagram) {
    tag.hidden = false;
    tag.className = 'tag insta';
    tag.textContent = 'Instagram – Caption wird per KI gelesen';
  } else if (status.clippable) {
    tag.hidden = false;
    tag.className = 'tag';
    tag.textContent = 'Website';
  } else {
    tag.hidden = true;
  }

  if (!status.paired) {
    saveBtn.hidden = true;
    connectBtn.hidden = false;
    showMessage('Noch nicht verbunden. In Nestbau unter Einstellungen > Rezept-Clipper ein Geraet hinzufuegen.', 'err');
    return;
  }

  connectBtn.hidden = true;
  saveBtn.hidden = false;
  saveBtn.disabled = !status.clippable;
  if (!status.clippable) showMessage('Diese Seite kann nicht gelesen werden.', 'err');
}

async function load() {
  status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  render();
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span>Wird gesendet...';
  msg.className = 'msg';

  const result = await chrome.runtime.sendMessage({ type: 'clip' });

  saveBtn.textContent = 'Rezept speichern';
  saveBtn.disabled = false;

  if (result.ok) {
    saveBtn.textContent = 'Nochmal speichern';
    showMessage(
      result.structured
        ? 'Gespeichert. Die Seite lieferte strukturierte Rezeptdaten.'
        : 'Gespeichert. Der Text wird per KI aufbereitet.',
      'ok',
      `${result.appUrl}/#/kochbuch/importe`,
      'Importe oeffnen'
    );
  } else {
    showMessage(result.error, 'err');
    if (result.code === 'not_paired') {
      saveBtn.hidden = true;
      connectBtn.hidden = false;
    }
  }
});

connectBtn.addEventListener('click', async () => {
  const config = await chrome.runtime.sendMessage({ type: 'getStatus' });
  chrome.tabs.create({ url: `${config.appUrl}/clipper-connect.html` });
  window.close();
});

el('optionsLink').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();

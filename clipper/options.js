// Nestbau Rezept-Clipper – Einstellungen.

const el = (id) => document.getElementById(id);
const msg = el('msg');

function show(text, kind) {
  msg.className = `msg show ${kind}`;
  msg.textContent = text;
}

async function load() {
  const status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  el('endpoint').value = status.endpoint || '';
  el('appUrl').value = status.appUrl || '';
  el('label').value = status.label || '';
  el('token').value = status.paired ? '\u2022'.repeat(24) : '';
  el('token').dataset.masked = status.paired ? '1' : '';
}

el('token').addEventListener('focus', (event) => {
  // Den Platzhalter beim ersten Klick leeren, statt ihn versehentlich zu speichern.
  if (event.target.dataset.masked === '1') {
    event.target.value = '';
    event.target.dataset.masked = '';
  }
});

el('saveBtn').addEventListener('click', async () => {
  const patch = {
    type: 'setConfig',
    endpoint: el('endpoint').value.trim(),
    appUrl: el('appUrl').value.trim(),
    label: el('label').value.trim()
  };

  const token = el('token').value.trim();
  if (token && el('token').dataset.masked !== '1') {
    if (!token.startsWith('nb1_')) {
      show('Das Token muss mit "nb1_" beginnen.', 'err');
      return;
    }
    patch.token = token;
  }

  if (patch.endpoint && !/^https:\/\//i.test(patch.endpoint)) {
    show('Der Endpunkt muss mit https:// beginnen.', 'err');
    return;
  }

  await chrome.runtime.sendMessage(patch);
  await load();
  show('Gespeichert.', 'ok');
});

el('unpairBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'unpair' });
  await load();
  show('Verbindung getrennt. Das Geraet kann in Nestbau zusaetzlich entfernt werden.', 'ok');
});

load();

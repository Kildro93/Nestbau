'use strict';

// Nestbau v2.0 – Foto-Uebernahme fuer importierte Rezepte.
//
// Das Bild wird SERVERSEITIG geholt, nicht im Browser des Nutzers. Damit
// funktioniert der Import auch bei Hotlink-Sperren und die Datei liegt danach
// im eigenen Storage statt als Fremd-URL, die morgen tot ist.
//
// Serverseitiges Laden einer vom Nutzer gelieferten URL ist ein klassisches
// SSRF-Loch: ohne Pruefung koennte man die Function dazu bringen, interne
// Metadata-Endpunkte (169.254.169.254) abzurufen. Deshalb unten die
// IP-Pruefung – und zwar bei JEDEM Redirect erneut.

const dns = require('dns').promises;
const net = require('net');
const { admin } = require('./common');

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const USER_AGENT = 'NestbauRecipeImporter/1.0 (+https://github.com/Kildro93/Nestbau)';

function ipv4ToLong(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIPv4(ip) {
  const value = ipv4ToLong(ip);
  const inRange = (cidr, bits) => (value >>> (32 - bits)) === (ipv4ToLong(cidr) >>> (32 - bits));
  return inRange('0.0.0.0', 8)          // "dieses" Netz
    || inRange('10.0.0.0', 8)
    || inRange('100.64.0.0', 10)        // CGNAT
    || inRange('127.0.0.0', 8)
    || inRange('169.254.0.0', 16)       // Link-local / Cloud-Metadata
    || inRange('172.16.0.0', 12)
    || inRange('192.0.0.0', 24)
    || inRange('192.168.0.0', 16)
    || inRange('198.18.0.0', 15)
    || inRange('224.0.0.0', 4)          // Multicast
    || inRange('240.0.0.0', 4);         // reserviert
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4-mapped (::ffff:10.0.0.1) faellt sonst durch das IPv4-Raster
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    const isPrivate = net.isIPv4(hostname) ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname);
    if (isPrivate) throw new Error(`Interne Adresse blockiert: ${hostname}`);
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Host nicht aufloesbar: ${hostname}`);
  }
  if (!addresses.length) throw new Error(`Host nicht aufloesbar: ${hostname}`);

  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) throw new Error(`Interne Adresse blockiert: ${hostname}`);
  }
}

/**
 * Laedt ein Bild von einer oeffentlichen URL herunter.
 * Gibt { buffer, contentType, extension, bytes } zurueck oder wirft.
 */
async function fetchImageSafely(rawUrl) {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let url;
    try {
      url = new URL(current);
    } catch {
      throw new Error('Ungueltige Bild-URL.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Nur http(s)-Bild-URLs werden geladen.');
    }

    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect ohne Ziel.');
      current = new URL(location, url).toString();   // naechster Hop wird erneut geprueft
      continue;
    }

    if (!response.ok) throw new Error(`Bild-Download fehlgeschlagen (HTTP ${response.status}).`);

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extension = ALLOWED_TYPES[contentType];
    if (!extension) throw new Error(`Nicht unterstuetzter Bildtyp: ${contentType || 'unbekannt'}`);

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > MAX_BYTES) throw new Error('Bild ist groesser als 8 MB.');

    const buffer = Buffer.from(await response.arrayBuffer());
    // Content-Length ist nur eine Behauptung – die echte Groesse zaehlt.
    if (buffer.length > MAX_BYTES) throw new Error('Bild ist groesser als 8 MB.');
    if (buffer.length < 512) throw new Error('Bild ist leer oder beschaedigt.');

    return { buffer, contentType, extension, bytes: buffer.length };
  }

  throw new Error('Zu viele Weiterleitungen beim Bild-Download.');
}

/**
 * Legt das Bild im Storage ab und gibt Pfad + direkt nutzbare URL zurueck.
 * Der Download-Token macht die Datei ueber die Firebase-SDK-URL lesbar,
 * ohne den Bucket oeffentlich zu schalten.
 */
async function storeImage(storagePath, buffer, contentType) {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const token = require('crypto').randomUUID();

  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'public, max-age=604800',
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });

  const encoded = encodeURIComponent(storagePath);
  return {
    path: storagePath,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`
  };
}

/** Kopiert ein bereits importiertes Bild an seinen endgueltigen Rezept-Pfad. */
async function copyImage(fromPath, toPath) {
  const bucket = admin.storage().bucket();
  const token = require('crypto').randomUUID();

  await bucket.file(fromPath).copy(bucket.file(toPath));
  await bucket.file(toPath).setMetadata({
    metadata: { firebaseStorageDownloadTokens: token }
  });

  const encoded = encodeURIComponent(toPath);
  return {
    path: toPath,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`
  };
}

async function deleteImage(storagePath) {
  if (!storagePath) return;
  try {
    await admin.storage().bucket().file(storagePath).delete();
  } catch (error) {
    // Fehlende Datei ist kein Fehler – Aufraeumen darf nie den Ablauf stoppen.
    if (error.code !== 404) throw error;
  }
}

module.exports = { fetchImageSafely, storeImage, copyImage, deleteImage, MAX_BYTES, ALLOWED_TYPES };

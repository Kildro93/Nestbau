// Erzeugt die drei Extension-Icons (Nestbau-Tuerkis mit weissem "N").
// Aufruf:  node make-icons.js
// Bewusst ohne Abhaengigkeiten – PNG wird direkt geschrieben.

const fs = require('fs');
const zlib = require('zlib');

const BG = [28, 125, 112];      // #1c7d70
const FG = [255, 255, 255];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Deckungsgrad des "N"-Glyphs an Position (x, y), 0..1 – mit weicher Kante.
function glyphAlpha(x, y, size) {
  const pad = size * 0.24;
  const w = size - 2 * pad;
  const stroke = Math.max(1.6, size * 0.115);
  const half = stroke / 2;
  const u = x - pad;
  const v = y - pad;
  if (u < -half || u > w + half || v < -half || v > w + half) return 0;

  const soft = (distance) => Math.max(0, Math.min(1, (half - distance) / Math.max(0.7, size * 0.02) + 0.5));

  const left = soft(Math.abs(u - half));
  const right = soft(Math.abs(u - (w - half)));
  // Diagonale von links oben nach rechts unten
  const dx = w - stroke;
  const dy = w;
  const t = Math.max(0, Math.min(1, ((u - half) * dx + v * dy) / (dx * dx + dy * dy)));
  const diagonal = soft(Math.hypot(u - half - t * dx, v - t * dy));

  return Math.max(left, right, diagonal);
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;                         // Filter "none"
    for (let x = 0; x < size; x++) {
      const a = glyphAlpha(x + 0.5, y + 0.5, size);
      for (let c = 0; c < 3; c++) raw[offset++] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
      raw[offset++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [16, 48, 128]) {
  fs.writeFileSync(`${__dirname}/icon${size}.png`, makePng(size));
  console.log(`icon${size}.png geschrieben`);
}

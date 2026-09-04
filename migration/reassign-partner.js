#!/usr/bin/env node
'use strict';

/**
 * Nachtrag zur Migration: alle Eintraege mit assignee "pending:b" auf die echte
 * UID der zweiten Person umschreiben.
 *
 * Ablauf: zuerst migrieren (ohne --partner-uid), dann die zweite Person ueber die
 * App einladen, und sobald sie beigetreten ist:
 *
 *   node reassign-partner.js --household <hid> --partner-uid <uid>
 *
 * Betrifft: Aufgabenpositionen, Termine, Abos - ueberall dort steht ein assignee.
 */

const admin = require('firebase-admin');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--household': args.householdId = next(); break;
      case '--partner-uid': args.partnerUid = next(); break;
      case '--from': args.from = next(); break;
      case '--project': args.projectId = next(); break;
      case '--dry-run': args.dryRun = true; break;
      case '--emulator': args.emulator = true; break;
      default: throw new Error(`Unbekannte Option: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.householdId || !args.partnerUid) {
    console.error('Aufruf: node reassign-partner.js --household <hid> --partner-uid <uid> [--dry-run]');
    process.exit(1);
  }
  const from = args.from || 'pending:b';

  if (args.emulator) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  }

  admin.initializeApp({ projectId: args.projectId || process.env.GOOGLE_CLOUD_PROJECT });
  const db = admin.firestore();
  const hid = args.householdId;

  const hh = await db.doc(`households/${hid}`).get();
  if (!hh.exists) { console.error(`Haushalt ${hid} existiert nicht.`); process.exit(1); }
  if (!(hh.get('memberUids') || []).includes(args.partnerUid)) {
    console.error('Diese UID ist kein Mitglied des Haushalts. Zuerst die Einladung annehmen lassen.');
    process.exit(1);
  }

  const targets = [];

  // Aufgaben liegen je Liste in einer eigenen Unterkollektion.
  const lists = await db.collection(`households/${hid}/lists`).get();
  for (const list of lists.docs) {
    const items = await list.ref.collection('items').where('assignee', '==', from).get();
    items.docs.forEach((d) => targets.push(d.ref));
  }
  for (const name of ['events', 'subscriptions']) {
    const snap = await db.collection(`households/${hid}/${name}`).where('assignee', '==', from).get();
    snap.docs.forEach((d) => targets.push(d.ref));
  }

  console.log(`[reassign] ${targets.length} Dokument(e) mit assignee "${from}"`);
  if (args.dryRun) {
    targets.slice(0, 20).forEach((r) => console.log('  ' + r.path));
    if (targets.length > 20) console.log(`  ... und ${targets.length - 20} weitere`);
    console.log('[reassign] Probelauf - nichts geschrieben.');
    await admin.app().delete();
    return;
  }

  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    targets.slice(i, i + 400).forEach((ref) => batch.update(ref, { assignee: args.partnerUid }));
    await batch.commit();
  }

  // legacyKey am Mitgliedsdokument nachziehen, damit klar bleibt, wer "Partnerin" war.
  await db.doc(`households/${hid}/members/${args.partnerUid}`)
    .set({ legacyKey: 'b' }, { merge: true });

  console.log(`[reassign] fertig: ${targets.length} Dokument(e) auf ${args.partnerUid} umgeschrieben.`);
  await admin.app().delete();
}

main().catch((err) => {
  console.error('Fehlgeschlagen:', err.message);
  process.exit(1);
});

'use strict';

// Geplante Aufraeumjobs. Halten Kosten und Datenbestand klein.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');

const { db, REGION, now } = require('../lib/common');

const TZ = 'Europe/Zurich';

/** Abgelaufene Einladungen schliessen und das Token-Hash entfernen. */
exports.cleanupExpiredInvites = onSchedule(
  { region: REGION, schedule: 'every day 03:15', timeZone: TZ },
  async () => {
    const snap = await db.collectionGroup('invites')
      .where('status', '==', 'pending')
      .where('expiresAt', '<=', new Date())
      .limit(400)
      .get();

    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, {
      status: 'expired', tokenHash: null, updatedAt: now(),
    }));
    await batch.commit();
    logger.info('Abgelaufene Einladungen geschlossen', { count: snap.size });
  }
);

/** Gelesene Hinweise nach 60 Tagen entfernen. */
exports.pruneNotifications = onSchedule(
  { region: REGION, schedule: 'every sunday 04:00', timeZone: TZ },
  async () => {
    const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    const snap = await db.collectionGroup('notifications')
      .where('createdAt', '<=', cutoff)
      .limit(500)
      .get();

    const stale = snap.docs.filter((d) => d.get('read') === true);
    if (!stale.length) return;
    const batch = db.batch();
    stale.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    logger.info('Alte Hinweise entfernt', { count: stale.length });
  }
);

/**
 * Verwaiste Haushalte (letztes Mitglied hat das Konto geloescht) nach 30 Tagen
 * endgueltig entfernen. Die Frist gibt Zeit fuer ein Support-Anliegen.
 */
exports.purgeOrphanedHouseholds = onSchedule(
  { region: REGION, schedule: 'every monday 04:30', timeZone: TZ },
  async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const snap = await db.collection('households')
      .where('status', '==', 'orphaned')
      .where('updatedAt', '<=', cutoff)
      .limit(20)
      .get();

    for (const doc of snap.docs) {
      await db.recursiveDelete(doc.ref);
      logger.warn('Verwaisten Haushalt geloescht', { hid: doc.id });
    }
  }
);

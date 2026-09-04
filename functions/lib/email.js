'use strict';

// Email-Versand ueber SendGrid. Ohne gesetzten API-Key wird nur geloggt,
// damit der Emulator und lokale Tests ohne Zugangsdaten laufen.

const sgMail = require('@sendgrid/mail');
const logger = require('firebase-functions/logger');

const BRAND = {
  teal: '#1c7d70',
  olive: '#4a6741',
  amber: '#8a5f22',
  maroon: '#b5342a',
  ink: '#2c2a26',
  paper: '#faf7f2',
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function layout({ heading, intro, buttonLabel, buttonUrl, footnote }) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:${BRAND.paper};font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:${BRAND.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e7e1d7;">
    <tr><td style="background:${BRAND.teal};padding:20px 24px;color:#fff;font-size:20px;font-weight:700;">Nestbau</td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 12px;font-size:19px;color:${BRAND.olive};">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">${intro}</p>
      ${buttonUrl ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(buttonUrl)}"
        style="display:inline-block;background:${BRAND.teal};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:15px;">${escapeHtml(buttonLabel)}</a></p>
      <p style="margin:0 0 16px;font-size:12px;color:#7a7268;word-break:break-all;">Falls der Button nicht funktioniert: ${escapeHtml(buttonUrl)}</p>` : ''}
      ${footnote ? `<p style="margin:0;font-size:12px;color:#7a7268;">${escapeHtml(footnote)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f4efe7;font-size:12px;color:#7a7268;">Nestbau - Haushalt. Aufgaben. Rezepte.</td></tr>
  </table>
</body></html>`;
}

async function send({ apiKey, from, to, subject, html, text }) {
  if (!apiKey) {
    logger.warn('Kein SENDGRID_API_KEY gesetzt - Email wird nur geloggt.', { to, subject });
    return { skipped: true };
  }
  sgMail.setApiKey(apiKey);
  await sgMail.send({ to, from, subject, html, text: text || subject });
  return { skipped: false };
}

const templates = {
  verifyEmail: ({ link, name }) => ({
    subject: 'Bestaetige deine Nestbau-Adresse',
    html: layout({
      heading: `Willkommen bei Nestbau${name ? ', ' + escapeHtml(name) : ''}`,
      intro: 'Noch ein Klick, dann ist dein Konto aktiv und du kannst deinen Haushalt einrichten.',
      buttonLabel: 'Email bestaetigen',
      buttonUrl: link,
      footnote: 'Der Link ist 24 Stunden gueltig. Wenn du dich nicht registriert hast, ignoriere diese Nachricht.',
    }),
  }),

  invite: ({ link, householdName, inviterName, expiresInDays }) => ({
    subject: `${inviterName} laedt dich zu "${householdName}" ein`,
    html: layout({
      heading: 'Einladung in einen Haushalt',
      intro: `<strong>${escapeHtml(inviterName)}</strong> moechte den Haushalt <strong>${escapeHtml(householdName)}</strong> mit dir teilen: Aufgaben, Kalender, Finanzen und das Kochbuch.`,
      buttonLabel: 'Einladung annehmen',
      buttonUrl: link,
      footnote: `Die Einladung laeuft in ${expiresInDays} Tagen ab. Deine Gesundheitsdaten und Allergien bleiben privat - geteilt wird nur, was du selbst freigibst.`,
    }),
  }),

  passwordReset: ({ link }) => ({
    subject: 'Nestbau-Passwort zuruecksetzen',
    html: layout({
      heading: 'Passwort zuruecksetzen',
      intro: 'Setze hier ein neues Passwort. Wenn die Anfrage nicht von dir kam, passiert ohne Klick nichts.',
      buttonLabel: 'Neues Passwort setzen',
      buttonUrl: link,
      footnote: 'Der Link ist 1 Stunde gueltig.',
    }),
  }),

  memberJoined: ({ memberName, householdName }) => ({
    subject: `${memberName} ist "${householdName}" beigetreten`,
    html: layout({
      heading: 'Neues Mitglied',
      intro: `<strong>${escapeHtml(memberName)}</strong> hat die Einladung zu <strong>${escapeHtml(householdName)}</strong> angenommen.`,
      footnote: 'Du kannst Rollen jederzeit in den Haushalts-Einstellungen aendern.',
    }),
  }),
};

module.exports = { send, templates, layout, BRAND };

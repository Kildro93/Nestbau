'use strict';

// Nestbau v2.0 - Cloud Functions (Node 20, firebase-functions v6, Region europe-west1)
//
// Deploy:            firebase deploy --only functions
// Einzeln:           firebase deploy --only functions:inviteToHousehold
// Secrets vorher:    firebase functions:secrets:set SENDGRID_API_KEY
//                    firebase functions:secrets:set TOKEN_ENC_KEY
//                    firebase functions:secrets:set GOOGLE_CLIENT_ID
//                    firebase functions:secrets:set GOOGLE_CLIENT_SECRET
//                    firebase functions:secrets:set MS_CLIENT_ID
//                    firebase functions:secrets:set MS_CLIENT_SECRET

const { setGlobalOptions } = require('firebase-functions/v2');
const { REGION } = require('./lib/common');

setGlobalOptions({
  region: REGION,
  maxInstances: 10,     // Kostenbremse: die App hat wenige Nutzer, aber Bugs skalieren gern
  memory: '256MiB',
  timeoutSeconds: 60,
});

const users = require('./src/users');
const household = require('./src/household');
const storage = require('./src/storage');
const allergies = require('./src/allergies');
const tokens = require('./src/tokens');
const maintenance = require('./src/maintenance');
const recipeImport = require('./lib/recipeImport');

// ---- Konto ----
exports.onUserCreated = users.onUserCreated;
exports.onUserDeleted = users.onUserDeleted;
exports.resendVerificationEmail = users.resendVerificationEmail;
exports.updateDisplayProfile = users.updateDisplayProfile;
exports.deleteAccount = users.deleteAccount;

// ---- Haushalt ----
exports.createHousehold = household.createHousehold;
exports.inviteToHousehold = household.inviteToHousehold;
exports.acceptInvite = household.acceptInvite;
exports.revokeInvite = household.revokeInvite;
exports.setMemberRole = household.setMemberRole;
exports.removeMember = household.removeMember;

// ---- Storage ----
exports.validateUpload = storage.validateUpload;
exports.onRecipeDeleted = storage.onRecipeDeleted;
exports.onIngredientDeleted = storage.onIngredientDeleted;

// ---- Allergien / Menueplan ----
exports.aggregateRecipeAllergens = allergies.aggregateRecipeAllergens;
exports.syncAllergyMirror = allergies.syncAllergyMirror;
exports.checkMenuPlanAllergies = allergies.checkMenuPlanAllergies;

// ---- Kalender-Tokens (fuer Bot 3) ----
exports.connectCalendar = tokens.connectCalendar;
exports.disconnectCalendar = tokens.disconnectCalendar;

// ---- Wartung ----
exports.cleanupExpiredInvites = maintenance.cleanupExpiredInvites;
exports.pruneNotifications = maintenance.pruneNotifications;
exports.purgeOrphanedHouseholds = maintenance.purgeOrphanedHouseholds;

// ---- Rezept-Import (Web Clipper) ----
exports.clipRecipe = recipeImport.clipRecipe;
exports.processRecipeImport = recipeImport.processRecipeImport;
exports.importRecipeFromUrl = recipeImport.importRecipeFromUrl;
exports.retryRecipeImport = recipeImport.retryRecipeImport;
exports.commitRecipeImport = recipeImport.commitRecipeImport;
exports.deleteRecipeImport = recipeImport.deleteRecipeImport;
exports.createClipperToken = recipeImport.createClipperToken;
exports.listClipperDevices = recipeImport.listClipperDevices;
exports.revokeClipperDevice = recipeImport.revokeClipperDevice;

// Serverseitiger Helfer, kein HTTP-Endpunkt: von Sync-Jobs importieren mit
//   const { getValidAccessToken } = require('./src/tokens');
module.exports.internal = { getValidAccessToken: tokens.getValidAccessToken };

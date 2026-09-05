# Phase 3: OAuth Integration – Status Dashboard

**Datum:** 2026-09-05  
**Status:** 🟡 In Progress – Waiting for User Input  
**Branch:** main

---

## ✅ Completed Tasks

| Task | Status | Details |
|------|--------|---------|
| OAuth Architecture | ✅ | PKCE Flow (no client secrets), Popup-basiert |
| Google Calendar Integration | ✅ | Code komplett (nb-google-calendar.js) |
| Outlook Integration | ✅ | Code komplett (nb-outlook-calendar.js) |
| Configuration System | ✅ | nb-config.js (Defaults) + nb-config.local.js (Locals) |
| Setup Documentation | ✅ | PHASE_3_OAUTH_SETUP.md (detaillierte Anleitung) |
| Transferable Prompt | ✅ | PHASE_3_PROMPT_FOR_ANOTHER_SESSION.md |

---

## 🟡 In Progress – User Action Required

### Google OAuth Setup
```
[ ] 1. Google Cloud Console → create OAuth 2.0 Client ID
[ ] 2. Configure OAuth Consent Screen
[ ] 3. Add Calendar scopes
[ ] 4. Add Redirect URIs
[ ] 5. Copy Google Client ID
[ ] 6. Share with Claude
```

**What you'll get:**  
`123456789-abc.apps.googleusercontent.com`

**Where:** Google Cloud Console → APIs & Services → Credentials

---

### Outlook OAuth Setup
```
[ ] 1. Azure Portal → create App Registration
[ ] 2. Configure Single-Page Application platform
[ ] 3. Add Calendar.ReadWrite scope
[ ] 4. Add Redirect URIs
[ ] 5. Copy Application (Client) ID
[ ] 6. Share with Claude
```

**What you'll get:**  
`a1b2c3d4-1234-1234-1234-a1b2c3d4e5f6`

**Where:** Azure Portal → Entra ID → App registrations

---

## 🔴 Blocked – Waiting For

### Required from User
1. **Google Client ID** – Format: `XXXXXXX-abc.apps.googleusercontent.com`
2. **Outlook Client ID** – Format: UUID (a1b2c3d4-...)

### What happens after you provide these:
1. Claude creates `js/nb-config.local.js` with your credentials
2. You download the file to your local machine
3. You test the OAuth flow locally (http://localhost:8000)
4. Browser should show "Google Kalender ✅ Ready" and "Outlook ✅ Ready"

---

## 📋 Files Created This Phase

| File | Purpose | Private |
|------|---------|---------|
| PHASE_3_OAUTH_SETUP.md | Complete setup guide | ❌ No |
| PHASE_3_PROMPT_FOR_ANOTHER_SESSION.md | Delegatable prompt | ❌ No |
| js/nb-config.local.js | **TO BE CREATED** | ✅ Yes (in .gitignore) |

---

## 🚀 Next Phases

### Phase 4: Firebase Deployment
- Deploy Firestore Security Rules: `firebase deploy --only firestore:rules`
- Deploy Storage Rules: `firebase deploy --only storage`
- Verify member-based access control

### Phase 5: QA Testing
- Use QA_VALIDATION_REPORT.md
- Test offline functionality
- Verify calendar sync
- Check dark mode and responsive design

---

## 📞 How to Proceed

### Option A: Continue in this chat
Share your Google & Outlook Client IDs here:
```
Google Client ID: [paste here]
Outlook Client ID: [paste here]
```
I'll create `js/nb-config.local.js` immediately.

### Option B: Delegate to another session
Use **PHASE_3_PROMPT_FOR_ANOTHER_SESSION.md** – copy the entire text into a new Claude chat and continue there.

---

## 🔐 Security Notes

- ✅ No client secrets in frontend (PKCE is secure for SPAs)
- ✅ Tokens stored in localStorage (standard for SPAs like Gmail, Office 365)
- ✅ nb-config.local.js is in .gitignore (credentials stay local)
- ✅ Firebase API key is public (security via Firestore rules)
- ⚠️ Don't commit js/nb-config.local.js to GitHub

---

## 📊 Progress Metrics

```
Phase 1: Design        ████████████████████ 100% ✅
Phase 2: Firebase      ████████████████████ 100% ✅
Phase 3: OAuth         ███████░░░░░░░░░░░░░  35% 🟡
Phase 4: Deployment    ░░░░░░░░░░░░░░░░░░░░   0% ⏳
Phase 5: QA Testing    ░░░░░░░░░░░░░░░░░░░░   0% ⏳

Timeline: 5 days in  
Owner: Indra (Backend + OAuth prep), Claude (Integration)
```

---

**Created by:** Claude Design & OAuth Architect  
**For:** Indra / Nestbau v2.0 Project  
**Status:** 🟡 Ready for Input

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  linkWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
  addDoc,
  onSnapshot,
  orderBy
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";


// =========================
// NEXUS PWA / Installation
// =========================
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((error) => console.error("Service Worker Fehler:", error));
  });
}

function getInstallButtonHtml() {
  return `
    <button class="install-btn" id="installAppBtn">
      NEXUS als App installieren
    </button>
    <p class="install-hint">
      Falls der Installationsdialog nicht automatisch angeboten wird,
      kannst du im Browser-Menü „App installieren“ bzw.
      „Zum Startbildschirm hinzufügen“ wählen.
    </p>
  `;
}

const firebaseConfig = {
  apiKey: "AIzaSyC1zecGgLUSOnylen7-KBB6tcIxeasRKIY",
  authDomain: "nexus-messenger-1c6b7.firebaseapp.com",
  projectId: "nexus-messenger-1c6b7",
  storageBucket: "nexus-messenger-1c6b7.firebasestorage.app",
  messagingSenderId: "817244604485",
  appId: "1:817244604485:web:8aa114c0243c11f6d63b2c",
  measurementId: "G-3KMDJEMN9T"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const authScreen = document.getElementById("authScreen");
const registerStep = document.getElementById("registerStep");
const loginStep = document.getElementById("loginStep");
const unlockStep = document.getElementById("unlockStep");

const showRegisterBtn = document.getElementById("showRegisterBtn");
const showLoginBtn = document.getElementById("showLoginBtn");

const inviteCodeInput = document.getElementById("inviteCodeInput");
const usernameInput = document.getElementById("usernameInput");
const pinInput = document.getElementById("pinInput");
const pinConfirmInput = document.getElementById("pinConfirmInput");
const registerBtn = document.getElementById("registerBtn");
const authMessage = document.getElementById("authMessage");

const loginUsernameInput = document.getElementById("loginUsernameInput");
const loginPinInput = document.getElementById("loginPinInput");
const loginBtn = document.getElementById("loginBtn");
const loginMessage = document.getElementById("loginMessage");
const forgotLoginPinBtn = document.getElementById("forgotLoginPinBtn");

const unlockPinInput = document.getElementById("unlockPinInput");
const unlockBtn = document.getElementById("unlockBtn");
const useOtherAccountBtn = document.getElementById("useOtherAccountBtn");
const forgotPinBtn = document.getElementById("forgotPinBtn");
const unlockMessage = document.getElementById("unlockMessage");
const unlockHello = document.getElementById("unlockHello");

const firebaseStatus = document.getElementById("firebaseStatus");

let authReady = false;

function setFirebaseStatus(text, state = "loading") {
  if (!firebaseStatus) return;
  firebaseStatus.textContent = text;
  firebaseStatus.dataset.state = state;
}

function setMessage(el, text, type = "") {
  if (!el) return;
  el.textContent = text;
  el.className = "auth-message" + (type ? ` ${type}` : "");
}

function normalizeUsername(value) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidPin(pin) {
  return /^\d{6}$/.test(pin);
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/*
  NEXUS speichert keine echte E-Mail-Adresse.
  Firebase Email/Password wird nur intern benutzt, damit dasselbe Konto
  auf PC und Handy funktionieren kann.
*/
async function internalCredentials(username, pin) {
  const normalized = normalizeUsername(username).toLowerCase();
  const usernameHash = await sha256Hex(normalized);
  const passwordHash = await sha256Hex(`NEXUS|${normalized}|${pin}`);
  return {
    email: `${usernameHash.slice(0, 40)}@nexus.example`,
    password: `Nx!${pin}!${passwordHash.slice(0, 32)}`
  };
}

async function derivePinHash(pin, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 250000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function createLocalPinVerifier(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt);
  localStorage.setItem("nexusPinSalt", bytesToBase64(salt));
  localStorage.setItem("nexusPinHash", hash);
}

async function verifyLocalPin(pin) {
  const saltB64 = localStorage.getItem("nexusPinSalt");
  const expectedHash = localStorage.getItem("nexusPinHash");
  if (!saltB64 || !expectedHash) return false;
  const hash = await derivePinHash(pin, base64ToBytes(saltB64));
  return hash === expectedHash;
}

function clearLocalSession() {
  localStorage.removeItem("nexusUnlocked");
  localStorage.removeItem("nexusUsername");
  localStorage.removeItem("nexusPublicId");
  localStorage.removeItem("nexusPinSalt");
  localStorage.removeItem("nexusPinHash");
}

function makePublicId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "NX-";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function activateSwitch(which) {
  showRegisterBtn.classList.toggle("active", which === "register");
  showLoginBtn.classList.toggle("active", which === "login");
}

function showRegister() {
  registerStep.classList.remove("hidden");
  loginStep.classList.add("hidden");
  unlockStep.classList.add("hidden");
  activateSwitch("register");
  authScreen.classList.remove("hidden");
}

function showLogin() {
  registerStep.classList.add("hidden");
  loginStep.classList.remove("hidden");
  unlockStep.classList.add("hidden");
  activateSwitch("login");
  authScreen.classList.remove("hidden");
  setTimeout(() => loginUsernameInput.focus(), 100);
}

function showUnlock(username = "") {
  registerStep.classList.add("hidden");
  loginStep.classList.add("hidden");
  unlockStep.classList.remove("hidden");
  showRegisterBtn.classList.remove("active");
  showLoginBtn.classList.remove("active");
  unlockHello.textContent = username
    ? `Hallo ${username}. Gib deinen persönlichen App-Code ein.`
    : "Gib deinen persönlichen App-Code ein.";
  authScreen.classList.remove("hidden");
  setTimeout(() => unlockPinInput.focus(), 100);
}

function enterApp() {
  localStorage.setItem("nexusUnlocked", "1");
  authScreen.classList.add("hidden");
  window.dispatchEvent(new CustomEvent("nexus-login-ready"));
}

async function getCurrentUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function usernameExists(username) {
  const q = query(
    collection(db, "users"),
    where("usernameLower", "==", normalizeUsername(username).toLowerCase())
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

async function findUsableInvite(code) {
  const q = query(
    collection(db, "invites"),
    where("code", "==", code),
    where("used", "==", false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const inviteDoc = snap.docs[0];
  return { ref: inviteDoc.ref, data: inviteDoc.data() };
}

async function ensureAnonymousForRegistration() {
  if (auth.currentUser && auth.currentUser.isAnonymous) return auth.currentUser;
  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    await signOut(auth);
  }
  const result = await signInAnonymously(auth);
  return result.user;
}

showRegisterBtn.addEventListener("click", showRegister);
showLoginBtn.addEventListener("click", showLogin);

registerBtn.addEventListener("click", async () => {
  const code = inviteCodeInput.value.trim();
  const username = normalizeUsername(usernameInput.value);
  const pin = pinInput.value.trim();
  const pinConfirm = pinConfirmInput.value.trim();

  setMessage(authMessage, "");

  if (!code || !username || !pin || !pinConfirm) {
    setMessage(authMessage, "Bitte fülle alle Felder aus.", "error");
    return;
  }
  if (username.length < 3) {
    setMessage(authMessage, "Der Benutzername muss mindestens 3 Zeichen haben.", "error");
    return;
  }
  if (!isValidPin(pin)) {
    setMessage(authMessage, "Der App-Code muss genau 6 Ziffern haben.", "error");
    return;
  }
  if (pin !== pinConfirm) {
    setMessage(authMessage, "Die beiden App-Codes stimmen nicht überein.", "error");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Konto wird erstellt…";

  try {
    const user = await ensureAnonymousForRegistration();

    const invite = await findUsableInvite(code);
    if (!invite) {
      setMessage(authMessage, "Der Einladungscode ist ungültig oder wurde bereits benutzt.", "error");
      return;
    }

    if (await usernameExists(username)) {
      setMessage(authMessage, "Dieser Benutzername ist bereits vergeben.", "error");
      return;
    }

    const creds = await internalCredentials(username, pin);
    const credential = EmailAuthProvider.credential(creds.email, creds.password);

    // Die anonyme Firebase-ID wird dabei in ein dauerhaftes Konto umgewandelt.
    const linked = await linkWithCredential(user, credential);
    const permanentUser = linked.user;
    const publicId = makePublicId();

    await setDoc(doc(db, "users", permanentUser.uid), {
      uid: permanentUser.uid,
      username,
      usernameLower: username.toLowerCase(),
      publicId,
      inviteCode: code,
      createdAt: serverTimestamp(),
      isAdmin: false,
      active: true
    });

    await updateDoc(invite.ref, {
      used: true,
      usedBy: permanentUser.uid
    });

    await createLocalPinVerifier(pin);
    localStorage.setItem("nexusUsername", username);
    localStorage.setItem("nexusPublicId", publicId);

    const profileInitial = document.getElementById("profileInitial");
    if (profileInitial) profileInitial.textContent = username.charAt(0).toUpperCase();

    enterApp();
  } catch (error) {
    console.error(error);
    if (error.code === "auth/email-already-in-use" || error.code === "auth/credential-already-in-use") {
      setMessage(authMessage, "Dieses NEXUS-Konto existiert bereits. Nutze „Anmelden“.", "error");
    } else if (error.code === "auth/operation-not-allowed") {
      setMessage(authMessage, "In Firebase muss „E-Mail/Passwort“ noch aktiviert werden.", "error");
    } else {
      setMessage(authMessage, "Das Konto konnte nicht erstellt werden.", "error");
    }
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Konto erstellen";
  }
});

loginBtn.addEventListener("click", async () => {
  const username = normalizeUsername(loginUsernameInput.value);
  const pin = loginPinInput.value.trim();
  setMessage(loginMessage, "");

  if (!username || !isValidPin(pin)) {
    setMessage(loginMessage, "Gib Benutzername und 6-stelligen Code ein.", "error");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Anmeldung läuft…";

  try {
    if (auth.currentUser) await signOut(auth);

    const creds = await internalCredentials(username, pin);
    const result = await signInWithEmailAndPassword(auth, creds.email, creds.password);
    const profile = await getCurrentUserProfile(result.user.uid);

    if (!profile || profile.active === false) {
      await signOut(auth);
      setMessage(loginMessage, "Dieses NEXUS-Konto ist nicht verfügbar.", "error");
      return;
    }

    await createLocalPinVerifier(pin);
    localStorage.setItem("nexusUsername", profile.username || username);
    localStorage.setItem("nexusPublicId", profile.publicId || "");

    const profileInitial = document.getElementById("profileInitial");
    if (profileInitial && profile.username) {
      profileInitial.textContent = profile.username.charAt(0).toUpperCase();
    }

    enterApp();
  } catch (error) {
    console.error(error);
    if (error.code === "auth/operation-not-allowed") {
      setMessage(loginMessage, "In Firebase muss „E-Mail/Passwort“ noch aktiviert werden.", "error");
    } else {
      setMessage(loginMessage, "Benutzername oder Code ist nicht korrekt.", "error");
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Anmelden";
  }
});

unlockBtn.addEventListener("click", async () => {
  const pin = unlockPinInput.value.trim();
  setMessage(unlockMessage, "");

  if (!isValidPin(pin)) {
    setMessage(unlockMessage, "Bitte gib deinen 6-stelligen Code ein.", "error");
    return;
  }

  try {
    // Neue Konten prüfen lokal. Alte anonyme Konten werden einmalig migriert.
    let ok = await verifyLocalPin(pin);

    const user = auth.currentUser;
    if (!ok && user) {
      const profile = await getCurrentUserProfile(user.uid);

      // Migration unserer bisherigen Test-/Anonymous-Konten
      if (profile?.pinSalt && profile?.pinHash) {
        const hash = await derivePinHash(pin, base64ToBytes(profile.pinSalt));
        ok = hash === profile.pinHash;

        if (ok && user.isAnonymous && profile.username) {
          const creds = await internalCredentials(profile.username, pin);
          const credential = EmailAuthProvider.credential(creds.email, creds.password);
          await linkWithCredential(user, credential);
          await createLocalPinVerifier(pin);

          // Der PIN-Hash soll danach nicht mehr in Firestore liegen.
          await updateDoc(doc(db, "users", user.uid), {
            pinSalt: deleteField(),
            pinHash: deleteField()
          });
        }
      }
    }

    if (!ok) {
      setMessage(unlockMessage, "Der Code ist nicht korrekt.", "error");
      return;
    }

    enterApp();
  } catch (error) {
    console.error(error);
    if (error.code === "auth/email-already-in-use" || error.code === "auth/credential-already-in-use") {
      setMessage(unlockMessage, "Das Konto wurde bereits umgestellt. Bitte über „Anderes Konto verwenden“ neu anmelden.", "error");
    } else if (error.code === "auth/operation-not-allowed") {
      setMessage(unlockMessage, "In Firebase muss „E-Mail/Passwort“ noch aktiviert werden.", "error");
    } else {
      setMessage(unlockMessage, "Entsperren fehlgeschlagen.", "error");
    }
  }
});

useOtherAccountBtn.addEventListener("click", async () => {
  clearLocalSession();
  if (auth.currentUser) await signOut(auth);
  showLogin();
});

forgotPinBtn.addEventListener("click", () => {
  alert("Die Wiederherstellung über Admin-Freigabe bauen wir als nächsten Schritt.");
});
forgotLoginPinBtn.addEventListener("click", () => {
  alert("Die Wiederherstellung über Admin-Freigabe bauen wir als nächsten Schritt.");
});

onAuthStateChanged(auth, async (user) => {
  if (!authReady) authReady = true;

  if (!user) {
    setFirebaseStatus("Firebase verbunden", "ok");
    window.NEXUS = { auth, db, uid: null };
    showLogin();
    return;
  }

  setFirebaseStatus("Firebase verbunden", "ok");
  window.NEXUS = { auth, db, uid: user.uid };

  try {
    const profile = await getCurrentUserProfile(user.uid);

    if (!profile) {
      // Anonyme Anmeldung ohne fertiges NEXUS-Profil = Registrierung anzeigen.
      if (user.isAnonymous) showRegister();
      else showLogin();
      return;
    }

    localStorage.setItem("nexusUsername", profile.username || "");
    localStorage.setItem("nexusPublicId", profile.publicId || "");

    const profileInitial = document.getElementById("profileInitial");
    if (profileInitial && profile.username) {
      profileInitial.textContent = profile.username.charAt(0).toUpperCase();
    }

    // Auch nach Browser-Neustart bleibt Firebase angemeldet, NEXUS selbst
    // verlangt aber wieder den persönlichen App-Code.
    showUnlock(profile.username || "");
  } catch (error) {
    console.error(error);
    showLogin();
  }
});




// =========================
// NEXUS Kontakte
// =========================

const contactsList = document.getElementById("contactsList");
const contactsEmpty = document.getElementById("contactsEmpty");
const addContactBtn = document.getElementById("addContactBtn");

let contactsUnsubscribe = null;
let currentContacts = [];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getUserByUid(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

async function findUserByPublicId(publicId) {
  const normalized = publicId.trim().toUpperCase();
  const q = query(
    collection(db, "users"),
    where("publicId", "==", normalized)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

async function isAlreadyContact(contactUid) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;

  const q = query(
    collection(db, "contacts"),
    where("ownerUid", "==", uid),
    where("contactUid", "==", contactUid)
  );

  const snap = await getDocs(q);
  return !snap.empty;
}

async function addContact(contactUser) {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    alert("Du bist nicht angemeldet.");
    return;
  }

  if (!contactUser?.uid) {
    alert("Kontakt konnte nicht gefunden werden.");
    return;
  }

  if (contactUser.uid === uid) {
    alert("Du kannst dich nicht selbst als Kontakt hinzufügen.");
    return;
  }

  if (await isAlreadyContact(contactUser.uid)) {
    alert(`${contactUser.username || "Dieser Nutzer"} ist bereits in deinen Kontakten.`);
    return;
  }

  await addDoc(collection(db, "contacts"), {
    ownerUid: uid,
    contactUid: contactUser.uid,
    createdAt: serverTimestamp(),
    blocked: false
  });

  alert(`${contactUser.username || "Kontakt"} wurde hinzugefügt.`);
}

async function renderContacts(contactDocs) {
  if (!contactsList) return;

  const rows = [];

  for (const contactDoc of contactDocs) {
    try {
      const user = await getUserByUid(contactDoc.contactUid);
      if (user && user.active !== false) {
        rows.push({
          contactDocId: contactDoc.id,
          ...contactDoc,
          user
        });
      }
    } catch (error) {
      console.error("Kontakt konnte nicht geladen werden:", error);
    }
  }

  currentContacts = rows;

  if (!rows.length) {
    contactsList.innerHTML = `
      <div class="empty-state compact-empty">
        <div class="empty-icon">👥</div>
        <h2>Noch keine Kontakte</h2>
        <p>Öffne einen NEXUS-Link oder füge einen Kontakt über seine NEXUS-ID hinzu.</p>
      </div>
    `;
    return;
  }

  contactsList.innerHTML = rows.map((row, index) => {
    const username = row.user.username || "Unbekannt";
    const initial = username.charAt(0).toUpperCase();

    return `
      <button class="contact-row" data-contact-index="${index}">
        <span class="contact-avatar">${escapeHtml(initial)}</span>
        <span class="contact-main">
          <strong>${escapeHtml(username)}</strong>
          <small>${escapeHtml(row.user.publicId || "")}</small>
        </span>
        <span class="contact-chevron">›</span>
      </button>
    `;
  }).join("");

  contactsList.querySelectorAll(".contact-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = currentContacts[Number(btn.dataset.contactIndex)];
      if (item) openContactActions(item.user);
    });
  });
}

function startContactsListener() {
  const uid = auth.currentUser?.uid;
  if (!uid || !contactsList) return;

  if (contactsUnsubscribe) contactsUnsubscribe();

  const q = query(
    collection(db, "contacts"),
    where("ownerUid", "==", uid)
  );

  contactsUnsubscribe = onSnapshot(q, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderContacts(docs);
  }, (error) => {
    console.error("Kontakte konnten nicht geladen werden:", error);
    contactsList.innerHTML = `
      <div class="empty-state compact-empty">
        <h2>Kontakte konnten nicht geladen werden</h2>
        <p>Prüfe deine Firestore-Regeln und die Internetverbindung.</p>
      </div>
    `;
  });
}

function openContactActions(user) {
  const username = user.username || "NEXUS-Nutzer";
  const publicId = user.publicId || "";

  openModal(username, `
    <div class="profile-card">
      <div class="contact-profile-avatar">${escapeHtml(username.charAt(0).toUpperCase())}</div>

      <div class="info-row">
        <small>Benutzername</small>
        <strong>${escapeHtml(username)}</strong>
      </div>

      <div class="info-row">
        <small>NEXUS-ID</small>
        <strong>${escapeHtml(publicId)}</strong>
      </div>

      <button class="share-btn" id="openChatFromContactBtn">
        Chat öffnen
      </button>
    </div>
  `);

  document.getElementById("openChatFromContactBtn")?.addEventListener("click", () => {
    closeModal();
    openDirectChatPlaceholder(user);
  });
}

function openDirectChatPlaceholder(user) {
  openModal(`Chat mit ${user.username || "Kontakt"}`, `
    <div class="chat-placeholder">
      <div class="contact-profile-avatar">${escapeHtml((user.username || "N").charAt(0).toUpperCase())}</div>
      <h3>${escapeHtml(user.username || "NEXUS-Nutzer")}</h3>
      <p>Der Kontakt ist verbunden. Im nächsten Schritt bauen wir hier das echte Senden und Empfangen von Nachrichten ein.</p>
    </div>
  `);
}

function openAddContactDialog() {
  openModal("Kontakt hinzufügen", `
    <div class="profile-card">
      <p class="modal-note">
        Gib die persönliche NEXUS-ID des Kontakts ein, zum Beispiel <strong>NX-AB12CD34</strong>.
      </p>

      <input
        class="auth-input"
        id="contactPublicIdInput"
        type="text"
        autocomplete="off"
        placeholder="NX-..."
      >

      <button class="share-btn" id="findContactBtn">
        Kontakt suchen
      </button>

      <div class="auth-message" id="findContactMessage"></div>
      <div id="foundContactArea"></div>
    </div>
  `);

  const input = document.getElementById("contactPublicIdInput");
  const message = document.getElementById("findContactMessage");
  const area = document.getElementById("foundContactArea");

  document.getElementById("findContactBtn")?.addEventListener("click", async () => {
    const publicId = input.value.trim().toUpperCase();
    setMessage(message, "");

    if (!publicId) {
      setMessage(message, "Bitte gib eine NEXUS-ID ein.", "error");
      return;
    }

    try {
      const user = await findUserByPublicId(publicId);

      if (!user) {
        area.innerHTML = "";
        setMessage(message, "Kein Benutzer mit dieser NEXUS-ID gefunden.", "error");
        return;
      }

      if (user.uid === auth.currentUser?.uid) {
        area.innerHTML = "";
        setMessage(message, "Das ist deine eigene NEXUS-ID.", "error");
        return;
      }

      area.innerHTML = `
        <div class="found-contact">
          <span class="contact-avatar">${escapeHtml((user.username || "N").charAt(0).toUpperCase())}</span>
          <div>
            <strong>${escapeHtml(user.username || "NEXUS-Nutzer")}</strong>
            <small>${escapeHtml(user.publicId || "")}</small>
          </div>
        </div>
        <button class="share-btn" id="confirmAddContactBtn">
          Kontakt hinzufügen
        </button>
      `;

      document.getElementById("confirmAddContactBtn")?.addEventListener("click", async () => {
        try {
          await addContact(user);
          closeModal();
        } catch (error) {
          console.error(error);
          setMessage(message, "Kontakt konnte nicht hinzugefügt werden.", "error");
        }
      });
    } catch (error) {
      console.error(error);
      setMessage(message, "Kontakt konnte nicht gesucht werden.", "error");
    }
  });

  setTimeout(() => input?.focus(), 100);
}

addContactBtn?.addEventListener("click", openAddContactDialog);

async function openSharedUser(publicId) {
  if (!publicId || !auth.currentUser) return;

  try {
    const user = await findUserByPublicId(publicId);

    if (!user || user.uid === auth.currentUser.uid) return;

    const already = await isAlreadyContact(user.uid);

    openModal(user.username || "NEXUS-Nutzer", `
      <div class="profile-card">
        <div class="contact-profile-avatar">${escapeHtml((user.username || "N").charAt(0).toUpperCase())}</div>

        <div class="info-row">
          <small>Benutzername</small>
          <strong>${escapeHtml(user.username || "NEXUS-Nutzer")}</strong>
        </div>

        <div class="info-row">
          <small>NEXUS-ID</small>
          <strong>${escapeHtml(user.publicId || "")}</strong>
        </div>

        ${already
          ? `<button class="share-btn" id="sharedOpenChatBtn">Chat öffnen</button>`
          : `<button class="share-btn" id="sharedAddContactBtn">Kontakt hinzufügen</button>`
        }
      </div>
    `);

    document.getElementById("sharedAddContactBtn")?.addEventListener("click", async () => {
      await addContact(user);
      closeModal();
      openDirectChatPlaceholder(user);
    });

    document.getElementById("sharedOpenChatBtn")?.addEventListener("click", () => {
      closeModal();
      openDirectChatPlaceholder(user);
    });
  } catch (error) {
    console.error("Geteilter Kontakt konnte nicht geöffnet werden:", error);
  }
}

function getSharedPublicIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const queryId = params.get("user") || params.get("chat");
  if (queryId) return queryId.toUpperCase();

  const match = location.pathname.match(/\/chat\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).toUpperCase() : null;
}

async function afterNexusLoginContacts() {
  startContactsListener();

  const sharedPublicId = getSharedPublicIdFromUrl();
  if (sharedPublicId) {
    setTimeout(() => openSharedUser(sharedPublicId), 250);
  }
}

window.addEventListener("nexus-login-ready", afterNexusLoginContacts);




// =========================
// NEXUS 1:1 Chats
// =========================

const chatsList = document.getElementById("chatsList");
let chatsUnsubscribe = null;
let activeMessagesUnsubscribe = null;
let currentChatPartner = null;
let currentChatId = null;

function directChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

async function ensureDirectChat(otherUser) {
  const myUid = auth.currentUser?.uid;
  if (!myUid || !otherUser?.uid) throw new Error("Chat-Teilnehmer fehlen.");

  const chatId = directChatId(myUid, otherUser.uid);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      type: "direct",
      memberUids: [myUid, otherUser.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastMessageAt: serverTimestamp()
    });
  }

  return chatId;
}

function formatChatTime(value) {
  if (!value) return "";
  try {
    const d = value.toDate ? value.toDate() : new Date(value);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatChatListTime(value) {
  if (!value) return "";
  try {
    const d = value.toDate ? value.toDate() : new Date(value);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    if (sameDay) {
      return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }

    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

async function openDirectChat(user) {
  try {
    const chatId = await ensureDirectChat(user);
    currentChatId = chatId;
    currentChatPartner = user;

    openModal(user.username || "Chat", `
      <div class="chat-window">
        <div class="chat-partner">
          <span class="contact-avatar">${escapeHtml((user.username || "N").charAt(0).toUpperCase())}</span>
          <div>
            <strong>${escapeHtml(user.username || "NEXUS-Nutzer")}</strong>
            <small>${escapeHtml(user.publicId || "")}</small>
          </div>
        </div>

        <div class="messages-list" id="messagesList">
          <div class="chat-loading">Nachrichten werden geladen…</div>
        </div>

        <form class="message-composer" id="messageForm">
          <textarea
            id="messageInput"
            rows="1"
            maxlength="4000"
            placeholder="Nachricht schreiben…"
          ></textarea>
          <button type="submit" class="send-btn" aria-label="Nachricht senden">➤</button>
        </form>
      </div>
    `);

    startMessagesListener(chatId);

    const form = document.getElementById("messageForm");
    const input = document.getElementById("messageInput");

    input?.focus();

    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const text = input.value.trim();
      if (!text) return;

      input.disabled = true;

      try {
        await sendMessage(chatId, text);
        input.value = "";
        input.style.height = "auto";
      } catch (error) {
        console.error("Nachricht konnte nicht gesendet werden:", error);
        alert("Die Nachricht konnte nicht gesendet werden.");
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    input?.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });
  } catch (error) {
    console.error("Chat konnte nicht geöffnet werden:", error);
    alert("Der Chat konnte nicht geöffnet werden.");
  }
}

async function sendMessage(chatId, text) {
  const myUid = auth.currentUser?.uid;
  if (!myUid) throw new Error("Nicht angemeldet.");

  const messageRef = collection(db, "chats", chatId, "messages");

  await addDoc(messageRef, {
    senderUid: myUid,
    text,
    createdAt: serverTimestamp(),
    readBy: [myUid],
    deleted: false
  });

  await updateDoc(doc(db, "chats", chatId), {
    updatedAt: serverTimestamp(),
    lastMessage: text,
    lastMessageAt: serverTimestamp()
  });
}

function startMessagesListener(chatId) {
  if (activeMessagesUnsubscribe) {
    activeMessagesUnsubscribe();
    activeMessagesUnsubscribe = null;
  }

  const messagesQuery = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc")
  );

  activeMessagesUnsubscribe = onSnapshot(messagesQuery, (snap) => {
    const list = document.getElementById("messagesList");
    if (!list) return;

    if (snap.empty) {
      list.innerHTML = `
        <div class="chat-empty">
          <div>👋</div>
          <p>Schreib die erste Nachricht.</p>
        </div>
      `;
      return;
    }

    const myUid = auth.currentUser?.uid;

    list.innerHTML = snap.docs.map(d => {
      const m = d.data();
      const mine = m.senderUid === myUid;
      const text = m.deleted ? "Nachricht gelöscht" : escapeHtml(m.text || "");
      const time = formatChatTime(m.createdAt);

      return `
        <div class="message-row ${mine ? "mine" : "theirs"}">
          <div class="message-bubble">
            <div class="message-text">${text}</div>
            <div class="message-time">${escapeHtml(time)}</div>
          </div>
        </div>
      `;
    }).join("");

    list.scrollTop = list.scrollHeight;
  }, (error) => {
    console.error("Nachrichten konnten nicht geladen werden:", error);
    const list = document.getElementById("messagesList");
    if (list) {
      list.innerHTML = `<div class="chat-loading">Nachrichten konnten nicht geladen werden.</div>`;
    }
  });
}

async function renderChats(chatDocs) {
  if (!chatsList) return;

  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  const rows = [];

  for (const chatDoc of chatDocs) {
    if (chatDoc.type !== "direct") continue;

    const otherUid = (chatDoc.memberUids || []).find(uid => uid !== myUid);
    if (!otherUid) continue;

    try {
      const otherUser = await getUserByUid(otherUid);
      if (!otherUser || otherUser.active === false) continue;

      rows.push({
        ...chatDoc,
        otherUser
      });
    } catch (error) {
      console.error("Chatpartner konnte nicht geladen werden:", error);
    }
  }

  rows.sort((a, b) => {
    const at = a.lastMessageAt?.toMillis?.() || a.updatedAt?.toMillis?.() || 0;
    const bt = b.lastMessageAt?.toMillis?.() || b.updatedAt?.toMillis?.() || 0;
    return bt - at;
  });

  if (!rows.length) {
    chatsList.innerHTML = `
      <div class="empty-state compact-empty">
        <div class="empty-icon">💬</div>
        <h2>Noch keine Chats</h2>
        <p>Öffne einen Kontakt und schreibe die erste Nachricht.</p>
      </div>
    `;
    return;
  }

  chatsList.innerHTML = rows.map((row, index) => {
    const username = row.otherUser.username || "NEXUS-Nutzer";
    const lastMessage = row.lastMessage || "Noch keine Nachricht";
    const time = formatChatListTime(row.lastMessageAt || row.updatedAt);

    return `
      <button class="chat-row" data-chat-index="${index}">
        <span class="contact-avatar">${escapeHtml(username.charAt(0).toUpperCase())}</span>
        <span class="chat-row-main">
          <span class="chat-row-top">
            <strong>${escapeHtml(username)}</strong>
            <small>${escapeHtml(time)}</small>
          </span>
          <span class="chat-preview">${escapeHtml(lastMessage)}</span>
        </span>
      </button>
    `;
  }).join("");

  chatsList.querySelectorAll(".chat-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.dataset.chatIndex)];
      if (row) openDirectChat(row.otherUser);
    });
  });
}

function startChatsListener() {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatsList) return;

  if (chatsUnsubscribe) chatsUnsubscribe();

  const q = query(
    collection(db, "chats"),
    where("memberUids", "array-contains", uid)
  );

  chatsUnsubscribe = onSnapshot(q, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderChats(docs);
  }, (error) => {
    console.error("Chats konnten nicht geladen werden:", error);
    chatsList.innerHTML = `
      <div class="empty-state compact-empty">
        <h2>Chats konnten nicht geladen werden</h2>
        <p>Prüfe deine Firestore-Regeln und die Internetverbindung.</p>
      </div>
    `;
  });
}

// Existing contact flow now opens a real chat.
function openDirectChatPlaceholder(user) {
  openDirectChat(user);
}

window.addEventListener("nexus-login-ready", () => {
  startChatsListener();
});

// Clean up live message listener when modal closes
const originalCloseModalForChats = typeof closeModal === "function" ? closeModal : null;


const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".tab-page");

const settingsBtn = document.getElementById("settingsBtn");
const profileBtn = document.getElementById("profileBtn");
const newGroupBtn = document.getElementById("newGroupBtn");

const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModal");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => item.classList.remove("active"));
    pages.forEach(page => page.classList.remove("active"));

    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

function openModal(title, html) {
  modalTitle.textContent = title;
  modalContent.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");

  if (activeMessagesUnsubscribe) {
    activeMessagesUnsubscribe();
    activeMessagesUnsubscribe = null;
  }

  currentChatId = null;
  currentChatPartner = null;
}

settingsBtn.addEventListener("click", () => {
  openModal("Einstellungen", `
    <div class="settings-card">
      ${getInstallButtonHtml()}
      <button class="danger-btn" id="deleteAccountBtn">
        Konto löschen
      </button>
    </div>
  `);

  const installBtn = document.getElementById("installAppBtn");
  installBtn?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else {
      alert("Wenn NEXUS über HTTPS geöffnet ist, kannst du im Browser-Menü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.");
    }
  });

  document.getElementById("deleteAccountBtn").addEventListener("click", () => {
    alert("Das echte Löschen bauen wir später mit Firebase und einer Sicherheitsabfrage ein.");
  });
});

profileBtn.addEventListener("click", () => {
  openModal("Mein Profil", `
    <div class="profile-card">
      <div class="info-row">
        <small>Benutzername</small>
        <strong>${localStorage.getItem("nexusUsername") || "Benutzer"}</strong>
      </div>

      <div class="info-row">
        <small>Persönlicher Chat-Link</small>
        <strong>${window.location.host || "NEXUS"}/?user=${localStorage.getItem("nexusPublicId") || "..."}</strong>
      </div>

      <button class="share-btn" id="shareProfileBtn">
        Chat-Link teilen
      </button>
    </div>
  `);

  document.getElementById("shareProfileBtn").addEventListener("click", async () => {
    const publicId = localStorage.getItem("nexusPublicId") || "";
    const url = `${window.location.origin}${window.location.pathname}?user=${encodeURIComponent(publicId)}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "NEXUS",
          text: "Schreib mir auf NEXUS",
          url
        });
      } catch (_) {}
    } else {
      await navigator.clipboard.writeText(url);
      alert("Link wurde kopiert.");
    }
  });
});

newGroupBtn.addEventListener("click", () => {
  openModal("Neue Gruppe", `
    <p style="margin-top:0;color:#aaa">
      Die Gruppenerstellung bauen wir ein, sobald Benutzer und Kontakte mit Supabase verbunden sind.
    </p>
  `);
});

closeModalBtn.addEventListener("click", closeModal);

modalBackdrop.addEventListener("click", event => {
  if (event.target === modalBackdrop) {
    closeModal();
  }
});

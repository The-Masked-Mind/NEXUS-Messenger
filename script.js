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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

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
  installBtn.addEventListener("click", async () => {
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
        <strong>nexus.app/chat/${localStorage.getItem("nexusPublicId") || "..."}</strong>
      </div>

      <button class="share-btn" id="shareProfileBtn">
        Chat-Link teilen
      </button>
    </div>
  `);

  document.getElementById("shareProfileBtn").addEventListener("click", async () => {
    const publicId = localStorage.getItem("nexusPublicId") || "";
    const url = `https://nexus.app/chat/${publicId}`;

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

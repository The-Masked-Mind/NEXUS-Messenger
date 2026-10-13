<<<<<<< HEAD
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
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
const unlockStep = document.getElementById("unlockStep");
const inviteCodeInput = document.getElementById("inviteCodeInput");
const usernameInput = document.getElementById("usernameInput");
const pinInput = document.getElementById("pinInput");
const pinConfirmInput = document.getElementById("pinConfirmInput");
const registerBtn = document.getElementById("registerBtn");
const authMessage = document.getElementById("authMessage");
const unlockPinInput = document.getElementById("unlockPinInput");
const unlockBtn = document.getElementById("unlockBtn");
const forgotPinBtn = document.getElementById("forgotPinBtn");
const unlockMessage = document.getElementById("unlockMessage");
const unlockHello = document.getElementById("unlockHello");
const firebaseStatus = document.getElementById("firebaseStatus");

function setFirebaseStatus(text, state = "loading") {
  if (!firebaseStatus) return;
  firebaseStatus.textContent = text;
  firebaseStatus.dataset.state = state;
}

function setMessage(el, text, type = "") {
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

async function createPinVerifier(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt);
  return {
    salt: bytesToBase64(salt),
    hash
  };
}

async function verifyPin(pin, saltB64, expectedHash) {
  const salt = base64ToBytes(saltB64);
  const hash = await derivePinHash(pin, salt);
  return hash === expectedHash;
}

function makePublicId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "NX-";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function showRegister() {
  registerStep.classList.remove("hidden");
  unlockStep.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

function showUnlock(username = "") {
  registerStep.classList.add("hidden");
  unlockStep.classList.remove("hidden");
  unlockHello.textContent = username
    ? `Hallo ${username}. Gib deinen persönlichen App-Code ein.`
    : "Gib deinen persönlichen App-Code ein.";
  authScreen.classList.remove("hidden");
  setTimeout(() => unlockPinInput.focus(), 100);
}

function enterApp() {
  authScreen.classList.add("hidden");
}

async function getCurrentUserProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function usernameExists(username) {
  const q = query(collection(db, "users"), where("usernameLower", "==", username.toLowerCase()));
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
    const user = auth.currentUser;
    if (!user) throw new Error("Keine Firebase-Anmeldung vorhanden.");

    const invite = await findUsableInvite(code);
    if (!invite) {
      setMessage(authMessage, "Der Einladungscode ist ungültig oder wurde bereits benutzt.", "error");
      return;
    }

    if (await usernameExists(username)) {
      setMessage(authMessage, "Dieser Benutzername ist bereits vergeben.", "error");
      return;
    }

    const verifier = await createPinVerifier(pin);
    const publicId = makePublicId();

    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      username,
      usernameLower: username.toLowerCase(),
      publicId,
      inviteCode: code,
      createdAt: serverTimestamp(),
      isAdmin: false,
      active: true,
      pinSalt: verifier.salt,
      pinHash: verifier.hash
    });

    await updateDoc(invite.ref, {
      used: true,
      usedBy: user.uid
    });

    localStorage.setItem("nexusUnlocked", "1");
    localStorage.setItem("nexusUsername", username);
    localStorage.setItem("nexusPublicId", publicId);

    const profileInitial = document.getElementById("profileInitial");
    if (profileInitial) profileInitial.textContent = username.charAt(0).toUpperCase();

    enterApp();
  } catch (error) {
    console.error(error);
    setMessage(authMessage, "Das Konto konnte nicht erstellt werden. Prüfe die Firebase-Regeln.", "error");
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Konto erstellen";
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
    const user = auth.currentUser;
    if (!user) throw new Error("Nicht angemeldet.");

    const profile = await getCurrentUserProfile(user.uid);
    if (!profile) {
      showRegister();
      return;
    }

    const ok = await verifyPin(pin, profile.pinSalt, profile.pinHash);
    if (!ok) {
      setMessage(unlockMessage, "Der Code ist nicht korrekt.", "error");
      return;
    }

    localStorage.setItem("nexusUnlocked", "1");
    enterApp();
  } catch (error) {
    console.error(error);
    setMessage(unlockMessage, "Entsperren fehlgeschlagen.", "error");
  }
});

forgotPinBtn.addEventListener("click", () => {
  alert("Die Code-Wiederherstellung über deine Admin-Freigabe bauen wir als nächsten Schritt.");
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  setFirebaseStatus("Firebase verbunden", "ok");
  window.NEXUS = { auth, db, uid: user.uid };

  try {
    const profile = await getCurrentUserProfile(user.uid);

    if (!profile) {
      showRegister();
      return;
    }

    localStorage.setItem("nexusUsername", profile.username || "");
    localStorage.setItem("nexusPublicId", profile.publicId || "");

    const profileInitial = document.getElementById("profileInitial");
    if (profileInitial && profile.username) {
      profileInitial.textContent = profile.username.charAt(0).toUpperCase();
    }

    showUnlock(profile.username || "");
  } catch (error) {
    console.error(error);
    showRegister();
  }
});

if (!auth.currentUser) {
  signInAnonymously(auth).catch((error) => {
    console.error("Firebase-Anmeldung fehlgeschlagen:", error);
    setFirebaseStatus("Firebase-Verbindung fehlgeschlagen", "error");
    setMessage(authMessage, "Firebase-Verbindung fehlgeschlagen.", "error");
  });
}

=======


// --- PWA / App-Installation ---
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(error => console.error("Service Worker Fehler:", error));
  });
}

function getInstallButtonHtml() {
  return `
    <button class="install-btn" id="installAppBtn">
      NEXUS als App installieren
    </button>
    <p class="install-hint">
      Auf Android/Chrome erscheint dadurch die normale App-Installation.
      Falls der Button nicht angeboten wird, kannst du im Browser-Menü
      „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.
    </p>
  `;
}
>>>>>>> 25950124f9ba9a20e7f087d9803f2731e1f45ba0

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

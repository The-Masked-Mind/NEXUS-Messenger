

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
        <strong>DemoUser</strong>
      </div>

      <div class="info-row">
        <small>Persönlicher Chat-Link</small>
        <strong>nexus.app/chat/DEMO7K2</strong>
      </div>

      <button class="share-btn" id="shareProfileBtn">
        Chat-Link teilen
      </button>
    </div>
  `);

  document.getElementById("shareProfileBtn").addEventListener("click", async () => {
    const url = "https://nexus.app/chat/DEMO7K2";

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

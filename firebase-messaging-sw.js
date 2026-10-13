importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC1zecGgLUSOnylen7-KBB6tcIxeasRKIY",
  authDomain: "nexus-messenger-1c6b7.firebaseapp.com",
  projectId: "nexus-messenger-1c6b7",
  storageBucket: "nexus-messenger-1c6b7.firebasestorage.app",
  messagingSenderId: "817244604485",
  appId: "1:817244604485:web:8aa114c0243c11f6d63b2c",
  measurementId: "G-3KMDJEMN9T"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    "Neue NEXUS-Nachricht";

  const body =
    payload?.notification?.body ||
    payload?.data?.body ||
    "Du hast eine neue Nachricht erhalten.";

  const chatId = payload?.data?.chatId || "";

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: chatId || "nexus-message",
    data: {
      chatId,
      url: payload?.data?.url || "/"
    }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

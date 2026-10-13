const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

exports.sendChatPush = onDocumentCreated(
  {
    document: "chats/{chatId}/messages/{messageId}",
    region: "europe-west3"
  },
  async (event) => {
    const messageSnap = event.data;

    if (!messageSnap) {
      logger.warn("Keine Nachrichtendaten am Event.");
      return;
    }

    const message = messageSnap.data();
    const chatId = event.params.chatId;
    const senderUid = message.senderUid;

    if (!senderUid) {
      logger.warn("Nachricht ohne senderUid.", { chatId });
      return;
    }

    const chatSnap = await db.doc(`chats/${chatId}`).get();

    if (!chatSnap.exists) {
      logger.warn("Chat existiert nicht.", { chatId });
      return;
    }

    const chat = chatSnap.data() || {};
    const memberUids = Array.isArray(chat.memberUids) ? chat.memberUids : [];

    const recipientUids = memberUids.filter((uid) => uid && uid !== senderUid);

    if (!recipientUids.length) {
      logger.info("Keine Empfänger für Push.", { chatId });
      return;
    }

    const senderSnap = await db.doc(`users/${senderUid}`).get();
    const senderName = senderSnap.exists
      ? (senderSnap.data()?.username || "NEXUS")
      : "NEXUS";

    // Aus Datenschutzgründen zeigen wir den Nachrichtentext nicht
    // auf dem Sperrbildschirm. Das kann später optional geändert werden.
    const title = `Neue Nachricht von ${senderName}`;
    const body = "Du hast eine neue NEXUS-Nachricht erhalten.";

    for (const recipientUid of recipientUids) {
      const devicesSnap = await db
        .collection(`users/${recipientUid}/devices`)
        .where("notificationsEnabled", "==", true)
        .get();

      if (devicesSnap.empty) {
        logger.info("Keine Push-Geräte registriert.", { recipientUid });
        continue;
      }

      const deviceDocs = devicesSnap.docs;
      const tokens = deviceDocs
        .map((doc) => doc.data()?.token)
        .filter(Boolean);

      if (!tokens.length) {
        continue;
      }

      // FCM erlaubt max. 500 Tokens pro Multicast-Anfrage.
      for (let i = 0; i < tokens.length; i += 500) {
        const tokenChunk = tokens.slice(i, i + 500);

        const response = await messaging.sendEachForMulticast({
          tokens: tokenChunk,
          notification: {
            title,
            body
          },
          data: {
            chatId,
            senderUid,
            url: "/"
          },
          webpush: {
            fcmOptions: {
              link: "/"
            },
            notification: {
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              tag: chatId
            }
          }
        });

        const cleanup = [];

        response.responses.forEach((result, index) => {
          if (result.success) return;

          const code = result.error?.code;
          logger.warn("Push an Token fehlgeschlagen.", {
            recipientUid,
            code
          });

          if (INVALID_TOKEN_CODES.has(code)) {
            const badToken = tokenChunk[index];

            const matchingDocs = deviceDocs.filter(
              (doc) => doc.data()?.token === badToken
            );

            for (const deviceDoc of matchingDocs) {
              cleanup.push(deviceDoc.ref.delete());
            }
          }
        });

        if (cleanup.length) {
          await Promise.allSettled(cleanup);
        }
      }
    }

    logger.info("Push-Verarbeitung abgeschlossen.", {
      chatId,
      senderUid,
      recipients: recipientUids.length
    });
  }
);

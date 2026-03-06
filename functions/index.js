const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function: sendCallNotification
 * 
 * Triggers when a new document is created in the "calls" collection.
 * Sends an FCM push notification to the receiver's device.
 */
exports.sendCallNotification = functions.firestore
    .document("calls/{callId}")
    .onCreate(async (snap, context) => {
        const callData = snap.data();

        if (!callData || callData.status !== "calling") {
            console.log("Call status is not 'calling', skipping notification.");
            return null;
        }

        const receiverId = callData.receiver;
        if (!receiverId) {
            console.log("No receiver ID found in call document.");
            return null;
        }

        try {
            // Fetch receiver's user document to get FCM token
            const userDoc = await db.collection("users").doc(receiverId).get();
            if (!userDoc.exists) {
                console.log(`Receiver user doc ${receiverId} not found.`);
                return null;
            }

            const userData = userDoc.data();
            const fcmToken = userData.fcmToken;

            if (!fcmToken) {
                console.log(`No FCM token for user ${receiverId}. Push notification skipped.`);
                return null;
            }

            const callerName = callData.callerName || "Someone";
            const callType = callData.type === "video" ? "Video" : "Voice";

            const message = {
                token: fcmToken,
                notification: {
                    title: `📞 Incoming ${callType} Call`,
                    body: `${callerName} is calling you...`,
                },
                data: {
                    type: "incoming_call",
                    callId: context.params.callId,
                    callerName: callerName,
                    callerPhotoUrl: callData.callerPhotoUrl || "",
                    callType: callData.type || "voice",
                    url: userData.role === "ADMIN" || userData.role === "SUPER_ADMIN"
                        ? "/admin.html"
                        : "/emp.html"
                },
                webpush: {
                    headers: {
                        Urgency: "high"
                    },
                    notification: {
                        title: `📞 Incoming ${callType} Call`,
                        body: `${callerName} is calling you...`,
                        icon: "/assets/images/cropped-ipec-logo-32x32.png",
                        badge: "/assets/images/cropped-ipec-logo-32x32.png",
                        requireInteraction: true,
                        vibrate: [300, 100, 300, 100, 300]
                    }
                }
            };

            const response = await admin.messaging().send(message);
            console.log(`FCM notification sent successfully to ${receiverId}:`, response);
            return response;

        } catch (error) {
            console.error("Error sending call notification:", error);
            // If token is invalid, clean it from the user doc
            if (error.code === "messaging/registration-token-not-registered" ||
                error.code === "messaging/invalid-registration-token") {
                console.log(`Removing invalid FCM token for user ${receiverId}`);
                await db.collection("users").doc(receiverId).update({
                    fcmToken: admin.firestore.FieldValue.delete()
                });
            }
            return null;
        }
    });

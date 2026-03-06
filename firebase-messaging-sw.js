importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Service workers cannot access window.ENV, so config is hardcoded here
const firebaseConfig = {
    apiKey: "AIzaSyBHQF5cUBujrCJqOqybEUIeanTCbHYpMWU",
    authDomain: "expense-manager-ec149.firebaseapp.com",
    projectId: "expense-manager-ec149",
    storageBucket: "expense-manager-ec149.firebasestorage.app",
    messagingSenderId: "868468480650",
    appId: "1:868468480650:web:484a4e831724a8112feb73"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const notificationTitle = payload.notification?.title || 'IPEC Notification';
    const notificationOptions = {
        body: payload.notification?.body || '',
        icon: '/cropped-ipec-logo-32x32.png',
        badge: '/cropped-ipec-logo-32x32.png',
        vibrate: [200, 100, 200],
        tag: payload.data?.type || 'general',
        data: payload.data || {}
    };

    // For incoming calls, use a more prominent notification
    if (payload.data?.type === 'incoming_call') {
        notificationOptions.requireInteraction = true;
        notificationOptions.tag = 'incoming-call';
        notificationOptions.vibrate = [300, 100, 300, 100, 300];
    }

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(urlToOpen) && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(urlToOpen);
        })
    );
});

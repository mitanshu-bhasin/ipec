// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBHQF5cUBujrCJqOqybEUIeanTCbHYpMWU",
    authDomain: "expense-manager-ec149.firebaseapp.com",
    projectId: "expense-manager-ec149",
    storageBucket: "expense-manager-ec149.firebasestorage.app",
    messagingSenderId: "868468480650",
    appId: "1:868468480650:web:484a4e831724a8112feb73",
    measurementId: "G-1K8CS62VLR"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Export for use in other files
window.auth = auth;
window.db = db;
window.firebaseApp = app;

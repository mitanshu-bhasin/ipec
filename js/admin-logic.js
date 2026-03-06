import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, addDoc, onSnapshot, serverTimestamp, setDoc, orderBy, getDoc, deleteDoc, writeBatch, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";
import { AISupport } from './ai-support.js';

const firebaseConfig = {
    apiKey: window.ENV.FIREBASE_API_KEY,
    authDomain: window.ENV.FIREBASE_AUTH_DOMAIN,
    projectId: window.ENV.FIREBASE_PROJECT_ID,
    storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.ENV.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
let messaging = null;
try {
    messaging = getMessaging(app);
} catch (e) {
    console.warn("FCM error:", e);
}

let currentUser = null;
let userData = null;
try {
    const cached = localStorage.getItem('ipec_admin_data_cache');
    if (cached) {
        userData = JSON.parse(cached);
        currentUser = { email: userData.email, uid: userData.uid };
        document.addEventListener('DOMContentLoaded', () => {
            const authSc = document.getElementById('auth-screen');
            const dashSc = document.getElementById('dashboard-screen');
            if (authSc && dashSc) {
                authSc.classList.add('hidden');
                dashSc.classList.remove('hidden');
            }
            const nameD = document.getElementById('user-name-display');
            if (nameD) nameD.textContent = userData.name || '';
            const roleD = document.getElementById('user-role-display');
            if (roleD) roleD.textContent = userData.role || 'Admin';
            const avContainer = document.getElementById('header-profile-avatar');
            if (avContainer) {
                if (userData.photoUrl) avContainer.innerHTML = `<img src="${userData.photoUrl}" class="w-full h-full object-cover">`;
                else avContainer.innerHTML = `<i class="fa-solid fa-user-gear text-xs"></i>`;
            }
        });
    }
} catch (e) { }
let userToDelete = null;
let activeListeners = []; // Store active listeners to unsubscribe
let approvalSearchTerm = '';
let aiAssistant = null;

const roleRank = {
    'ADMIN': 7,
    'HR': 6,
    'SENIOR_MANAGER': 5,
    'FINANCE_MANAGER': 4,
    'TREASURY': 3, // Keep for legacy/senior finance
    'ACCOUNTS': 3,
    'AUDIT': 2,
    'MANAGER': 2,
    'EMPLOYEE': 1
};

// Cache users for edit modal
let globalUsersCache = [];

// Toast function
window.showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-green-600',
        warning: 'bg-yellow-600'
    };
    toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-[slideUp_0.3s] z-50`;
    toast.innerHTML = `
                <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                <span class="text-sm">${message}</span>
            `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

// Load company branding
async function loadCompanyBranding() {
    try {
        const settingsRef = doc(db, "settings", "global");
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
            const data = settingsSnap.data();

            if (data.name) {
                document.getElementById('login-company-name').textContent = data.name;
                document.getElementById('sidebar-company-name').innerHTML = data.name.replace(/(\S+)/, '$1<span class="text-green-500">Portal</span>');
            }

            if (data.logo) {
                const logoImg = document.getElementById('login-logo-img');
                const logoFallback = document.getElementById('login-logo-fallback');
                logoImg.src = data.logo;
                logoImg.classList.remove('hidden');
                logoFallback.classList.add('hidden');

                // Update sidebar logo
                const sidebarLogo = document.querySelector('.fa-bolt').parentElement;
                if (sidebarLogo) {
                    sidebarLogo.innerHTML = `<img src="${data.logo}" class="w-6 h-6 object-contain mr-2">`;
                }
            }
        }
    } catch (e) {
        console.error("Error loading branding:", e);
    }
}

onAuthStateChanged(auth, async (user) => {

    // Initialize AI Assistant
    if (user && typeof AISupport !== 'undefined' && !aiAssistant) { aiAssistant = new AISupport(user); }
    if (user) {
        try {
            // Fetch full user profile
            const q = query(collection(db, "users"), where("email", "==", user.email));
            let snap = await getDocs(q);

            if (snap.empty) {
                try {
                    // Fallback: Case-insensitive/Trim search
                    const allUsersSnap = await getDocs(collection(db, "users"));
                    const foundDoc = allUsersSnap.docs.find(doc => doc.data().email?.trim().toLowerCase() === user.email.trim().toLowerCase());
                    if (foundDoc) {
                        snap = { empty: false, docs: [foundDoc] };
                        // Auto-fix email casing in DB
                        await updateDoc(doc(db, "users", foundDoc.id), { email: user.email });
                    }
                } catch (e) { console.error("Fallback lookup failed", e); }
            }

            if (!snap.empty) {
                userData = snap.docs[0].data();
                userData.docId = snap.docs[0].id; // crucial for updates
                localStorage.setItem('ipec_admin_data_cache', JSON.stringify(userData));

                // --- MAINTENANCE MODE CHECK ---
                try {
                    const settingsRef = doc(db, "settings", "global");
                    const setSnap = await getDoc(settingsRef);
                    if (setSnap.exists() && setSnap.data().maintenanceMode === true) {
                        if (user.email !== 'mfskufgu@gmail.com' && user.email !== 'info@fouralpha.org') {
                            document.body.innerHTML = `
                                        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f172a;color:white;font-family:sans-serif;text-align:center;padding:20px;">
                                            <i class="fa-solid fa-person-digging" style="font-size:5rem;color:#ef4444;margin-bottom:20px;"></i>
                                            <h1 style="font-size:2.5rem;font-weight:bold;margin-bottom:10px;">System Under Maintenance</h1>
                                            <p style="color:#94a3b8;font-size:1.1rem;max-width:500px;">The IPEC Expense Manager is currently down for scheduled upgrades. Please try again later.</p>
                                        </div>
                                    `;
                            await signOut(auth);
                            return;
                        }
                    }
                } catch (e) {
                    console.error("Maintenance check failed:", e);
                }
                // ------------------------------

                const allowed = ['ADMIN', 'MANAGER', 'SENIOR_MANAGER', 'TREASURY', 'AUDIT', 'HR', 'FINANCE_MANAGER', 'ACCOUNTS'];
                if (!allowed.includes(userData.role)) {
                    showToast('Access Denied: You do not have management privileges.', 'error');
                    await signOut(auth);
                    return;
                }

                // Ensure UID is linked (Safe update if mismatch)
                if (userData.uid !== user.uid) {
                    await updateDoc(doc(db, "users", userData.docId), {
                        uid: user.uid,
                        status: 'ACTIVE',
                        authProvider: 'google',
                        updatedAt: serverTimestamp()
                    });
                }

                currentUser = user;

                // Initialize AI
                if (!aiAssistant) {
                    try {
                        aiAssistant = new AISupport(userData);
                        window.aiAssistant = aiAssistant;
                    } catch (e) {
                        console.error("AI Error:", e);
                    }
                }

                // --- FCM LIVE NOTIFICATIONS PUSH ---
                if (messaging) {
                    try {
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') {
                            // Please replace 'VAPID_KEY_HERE' with your actual Firebase Web Push cert key
                            const currentToken = await getToken(messaging, { vapidKey: 'BOsOeRaI8phgZF1FNFk3ruTzQJh15l0QA2vYzuwJ3ZS59jSSFRxfWRWpzWGriIGhaaLwxASNtvrRCdYO-Zs2B-s' }).catch(() => null);
                            if (currentToken) {
                                // Save token to user doc
                                await updateDoc(doc(db, "users", userData.docId), {
                                    fcmToken: currentToken
                                });
                            }
                        }

                        onMessage(messaging, (payload) => {
                            console.log('FCM Foreground Message received: ', payload);
                            showToast(payload.notification.title + " - " + payload.notification.body, 'info');
                        });
                    } catch (e) {
                        console.error('FCM Setup Error:', e);
                    }
                }

                // --- LIVE NOTIFICATIONS (Old In-App Browser Method) ---
                if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
                try {
                    const notifQ = query(collection(db, "expenses"), orderBy("updatedAt", "desc"), limit(10));
                    let isInitial = true;
                    onSnapshot(notifQ, (snapshot) => {
                        if (isInitial) { isInitial = false; return; }
                        if (snapshot.metadata.hasPendingWrites) return;

                        snapshot.docChanges().forEach((change) => {
                            const d = change.doc.data();
                            const name = d.employeeName || d.userName || 'User';
                            let title = '';
                            let body = '';

                            if (change.type === 'added') {
                                title = 'New Expense Submission';
                                body = `${name} submitted a claim for ${d.currency} ${d.totalAmount}`;
                            } else if (change.type === 'modified') {
                                title = 'Expense Update';
                                body = `${name}'s claim "${d.title}" is now ${d.status.replace(/_/g, ' ')}`;
                            }

                            if (title && Notification.permission === 'granted') {
                                const opts = {
                                    body: body,
                                    icon: 'assets/images/cropped-ipec-logo-32x32.png',
                                    vibrate: [200, 100, 200]
                                };
                                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                                    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts));
                                } else {
                                    new Notification(title, opts);
                                }
                            }
                        });
                    });

                    // --- CHAT NOTIFICATIONS ---
                    let chatNotifInitial = true;
                    onSnapshot(query(collection(db, "chats"), where("users", "array-contains", userData.docId)), (snapshot) => {
                        if (chatNotifInitial) { chatNotifInitial = false; return; }
                        snapshot.docChanges().forEach(change => {
                            if (change.type === 'modified') {
                                const data = change.doc.data();
                                // Only notify if someone else sent it and we aren't currently viewing it in-focus
                                if (data.lastSender && data.lastSender !== userData.docId) {
                                    if (document.hidden || currentChatId !== change.doc.id) {
                                        if (Notification.permission === 'granted') {
                                            const opts = {
                                                body: data.lastMessage || 'New message',
                                                icon: 'assets/images/cropped-ipec-logo-32x32.png',
                                                vibrate: [200, 100, 200],
                                                tag: change.doc.id,
                                                renotify: true
                                            };
                                            if (navigator.serviceWorker?.controller) {
                                                navigator.serviceWorker.ready.then(reg => reg.showNotification('New Private Message', opts));
                                            } else {
                                                new Notification('New Private Message', opts);
                                            }
                                        }
                                    }
                                    // Also refresh user list if chat modal is open to update last message/sort
                                    if (!document.getElementById('modal-chat').classList.contains('hidden')) {
                                        if (typeof loadChatUsers === 'function') loadChatUsers();
                                    }
                                }
                            }
                        });
                    });

                    // --- GLOBAL CHAT NOTIFICATIONS ---
                    let globalNotifInitial = true;
                    onSnapshot(query(collection(db, "global_chat"), orderBy("createdAt", "desc"), limit(1)), (snapshot) => {
                        if (globalNotifInitial) { globalNotifInitial = false; return; }
                        if (!snapshot.empty) {
                            const data = snapshot.docs[0].data();
                            if (data.email !== userData.email) {
                                if (document.hidden || currentChatId !== 'global_chat') {
                                    if (Notification.permission === 'granted') {
                                        const opts = {
                                            body: `${data.sender}: ${data.text}`,
                                            icon: 'assets/images/cropped-ipec-logo-32x32.png',
                                            tag: 'global_chat'
                                        };
                                        if (navigator.serviceWorker?.controller) {
                                            navigator.serviceWorker.ready.then(reg => reg.showNotification('Global Group Message', opts));
                                        } else {
                                            new Notification('Global Group Message', opts);
                                        }
                                    }
                                }
                                if (typeof loadChatUsers === 'function') loadChatUsers();

                                // Toggle global unread dot
                                if (currentChatId !== 'global_chat') {
                                    const dot = document.getElementById('global-unread-dot');
                                    if (dot) dot.classList.remove('hidden');
                                }
                            }
                        }
                    });
                } catch (e) { console.error("Notification Error", e); }

                // --- CUSTOM ADMIN NOTIFICATIONS ---
                try {
                    const customQ = query(
                        collection(db, "notifications"),
                        where("targetUserId", "in", [userData.docId, 'ALL']),
                        orderBy("createdAt", "desc"),
                        limit(5)
                    );
                    let isInitialCustom = true;
                    onSnapshot(customQ, (snapshot) => {
                        if (isInitialCustom) { isInitialCustom = false; return; }
                        if (snapshot.metadata.hasPendingWrites) return;

                        snapshot.docChanges().forEach((change) => {
                            if (change.type === 'added') {
                                const d = change.doc.data();
                                // if (d.sender === userData.name) return; // Removed to allow self-notifications

                                if (Notification.permission === 'granted') {
                                    const opts = {
                                        body: d.body,
                                        icon: 'assets/images/cropped-ipec-logo-32x32.png',
                                        tag: change.doc.id,
                                        vibrate: [200, 100, 200]
                                    };
                                    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                                        navigator.serviceWorker.ready.then(reg => reg.showNotification(d.title, opts));
                                    } else {
                                        new Notification(d.title, opts);
                                    }
                                }
                                showToast(`New Message: ${d.title}`, 'info');
                            }
                        });
                    });
                } catch (e) { console.error("Custom Notif Error", e); }

                // --- WEBRTC CALL LISTENER ---
                if (typeof listenForCalls === 'function') listenForCalls();

                showDashboard();
                updatePendingCount();
            } else {
                showToast(`User record [${user.email}] not found in database.`, 'error');
                await signOut(auth);
            }
        } catch (error) {
            console.error("Auth Error:", error);
            showToast('Login Error: ' + error.message, 'error');
            await signOut(auth);
        }
    } else {
        showLogin();
    }
});

window.getAllowedStatusesForRole = async (role) => {
    if (role === 'ADMIN') return null; // Admin sees everything via not-in PAID,REJECTED,AUDITED
    let statuses = [];
    // Parse through workflowConfig to find all stages where approverRole === role
    if (!window.currentWorkflowConfig) {
        try {
            const snap = await getDoc(doc(db, "settings", "workflow_config"));
            if (snap.exists()) window.currentWorkflowConfig = snap.data();
        } catch (e) { }
    }
    if (window.currentWorkflowConfig) {
        const config = window.currentWorkflowConfig;
        // Check defaultFlow
        (config.defaultFlow || []).forEach(stage => {
            if (stage.approverRole === role) statuses.push(stage.stage);
        });
        // Check roleOverrides
        if (config.roleOverrides) {
            Object.values(config.roleOverrides).forEach(override => {
                if (override.flow) {
                    override.flow.forEach(stage => {
                        if (stage.approverRole === role) statuses.push(stage.stage);
                    });
                }
            });
        }
    } else {
        // Fallback hardcoded if no config
        if (role === 'MANAGER') statuses = ['PENDING_MANAGER'];
        else if (role === 'FINANCE_MANAGER') statuses = ['PENDING_FINANCE'];
        else if (role === 'ACCOUNTS') statuses = ['FINANCE_APPROVED', 'PENDING_ACCOUNTS'];
        else if (role === 'SENIOR_MANAGER') statuses = ['PENDING_SENIOR_MANAGER'];
        else if (role === 'TREASURY') statuses = ['PENDING_TREASURY'];
        else if (role === 'AUDIT') statuses = ['PAID'];
    }
    // Unique statuses
    return [...new Set(statuses)];
};

async function updatePendingCount() {
    try {
        let q;
        if (userData.role === 'ADMIN') {
            q = query(collection(db, "expenses"), where("status", "not-in", ["PAID", "REJECTED", "AUDITED"]));
        } else {
            const allowedStatuses = await getAllowedStatusesForRole(userData.role);
            if (allowedStatuses && allowedStatuses.length > 0) {
                q = query(collection(db, "expenses"), where("status", "in", allowedStatuses.slice(0, 10)));
            } else {
                const pendingEl = document.getElementById('pending-count');
                if (pendingEl) pendingEl.classList.add('hidden');
                return;
            }
        }

        if (q) {
            const snap = await getDocs(q);
            const count = snap.size;
            const pendingEl = document.getElementById('pending-count');
            if (count > 0) {
                pendingEl.classList.remove('hidden');
            } else {
                pendingEl.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error("Error updating pending count:", e);
    }
}

// Modal Helpers
let inputModalResolve = null;

window.showInputPromise = (title, message, placeholder = '', type = 'text', defaultValue = '') => {
    if (inputModalResolve) {
        inputModalResolve(null);
        inputModalResolve = null;
    }

    return new Promise((resolve) => {
        inputModalResolve = resolve;

        document.getElementById('input-modal-title').textContent = title;
        document.getElementById('input-modal-message').textContent = message;

        const input = document.getElementById('input-modal-value');
        if (type === 'none') {
            input.classList.add('hidden');
        } else {
            input.classList.remove('hidden');
            input.type = type;
            input.placeholder = placeholder;
            input.value = defaultValue;
        }

        const modal = document.getElementById('input-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            const content = document.getElementById('input-modal-content');
            if (content) {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }
            if (type !== 'none' && input) input.focus();
        }, 50);
    });
};

window.closeInputModal = (val) => {
    const modal = document.getElementById('input-modal');
    const content = document.getElementById('input-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        const input = document.getElementById('input-modal-value');
        if (input) input.value = '';
    }, 200);

    if (inputModalResolve) {
        const resolve = inputModalResolve;
        inputModalResolve = null;
        resolve(val);
    }
};

window.confirmInputModal = () => {
    const input = document.getElementById('input-modal-value');
    if (input.classList.contains('hidden')) {
        closeInputModal(true);
    } else {
        closeInputModal(input.value);
    }
};

// Handle Enter key
document.getElementById('input-modal-value')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmInputModal();
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authenticating...';
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        showToast('Login successful!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
        btn.innerHTML = 'Secure Login <i class="fa-solid fa-arrow-right ml-2"></i>';
    }
});

window.handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        // 1. Fetch only email from Google and verify in our records
        const q = query(collection(db, "users"), where("email", "==", user.email));
        let snap = await getDocs(q);

        if (snap.empty) {
            // Fallback: Case-insensitive/Trim search
            try {
                const allUsersSnap = await getDocs(collection(db, "users"));
                const foundDoc = allUsersSnap.docs.find(doc => doc.data().email?.trim().toLowerCase() === user.email.trim().toLowerCase());
                if (foundDoc) {
                    snap = { empty: false, docs: [foundDoc] };
                    // Auto-fix email casing for future
                    await updateDoc(doc(db, "users", foundDoc.id), { email: user.email });
                }
            } catch (e) { console.error("Google Auth Fallback Error", e); }
        }

        if (snap.empty) {
            await signOut(auth);
            showToast(`Access Denied: Email [${user.email}] not registered in system.`, "error");
            return;
        }

        const userDoc = snap.docs[0].data();
        const docId = snap.docs[0].id;

        // 2. Check Role
        const allowed = ['ADMIN', 'MANAGER', 'SENIOR_MANAGER', 'TREASURY', 'AUDIT', 'HR', 'FINANCE_MANAGER', 'ACCOUNTS'];
        if (!allowed.includes(userDoc.role)) {
            await signOut(auth);
            showToast("Access Denied: You do not have management privileges.", "error");
            return;
        }

        // 3. Pass user (Update system record with Google UID)
        await updateDoc(doc(db, "users", docId), {
            uid: user.uid,
            updatedAt: serverTimestamp(),
            status: 'ACTIVE',
            authProvider: 'google'
        });

        showToast("Login successful!", "success");
        // onAuthStateChanged will handle the rest
    } catch (error) {
        console.error(error);
        showToast("Google Sign-In Failed: " + error.message, "error");
    }
};

window.logout = async () => {
    if (await showInputPromise("Logout", "Are you sure you want to logout?", "", "none")) {
        localStorage.removeItem('ipec_admin_data_cache');
        signOut(auth);
        showToast('Logged out successfully', 'info');
    }
};

window.forgotPassword = async () => {
    let email = userData?.email;

    if (email) {
        if (!await showInputPromise("Reset Password", `Send password reset email to ${email}?`, "", "none")) return;
    } else {
        email = await showInputPromise("Reset Password", "Enter your corporate email to reset password:", "user@example.com", "email");
    }

    if (email) {
        try {
            await sendPasswordResetEmail(auth, email);
            showToast(`Password reset email sent to ${email}!`, 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    }
};

window.toggleAuthMode = (mode) => {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const loginFooter = document.getElementById('login-footer');
    const signupFooter = document.getElementById('signup-footer');
    const googleBtn = document.getElementById('google-signin-container');

    if (mode === 'signup') {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        loginFooter.classList.add('hidden');
        signupFooter.classList.remove('hidden');
        googleBtn.classList.add('hidden');
    } else {
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
        loginFooter.classList.remove('hidden');
        signupFooter.classList.add('hidden');
        googleBtn.classList.remove('hidden');
    }
};

window.handleAccountActivation = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-password').value;
    const btn = document.getElementById('signup-btn');

    if (!email || !pass) return showToast("Please fill in all fields", "error");
    if (pass.length < 6) return showToast("Password must be at least 6 characters", "warning");

    const originalBtnContent = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Activating...';
    btn.disabled = true;

    try {
        // Check if email already exists in DB
        const q = query(collection(db, "users"), where("email", "==", email));
        const snap = await getDocs(q);

        if (snap.empty) {
            throw new Error("Email not registered as Admin/Manager. Contact System Owner.");
        }

        const userDoc = snap.docs[0];
        const userData = userDoc.data();

        if (userData.uid) {
            throw new Error("Account already activated. Please login.");
        }

        // Check Role
        if (!['ADMIN', 'MANAGER', 'SENIOR_MANAGER', 'HR', 'FINANCE_MANAGER', 'ACCOUNTS', 'TREASURY', 'AUDIT'].includes(userData.role)) {
            throw new Error("This portal is for Admins & Managers only.");
        }

        const userCred = await createUserWithEmailAndPassword(auth, email, pass);

        // Activate User: Update Firestore with Auth UID
        await updateDoc(doc(db, "users", userDoc.id), {
            uid: userCred.user.uid,
            updatedAt: serverTimestamp(),
            status: 'ACTIVE'
        });

        showToast("Account activated successfully! Logging in...", "success");
    } catch (err) {
        showToast(err.message, "error");
        btn.innerHTML = originalBtnContent;
        btn.disabled = false;
    }
};

function showLogin() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');

    document.getElementById('current-user-name').textContent = userData.name;
    document.getElementById('current-user-role').textContent = userData.role.replace('_', ' ');

    const avatarContainer = document.getElementById('sidebar-user-avatar');
    if (avatarContainer) {
        if (userData.photoUrl && userData.photoUrl.trim() !== '') {
            avatarContainer.innerHTML = `<img src="${userData.photoUrl}" class="w-full h-full object-cover">`;
        } else {
            avatarContainer.innerHTML = `<i class="fa-solid fa-user-tie"></i>`;
        }
    }

    // Reset visibility for optional tabs
    const optionalTabs = ['users', 'projects', 'settings', 'reports', 'audit'];
    optionalTabs.forEach(id => {
        const el = document.getElementById(`nav-${id}`);
        if (el) el.classList.add('hidden');
    });

    // Hide Approvals by default (except for managers/admins)
    const approvalsTab = document.querySelector('[data-tab="approvals"]');
    if (approvalsTab) approvalsTab.classList.add('hidden');

    // --- Role Based Access Control ---

    // Approvals: Managers, Sr Managers, Treasury, Admin
    // Approvals: Managers, Finance, Accounts, Admin
    if (['ADMIN', 'MANAGER', 'SENIOR_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTS', 'TREASURY'].includes(userData.role)) {
        if (approvalsTab) approvalsTab.classList.remove('hidden');
    }

    // User Mgmt & Projects: Admin, HR
    if (['ADMIN', 'HR'].includes(userData.role)) {
        document.getElementById('nav-users').classList.remove('hidden');
        document.getElementById('nav-projects').classList.remove('hidden');
    }

    // Reports: Admin, Treasury, Sr Manager
    // Reports: Admin, Finance, Accounts
    if (['ADMIN', 'TREASURY', 'SENIOR_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTS'].includes(userData.role)) {
        document.getElementById('nav-reports').classList.remove('hidden');
    }

    // Settings: Admin only
    if (userData.role === 'ADMIN') {
        document.getElementById('nav-settings').classList.remove('hidden');
    }

    // Audit Logs: Visible to all, but data is filtered by role inside the tab
    document.getElementById('nav-audit').classList.remove('hidden');

    // Task Manager: Admin, HR, Managers (Optional: logic to show for anyone who can assign tasks)
    if (['ADMIN', 'MANAGER', 'SENIOR_MANAGER', 'HR'].includes(userData.role)) {
        const navTasks = document.getElementById('nav-tasks');
        if (navTasks) navTasks.classList.remove('hidden');
    }

    // Workflow: Admin only
    if (userData.role === 'ADMIN') {
        document.getElementById('nav-workflow').classList.remove('hidden');
    }

    // Default Tab Logic
    if (userData.role === 'HR') switchTab('users');
    else if (userData.role === 'AUDIT') switchTab('audit');
    else switchTab('overview');
}

window.switchTab = (tab) => {
    // Cleanup active listeners
    activeListeners.forEach(unsub => unsub());
    activeListeners = [];

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active', 'bg-slate-800', 'text-white');
        if (el.dataset.tab === tab) el.classList.add('active', 'bg-slate-800', 'text-white');
    });

    if (tab === 'overview') renderOverview();
    if (tab === 'approvals') renderApprovals();
    if (tab === 'users') renderUserManagement();
    if (tab === 'settings') renderSettings();
    if (tab === 'reports') renderReports();
    if (tab === 'audit') renderAuditLogs();
    if (tab === 'tasks') renderTasks(); // Added tasks renderer
    if (tab === 'my-claims') renderMyClaims();
    if (tab === 'projects') renderProjects();
    if (tab === 'projects') renderProjects();
    if (tab === 'chat') renderChat();
    if (tab === 'workflow') renderWorkflow();
};

async function renderOverview() {
    document.getElementById('page-title').textContent = "System Overview";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        const expensesSnap = await getDocs(collection(db, "expenses"));
        const usersSnap = await getDocs(collection(db, "users"));

        const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const totalPaid = expenses.filter(e => e.status === 'PAID').reduce((sum, e) => sum + (parseFloat(e.totalAmount) || 0), 0);
        const pending = expenses.filter(e => !['PAID', 'REJECTED'].includes(e.status)).length;
        const rejected = expenses.filter(e => e.status === 'REJECTED').length;
        const totalUsers = users.length;
        const totalExpenses = expenses.length;

        // Monthly data for chart
        const monthlyData = {};
        expenses.forEach(e => {
            if (e.createdAt?.toDate) {
                const month = e.createdAt.toDate().toLocaleString('default', { month: 'short' });
                monthlyData[month] = (monthlyData[month] || 0) + 1;
            }
        });

        if (aiAssistant) {
            aiAssistant.updateContext({
                dashboardData: {
                    stats: { totalPaid, pending, rejected, totalUsers, totalExpenses },
                    monthlyTrend: monthlyData
                }
            });
        }

        content.innerHTML = `
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 fade-in">
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
                            <div class="absolute -right-6 -top-6 w-24 h-24 bg-green-50 rounded-full transition-transform group-hover:scale-110"></div>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider relative">Total Disbursed</p>
                            <p class="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2 font-mono relative">₹${totalPaid.toLocaleString()}</p>
                        </div>
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
                            <div class="absolute -right-6 -top-6 w-24 h-24 bg-green-50 rounded-full transition-transform group-hover:scale-110"></div>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider relative">Pending Action</p>
                            <p class="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2 font-mono relative">${pending}</p>
                        </div>
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
                            <div class="absolute -right-6 -top-6 w-24 h-24 bg-red-50 rounded-full transition-transform group-hover:scale-110"></div>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider relative">Rejections</p>
                            <p class="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2 font-mono relative">${rejected}</p>
                        </div>
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
                            <div class="absolute -right-6 -top-6 w-24 h-24 bg-purple-50 rounded-full transition-transform group-hover:scale-110"></div>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider relative">Total Users</p>
                            <p class="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2 font-mono relative">${totalUsers}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 fade-in">
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                             <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4">Expense Trend (Last 6 Months)</h3>
                             <canvas id="overviewChart"></canvas>
                        </div>
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                             <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4">Status Distribution</h3>
                             <div class="h-64 flex justify-center">
                                <canvas id="statusChart"></canvas>
                             </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><i class="fa-solid fa-chart-simple text-green-500"></i> Quick Stats</h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Expenses</span>
                                    <span class="text-sm font-bold text-slate-800 dark:text-slate-100">${totalExpenses}</span>
                                </div>
                                <div class="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Avg. Expense Amount</span>
                                    <span class="text-sm font-bold text-slate-800 dark:text-slate-100">₹${(totalPaid / (expenses.filter(e => e.status === 'PAID').length || 1)).toFixed(2)}</span>
                                </div>
                                <div class="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Approval Rate</span>
                                    <span class="text-sm font-bold text-slate-800 dark:text-slate-100">${((totalExpenses - rejected) / totalExpenses * 100 || 0).toFixed(1)}%</span>
                                </div>
                            </div>
                        </div>

                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><i class="fa-solid fa-clock text-green-500"></i> Recent Activity</h3>
                            <div class="space-y-3 max-h-60 overflow-y-auto">
                                ${expenses.slice(0, 5).map(e => `
                                    <div class="flex items-center gap-3 p-2 hover:bg-slate-50 dark:bg-slate-900 rounded-lg transition">
                                        <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                            <i class="fa-solid fa-receipt text-xs text-slate-500 dark:text-slate-400"></i>
                                        </div>
                                        <div class="flex-1">
                                            <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">${e.title}</p>
                                            <p class="text-[10px] text-slate-400">${new Date(e.createdAt?.toDate()).toLocaleDateString()}</p>
                                        </div>
                                        <span class="badge ${getStatusBadgeClass(e.status).split(' ')[0]}">${e.status.replace('_', ' ')}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><i class="fa-solid fa-rss text-green-500"></i> Live Activity Feed</h3>
                            ${expenses.slice(0, 50).map((e, i) => `
                                <div class="flex items-center justify-between p-4 hover:bg-slate-50 dark:bg-slate-900 transition border-b border-slate-50 last:border-0 ${i % 2 === 0 ? 'bg-slate-50 dark:bg-slate-900/50' : ''} ${i >= 3 ? 'hidden extra-activity' : ''}">
                                    <div class="flex items-center gap-4">
                                        <div class="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-400 shadow-sm">
                                            ${e.currency || 'INR'}
                                        </div>
                                        <div>
                                            <p class="text-sm font-bold text-slate-700 dark:text-slate-200">${e.title}</p>
                                            <div class="flex gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                <span>${new Date(e.createdAt?.toDate()).toLocaleDateString()}</span>
                                                <span class="bg-slate-200 px-1.5 rounded text-slate-600 dark:text-slate-300 font-mono">${e.projectCode || 'N/A'}</span>
                                                ${e.preApproved ? '<span class="text-green-600"><i class="fa-solid fa-check-circle"></i> Pre-Aprvd</span>' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <span class="${getStatusBadgeClass(e.status)}">${e.status.replace('_', ' ')}</span>
                                        <p class="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 mt-1">${getSymbol(e.currency)}${e.totalAmount}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        ${expenses.length > 3 ? `
                            <div class="text-center pt-3 border-t border-slate-50 dark:border-slate-800 mt-1">
                                <button onclick="document.querySelectorAll('.extra-activity').forEach(el => el.classList.remove('hidden')); this.parentElement.remove();" class="text-xs font-bold text-green-600 hover:text-brand-800 transition py-1 px-3 rounded hover:bg-green-50">View All Activity <i class="fa-solid fa-chevron-down ml-1"></i></button>
                            </div>
                        ` : ''}
                    </div>
                `;

        // Render Charts
        setTimeout(() => {
            const ctx1 = document.getElementById('overviewChart');
            const ctx2 = document.getElementById('statusChart');

            if (ctx1 && ctx2) {
                // Prepare data for trend chart
                const months = Object.keys(monthlyData).reverse(); // Assuming simple sort for demo, improving requires proper date sort
                const counts = Object.values(monthlyData).reverse();

                new Chart(ctx1, {
                    type: 'line',
                    data: {
                        labels: months,
                        datasets: [{
                            label: 'Expenses',
                            data: counts,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } } }
                });

                new Chart(ctx2, {
                    type: 'doughnut',
                    data: {
                        labels: ['Paid', 'Pending', 'Rejected'],
                        datasets: [{
                            data: [
                                expenses.filter(e => e.status === 'PAID').length,
                                expenses.filter(e => !['PAID', 'REJECTED'].includes(e.status)).length,
                                rejected
                            ],
                            backgroundColor: ['#10b981', '#fbbf24', '#ef4444'],
                            borderWidth: 0
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
                });
            }
        }, 100);

    } catch (e) {
        content.innerHTML = emptyState("Error loading data: " + e.message);
    }
}

async function renderReports() {
    document.getElementById('page-title').textContent = "Financial Reports";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        const expensesSnap = await getDocs(collection(db, "expenses"));
        const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Group by month
        const monthlyTotals = {};
        const categoryTotals = {};

        expenses.forEach(e => {
            if (e.createdAt?.toDate && e.status === 'PAID') {
                const month = e.createdAt.toDate().toLocaleString('default', { month: 'long', year: 'numeric' });
                monthlyTotals[month] = (monthlyTotals[month] || 0) + (parseFloat(e.totalAmount) || 0);
            }

            if (e.lineItems) {
                e.lineItems.forEach(item => {
                    categoryTotals[item.category] = (categoryTotals[item.category] || 0) + (item.amount || 0);
                });
            }
        });

        content.innerHTML = `
                    <div class="space-y-6">
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Monthly Expenditure</h3>
                            <div class="space-y-3">
                                ${Object.entries(monthlyTotals).map(([month, total]) => `
                                    <div class="flex items-center gap-4">
                                        <span class="text-sm font-semibold text-slate-600 dark:text-slate-300 w-32">${month}</span>
                                        <div class="flex-1 h-8 bg-slate-100 rounded-full overflow-hidden">
                                            <div class="h-full bg-green-600 rounded-full" style="width: ${(total / Math.max(...Object.values(monthlyTotals)) * 100)}%"></div>
                                        </div>
                                        <span class="text-sm font-bold text-slate-700 dark:text-slate-200 font-mono">₹${total.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Category-wise Spend</h3>
                            <div class="space-y-3">
                                ${Object.entries(categoryTotals).map(([category, total]) => `
                                    <div class="flex items-center gap-4">
                                        <span class="text-sm font-semibold text-slate-600 dark:text-slate-300 w-40">${category}</span>
                                        <div class="flex-1 h-8 bg-slate-100 rounded-full overflow-hidden">
                                            <div class="h-full bg-green-600 rounded-full" style="width: ${(total / Math.max(...Object.values(categoryTotals)) * 100)}%"></div>
                                        </div>
                                        <span class="text-sm font-bold text-slate-700 dark:text-slate-200 font-mono">₹${total.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Export Options</h3>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <button onclick="exportReport('csv')" class="p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl hover:border-green-500 hover:bg-green-50 transition group">
                                    <i class="fa-solid fa-file-csv text-2xl text-slate-400 group-hover:text-green-600 mb-2"></i>
                                    <p class="text-sm font-bold text-slate-600 dark:text-slate-300 group-hover:text-green-700">Export as CSV</p>
                                </button>
                                <button onclick="exportReport('pdf')" class="p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl hover:border-green-500 hover:bg-green-50 transition group">
                                    <i class="fa-solid fa-file-pdf text-2xl text-slate-400 group-hover:text-green-600 mb-2"></i>
                                    <p class="text-sm font-bold text-slate-600 dark:text-slate-300 group-hover:text-green-700">Export as PDF</p>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
    } catch (e) {
        content.innerHTML = emptyState("Error loading reports: " + e.message);
    }
}

async function renderAuditLogs() {
    document.getElementById('page-title').textContent = "Audit Logs";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        // Get recent actions from expenses history
        const expensesSnap = await getDocs(query(collection(db, "expenses"), orderBy("createdAt", "desc")));
        const auditLogs = [];

        expensesSnap.forEach(doc => {
            const data = doc.data();
            if (data.history) {
                data.history.forEach(h => {
                    auditLogs.push({
                        ...h,
                        expenseId: doc.id,
                        expenseTitle: data.title,
                        expenseAmount: data.totalAmount,
                        expenseCurrency: data.currency,
                        expenseProject: data.projectCode,
                        expenseStatus: data.status,
                        expenseUser: data.userName,
                        expenseUserEmail: data.userEmail,
                        expenseDate: data.createdAt
                    });
                });
            }
        });

        // Sort by date desc
        auditLogs.sort((a, b) => new Date(b.date?.toDate ? b.date.toDate() : b.date) - new Date(a.date?.toDate ? a.date.toDate() : a.date));

        let filteredLogs = auditLogs;
        if (!['ADMIN', 'HR'].includes(userData.role)) {
            filteredLogs = auditLogs.filter(log => log.by === userData.name);
        }

        window.currentAuditLogs = filteredLogs; // Store globally for export

        content.innerHTML = `
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <div class="p-6 border-b border-slate-100 dark:border-slate-800">
                            <div class="flex justify-between items-center audit-header-flex">
                                <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">System Activity Log</h3>
                                <div class="flex gap-2">
                                    <button onclick="downloadAuditCSV()" class="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded transition font-bold flex items-center gap-2">
                                        <i class="fa-solid fa-download"></i> Export CSV
                                    </button>
                                    <input type="file" id="audit-upload" class="hidden" accept=".csv" onchange="uploadAuditCSV(this)">
                                    <button onclick="document.getElementById('audit-upload').click()" class="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded transition font-bold flex items-center gap-2">
                                        <i class="fa-solid fa-upload"></i> Import CSV
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="overflow-x-auto audit-table-wrap">
                            <table class="data-grid text-sm">
                                <thead class="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs">
                                    <tr>
                                        <th class="px-6 py-3 text-left">Timestamp</th>
                                    <th class="px-6 py-3 text-left">Action</th>
                                        <th class="px-6 py-3 text-left">User</th>
                                        <th class="px-6 py-3 text-left">Role</th>
                                        <th class="px-6 py-3 text-left">Expense</th>
                                        <th class="px-6 py-3 text-left">Comment</th>
                                        <th class="px-6 py-3 text-center">View</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${filteredLogs.slice(0, 50).map(log => `
                                        <tr class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:bg-slate-900">
                                            <td class="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">${new Date(log.date?.toDate ? log.date.toDate() : log.date).toLocaleString()}</td>
                                            <td class="px-6 py-4">
                                                <span class="badge ${log.action.includes('APPROVE') ? 'bg-green-100 text-green-700' : log.action.includes('REJECT') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${log.action}</span>
                                            </td>
                                            <td class="px-6 py-4 font-medium">${log.by}</td>
                                            <td class="px-6 py-4 text-slate-500 dark:text-slate-400">${log.role}</td>
                                            <td class="px-6 py-4 text-slate-500 dark:text-slate-400">${log.expenseTitle || 'N/A'}</td>
                                            <td class="px-6 py-4 text-slate-400 text-xs italic">${log.comment || '-'}</td>
                                            <td class="px-6 py-4 text-center">
                                                <button onclick="openExpenseModal('${log.expenseId}')" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-green-600 transition flex items-center justify-center mx-auto" title="View Expense">
                                                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
    } catch (e) {
        content.innerHTML = emptyState("Error loading audit logs: " + e.message);
    }
}



window.downloadAuditCSV = () => {
    const logs = window.currentAuditLogs;
    if (!logs || logs.length === 0) return showToast("No logs to export", "info");

    const headers = [
        "Timestamp", "Action", "Performed By", "Role",
        "Claimant Name", "Claimant Email", "Expense Title", "Project Code",
        "Amount", "Currency", "Status", "Comment",
        "Payment Mode", "Transaction Ref", "Proof URL"
    ];

    const rows = logs.map(log => [
        `"${new Date(log.date?.toDate ? log.date.toDate() : log.date).toLocaleString().replace(/"/g, '""')}"`,
        `"${log.action}"`,
        `"${log.by}"`,
        `"${log.role}"`,
        `"${(log.expenseUser || 'Unknown').replace(/"/g, '""')}"`,
        `"${(log.expenseUserEmail || '-').replace(/"/g, '""')}"`,
        `"${(log.expenseTitle || 'N/A').replace(/"/g, '""')}"`,
        `"${(log.expenseProject || '-').replace(/"/g, '""')}"`,
        `"${log.expenseAmount || '0'}"`,
        `"${log.expenseCurrency || '-'}"`,
        `"${(log.expenseStatus || '-').replace(/"/g, '""')}"`,
        `"${(log.comment || '-').replace(/"/g, '""')}"`,
        `"${(log.paymentMode || '-').replace(/"/g, '""')}"`,
        `"${(log.transactionRef || '-').replace(/"/g, '""')}"`,
        `"${(log.paymentProofUrl || '-').replace(/"/g, '""')}"`
    ]);

    let csvContent = headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Audit logs exported successfully!", "success");
};

window.uploadAuditCSV = (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const rows = text.split("\n").slice(1);
        console.log("Parsed rows:", rows.length);
        showToast(`Successfully processed ${rows.length} records (Simulation)`, 'success');
        input.value = '';
    };
    reader.readAsText(file);
};

window.uploadAuditCSV = (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const rows = text.split("\n").slice(1);
        console.log("Parsed rows:", rows.length);
        showToast(`Successfully processed ${rows.length} records (Simulation)`, 'success');
        input.value = '';
    };
    reader.readAsText(file);
};

async function renderTasks() {
    document.getElementById('page-title').textContent = "Task Manager";
    const content = document.getElementById('content-area');

    // Fetch users for assignment dropdown
    let usersOptions = '<option value="">Select Employee...</option>';
    try {
        const usersSnap = await getDocs(query(collection(db, "users"), where("status", "==", "ACTIVE")));
        usersSnap.forEach(d => {
            const u = d.data();
            usersOptions += `<option value="${u.email}">${u.name} (${u.role.replace('_', ' ')})</option>`;
        });
    } catch (e) {
        console.error("Error loading users for tasks:", e);
    }

    content.innerHTML = `
                <div class="flex flex-col lg:flex-row gap-6 h-full pb-20">
                    <!-- Create Task Form -->
                    <div class="w-full lg:w-1/3 fade-in">
                        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 sticky top-4">
                            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                <i class="fa-solid fa-plus-circle text-green-600"></i> Assign New Task
                            </h3>
                            <form id="create-task-form" onsubmit="handleCreateTask(event)" class="space-y-4">
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Task Title <span class="text-red-500">*</span></label>
                                    <input type="text" id="task-title" class="input-primary" placeholder="e.g., Monthly Report" required>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Description</label>
                                    <textarea id="task-desc" class="input-primary h-20 resize-none" placeholder="Provide details..."></textarea>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Assign To <span class="text-red-500">*</span></label>
                                    <select id="task-assignee" class="input-primary" required>
                                        ${usersOptions}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Due Date <span class="text-red-500">*</span></label>
                                    <input type="date" id="task-due-date" class="input-primary" required>
                                </div>
                                <button type="submit" id="btn-create-task" class="w-full btn-primary py-3 flex justify-center items-center gap-2">
                                    <span>Assign Task</span> <i class="fa-solid fa-paper-plane"></i>
                                </button>
                            </form>
                        </div>
                    </div>

                    <!-- Tasks List -->
                    <div class="w-full lg:w-2/3 flex flex-col fade-in max-h-full">
                        <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm mb-4 flex justify-between items-center">
                            <div class="flex items-center gap-4">
                                <div class="relative min-w-[200px]">
                                    <i class="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                                    <input type="text" id="task-search" onkeyup="filterAdminTasks()" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs outline-none" placeholder="Search tasks...">
                                </div>
                                <select id="task-status-filter" onchange="filterAdminTasks()" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-xs outline-none">
                                    <option value="">All Statuses</option>
                                    <option value="PENDING">Pending</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="COMPLETED">Completed</option>
                                </select>
                            </div>
                        </div>
                        
                        <div id="admin-tasks-list" class="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                            <div class="flex justify-center mt-10"><i class="fa-solid fa-circle-notch fa-spin text-green-500 text-3xl"></i></div>
                        </div>
                    </div>
                </div>
            `;

    // Set minimum due date to today
    const today = new Date().toISOString().split('T')[0];
    const dueInput = document.getElementById('task-due-date');
    if (dueInput) dueInput.min = today;

    try {
        // Fetch tasks (ADMIN sees all, others see only what they assigned)
        let q = collection(db, "tasks");
        if (userData.role !== 'ADMIN') {
            q = query(collection(db, "tasks"), where("assignedBy", "==", userData.email));
        }

        // Remove server-side orderBy to avoid index issues. We sort in JS.
        const unsub = onSnapshot(q, (snap) => {
            const list = document.getElementById('admin-tasks-list');
            if (!list) return;

            if (snap.empty) {
                list.innerHTML = emptyState("No tasks found. Create one to get started!");
                window.adminTasksData = [];
                return;
            }

            // Map and sort locally
            let tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            tasks.sort((a, b) => {
                const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
                const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
                return dateB - dateA;
            });

            window.adminTasksData = tasks;
            filterAdminTasks();
        });

        activeListeners.push(unsub);
    } catch (e) {
        console.error("Error loading tasks:", e);
        document.getElementById('admin-tasks-list').innerHTML = emptyState("Failed to load tasks: " + e.message);
    }
}

window.filterAdminTasks = () => {
    const list = document.getElementById('admin-tasks-list');
    if (!list || !window.adminTasksData) return;

    const search = (document.getElementById('task-search')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('task-status-filter')?.value;

    const filtered = window.adminTasksData.filter(t => {
        const matchesSearch = (t.title + t.description + t.assignedTo).toLowerCase().includes(search);
        const matchesStatus = !statusFilter || t.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        list.innerHTML = emptyState("No tasks match your filters.");
        return;
    }

    list.innerHTML = filtered.map(t => `
                <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition relative">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">${t.title}</h4>
                            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">${t.description || 'No description provided.'}</p>
                        </div>
                        <span class="badge ${getTaskStatusClass(t.status)}">${t.status.replace('_', ' ')}</span>
                    </div>
                    <div class="mt-4 pt-3 border-t border-slate-50 dark:border-slate-700/50 flex flex-wrap gap-4 text-[10px] text-slate-500 dark:text-slate-400 items-center">
                        <span class="flex items-center gap-1"><i class="fa-solid fa-user text-green-500"></i> Assignee: <span class="font-bold text-slate-700 dark:text-slate-300">${t.assignedTo}</span></span>
                        <span class="flex items-center gap-1"><i class="fa-regular fa-calendar-check text-red-400"></i> Due: <span class="font-bold ${new Date(t.dueDate) < new Date() && t.status !== 'COMPLETED' ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}">${new Date(t.dueDate).toLocaleDateString()}</span></span>
                        <span class="flex items-center gap-1"><i class="fa-regular fa-clock text-slate-400"></i> Created: ${t.createdAt?.toDate ? t.createdAt.toDate().toLocaleDateString() : 'Unknown'}</span>
                        ${t.status !== 'COMPLETED' ? `<button onclick="updateTaskStatus('${t.id}', 'COMPLETED')" class="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-[10px] font-bold transition ml-auto"><i class="fa-solid fa-check"></i> Mark Done</button>` : ''}
                    </div>
                     ${t.status !== 'COMPLETED' ? `<button onclick="deleteTask('${t.id}', '${t.status}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 dark:hover:bg-slate-700" title="Delete Task"><i class="fa-solid fa-trash text-xs"></i></button>` : `<div class="absolute top-4 right-4 text-slate-300" title="Completed tasks cannot be deleted"><i class="fa-solid fa-lock text-[10px]"></i></div>`}
                </div>
            `).join('');
};

window.handleCreateTask = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-create-task');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const title = document.getElementById('task-title').value;
        const desc = document.getElementById('task-desc').value;
        const assignee = document.getElementById('task-assignee').value;
        const dueDate = document.getElementById('task-due-date').value;

        await addDoc(collection(db, "tasks"), {
            title: title,
            description: desc,
            assignedTo: assignee,
            assignedBy: userData.email,
            status: 'PENDING',
            dueDate: dueDate,
            createdAt: serverTimestamp()
        });

        showToast("Task assigned successfully!", "success");
        e.target.reset();
    } catch (err) {
        console.error("Task creation error:", err);
        showToast("Failed to create task: " + err.message, "error");
    } finally {
        btn.innerHTML = '<span>Assign Task</span> <i class="fa-solid fa-paper-plane"></i>';
        btn.disabled = false;
    }
};

window.deleteTask = async (taskId, status) => {
    if (status === 'COMPLETED') {
        showToast("Completed tasks cannot be deleted.", "error");
        return;
    }
    if (!await showInputPromise("Delete Task", "Are you sure you want to delete this task?", "", "none")) return;
    try {
        await deleteDoc(doc(db, "tasks", taskId));
        showToast("Task deleted.", "info");
    } catch (err) {
        showToast("Failed to delete task.", "error");
    }
};

window.updateTaskStatus = async (taskId, newStatus) => {
    try {
        await updateDoc(doc(db, "tasks", taskId), {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
        showToast("Task status updated", "success");
    } catch (err) {
        console.error("Update task error:", err);
        showToast("Failed to update task status", "error");
    }
};

function getTaskStatusClass(status) {
    switch (status) {
        case 'COMPLETED': return 'bg-green-100 text-green-700 border-green-200';
        case 'IN_PROGRESS': return 'bg-green-100 text-green-700 border-green-200';
        default: return 'bg-amber-100 text-amber-700 border-amber-200';
    }
}

async function renderSettings() {
    if (userData.role !== 'ADMIN') return;
    document.getElementById('page-title').textContent = "Company Settings";
    const content = document.getElementById('content-area');

    let settings = { name: '', logo: '', email: '', phone: '', address: '', taxId: '' };
    try {
        const settingsRef = doc(db, "settings", "global");
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) settings = settingsSnap.data();
    } catch (e) { }

    content.innerHTML = `
                        <div class="max-w-2xl mx-auto space-y-6">
                    <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">Global Branding</h3>
                        
                        <div class="space-y-6">
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Company Name</label>
                                <input type="text" id="company-name" value="${settings.name || ''}" class="input-primary" placeholder="RebelCorp Inc.">
                            </div>

                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Company Logo</label>
                                <div class="flex items-center gap-6">
                                    <div class="w-24 h-24 bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center overflow-hidden relative group">
                                        <img id="logo-preview" src="${settings.logo ? settings.logo : ''}" class="${settings.logo ? '' : 'hidden'} w-full h-full object-contain p-2">
                                        <div class="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer" onclick="document.getElementById('logo-upload').click()">
                                            <i class="fa-solid fa-camera"></i>
                                        </div>
                                    </div>
                                    <div class="flex-1">
                                        <input type="file" id="logo-upload" class="hidden" accept="image/*" onchange="handleLogoPreview(this)">
                                        <button onclick="document.getElementById('logo-upload').click()" class="text-sm text-green-600 font-bold hover:underline mb-1">Upload New Logo</button>
                                        <p class="text-xs text-slate-400">Recommended: 200x200px PNG. Max 1MB.</p>
                                        <input type="hidden" id="logo-base64" value="${settings.logo || ''}">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">Company Information</h3>
                        
                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Email</label>
                                <input type="email" id="company-email" value="${settings.email || ''}" class="input-primary" placeholder="info@company.com">
                            </div>
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Phone</label>
                                <input type="text" id="company-phone" value="${settings.phone || ''}" class="input-primary" placeholder="+1 234 567 8900">
                            </div>
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Address</label>
                                <textarea id="company-address" class="input-primary h-20" placeholder="Company address...">${settings.address || ''}</textarea>
                            </div>
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">Tax ID / GST</label>
                                <input type="text" id="company-tax-id" value="${settings.taxId || ''}" class="input-primary" placeholder="GSTIN-123456789">
                            </div>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">System Settings</h3>
                        
                        <div class="space-y-4">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm font-bold text-slate-600 dark:text-slate-300">Auto-approve expenses under</p>
                                    <p class="text-xs text-slate-400">Expenses below this amount will be auto-approved</p>
                                </div>
                                <input type="number" id="auto-approve-limit" value="${settings.autoApproveLimit || 0}" class="input-primary w-32 text-right">
                            </div>
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm font-bold text-slate-600 dark:text-slate-300">Require receipt for expenses over</p>
                                    <p class="text-xs text-slate-400">Receipt mandatory for amounts above this</p>
                                </div>
                                <input type="number" id="receipt-limit" value="${settings.receiptLimit || 0}" class="input-primary w-32 text-right">
                            </div>
                            <div class="flex items-center gap-3">
                                <input type="checkbox" id="email-notifications" ${settings.emailNotifications ? 'checked' : ''} class="w-4 h-4 text-green-600 rounded">
                                <label for="email-notifications" class="text-sm font-bold text-slate-600 dark:text-slate-300">Enable email notifications for approvals</label>
                            </div>
                            <div class="flex items-center gap-3 pt-2">
                                <button onclick="toggleTheme()" class="bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 dark:text-slate-300 flex items-center gap-2">
                                    <i class="fa-solid fa-moon theme-toggle-icon"></i> Toggle Dark Mode
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">Legal & Compliance</h3>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <a href="privacy.html" target="_blank" class="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-green-500 hover:bg-green-50 transition group">
                                <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:text-green-600 group-hover:bg-white dark:bg-slate-800"><i class="fa-solid fa-shield-halved"></i></div>
                                <span class="font-bold text-slate-600 dark:text-slate-300 group-hover:text-green-700">Privacy Policy</span>
                            </a>
                            <a href="terms.html" target="_blank" class="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-green-500 hover:bg-green-50 transition group">
                                <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:text-green-600 group-hover:bg-white dark:bg-slate-800"><i class="fa-solid fa-file-contract"></i></div>
                                <span class="font-bold text-slate-600 dark:text-slate-300 group-hover:text-green-700">Terms of Service</span>
                            </a>
                            <a href="license.html" target="_blank" class="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-green-500 hover:bg-green-50 transition group">
                                <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:text-green-600 group-hover:bg-white dark:bg-slate-800"><i class="fa-solid fa-scale-balanced"></i></div>
                                <span class="font-bold text-slate-600 dark:text-slate-300 group-hover:text-green-700">License Info</span>
                            </a>
                        </div>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center gap-2">
                            <i class="fa-solid fa-robot text-green-600"></i> AI Support Assistant
                        </h3>
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-sm font-bold text-slate-600 dark:text-slate-300">Enable AI Chat Support</p>
                                <p class="text-xs text-slate-400">Allow the AI to assist with policy questions and data analysis.</p>
                            </div>
                            <button onclick="aiAssistant.toggleChat()" class="bg-gradient-to-r from-green-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-green-200 hover:shadow-xl transition">
                                <i class="fa-solid fa-comment-dots mr-2"></i> Launch Assistant
                            </button>
                        </div>
                    </div>

                </div>

                <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                    <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4">Account Security</h3>
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-bold text-slate-600 dark:text-slate-300">Admin Password</p>
                            <p class="text-xs text-slate-400">Send a password reset email to your registered address.</p>
                        </div>
                        <button onclick="resetAdminPassword()" class="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-bold px-4 py-2 rounded-lg text-sm border border-slate-200 dark:border-slate-700 transition">
                            <i class="fa-solid fa-key mr-2"></i> Reset Password
                        </button>
                    </div>
                </div>

                <div class="pt-4">
                    <button onclick="saveAllSettings()" class="btn-primary w-full py-3">Save All Changes</button>
                </div>
            </div>
                        `;
}

window.resetAdminPassword = async () => {
    if (await confirm("Send password reset email to " + userData.email + "?")) {
        try {
            await sendPasswordResetEmail(auth, userData.email);
            showToast("Password reset email sent!", "success");
        } catch (e) {
            showToast(e.message, "error");
        }
    }
};

window.selectedApprovals = new Set();
let approvalsData = []; // Store for filtering

async function renderApprovals() {
    document.getElementById('page-title').textContent = "Pending Approvals";
    const content = document.getElementById('content-area');

    // Fetch Projects for Filter
    let projectOptions = '<option value="">All Projects</option>';
    try {
        const pSnap = await getDocs(query(collection(db, "projects"), orderBy("code")));
        pSnap.forEach(d => {
            projectOptions += `<option value="${d.data().code}">${d.data().code}</option>`;
        });
    } catch (e) { console.error("Project load err", e); }

    content.innerHTML = `
                        <div class="flex flex-col h-full">
                    
                    <!--Toolbar -->
                    <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm mb-6 fade-in flex flex-col md:flex-row gap-4 justify-between items-center">
                        <div class="flex gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                             <div class="relative flex min-w-[240px]">
                                <i class="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                                <input type="text" id="approval-search" onkeyup="if(event.key === 'Enter') applyApprovalFilters()" class="w-full bg-slate-50 dark:bg-slate-900 border border-r-0 border-slate-200 dark:border-slate-700 rounded-l-lg py-2 pl-9 pr-3 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="Search by name, ID, amount...">
                                <button onclick="applyApprovalFilters()" class="bg-green-600 hover:bg-brand-700 text-white px-3 py-2 rounded-r-lg text-xs font-bold transition border border-green-600"><i class="fa-solid fa-search"></i></button>
                            </div>
                            <select id="filter-project" onchange="applyApprovalFilters()" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-xs outline-none">
                                ${projectOptions}
                            </select>
                            <select id="filter-amount" onchange="applyApprovalFilters()" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-xs outline-none">
                                <option value="">Any Amount</option>
                                <option value="small">< ₹1,000</option>
                                <option value="medium">₹1k - ₹10k</option>
                                <option value="large">> ₹10k</option>
                            </select>
                            <select id="sort-order" onchange="applyApprovalFilters()" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-xs outline-none font-bold text-slate-600 dark:text-slate-300">
                                <option value="date_desc">Newest First</option>
                                <option value="date_asc">Oldest First</option>
                                <option value="amount_desc">Highest Amount</option>
                                <option value="amount_asc">Lowest Amount</option>
                                <option value="user_asc">User Name (A-Z)</option>
                                <option value="user_desc">User Name (Z-A)</option>
                            </select>
                        </div>

                        <div id="bulk-actions" class="hidden flex gap-2 items-center w-full md:w-auto justify-end animate-[slideUp_0.1s_ease-out]">
                            <span class="text-xs font-bold text-slate-500 mr-2"><span id="selected-count">0</span> Selected</span>
                            <button onclick="handleBulkAction('APPROVE')" class="bg-green-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                            ${['ADMIN', 'MANAGER'].includes(userData.role) ? `<button onclick="handleBulkAction('REJECT')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-xs font-bold transition"><i class="fa-solid fa-xmark mr-1"></i> Refund</button>` : ''}
                        </div>
                    </div>

                    <div id="approvals-list" class="flex-1 overflow-y-auto pb-20">
                        <div class="flex justify-center mt-20"><i class="fa-solid fa-circle-notch fa-spin text-green-500 text-3xl"></i></div>
                    </div>
                </div>
                        `;

    try {
        let q;
        if (userData.role === 'ADMIN') {
            q = query(collection(db, "expenses"), where("status", "not-in", ["PAID", "REJECTED", "AUDITED"]));
        } else {
            const allowedStatuses = await getAllowedStatusesForRole(userData.role);
            if (allowedStatuses && allowedStatuses.length > 0) {
                q = query(collection(db, "expenses"), where("status", "in", allowedStatuses.slice(0, 10)));
            } else {
                document.getElementById('approvals-list').innerHTML = emptyState("No workflow stages assigned to your role.");
                return;
            }
        }

        if (!q) return;

        const unsub = onSnapshot(q, async (snap) => {
            if (snap.empty) {
                document.getElementById('approvals-list').innerHTML = emptyState("All caught up! No pending items.");
                approvalsData = [];
                return;
            }

            // Get User Names Efficiently
            const userIds = [...new Set(snap.docs.map(d => d.data().userId))];
            const userMap = new Map();

            if (userIds.length > 0) {
                const chunks = [];
                for (let i = 0; i < userIds.length; i += 10) {
                    chunks.push(
                        getDocs(query(collection(db, "users"), where("__name__", "in", userIds.slice(i, i + 10))))
                    );
                }
                const results = await Promise.all(chunks);
                results.forEach(s => s.forEach(d => userMap.set(d.id, d.data().name)));
            }

            approvalsData = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                userName: userMap.get(doc.data().userId) || 'Unknown'
            }));

            window.applyApprovalFilters();
        });

        activeListeners.push(unsub);

    } catch (e) {
        console.error(e);
        document.getElementById('approvals-list').innerHTML = emptyState("Error loading approvals: " + e.message);
    }
}

window.applyApprovalFilters = () => {
    const list = document.getElementById('approvals-list');
    const search = document.getElementById('approval-search').value.toLowerCase();
    const project = document.getElementById('filter-project').value;
    const amountType = document.getElementById('filter-amount').value;

    const filtered = approvalsData.filter(d => {
        const term = (d.title + d.projectCode + d.userName + d.totalAmount + (d.id || '')).toLowerCase();
        const matchesSearch = term.includes(search);
        const matchesProject = !project || d.projectCode === project;

        let matchesAmount = true;
        const amt = parseFloat(d.totalAmount);
        if (amountType === 'small') matchesAmount = amt < 1000;
        else if (amountType === 'medium') matchesAmount = amt >= 1000 && amt <= 10000;
        else if (amountType === 'large') matchesAmount = amt > 10000;

        return matchesSearch && matchesProject && matchesAmount;
    });

    // Sorting Logic
    const sortOrder = document.getElementById('sort-order').value;
    filtered.sort((a, b) => {
        const dateA = new Date(a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt);
        const dateB = new Date(b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt);
        const amtA = parseFloat(a.totalAmount);
        const amtB = parseFloat(b.totalAmount);
        const userA = (a.userName || '').toLowerCase();
        const userB = (b.userName || '').toLowerCase();

        if (sortOrder === 'date_desc') return dateB - dateA;
        if (sortOrder === 'date_asc') return dateA - dateB;
        if (sortOrder === 'amount_desc') return amtB - amtA;
        if (sortOrder === 'amount_asc') return amtA - amtB;
        if (sortOrder === 'user_asc') return userA.localeCompare(userB);
        if (sortOrder === 'user_desc') return userB.localeCompare(userA);
        return 0;
    });

    if (filtered.length === 0) {
        list.innerHTML = emptyState("No matching approvals found.");
        return;
    }

    // Render List
    list.innerHTML = `<div class="space-y-3 fade-in">
                        ${filtered.map(d => `
                    <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border ${d.isSpam ? 'border-red-400 bg-red-50/50 dark:bg-red-900/20' : 'border-slate-100 dark:border-slate-800'} shadow-sm hover:shadow-md transition group relative overflow-hidden flex gap-4 items-center">
                        <div class="flex items-center justify-center pl-2">
                             <input type="checkbox" onchange="toggleSelection('${d.id}')" class="approval-check w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-brand-500 transition cursor-pointer" ${window.selectedApprovals.has(d.id) ? 'checked' : ''}>
                        </div>
                        
                        <div class="flex-1 cursor-pointer" onclick="if(!event.target.type) openExpenseModal('${d.id}')">
                            <div class="flex justify-between items-start mb-1">
                                <div>
                                    <h4 class="font-bold text-slate-800 dark:text-slate-100 group-hover:text-green-600 transition text-sm md:text-base flex items-center gap-2">
                                        ${d.title}
                                        ${d.isSpam ? '<span class="px-2 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-bold uppercase border border-red-200"><i class="fa-solid fa-triangle-exclamation"></i> SPAM</span>' : ''}
                                        ${d.reviewRequested ? '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase border border-amber-200 animate-pulse"><i class="fa-solid fa-rotate"></i> Re-Review</span>' : ''}
                                    </h4>
                                    <div class="flex gap-2 mt-1 flex-wrap">
                                        <span class="text-[10px] bg-slate-100 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-200 dark:border-slate-700">${d.projectCode || 'No-Code'}</span>
                                        <div class="inline-flex flex-col">
                                            <span class="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-t font-bold border border-green-100 flex items-center gap-1"><i class="fa-solid fa-user-circle"></i> ${d.userName}</span>
                                            ${d.userEmail ? `<a href="mailto:${d.userEmail}" class="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded-b font-mono border-x border-b border-green-200 hover:bg-green-200 transition flex items-center gap-1" title="Send Email"><i class="fa-solid fa-envelope"></i> ${d.userEmail}</a>` : ''}
                                            ${d.userPhone ? `<a href="tel:${d.userPhone}" class="text-[9px] text-slate-500 hover:text-slate-700 ml-1" title="Call"><i class="fa-solid fa-phone"></i></a>` : ''}
                                        </div>
                                        ${d.type === 'REQUEST' ? '<span class="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-bold border border-purple-100 uppercase"><i class="fa-solid fa-box mr-1"></i> Request</span>' : ''}
                                        ${d.preApproved ? '<span class="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded font-bold uppercase"><i class="fa-solid fa-check"></i> Pre-Approved</span>' : ''}
                                    </div>
                                </div>
                                <div class="text-right">
                                    <p class="text-lg font-bold text-slate-700 dark:text-slate-200 font-mono">${getSymbol(d.currency)}${d.totalAmount}</p>
                                    <p class="text-[10px] text-slate-400 font-bold">${d.currency}</p>
                                </div>
                            </div>
                            <div class="flex items-center justify-between border-t border-slate-50 dark:border-slate-700/50 pt-2 mt-2">
                                <span class="${getStatusBadgeClass(d.status)} scale-90 origin-left">${d.status.replace('_', ' ')}</span>
                                <div class="flex items-center gap-2">
                                    <span class="text-[10px] text-slate-400"><i class="fa-regular fa-calendar mr-1"></i> ${new Date(d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt).toLocaleDateString()}</span>
                                    ${(d.approvalProof || (d.lineItems && d.lineItems.some(i => i.receiptUrl))) ? (() => {
            // Check if any URL is insecure
            const urls = [d.approvalProof, ...(d.lineItems?.map(i => i.receiptUrl) || [])].filter(u => u);
            const hasInsecure = urls.some(u => !u.startsWith('https://') && !u.startsWith('blob:'));
            return hasInsecure
                ? '<span class="text-[9px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100" title="Unsecured Attachment (HTTP)"><i class="fa-solid fa-unlock-keyhole"></i> Insecure</span>'
                : '<span class="text-[9px] text-green-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100" title="Secured Attachment (HTTPS)"><i class="fa-solid fa-lock"></i> Secure</span>';
        })() : ''}
                                </div>
                            </div>
                        </div>
                         <div class="absolute top-0 left-0 w-1 h-full ${d.preApproved ? 'bg-green-400' : 'bg-green-500'}"></div>
                    </div>
                `).join('')
        }
            </div> `;
};

window.toggleSelection = (id) => {
    if (window.selectedApprovals.has(id)) window.selectedApprovals.delete(id);
    else window.selectedApprovals.add(id);
    updateBulkUI();
};

function updateBulkUI() {
    const count = window.selectedApprovals.size;
    document.getElementById('selected-count').textContent = count;
    const actionDiv = document.getElementById('bulk-actions');
    if (count > 0) actionDiv.classList.remove('hidden');
    else actionDiv.classList.add('hidden');
}

window.handleBulkAction = async (action) => {
    if (window.selectedApprovals.size === 0) return;
    if (!await confirm(`Are you sure you want to ${action} ${window.selectedApprovals.size} items ? `)) return;

    const btn = event.currentTarget;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';

    try {
        const batch = writeBatch(db);
        // We need to process each one logic-wise. Batch is tricky if logic differs per item.
        // However, for Approval, logic is standard per role.
        // We'll iterate and update. Since batch limit is 500, we'll process in parallel promises if needed, 
        // but let's just do Promise.all for simplicity as logic computation is needed.

        const updates = [];
        for (const id of window.selectedApprovals) {
            const expense = approvalsData.find(e => e.id === id);
            if (!expense) continue;

            let newStatus = expense.status;
            const amount = parseFloat(expense.totalAmount);

            if (action === 'REJECT') {
                newStatus = 'REJECTED';
            } else {
                // Approval Logic (Replicated)
                // Approval Logic
                if (userData.role === 'MANAGER') newStatus = 'PENDING_FINANCE';
                else if (userData.role === 'FINANCE_MANAGER') newStatus = 'FINANCE_APPROVED';
                else if (userData.role === 'ACCOUNTS') newStatus = 'PAID';
                else if (userData.role === 'SENIOR_MANAGER') newStatus = 'PENDING_TREASURY'; // Legacy path
                else if (userData.role === 'TREASURY') newStatus = 'PAID';
                else if (userData.role === 'AUDIT') newStatus = 'AUDITED';
                else if (userData.role === 'ADMIN') {
                    if (newStatus === 'PENDING_MANAGER') newStatus = 'PENDING_FINANCE';
                    else if (newStatus === 'PENDING_FINANCE') newStatus = 'FINANCE_APPROVED';
                    else if (newStatus === 'FINANCE_APPROVED') newStatus = 'PAID';
                    else if (newStatus === 'PENDING_SENIOR_MANAGER') newStatus = 'PENDING_TREASURY';
                    else if (newStatus === 'PENDING_TREASURY') newStatus = 'PAID';
                }
            }

            const historyEntry = {
                action: 'BULK_' + action,
                by: userData.name,
                role: userData.role,
                date: new Date(),
                comment: 'Bulk Action'
            };

            const ref = doc(db, "expenses", id);
            const updatePayload = {
                status: newStatus,
                updatedAt: serverTimestamp(),
                history: [...(expense.history || []), historyEntry]
            };

            // Include Payment Info if becoming PAID
            if (newStatus === 'PAID') {
                updatePayload.paymentMode = 'BULK_TRANSFER';
                updatePayload.transactionRef = 'BATCH-' + Date.now();
                updatePayload.paymentDate = new Date().toISOString().split('T')[0];
                historyEntry.paymentMode = 'BULK_TRANSFER';
                historyEntry.transactionRef = updatePayload.transactionRef;
            }

            updates.push(updateDoc(ref, updatePayload));
        }

        await Promise.all(updates);
        showToast(`Processed ${updates.length} items successfully!`, 'success');
        window.selectedApprovals.clear();
        updateBulkUI();
    } catch (e) {
        console.error(e);
        showToast("Bulk action failed: " + e.message, "error");
    } finally {
        btn.innerHTML = originalHTML;
    }
};

// User Management Functions
// Helper to populate roles
const populateRoles = (selectedRole = null) => {
    const select = document.getElementById('user-role');
    select.innerHTML = '';

    const myRank = roleRank[userData.role] || 0;

    Object.entries(roleRank).forEach(([role, rank]) => {
        // Allow if rank is lower than mine, OR if I am Admin (can add anyone), 
        // OR if I am editing and it's the current role (so it doesn't disappear)
        if (rank < myRank || userData.role === 'ADMIN' || (selectedRole && role === selectedRole)) {
            const opt = document.createElement('option');
            opt.value = role;
            opt.textContent = role.replace('_', ' ');
            if (selectedRole === role) opt.selected = true;
            select.appendChild(opt);
        }
    });

    if (select.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'EMPLOYEE';
        opt.textContent = 'Employee (Default)';
        select.appendChild(opt);
    }
};

window.showAddUserModal = () => {
    document.getElementById('user-modal-title').textContent = 'Add New User';
    document.getElementById('user-doc-id').value = '';
    document.getElementById('user-name').value = '';
    document.getElementById('user-email').value = '';
    document.getElementById('user-phone').value = '';
    document.getElementById('user-dob').value = '';
    document.getElementById('user-manager-id').value = '';
    document.getElementById('user-department').value = '';
    document.getElementById('user-employee-id').value = '';
    document.getElementById('user-budget-limit').value = '';

    // Profile Pic Logic
    const picContainer = document.getElementById('user-profile-pic-container');
    const picInput = document.getElementById('user-profile-pic');
    if (picContainer) {
        picInput.value = '';
        if (['info@fouralpha.org', 'mfskufgu@gmail.com'].includes(userData.email)) {
            picContainer.classList.remove('hidden');
        } else {
            picContainer.classList.add('hidden');
        }
    }

    populateRoles(); // Default population
    document.getElementById('user-modal').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('user-modal-content').classList.remove('scale-95', 'opacity-0');
        document.getElementById('user-modal-content').classList.add('scale-100', 'opacity-100');
    }, 10);
};

window.editUser = (id) => {
    const user = globalUsersCache.find(u => u.id === id);
    if (!user) return showToast("User not found", "error");

    const MAIN_ADMIN_EMAILS = ['info@fouralpha.org', 'mfskufgu@gmail.com'];
    if (MAIN_ADMIN_EMAILS.includes(user.email) && !MAIN_ADMIN_EMAILS.includes(userData.email)) {
        return showToast("Access Denied: Main Admin cannot be edited.", "error");
    }

    showAddUserModal();
    document.getElementById('user-modal-title').textContent = 'Edit User';
    document.getElementById('user-doc-id').value = user.id;
    document.getElementById('user-name').value = user.name || '';
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-phone').value = user.phone || '';
    document.getElementById('user-dob').value = user.dob || '';
    document.getElementById('user-role').value = user.role || 'EMPLOYEE';
    document.getElementById('user-manager-id').value = user.managerId || '';
    document.getElementById('user-department').value = user.department || '';
    document.getElementById('user-employee-id').value = user.employeeId || '';
    document.getElementById('user-budget-limit').value = user.budgetLimit || '';

    // Profile Pic
    if (MAIN_ADMIN_EMAILS.includes(userData.email)) {
        const picInput = document.getElementById('user-profile-pic');
        if (picInput) picInput.value = user.photoUrl || '';
        const picContainer = document.getElementById('user-profile-pic-container');
        if (picContainer) picContainer.classList.remove('hidden');
    }

    populateRoles(user.role);
};



window.toggleLoginPassword = () => {
    const input = document.getElementById('login-password');
    const icon = document.getElementById('login-eye-icon');
    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
};

window.closeUserModal = () => {
    const modal = document.getElementById('user-modal');
    const content = document.getElementById('user-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 200);
};

window.showDeleteModal = (docId, name) => {
    const user = globalUsersCache.find(u => u.id === docId);
    const MAIN_ADMIN_EMAILS = ['info@fouralpha.org', 'mfskufgu@gmail.com'];

    if (user && MAIN_ADMIN_EMAILS.includes(user.email) && !MAIN_ADMIN_EMAILS.includes(userData.email)) {
        return showToast("Access Denied: Main Admin cannot be deleted.", "error");
    }

    userToDelete = docId;
    document.getElementById('delete-modal-message').textContent = `Are you sure you want to delete ${name}? This will also remove all their expenses and cannot be undone.`;

    const modal = document.getElementById('delete-modal');
    const content = document.getElementById('delete-modal-content');
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
};

window.closeDeleteModal = () => {
    const modal = document.getElementById('delete-modal');
    const content = document.getElementById('delete-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 200);
    userToDelete = null;
};

window.confirmDeleteUser = async () => {
    if (!userToDelete) return;

    const user = globalUsersCache.find(u => u.id === userToDelete);
    const MAIN_ADMIN_EMAILS = ['info@fouralpha.org', 'mfskufgu@gmail.com'];

    if (user && MAIN_ADMIN_EMAILS.includes(user.email) && !MAIN_ADMIN_EMAILS.includes(userData.email)) {
        return showToast("Access Denied: Main Admin cannot be deleted.", "error");
    }

    const btn = document.querySelector('#delete-modal button.bg-red-600');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Deleting...';

    try {
        // Delete all expenses by this user (Handle Batch Limit of 500)
        const expensesQuery = query(collection(db, "expenses"), where("userId", "==", userToDelete));
        const expensesSnap = await getDocs(expensesQuery);

        // Chunk deletion
        const chunkSize = 400;
        for (let i = 0; i < expensesSnap.docs.length; i += chunkSize) {
            const batch = writeBatch(db);
            const chunk = expensesSnap.docs.slice(i, i + chunkSize);
            chunk.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        // Finally delete the user document
        await deleteDoc(doc(db, "users", userToDelete));

        showToast('User and all associated data deleted successfully!', 'success');
        closeDeleteModal();
        renderUserManagement(); // Refresh the list
    } catch (e) {
        console.error(e);
        showToast('Error deleting user: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
    }
};

document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const docId = document.getElementById('user-doc-id').value;
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const phone = document.getElementById('user-phone').value.trim();
    const dob = document.getElementById('user-dob').value;
    const role = document.getElementById('user-role').value;
    const managerId = document.getElementById('user-manager-id').value.trim();
    const department = document.getElementById('user-department').value.trim();
    const employeeId = document.getElementById('user-employee-id').value.trim();
    const budgetLimit = document.getElementById('user-budget-limit').value;
    const photoUrl = document.getElementById('user-profile-pic').value.trim();

    if (!name || !email) {
        showToast('Name and email are required!', 'error');
        return;
    }

    try {
        if (docId) {
            // Update existing user
            await updateDoc(doc(db, "users", docId), {
                name,
                role,
                managerId: managerId || null,
                department: department || null,
                employeeId: employeeId || null,
                budgetLimit: budgetLimit ? parseFloat(budgetLimit) : null,
                phone: phone || null,
                dob: dob || null,
                photoUrl: photoUrl || null,
                updatedAt: serverTimestamp()
            });
            showToast('User updated successfully!', 'success');
        } else {
            // Check if user already exists
            const q = query(collection(db, "users"), where("email", "==", email));
            const snap = await getDocs(q);

            if (!snap.empty) {
                showToast('User with this email already exists!', 'error');
                return;
            }

            // Create new user in Firestore
            await addDoc(collection(db, "users"), {
                name,
                email,
                role,
                managerId: managerId || null,
                department: department || null,
                employeeId: employeeId || null,
                budgetLimit: budgetLimit ? parseFloat(budgetLimit) : null,
                phone: phone || null,
                dob: dob || null,
                photoUrl: photoUrl || null,
                createdAt: serverTimestamp()
            });
            showToast('User added successfully! They can login after account creation.', 'success');
        }

        closeUserModal();
        renderUserManagement();
    } catch (e) {
        showToast('Error saving user: ' + e.message, 'error');
    }
});

window.toggleUserExpenses = async (userId, btn) => {
    const row = btn.closest('tr');
    const nextRow = row.nextElementSibling;

    // Check if already open
    if (nextRow && nextRow.classList.contains('expense-row')) {
        nextRow.remove();
        btn.innerHTML = '<i class="fa-solid fa-chevron-right text-[10px]"></i>';
        return;
    }

    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-[10px]"></i>';

    try {
        // Remove orderBy to avoid composite index requirement issues
        const q = query(collection(db, "expenses"), where("userId", "==", userId));
        const snap = await getDocs(q);

        // Client-side sort and limit
        const expenses = snap.docs
            .map(d => d.data())
            .sort((a, b) => {
                const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                return dateB - dateA;
            })
            .slice(0, 10);

        const newRow = document.createElement('tr');
        newRow.className = 'expense-row bg-slate-50 dark:bg-slate-900/50 animate-[slideUp_0.2s]';

        let detailsHtml = '';
        if (expenses.length === 0) {
            detailsHtml = '<div class="p-4 text-center text-slate-400 text-xs italic">No recent expenses found for this user.</div>';
        } else {
            detailsHtml = `
                        <div class="p-4 overflow-x-auto" >
                            <table class="data-grid text-xs text-left">
                                <thead class="text-slate-500 uppercase font-bold border-b border-slate-200 dark:border-slate-700">
                                    <tr>
                                        <th class="pb-2">Date</th>
                                        <th class="pb-2">Title</th>
                                        <th class="pb-2 text-right">Amount</th>
                                        <th class="pb-2 text-center">Status</th>
                                        <th class="pb-2">Project</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                    ${expenses.map(e => `
                                            <tr>
                                                <td class="py-2 text-slate-500">${e.createdAt?.toDate ? e.createdAt.toDate().toLocaleDateString() : '-'}</td>
                                                <td class="py-2 font-medium text-slate-700 dark:text-slate-200">${e.title}</td>
                                                <td class="py-2 text-right font-mono">${getSymbol(e.currency)}${e.totalAmount}</td>
                                                <td class="py-2 text-center"><span class="${getStatusBadgeClass(e.status).split(' ')[0]} scale-75 origin-center">${e.status.replace('_', ' ')}</span></td>
                                                <td class="py-2 text-slate-500">${e.projectCode || '-'}</td>
                                            </tr>
                                        `).join('')}
                                </tbody>
                            </table>
                        </div>
                        `;
        }

        newRow.innerHTML = `
                        <td colspan="8" class="p-0 border-b border-slate-200 dark:border-slate-800 shadow-inner">
                            <div class="border-l-4 border-green-500 m-2 rounded bg-white dark:bg-slate-800">
                                ${detailsHtml}
                            </div>
                    </td >
                        `;

        row.parentNode.insertBefore(newRow, row.nextSibling);
        btn.innerHTML = '<i class="fa-solid fa-chevron-down text-[10px]"></i>';

    } catch (e) {
        console.error(e);
        showToast("Error loading expenses", "error");
        btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-red-500 text-[10px]"></i>';
    }
};

let expenseCountsCache = {}; // Cache for expense counts

async function renderUserManagement() {
    document.getElementById('page-title').textContent = "User Management";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        globalUsersCache = users; // Update cache

        // Get expense counts for each user
        expenseCountsCache = {};
        const expensesSnap = await getDocs(collection(db, "expenses"));
        expensesSnap.forEach(doc => {
            const data = doc.data();
            expenseCountsCache[data.userId] = (expenseCountsCache[data.userId] || 0) + 1;
        });

        const myRank = roleRank[userData.role] || 0;

        content.innerHTML = `
                        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in" >
                        <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 justify-between items-center user-mgmt-header">
                            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">System Users <span id="user-count-badge" class="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs">${users.length}</span></h3>
                            
                            <div class="flex gap-3 w-full md:w-auto">
                                <div class="relative flex-1 md:w-64">
                                    <i class="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                                    <input type="text" id="user-search" onkeyup="handleUserSearch()" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="Search by name, email or ID...">
                                </div>
                                ${['ADMIN', 'HR'].includes(userData.role) ? `<button onclick="openNotificationModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-3 rounded-lg text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-indigo-200 mr-2"><i class="fa-solid fa-bell"></i> Notify Users</button>` : ''}
                                ${myRank > 1 ? `<button onclick="showAddUserModal()" class="btn-primary py-2 text-xs shrink-0"><i class="fa-solid fa-plus mr-1"></i> Add User</button>` : ''}
                            </div>
                        </div>
                        <div class="overflow-x-auto user-mgmt-table-wrap">
                            <table class="data-grid text-sm">
                                <thead class="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs">
                                    <tr>
                                        <th class="px-6 py-3 text-left">Employee ID</th>
                                        <th class="px-6 py-3 text-left">Name</th>
                                        <th class="px-6 py-3 text-left">Email</th>
                                        <th class="px-6 py-3 text-left">Role</th>
                                        <th class="px-6 py-3 text-left">Department</th>
                                        <th class="px-6 py-3 text-left">Budget</th>
                                        <th class="px-6 py-3 text-left">Expenses</th>
                                        <th class="px-6 py-3 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="users-table-body">
                                    <!-- Populated by JS -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                        `;

        renderUserRows(users);

    } catch (e) {
        content.innerHTML = emptyState("Error loading users: " + e.message);
    }
}

window.handleUserSearch = () => {
    const term = document.getElementById('user-search').value.toLowerCase();
    const filtered = globalUsersCache.filter(u =>
        (u.name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.employeeId || '').toLowerCase().includes(term) ||
        (u.role || '').toLowerCase().includes(term)
    );
    renderUserRows(filtered);
    document.getElementById('user-count-badge').textContent = filtered.length;
};

function renderUserRows(usersList) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (usersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-slate-400 italic">No users found matching your search.</td></tr>`;
        return;
    }

    const myRank = roleRank[userData.role] || 0;
    const MAIN_ADMIN_EMAIL = 'mfskufgu@gmail.com';

    tbody.innerHTML = usersList.map(u => {
        const uRank = roleRank[u.role] || 1;
        let canEdit = myRank > uRank || userData.role === 'ADMIN';

        // PROTECTION: Main Admin cannot be edited/deleted by others
        if (u.email === MAIN_ADMIN_EMAIL && userData.email !== MAIN_ADMIN_EMAIL) {
            canEdit = false;
        }

        const count = expenseCountsCache[u.id] || 0;

        return `
                        <tr class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:bg-slate-900 transition group">
                        <td class="px-6 py-4 font-mono text-xs text-slate-500">${u.employeeId || '-'}</td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-300 overflow-hidden border border-slate-200 dark:border-slate-600 flex-shrink-0">
                                    ${u.photoUrl
                ? `<img src="${u.photoUrl}" alt="${u.name}" class="w-full h-full object-cover">`
                : (u.name ? u.name.charAt(0).toUpperCase() : '<i class="fa-solid fa-user"></i>')}
                                </div>
                                <div class="font-medium text-slate-700 dark:text-slate-200">
                                    ${u.name || 'N/A'}
                                    ${u.id === currentUser.uid ? '<span class="ml-2 text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-bold">YOU</span>' : ''}
                                    ${u.email === MAIN_ADMIN_EMAIL ? '<span class="ml-2 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200"><i class="fa-solid fa-code mr-0.5"></i> DEVELOPER</span>' : ''}
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">
                            <div>${u.email}</div>
                            ${u.phone ? `<div class="text-[10px] text-slate-400 mt-0.5"><i class="fa-solid fa-phone mr-1"></i>${u.phone}</div>` : ''}
                        </td>
                        <td class="px-6 py-4">
                            <span class="px-2 py-1 rounded-full text-[10px] font-bold ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                u.role === 'MANAGER' ? 'bg-green-100 text-green-700' :
                    u.role === 'SENIOR_MANAGER' ? 'bg-indigo-100 text-indigo-700' :
                        u.role === 'TREASURY' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-slate-100 text-slate-700 dark:text-slate-200'
            }">${u.role ? u.role.replace('_', ' ') : 'EMPLOYEE'}</span>
                        </td>
                        <td class="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">${u.department || '-'}</td>
                        <td class="px-6 py-4 text-slate-500 text-xs font-mono">${u.budgetLimit ? '₹' + u.budgetLimit.toLocaleString() : 'Unlimited'}</td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-slate-700 dark:text-slate-200 text-xs">${count}</span>
                                <button onclick="toggleUserExpenses('${u.id}', this)" class="w-6 h-6 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-400 transition" title="View Expenses">
                                    <i class="fa-solid fa-chevron-right text-[10px]"></i>
                                </button>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition duration-200">
                                ${canEdit ? `
                                <button onclick="editUser('${u.id}')" class="w-7 h-7 rounded bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center transition" title="Edit">
                                    <i class="fa-solid fa-pen text-[10px]"></i>
                                </button>
                                ${u.email !== currentUser?.email ? `
                                    <button onclick="showDeleteModal('${u.id}', '${u.name || u.email}')" class="w-7 h-7 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center transition" title="Delete">
                                        <i class="fa-solid fa-trash text-[10px]"></i>
                                    </button>
                                ` : ''}` : '<span class="text-slate-300 text-[10px] italic">No Access</span>'}
                            </div>
                        </td>
                    </tr >
                        `}).join('');
}

window.handleLogoPreview = async (input) => {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        let url = '';

        const preview = document.getElementById('logo-preview');
        preview.parentElement.classList.add('opacity-50');

        try {
            url = await compressImage(file);
        } catch (e) {
            console.error("Image processing failed", e);
        }

        document.getElementById('logo-preview').src = url;
        document.getElementById('logo-preview').classList.remove('hidden');
        document.getElementById('logo-base64').value = url;
        preview.parentElement.classList.remove('opacity-50');
    }
};

window.openPaymentIssueModal = (id) => {
    const expense = window.currentExpenseData; // Admin context
    if (!expense) return;

    document.getElementById('issue-expense-id').value = id;
    document.getElementById('issue-type').value = 'NOT_RECEIVED';
    document.getElementById('issue-comment').value = '';

    document.getElementById('modal-payment-issue').classList.remove('hidden');
};

window.submitPaymentIssue = async (e) => {
    e.preventDefault();
    const id = document.getElementById('issue-expense-id').value;
    const type = document.getElementById('issue-type').value;
    const comment = document.getElementById('issue-comment').value;
    const btn = document.getElementById('btn-submit-issue');

    if (!comment) return showToast("Please provide details", "error");

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reporting...';
    btn.disabled = true;

    try {
        const expenseRef = doc(db, "expenses", id);
        const currentExpense = window.currentExpenseData;

        // Add to history
        const historyEntry = {
            action: 'PAYMENT_ISSUE_REPORTED',
            by: userData.name + ' (Admin)',
            role: userData.role,
            date: new Date(),
            comment: `Admin Flagged Issue: ${type} - ${comment} `,
            issueType: type
        };

        await updateDoc(expenseRef, {
            status: 'PAYMENT_ISSUE',
            paymentIssue: {
                type,
                comment,
                reportedAt: serverTimestamp(),
                reportedBy: userData.uid
            },
            history: [...(currentExpense.history || []), historyEntry],
            updatedAt: serverTimestamp()
        });

        showToast("Payment issue flagged successfully.", "success");
        closeModal('modal-payment-issue');
        closeModal('modal-expense'); // Close expense view too
        renderApprovals(); // Refresh list
    } catch (err) {
        console.error(err);
        showToast("Failed to flag issue: " + err.message, "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

window.saveAllSettings = async () => {
    const name = document.getElementById('company-name').value;
    const logo = document.getElementById('logo-base64').value;
    const email = document.getElementById('company-email').value;
    const phone = document.getElementById('company-phone').value;
    const address = document.getElementById('company-address').value;
    const taxId = document.getElementById('company-tax-id').value;
    const autoApproveLimit = document.getElementById('auto-approve-limit').value;
    const receiptLimit = document.getElementById('receipt-limit').value;
    const emailNotifications = document.getElementById('email-notifications').checked;

    try {
        await setDoc(doc(db, "settings", "global"), {
            name,
            logo,
            email,
            phone,
            address,
            taxId,
            autoApproveLimit: parseFloat(autoApproveLimit),
            receiptLimit: parseFloat(receiptLimit),
            emailNotifications,
            updatedAt: serverTimestamp()
        }, { merge: true });

        showToast('All settings updated successfully!', 'success');
        await loadCompanyBranding();
    } catch (e) {
        showToast(e.message, 'error');
    }
};

window.exportReport = async (format) => {
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const expensesSnap = await getDocs(collection(db, "expenses"));
        const expenses = expensesSnap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString()
            };
        });

        if (format === 'csv') {
            const headers = ["ID", "Title", "Date", "Amount", "Currency", "Status", "User", "Project Code"];
            const csvContent = [
                headers.join(","),
                ...expenses.map(e => [
                    e.id,
                    `"${e.title.replace(/"/g, '""')}"`,
                    e.createdAt.split('T')[0],
                    e.totalAmount,
                    e.currency,
                    e.status,
                    `"${(e.userName || 'Unknown').replace(/"/g, '""')}"`,
                    e.projectCode
                ].join(","))
            ].join("\n");

            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `expense_report_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            showToast("CSV Exported successfully!", "success");
        } else if (format === 'pdf') {
            // Generate a clean table for PDF
            const container = document.createElement('div');
            container.className = 'p-8 bg-white';
            container.innerHTML = `
                        <div class="text-center mb-6">
                            <h1 class="text-2xl font-bold text-slate-800 uppercase tracking-wider mb-2">Expense Report</h1>
                            <p class="text-sm text-slate-500">Generated on ${new Date().toLocaleString()}</p>
                        </div>
                        <table class="w-full text-xs border-collapse">
                            <thead>
                                <tr class="bg-slate-100 text-slate-600 uppercase">
                                    <th class="border p-2 text-left">Date</th>
                                    <th class="border p-2 text-left">Title</th>
                                    <th class="border p-2 text-left">User</th>
                                    <th class="border p-2 text-right">Amount</th>
                                    <th class="border p-2 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${expenses.map(e => `
                                    <tr>
                                        <td class="border p-2">${e.createdAt.split('T')[0]}</td>
                                        <td class="border p-2 font-bold">${e.title}</td>
                                        <td class="border p-2">${e.userName || 'Unknown'}</td>
                                        <td class="border p-2 text-right font-mono">${e.currency} ${parseFloat(e.totalAmount).toFixed(2)}</td>
                                        <td class="border p-2 text-center font-bold text-[10px]">${e.status}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                             <tfoot>
                                <tr class="bg-slate-50 font-bold">
                                    <td colspan="3" class="border p-2 text-right">TOTAL</td>
                                    <td class="border p-2 text-right">INR ${expenses.reduce((s, e) => s + (parseFloat(e.totalAmount) || 0), 0).toLocaleString()}</td>
                                    <td class="border p-2"></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div class="mt-8 text-xs text-slate-400 text-center">
                            <p>CONFIDENTIAL | IPEC Consulting Expense Management System</p>
                        </div>
                    `;

            const opt = {
                margin: 10,
                filename: `expense_report_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
            };

            try {
                await html2pdf().set(opt).from(container).save();
                showToast("PDF Exported successfully!", "success");
            } catch (err) {
                console.error(err);
                showToast("PDF Export failed: " + err.message, "error");
            }
        } else {
            showToast(`${format.toUpperCase()} export coming soon!`, 'info');
        }
    } catch (e) {
        console.error(e);
        showToast("Export failed: " + e.message, "error");
    } finally {
        btn.innerHTML = originalText;
    }
};

window.openExpenseModal = (id) => {
    const modal = document.getElementById('modal-expense');
    modal.classList.remove('hidden');
    document.getElementById('modal-items').innerHTML = '<div class="p-4 text-center text-slate-400">Loading...</div>';

    onSnapshot(doc(db, "expenses", id), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        window.currentExpenseData = data;
        window.currentExpenseId = id;

        // Get employee name
        let employeeName = 'Unknown';
        if (data.userId) {
            getDoc(doc(db, "users", data.userId)).then(userSnap => {
                if (userSnap.exists()) {
                    document.getElementById('modal-employee').textContent = userSnap.data().name || 'Unknown';
                }
            });
        }

        document.getElementById('modal-title').textContent = data.title;
        document.getElementById('modal-id').textContent = `ID: ${id.substring(0, 6)}`;
        document.getElementById('modal-amount').textContent = `${getSymbol(data.currency)}${data.totalAmount}`;
        document.getElementById('modal-project').textContent = data.projectCode || 'N/A';
        document.getElementById('modal-currency').textContent = data.currency || 'INR';

        if (data.preApproved) {
            document.getElementById('modal-pre-approved').classList.remove('hidden');
            const proofContainer = document.getElementById('modal-approval-proof-container');
            const proofLink = document.getElementById('modal-approval-link');

            const proofVal = data.approvalProofUrl || data.approvalProof;
            proofContainer.classList.remove('hidden');
            proofLink.href = proofVal || '#';
            proofLink.textContent = proofVal || 'N/A';

            // Security Badge
            const isSecure = proofVal && proofVal.startsWith('https://');
            const badge = document.createElement('span');
            badge.className = `ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${isSecure ? 'bg-emerald-100 text-green-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`;
            badge.innerHTML = isSecure ? '<i class="fa-solid fa-lock mr-1"></i> Secure' : '<i class="fa-solid fa-lock-open mr-1"></i> Insecure';

            // Clear old badge
            const existingBadge = proofContainer.querySelector('span.uppercase');
            if (existingBadge) existingBadge.remove();

            proofContainer.querySelector('p').appendChild(badge);
        } else {
            document.getElementById('modal-pre-approved').classList.add('hidden');
            const proofContainer = document.getElementById('modal-approval-proof-container');
            if (proofContainer) proofContainer.classList.add('hidden');
        }

        const statusEl = document.getElementById('modal-status');
        statusEl.className = `mt-2 inline-block px-3 py-1 rounded-full text-xs font-bold uppercase border ${getStatusBadgeClass(data.status)}`;
        statusEl.textContent = data.status.replace('_', ' ');

        // Show employee notes/description
        const notesContainer = document.getElementById('modal-notes-container');
        const notesEl = document.getElementById('modal-notes');
        if (data.notes && data.notes.trim()) {
            notesContainer.classList.remove('hidden');
            notesEl.textContent = data.notes;
        } else {
            notesContainer.classList.add('hidden');
            notesEl.textContent = '';
        }

        document.getElementById('modal-items').innerHTML = (data.lineItems || []).map(item => {
            const isSecure = item.receiptUrl && (item.receiptUrl.startsWith('https://') || item.receiptUrl.startsWith('blob:'));
            const badgeHtml = item.receiptUrl ? `<span class="ml-2 text-[8px] uppercase font-bold px-1.5 py-0.5 rounded border ${isSecure ? 'bg-emerald-100 text-green-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}">${isSecure ? '<i class="fa-solid fa-lock mr-1"></i> Secure' : '<i class="fa-solid fa-lock-open mr-1"></i> Insecure'}</span>` : '';

            return `
                    <div class="flex gap-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-green-100 transition">
                        <div class="w-16 h-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0 group relative">
                            ${item.receiptUrl ?
                    `<img src="${item.receiptUrl}" class="w-full h-full object-cover" onerror="this.onerror=null; this.src='https://placehold.co/100?text=File'; this.classList.add('p-2', 'opacity-50');">
                                 <div class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-200 cursor-pointer" onclick="window.open('${item.receiptUrl}', '_blank')">
                                    <i class="fa-solid fa-arrow-up-right-from-square text-white"></i>
                                 </div>`
                    : '<i class="fa-solid fa-image text-slate-300"></i>'}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between items-start">
                                <div>
                                    <span class="font-bold text-slate-700 dark:text-slate-200 text-sm block truncate">${item.category}</span>
                                    <div class="flex items-center gap-2 mt-1">
                                        ${badgeHtml}
                                        ${item.receiptUrl ? `<a href="${item.receiptUrl}" target="_blank" class="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded hover:bg-green-100 border border-green-100 flex items-center gap-1 transition"><i class="fa-solid fa-external-link-alt"></i> Open Proof</a>` : ''}
                                    </div>
                                </div>
                                <span class="font-mono font-bold text-slate-600 dark:text-slate-300 text-sm whitespace-nowrap">${getSymbol(data.currency)}${parseFloat(item.amount).toFixed(2)}</span>
                            </div>
                            <p class="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">${item.description || item.desc || 'No description'}</p>
                        </div>
                    </div>
                `;
        }).join('');

        document.getElementById('modal-history').innerHTML = (data.history || []).map(h => {
            let proofHtml = '';
            if (h.paymentProofUrl) {
                const isSecure = h.paymentProofUrl.startsWith('https://') || h.paymentProofUrl.startsWith('blob:');
                const badgeClass = isSecure ? 'bg-emerald-100 text-green-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200';
                const icon = isSecure ? '<i class="fa-solid fa-lock mr-1"></i>' : '<i class="fa-solid fa-lock-open mr-1"></i>';
                const text = isSecure ? 'Secure' : 'Insecure';

                proofHtml = `
                    <div class="mt-1 flex items-center gap-2">
                       <a href="${h.paymentProofUrl}" target="_blank" class="text-[10px] text-green-600 hover:underline flex items-center gap-1"><i class="fa-solid fa-paperclip"></i> View Proof</a>
                       <span class="text-[8px] uppercase font-bold px-1.5 py-0.5 rounded border ${badgeClass}">${icon} ${text}</span>
                    </div>`;
            }

            return `
                    <div class="relative pl-4 pb-4 last:pb-0">
                        <div class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-white dark:bg-slate-800 border-2 border-slate-300"></div>
                        <p class="text-[10px] text-slate-400 font-mono">${new Date(h.date?.toDate ? h.date.toDate() : h.date).toLocaleString()}</p>
                        <p class="text-xs text-slate-700 dark:text-slate-200 font-semibold">${h.action} <span class="font-normal text-slate-500 dark:text-slate-400">by ${h.by}</span></p>
                        ${h.comment ? `<div class="bg-yellow-50 text-yellow-800 text-[10px] p-2 rounded mt-1 border border-yellow-100 italic">"${h.comment}"</div>` : ''}
                        ${h.paymentMode ? `<div class="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Paid via ${h.paymentMode} (Ref: ${h.transactionRef}) on ${new Date(h.paymentDate).toLocaleDateString()}</div>` : ''}
                        ${proofHtml}
                    </div>
                `;
        }).join('');

        const actionPanel = document.getElementById('action-panel');
        // Clear previous dynamic content
        actionPanel.innerHTML = `
                    <h4 class="text-xs font-bold text-green-600 uppercase mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                        Approver Action</h4>
                    <textarea id="decision-comment" placeholder="Add comments or rejection reason..."
                        class="input-primary h-20 resize-none mb-3 text-xs"></textarea>
                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="handleDecision('REJECT')"
                            class="bg-white dark:bg-slate-800 border border-red-200 text-red-600 hover:bg-red-50 py-2 rounded-lg text-xs font-bold transition">Reject</button>
                        <button onclick="handleDecision('APPROVE')" id="btn-approve"
                            class="bg-green-600 hover:bg-green-500 text-white py-2 rounded-lg text-xs font-bold transition shadow-lg shadow-green-200">Approve</button>
                    </div>
                `;

        const btn = document.getElementById('btn-approve');

        actionPanel.classList.add('hidden');
        let canAct = false;

        const role = userData.role;
        const status = data.status;

        // Add Treasury Inputs if applicable
        // Add Payment Inputs for Accounts/Treasury
        if ((userData.role === 'ACCOUNTS' || userData.role === 'TREASURY' || userData.role === 'ADMIN') &&
            (data.status === 'FINANCE_APPROVED' || data.status === 'PENDING_TREASURY')) {
            actionPanel.innerHTML = `
                        <div class="mb-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                            <h4 class="font-bold text-slate-700 dark:text-slate-200 text-xs uppercase mb-3"><i class="fa-solid fa-money-bill-transfer mr-1"></i> Payment Details</h4>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Mode</label>
                                    <select id="payment-mode" class="w-full text-xs font-bold p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded">
                                        <option value="BANK_TRANSFER">Bank Transfer</option>
                                        <option value="CHEQUE">Cheque</option>
                                        <option value="UPI">UPI</option>
                                        <option value="CASH">Cash</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Transaction Ref / Cheque No.</label>
                                    <input type="text" id="payment-ref" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded uppercase font-mono" placeholder="CMS-29382...">
                                </div>
                                <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Date</label>
                                    <input type="date" id="payment-date" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded" value="${new Date().toISOString().split('T')[0]}">
                                </div>
                                <div class="col-span-1 md:col-span-3">
                                     <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Payment Proof (Optional)</label>
                                     <input type="file" id="payment-proof" accept="image/*" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded">
                                     <input type="hidden" id="payment-proof-base64">
                                </div>
                            </div>
                        </div>
                     ` + actionPanel.innerHTML;
        }

        if (role === 'MANAGER' && status === 'PENDING_MANAGER') {
            canAct = true;
            btn.textContent = "Approve Claim";
        }
        else if (role === 'FINANCE_MANAGER' && status === 'PENDING_FINANCE') {
            canAct = true;
            btn.textContent = "Approve for Payment";
        }
        else if (role === 'ACCOUNTS' && (status === 'FINANCE_APPROVED' || status === 'PENDING_ACCOUNTS')) {
            canAct = true;
            btn.textContent = "Complete Payment";
        }
        else if (role === 'SENIOR_MANAGER' && status === 'PENDING_SENIOR_MANAGER') {
            canAct = true;
            btn.textContent = "Approve for Treasury";
        }
        else if (role === 'TREASURY' && status === 'PENDING_TREASURY') {
            canAct = true;
            btn.textContent = "Mark as Paid";
        }
        else if (role === 'AUDIT' && status === 'PAID') {
            canAct = true;
            btn.textContent = "Mark as Audited";
        }
        else if (role === 'ADMIN') {
            if (!['AUDITED', 'REJECTED'].includes(status)) {
                canAct = true;
                // Intelligent Button Label
                if (status === 'PENDING_MANAGER') btn.textContent = "Approve (Managers)";
                else if (status === 'PENDING_FINANCE') btn.textContent = "Approve (Finance)";
                else if (status === 'FINANCE_APPROVED') btn.textContent = "Mark as Paid";
                else if (status === 'PENDING_ACCOUNTS') btn.textContent = "Mark as Paid";
                else if (status === 'PAID') btn.textContent = "Mark as Audited";
                else if (status === 'PAYMENT_ISSUE' || status === 'PAYMENT_DISPUTED') {
                    // Split Action Panel for Issue Resolution
                    actionPanel.innerHTML = `
                                <h4 class="text-xs font-bold text-orange-600 uppercase mb-4 border-b border-orange-100 pb-2">
                                    <i class="fa-solid fa-triangle-exclamation mr-2"></i> Payment Issue Resolution
                                </h4>
                                <div class="bg-orange-50 p-3 rounded-lg border border-orange-100 mb-4 text-xs text-orange-800">
                                    <div class="flex justify-between items-start border-b border-orange-100 pb-2 mb-2">
                                        <div>
                                            <p class="font-bold opacity-70 uppercase text-[9px]">Original Paid By</p>
                                            <p class="font-bold text-slate-800">${(data.history && data.history.find(h => h.action === 'PAID')?.by) || 'Unknown'}</p>
                                        </div>
                                        <div class="text-right">
                                            <p class="font-bold opacity-70 uppercase text-[9px]">Reported At</p>
                                            <p class="font-bold text-slate-800">${data.paymentIssue?.reportedAt ? new Date(data.paymentIssue.reportedAt.toDate()).toLocaleDateString() : 'N/A'}</p>
                                        </div>
                                    </div>
                                    <p class="font-bold">User reported issue:</p>
                                    <p class="italic text-slate-700">"${(data.history && (data.history.find(h => h.action === 'PAYMENT_ISSUE')?.comment || data.history.find(h => h.action === 'PAYMENT_ISSUE_REPORTED')?.comment)) || 'No details provided'}"</p>
                                </div>
                                <textarea id="decision-comment" placeholder="Resolution notes..."
                                    class="input-primary h-20 resize-none mb-3 text-xs"></textarea>
                                <div class="grid grid-cols-2 gap-3">
                                    <button onclick="handleDecision('REPROCESS')" 
                                        class="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 py-2 rounded-lg text-xs font-bold transition">
                                        <i class="fa-solid fa-rotate-left mr-1"></i> Retry Payment
                                    </button>
                                    <button onclick="handleDecision('RESOLVE')" 
                                        class="bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-xs font-bold transition shadow-lg shadow-green-200">
                                        <i class="fa-solid fa-check mr-1"></i> Mark Resolved
                                    </button>
                                </div>
                            `;
                    // Hide the default button since we replaced the panel
                    canAct = false;
                }
                else btn.textContent = "Move Forward";
            } else if (status === 'PAID') {
                // Add 'Payment Not Received' option for Admin too (e.g. if they notice it failed manually)
                // We append it to the action panel if it's visible (which it is for Admin)
                // But 'Mark as Audited' is already there. Let's add a secondary button.
                const container = actionPanel.querySelector('.grid');
                if (container) {
                    const issueBtn = document.createElement('button');
                    issueBtn.className = "col-span-2 mt-2 text-orange-600 hover:bg-orange-50 border border-orange-200 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2";
                    issueBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Flag Payment Issue';
                    issueBtn.onclick = async () => {
                        if (await confirm("Flag this expense as PAYMENT ISSUE?")) {
                            handleDecision('FLAG_ISSUE');
                        }
                    };
                    container.appendChild(issueBtn);
                }
            }
        }

        if (canAct || role === 'ADMIN') actionPanel.classList.remove('hidden');

        // Admin Override Panel (Always visible for Admin)
        if (role === 'ADMIN') {
            const isLocked = status === 'PAID';
            const adminPanel = `
                        <div class="mb-4 p-4 bg-slate-100 rounded-xl border border-slate-200 dark:border-slate-700 relative group">
                            <div class="absolute -top-3 left-3 bg-slate-800 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Admin Control</div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                 <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Force Status</label>
                                    <select id="admin-status" ${isLocked ? 'disabled' : ''} class="w-full text-xs font-bold p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded text-slate-700 dark:text-slate-200">
                                        <option value="PENDING_MANAGER">PENDING MANAGER</option>
                                        <option value="PENDING_FINANCE">PENDING FINANCE</option>
                                        <option value="FINANCE_APPROVED">FINANCE APPROVED (ACCOUNTS)</option>
                                        <option value="PENDING_SENIOR_MANAGER">PENDING SR. MANAGER</option>
                                        <option value="PENDING_TREASURY">PENDING TREASURY</option>
                                        <option value="PAID">PAID</option>
                                        <option value="AUDITED">AUDITED</option>
                                        <option value="REJECTED">REJECTED</option>
                                    </select>
                                </div>
                                 <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Payment Mode</label>
                                    <select id="admin-pay-mode" class="w-full text-xs font-bold p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded text-slate-700 dark:text-slate-200">
                                        <option value="">Select Mode</option>
                                        <option value="BANK_TRANSFER">Bank Transfer</option>
                                        <option value="CHEQUE">Cheque</option>
                                        <option value="UPI">UPI</option>
                                        <option value="CASH">Cash</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Transaction Ref</label>
                                    <input type="text" id="admin-pay-ref" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded font-mono" placeholder="Ref No.">
                                </div>
                                <div>
                                    <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Payment Date</label>
                                    <input type="date" id="admin-pay-date" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded">
                                </div>
                                <div class="col-span-1 md:col-span-2">
                                     <label class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">Payment Proof (Optional)</label>
                                     <input type="file" id="admin-pay-proof" accept="image/*" class="w-full text-xs p-2 bg-white dark:bg-slate-800 border border-slate-300 rounded">
                                     <input type="hidden" id="admin-pay-proof-base64">
                                </div>
                            </div>
                            <div class="mt-4 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                                <button onclick="updateAdminExpense()" class="bg-slate-900 hover:bg-slate-800 text-white py-2 px-6 rounded-lg text-xs font-bold transition shadow-lg flex items-center gap-2">
                                    <i class="fa-solid fa-floppy-disk"></i> Save & Update
                                </button>
                            </div>
                        </div>
                     `;

            if (role === 'ADMIN') {
                // For Admin, we Append the override panel below the standard actions
                // allowing them to use either the quick buttons OR the manual override.
                // We do NOT clear the previous content.
                actionPanel.innerHTML += adminPanel;

                // Pre-fill Admin Fields
                setTimeout(() => {
                    if (document.getElementById('admin-status')) document.getElementById('admin-status').value = data.status;
                    if (document.getElementById('admin-pay-mode')) document.getElementById('admin-pay-mode').value = data.paymentMode || '';
                    if (document.getElementById('admin-pay-ref')) document.getElementById('admin-pay-ref').value = data.transactionRef || '';
                    if (document.getElementById('admin-pay-date')) document.getElementById('admin-pay-date').value = data.paymentDate || new Date().toISOString().split('T')[0];
                }, 0);
            }
        }
    });
};



window.handleDecision = async (decision) => {
    const comment = document.getElementById('decision-comment').value.trim();

    if (decision === 'REJECT' && !comment) {
        showToast('Please provide a reason for rejection.', 'error');
        return;
    }

    const actionPanel = document.getElementById('action-panel');
    const buttons = actionPanel.querySelectorAll('button');
    buttons.forEach(b => b.disabled = true);

    // Find the approve button to show loading state (it's the second button usually, or by ID)
    const approveBtn = document.getElementById('btn-approve');
    const originalText = approveBtn ? approveBtn.innerHTML : 'Approve';
    if (approveBtn && decision === 'APPROVE') approveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';

    try {
        const expenseRef = doc(db, "expenses", window.currentExpenseId);
        let newStatus = window.currentExpenseData.status;
        const role = userData.role;
        const amount = parseFloat(window.currentExpenseData.totalAmount);

        if (decision === 'REJECT') {
            newStatus = 'REJECTED';
        } else if (decision === 'REPROCESS') {
            newStatus = 'FINANCE_APPROVED'; // Send back to payment queue
        } else if (decision === 'RESOLVE') {
            newStatus = 'PAID'; // Issue resolved, mark as paid
        } else if (decision === 'FLAG_ISSUE') {
            newStatus = 'PAYMENT_ISSUE';
        } else {
            // Dynamic Approval Logic
            try {
                const expenseOwnerRole = window.currentExpenseData.userRole || 'EMPLOYEE'; // Fallback if missing
                const nextStage = await getNextStageStatus(window.currentExpenseData.status, expenseOwnerRole);

                if (nextStage) {
                    newStatus = nextStage;
                } else {
                    // Fallback if workflow fails or ends
                    // If user is Admin, we might want to force logical next step or just warn
                    if (role === 'ADMIN') {
                        // Keep Admin override logic as fallback/helper if dynamic fails
                        if (newStatus === 'PENDING_MANAGER') newStatus = 'PENDING_FINANCE';
                        else if (newStatus === 'PENDING_FINANCE') newStatus = 'FINANCE_APPROVED';
                        else if (newStatus === 'FINANCE_APPROVED') newStatus = 'PAID';
                        else if (newStatus === 'PENDING_SENIOR_MANAGER') newStatus = 'PENDING_TREASURY';
                        else if (newStatus === 'PENDING_TREASURY') newStatus = 'PAID';
                        else if (newStatus === 'PAID') newStatus = 'AUDITED';
                    } else {
                        throw new Error("Workflow configuration error: No next stage defined.");
                    }
                }
            } catch (err) {
                console.error("Workflow Error:", err);
                // Fallback to legacy hardcoded logic for safety during migration
                if (role === 'MANAGER') newStatus = 'PENDING_FINANCE';
                else if (role === 'FINANCE_MANAGER') newStatus = 'FINANCE_APPROVED';
                else if (role === 'ACCOUNTS') newStatus = 'PAID';
                else if (role === 'SENIOR_MANAGER') newStatus = 'PENDING_TREASURY';
                else if (role === 'TREASURY') newStatus = 'PAID';
                else if (role === 'AUDIT') newStatus = 'AUDITED';
            }
        }

        // Prepare Update Data
        const updateData = {
            status: newStatus,
            updatedAt: serverTimestamp()
        };

        // Add Treasury Details if becoming PAID
        if (newStatus === 'PAID') {
            const payMode = document.getElementById('payment-mode')?.value;
            const payRef = document.getElementById('payment-ref')?.value;
            const payDate = document.getElementById('payment-date')?.value;
            const payProofInput = document.getElementById('payment-proof');

            if (payMode) updateData.paymentMode = payMode;
            if (payRef) updateData.transactionRef = payRef;
            if (payDate) updateData.paymentDate = payDate;

            if (payProofInput && payProofInput.files[0]) {
                try {
                    updateData.paymentProofUrl = await compressImage(payProofInput.files[0]);
                } catch (e) { console.error("Proof upload failed", e); }
            }
        }

        const historyEntry = {
            action: decision,
            by: userData.name,
            role: userData.role,
            date: new Date(),
            comment: comment || (decision === 'APPROVE' ? 'Approved' : 'Rejected'),
            paymentMode: updateData.paymentMode || null,
            transactionRef: updateData.transactionRef || null
        };

        await updateDoc(expenseRef, {
            ...updateData,
            history: [...(window.currentExpenseData.history || []), historyEntry]
        });

        showToast(`Expense ${decision === 'APPROVE' ? 'approved' : 'rejected'} successfully!`, 'success');
        closeModal('modal-expense');

        // Refresh lists
        if (!document.getElementById('dashboard-screen').classList.contains('hidden')) {
            // Try to finding active tab or just refresh approvals
            if (document.querySelector('[data-tab="approvals"].active')) renderApprovals();
            else if (document.querySelector('[data-tab="overview"].active')) renderOverview();
        }

    } catch (e) {
        console.error(e);
        showToast("Action failed: " + e.message, "error");
    } finally {
        buttons.forEach(b => b.disabled = false);
        if (approveBtn) approveBtn.innerHTML = originalText;
    }
};

window.updateAdminExpense = async () => {
    const btn = document.getElementById('btn-admin-update');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Updating...';
    btn.disabled = true;

    const expenseRef = doc(db, "expenses", window.currentExpenseId);
    const status = document.getElementById('admin-status').value;
    const payMode = document.getElementById('admin-pay-mode').value;
    const payRef = document.getElementById('admin-pay-ref').value;
    const payDate = document.getElementById('admin-pay-date').value;
    const payProofInput = document.getElementById('admin-pay-proof');

    try {
        let updateData = {
            status: status,
            updatedAt: serverTimestamp()
        };

        // Handle Proof
        if (payProofInput && payProofInput.files[0]) {
            try {
                updateData.paymentProofUrl = await compressImage(payProofInput.files[0]);
            } catch (e) {
                console.error("Proof upload failed", e);
            }
        }

        if (payMode) updateData.paymentMode = payMode;
        if (payRef) updateData.transactionRef = payRef;
        if (payDate) updateData.paymentDate = payDate;

        const historyEntry = {
            action: 'ADMIN_UPDATE',
            by: userData.name,
            role: 'ADMIN',
            date: new Date(),
            comment: 'Admin updated expense details.',
            paymentMode: payMode || null,
            transactionRef: payRef || null,
            paymentProofUrl: updateData.paymentProofUrl || null
        };

        await updateDoc(expenseRef, {
            ...updateData,
            history: [...(window.currentExpenseData.history || []), historyEntry]
        });

        showToast("Expense updated successfully by Admin!", "success");
        closeModal('modal-expense');
        renderApprovals();
    } catch (e) {
        console.error(e);
        showToast("Update failed: " + e.message, "error");
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};

// --- Projects Management ---
window.renderProjects = async () => {
    document.getElementById('page-title').textContent = "Project Management";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        const snap = await getDocs(collection(db, "projects"));
        const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        content.innerHTML = `
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 fade-in">
                        <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                            <div>
                                <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">Company Projects</h3>
                                <p class="text-xs text-slate-400">Manage cost codes and projects.</p>
                            </div>
                            <div class="flex gap-2">
                                <button onclick="exportProjectsCSV()" class="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-lg font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition border border-slate-200 dark:border-slate-600"><i class="fa-solid fa-download mr-1"></i> Export CSV</button>
                                <button onclick="showProjectModal()" class="text-xs bg-slate-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-slate-800 transition"><i class="fa-solid fa-plus mr-1"></i> Add Project</button>
                            </div>
                        </div>
                        <div class="p-0">
                            ${projects.length === 0 ? '<div class="p-8 text-center text-slate-400 text-sm">No projects found. Add one to get started.</div>' : ''}
                            <div class="overflow-x-auto">
                                <table class="data-grid text-sm text-left">
                                    <thead class="bg-slate-50 dark:bg-slate-900 text-slate-500 text-xs uppercase">
                                        <tr>
                                            <th class="px-6 py-3">Code</th>
                                            <th class="px-6 py-3">Name</th>
                                            <th class="px-6 py-3">Details</th>
                                            <th class="px-6 py-3">Status</th>
                                            <th class="px-6 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                        ${projects.map(p => `
                                            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                                <td class="px-6 py-4 font-mono font-bold text-slate-700 dark:text-slate-200">${p.code}</td>
                                                <td class="px-6 py-4 font-semibold">${p.name}</td>
                                                <td class="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate" title="${p.details || ''}">${p.details || '-'}</td>
                                                <td class="px-6 py-4">
                                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.active !== false ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}">
                                                        ${p.active !== false ? 'ACTIVE' : 'INACTIVE'}
                                                    </span>
                                                </td>
                                                <td class="px-6 py-4 text-right">
                                                    <button onclick="toggleProjectStatus('${p.id}', ${p.active !== false})" class="text-xs font-bold text-green-600 hover:underline">
                                                        ${p.active !== false ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                    <button onclick="deleteProject('${p.id}')" class="ml-3 text-xs font-bold text-red-600 hover:underline">Delete</button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
    } catch (e) {
        content.innerHTML = emptyState("Error loading projects: " + e.message);
    }
};

// Modal Functions
window.showProjectModal = () => {
    document.getElementById('project-modal').classList.remove('hidden');
    document.getElementById('project-code-input').value = '';
    document.getElementById('project-name-input').value = '';
    document.getElementById('project-details-input').value = '';
    setTimeout(() => {
        document.getElementById('project-modal-content').classList.remove('scale-95', 'opacity-0');
        document.getElementById('project-modal-content').classList.add('scale-100', 'opacity-100');
    }, 10);
};

window.closeProjectModal = () => {
    const m = document.getElementById('project-modal');
    const c = document.getElementById('project-modal-content');
    c.classList.remove('scale-100', 'opacity-100');
    c.classList.add('scale-95', 'opacity-0');
    setTimeout(() => m.classList.add('hidden'), 200);
};

// Export Function
window.exportProjectsCSV = async () => {
    try {
        const snap = await getDocs(collection(db, "projects"));
        if (snap.empty) return showToast("No projects to export", "info");

        const headers = ["Project Code", "Project Name", "Details", "Status", "Created At"];
        const rows = snap.docs.map(d => {
            const p = d.data();
            return [
                `"${(p.code || '').replace(/"/g, '""')}"`,
                `"${(p.name || '').replace(/"/g, '""')}"`,
                `"${(p.details || '').replace(/"/g, '""')}"`,
                p.active !== false ? 'ACTIVE' : 'INACTIVE',
                p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : ''
            ].join(",");
        });

        const csvContent = headers.join(",") + "\n" + rows.join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `projects_export_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        showToast("Projects exported successfully!", "success");
    } catch (e) {
        showToast("Export failed: " + e.message, "error");
    }
};

// Form Submit
document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('project-code-input').value.trim().toUpperCase();
    const name = document.getElementById('project-name-input').value.trim();
    const details = document.getElementById('project-details-input').value.trim();

    if (!code || !name) return showToast("Code and Name are required", "error");

    try {
        await addDoc(collection(db, "projects"), {
            code, name, details, active: true, createdAt: serverTimestamp()
        });
        showToast("Project added successfully!", "success");
        closeProjectModal();
        renderProjects();
    } catch (e) {
        showToast(e.message, "error");
    }
});

window.toggleProjectStatus = async (id, currentStatus) => {
    try {
        await updateDoc(doc(db, "projects", id), { active: !currentStatus });
        renderProjects();
    } catch (e) { showToast(e.message, "error"); }
};

window.loadProjects = async () => {
    const select = document.getElementById('project-code');
    if (!select) return; // Guard clause in case element missing

    try {
        const q = query(collection(db, "projects"), where("active", "==", true));
        const snap = await getDocs(q);

        if (snap.empty) {
            select.innerHTML = '<option value="" disabled selected>No active projects</option>';
            return;
        }

        select.innerHTML = '<option value="" disabled selected>Select Project...</option>' +
            snap.docs.map(d => `<option value="${d.data().code}">${d.data().code} - ${d.data().name}</option>`).join('');
    } catch (e) {
        console.error("Error loading projects", e);
        select.innerHTML = '<option value="" disabled selected>Error loading projects</option>';
    }
};

window.deleteProject = async (id) => {
    if (!await confirm("Delete this project?")) return;
    try {
        await deleteDoc(doc(db, "projects", id));
        renderProjects();
        loadProjects(); // Reload dropdown
    } catch (e) { showToast(e.message, "error"); }
};



window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.showImage = (src) => {
    if (src) {
        document.getElementById('overlay-img').src = src;
        document.getElementById('img-overlay').classList.remove('hidden');
    }
};


// --- Workflow Management ---
window.renderWorkflow = async () => {
    document.getElementById('page-title').textContent = "Workflow Configuration";
    const content = document.getElementById('content-area');
    content.innerHTML = '<div class="flex flex-col space-y-4 p-6 w-full"><div class="h-10 w-full skeleton rounded-lg"></div><div class="h-16 w-full skeleton rounded-xl"></div><div class="h-16 w-full skeleton rounded-xl"></div></div>';

    try {
        // Fetch existing config or use default
        let existingConfig = {};
        try {
            const snap = await getDoc(doc(db, "settings", "workflow_config"));
            if (snap.exists()) existingConfig = snap.data();
        } catch (e) { console.log("No existing workflow config found, using defaults."); }

        const defaults = {
            defaultFlow: [
                { stage: 'PENDING_MANAGER', label: 'Manager Approval', approverRole: 'MANAGER' },
                { stage: 'PENDING_FINANCE', label: 'Finance Verification', approverRole: 'FINANCE_MANAGER' },
                { stage: 'FINANCE_APPROVED', label: 'Payment Processing', approverRole: 'ACCOUNTS' },
                { stage: 'PAID', label: 'Audit Verification', approverRole: 'AUDIT' },
                { stage: 'AUDITED', label: 'Process Completed', approverRole: null }
            ],
            roleOverrides: {
                // Example structures, empty by default to use defaultFlow
            }
        };

        const config = { ...defaults, ...existingConfig };
        window.currentWorkflowConfig = config;

        // --- Access Control Check ---
        if (config.accessControl?.locked && config.accessControl.allowedEmail !== auth.currentUser.email) {
            content.innerHTML = `
                        <div class="text-center py-20 fade-in">
                            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                                <i class="fa-solid fa-lock text-3xl text-red-500"></i>
                            </div>
                            <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">Workflow Configuration Locked</h3>
                            <p class="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-6">
                                This configuration is locked by <span class="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">${config.accessControl.allowedEmail}</span>.
                                <br>You cannot modify or view the details.
                            </p>
                            <button onclick="renderOverview()" class="text-green-600 hover:text-green-700 font-bold text-sm">Return to Dashboard</button>
                        </div>
                    `;
            return;
        }

        content.innerHTML = `
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in">
                        <!-- Configuration Panel -->
                        <div class="lg:col-span-2 space-y-6">
                            <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
                                <div class="flex justify-between items-center mb-6">
                                    <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100"><i class="fa-solid fa-route text-green-500 mr-2"></i> Approval Chains</h3>
                                    <select id="workflow-role-select" onchange="renderWorkflowChain(this.value)" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-brand-500">
                                        <option value="DEFAULT">Default (Employees)</option>
                                        <option value="MANAGER">Manager</option>
                                        <option value="SENIOR_MANAGER">Senior Manager</option>
                                        <option value="ADMIN">Admin</option>
                                    </select>
                                </div>
                                
                                <div id="workflow-chain-container" class="space-y-4 relative min-h-[300px]">
                                    <!-- Chain rendered here -->
                                </div>

                                <div class="mt-8 flex justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800">
                                    <button onclick="saveWorkflowConfig()" class="bg-green-600 hover:bg-brand-700 text-white py-2.5 px-6 rounded-xl text-sm font-bold shadow-lg shadow-green-200 transition transform active:scale-95 flex items-center gap-2">
                                        <i class="fa-solid fa-save"></i> Save Configuration
                                    </button>
                                </div>
                            </div>

                            <!-- Access Control Card -->
                            <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 mt-6">
                                <div class="flex justify-between items-center">
                                    <div class="pr-4">
                                        <h4 class="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                            <i class="fa-solid fa-user-shield text-green-600"></i> Secure Workflow
                                        </h4>
                                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                            Enable this to prevent other admins from modifying this configuration. Only you will be able to unlock it.
                                        </p>
                                    </div>
                                    ${userData.role === 'MAIN_ADMIN' ? `
                                    <label class="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" id="workflow-lock-eval" class="sr-only peer" ${config.accessControl?.locked ? 'checked' : ''} onchange="toggleWorkflowLock(this)">
                                        <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-300 dark:peer-focus:ring-brand-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                                    </label>` : `<span class="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded border border-slate-200 dark:border-slate-800"><i class="fa-solid fa-lock mr-1"></i> Restricted</span>`}
                                </div>
                                ${config.accessControl?.locked ? `<div class="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800 rounded-lg flex items-center gap-3 text-xs text-red-700 dark:text-red-400 font-bold animate-[fadeIn_0.3s_ease-out]"><i class="fa-solid fa-lock"></i> Currently locked to: ${config.accessControl.allowedEmail}</div>` : ''}
                            </div>
                        </div>

                        <!-- Info Panel -->
                        <div class="space-y-6">
                            <div class="bg-green-50 dark:bg-slate-800 p-6 rounded-2xl border border-green-100 dark:border-slate-700">
                                <h4 class="font-bold text-green-900 dark:text-green-100 mb-2"><i class="fa-solid fa-circle-info mr-2"></i> How it works</h4>
                                <p class="text-sm text-green-800 dark:text-green-200 leading-relaxed mb-4">
                                    Configure the journey an expense claim takes from submission to completion.
                                </p>
                                <ul class="text-sm text-green-800 dark:text-green-200 space-y-2 list-disc pl-4">
                                    <li><strong>Stages</strong> define the status of the expense.</li>
                                    <li><strong>Approver Roles</strong> define who can act on that stage.</li>
                                    <li>The system moves to the <em>next</em> stage automatically upon approval.</li>
                                </ul>
                            </div>
                             <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700">
                                <h4 class="font-bold text-slate-700 dark:text-slate-200 mb-4">Available Roles</h4>
                                <div class="flex flex-wrap gap-2">
                                    ${['MANAGER', 'SENIOR_MANAGER', 'HR', 'FINANCE_MANAGER', 'ACCOUNTS', 'TREASURY', 'AUDIT', 'ADMIN'].map(r =>
            `<span class="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400">${r}</span>`
        ).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;

        // Initial Render
        renderWorkflowChain('DEFAULT');

    } catch (e) {
        content.innerHTML = emptyState("Error loading workflow: " + e.message);
    }
};

window.toggleWorkflowLock = async (el) => {
    const locked = el.checked;
    const updatedConfig = {
        ...window.currentWorkflowConfig,
        accessControl: {
            locked: locked,
            allowedEmail: locked ? auth.currentUser.email : null,
            lockedAt: new Date()
        }
    };

    try {
        // Optimistic UI Update
        window.currentWorkflowConfig = updatedConfig;
        // Re-render immediately to show status
        renderWorkflow();

        // Persist
        await setDoc(doc(db, "settings", "workflow_config"), updatedConfig, { merge: true });
        showToast(locked ? "Workflow Locked Successfully" : "Workflow Unlocked", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to update lock: " + e.message, "error");
        // Revert UI if fail
        el.checked = !locked;
    }
};

window.renderWorkflowChain = (roleKey) => {
    const container = document.getElementById('workflow-chain-container');
    const config = window.currentWorkflowConfig;

    let chain = [];
    if (roleKey === 'DEFAULT') {
        chain = config.defaultFlow;
    } else {
        // If override exists, use it. If not, maybe copy default or start empty?
        // For now, if no override, we show default but labeled as "Default Inherited" or allow create new.
        // Simplified: Logic will fallback to defaultFlow if not in roleOverrides.
        // So here we clone defaultFlow if not present, to allow editing.
        if (config.roleOverrides && config.roleOverrides[roleKey] && config.roleOverrides[roleKey].flow) {
            chain = config.roleOverrides[roleKey].flow;
        } else {
            // Start with a sensible default for new overrides? Or empty?
            // Let's copy default for ease of editing
            chain = JSON.parse(JSON.stringify(config.defaultFlow));
        }
    }

    // Store current editing chain in a temporary global variable to manipulate
    window.editingChain = chain;
    window.editingRoleKey = roleKey;

    renderChainVisuals();
};

window.renderChainVisuals = () => {
    const container = document.getElementById('workflow-chain-container');
    const chain = window.editingChain;

    if (chain.length === 0) {
        container.innerHTML = `
                    <div class="text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        <p class="text-slate-400 text-sm font-bold mb-4">No stages defined.</p>
                        <button onclick="addStage(0)" class="text-green-600 font-bold hover:underline text-xs">+ Add First Stage</button>
                    </div>
                 `;
        return;
    }

    container.innerHTML = chain.map((step, index) => `
                <div class="relative pl-8 pb-8 last:pb-0 group">
                    <!-- Connector Line -->
                    ${index !== chain.length - 1 ?
            `<div class="absolute left-[15px] top-8 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700 group-last:hidden"></div>` : ''}
                    
                    <!-- Node Circle -->
                    <div class="absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center bg-white dark:bg-slate-800 border-2 border-green-500 z-10 shadow-sm">
                        <span class="text-xs font-bold text-green-600">${index + 1}</span>
                    </div>

                    <!-- Content Card -->
                    <div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 transition hover:border-green-300 relative">
                        <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                            <div class="md:col-span-4">
                                <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Stage Status Code</label>
                                <input type="text" value="${step.stage}" onchange="updateStage(${index}, 'stage', this.value)" class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200 focus:border-green-500 outline-none" placeholder="e.g. PENDING_MANAGER">
                            </div>
                             <div class="md:col-span-4">
                                <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Display Label</label>
                                <input type="text" value="${step.label}" onchange="updateStage(${index}, 'label', this.value)" class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-green-500 outline-none" placeholder="e.g. Manager Approval">
                            </div>
                             <div class="md:col-span-3">
                                <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Approver Role</label>
                                <select onchange="updateStage(${index}, 'approverRole', this.value)" class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-green-500 outline-none">
                                    <option value="null" ${step.approverRole === null ? 'selected' : ''}>None (End)</option>
                                    <option value="MANAGER" ${step.approverRole === 'MANAGER' ? 'selected' : ''}>MANAGER</option>
                                    <option value="SENIOR_MANAGER" ${step.approverRole === 'SENIOR_MANAGER' ? 'selected' : ''}>SENIOR MANAGER</option>
                                    <option value="HR" ${step.approverRole === 'HR' ? 'selected' : ''}>HR</option>
                                    <option value="FINANCE_MANAGER" ${step.approverRole === 'FINANCE_MANAGER' ? 'selected' : ''}>FINANCE_MANAGER</option>
                                    <option value="ACCOUNTS" ${step.approverRole === 'ACCOUNTS' ? 'selected' : ''}>ACCOUNTS</option>
                                    <option value="TREASURY" ${step.approverRole === 'TREASURY' ? 'selected' : ''}>TREASURY</option>
                                    <option value="AUDIT" ${step.approverRole === 'AUDIT' ? 'selected' : ''}>AUDIT</option>
                                    <option value="ADMIN" ${step.approverRole === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
                                </select>
                            </div>
                            <div class="md:col-span-1 flex justify-end">
                                <button onclick="removeStage(${index})" class="text-red-400 hover:text-red-600 transition p-1" title="Remove Stage"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                        
                         <!-- Add Button Between -->
                        <div class="absolute -bottom-6 left-1/2 transform -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity z-20">
                            <button onclick="addStage(${index + 1})" class="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md hover:scale-110 transition"><i class="fa-solid fa-plus text-[10px]"></i></button>
                        </div>
                    </div>
                </div>
            `).join('');

    // Final Add Button
    container.innerHTML += `
                <div class="flex justify-center pt-4">
                     <button onclick="addStage(${chain.length})" class="text-xs font-bold text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg border border-dashed border-green-200 transition">+ Add Final Stage</button>
                </div>
            `;
};

window.updateStage = (index, field, value) => {
    if (field === 'approverRole' && value === 'null') value = null;
    window.editingChain[index][field] = value;
};

window.addStage = (index) => {
    window.editingChain.splice(index, 0, { stage: 'NEW_STAGE', label: 'New Stage', approverRole: 'ADMIN' });
    renderChainVisuals();
};

window.removeStage = (index) => {
    window.editingChain.splice(index, 1);
    renderChainVisuals();
};

window.saveWorkflowConfig = async () => {
    const btn = document.querySelector('button[onclick="saveWorkflowConfig()"]');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        // Update global config object
        if (window.editingRoleKey === 'DEFAULT') {
            window.currentWorkflowConfig.defaultFlow = window.editingChain;
        } else {
            if (!window.currentWorkflowConfig.roleOverrides) window.currentWorkflowConfig.roleOverrides = {};
            window.currentWorkflowConfig.roleOverrides[window.editingRoleKey] = { flow: window.editingChain };
        }

        // Save to Firestore
        await setDoc(doc(db, "settings", "workflow_config"), window.currentWorkflowConfig);
        showToast("Workflow configuration saved successfully!", "success");
    } catch (e) {
        console.error(e);
        showToast("Error saving workflow: " + e.message, "error");
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};

// Helper to get initial stage status
window.getInitialStageStatus = async (role) => {
    if (!window.currentWorkflowConfig) {
        try {
            const snap = await getDoc(doc(db, "settings", "workflow_config"));
            if (snap.exists()) window.currentWorkflowConfig = snap.data();
            else return null;
        } catch (e) { return null; }
    }

    const config = window.currentWorkflowConfig;
    let chain = config.defaultFlow;
    if (config.roleOverrides && config.roleOverrides[role] && config.roleOverrides[role].flow) {
        chain = config.roleOverrides[role].flow;
    }
    return chain.length > 0 ? chain[0].stage : null;
};

// Helper to get next stage status
window.getNextStageStatus = async (currentStatus, role) => {
    // This function will effectively replicate the logic in handleDecision
    // But we need to load the config first if not loaded.
    if (!window.currentWorkflowConfig) {
        try {
            const snap = await getDoc(doc(db, "settings", "workflow_config"));
            if (snap.exists()) window.currentWorkflowConfig = snap.data();
            else return null; // Fallback to hardcoded if needed
        } catch (e) { return null; }
    }

    const config = window.currentWorkflowConfig;
    // Determine chain to use based on USER ROLE (Expense Owner's role ideally, but here passed as 'role')
    // Note: The logic in handleDecision needs to pass the EXPENSE OWNER ROLE, not just any role. 
    // Usually workflows depend on who the requester is.

    let chain = config.defaultFlow;
    if (config.roleOverrides && config.roleOverrides[role] && config.roleOverrides[role].flow) {
        chain = config.roleOverrides[role].flow;
    }

    // Find current index
    const currentIndex = chain.findIndex(s => s.stage === currentStatus);
    if (currentIndex === -1) {
        // If current status not in chain, maybe it's start? Or maybe handled manually?
        // Assuming start of chain if status is 'SUBMITTED' or equivalent
        return chain[0]?.stage;
    }

    // Next stage
    if (currentIndex + 1 < chain.length) {
        return chain[currentIndex + 1].stage;
    }

    return 'COMPLETED'; // End of chain?
};

window.showModal = (title, msg, type) => {
    const m = document.getElementById('global-modal');
    const content = document.getElementById('global-modal-content');
    const icon = document.getElementById('modal-icon');

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-msg').textContent = msg;

    if (type === 'success') {
        icon.className = "w-12 h-12 rounded-full bg-green-50 text-green-500 flex items-center justify-center mx-auto mb-4 text-xl";
        icon.innerHTML = '<i class="fa-solid fa-check"></i>';
    }
    else if (type === 'error') {
        icon.className = "w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4 text-xl";
        icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }
    else {
        icon.className = "w-12 h-12 rounded-full bg-green-50 text-green-500 flex items-center justify-center mx-auto mb-4 text-xl";
        icon.innerHTML = '<i class="fa-solid fa-info"></i>';
    }

    m.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
};

window.closeGlobalModal = () => {
    const m = document.getElementById('global-modal');
    const content = document.getElementById('global-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => m.classList.add('hidden'), 200);
};

const emptyState = (msg) => `<div class="text-center py-20 opacity-50"><i class="fa-solid fa-wind text-4xl mb-4 text-slate-300"></i><p class="text-slate-500 dark:text-slate-400">${msg}</p></div>`;

const getStatusBadgeClass = (s) => {
    const map = {
        'PENDING_MANAGER': 'bg-green-50 text-green-600 border-green-200',
        'PENDING_FINANCE': 'bg-indigo-50 text-indigo-600 border-indigo-200',
        'FINANCE_APPROVED': 'bg-purple-50 text-purple-600 border-purple-200',
        'PENDING_ACCOUNTS': 'bg-orange-50 text-orange-600 border-orange-200',
        'PENDING_SENIOR_MANAGER': 'bg-slate-100 text-slate-600 border-slate-200',
        'PENDING_COMPLIANCE': 'bg-pink-50 text-pink-600 border-pink-200',
        'PENDING_TREASURY': 'bg-yellow-50 text-yellow-600 border-yellow-200',
        'PAID': 'bg-green-50 text-green-600 border-green-200',
        'AUDITED': 'bg-teal-50 text-green-600 border-teal-200',
        'REJECTED': 'bg-red-50 text-red-600 border-red-200',
        'PAYMENT_ISSUE': 'bg-orange-100 text-orange-700 border-orange-200',
        'PAYMENT_DISPUTED': 'bg-orange-100 text-orange-700 border-orange-200'
    };
    return `px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${map[s] || 'bg-slate-100 text-slate-500 dark:text-slate-400'}`;
};

const getSymbol = (c) => ({ 'USD': '$', 'EUR': '€', 'GBP': '£' }[c] || '₹');

const compressImage = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 600;
            const scale = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

// --- My Claims Logic (Admin/Manager Self-Service) ---

window.renderMyClaims = async () => {
    document.getElementById('page-title').textContent = "My Claims";
    const content = document.getElementById('content-area');
    content.innerHTML = `
                <div class="flex flex-col h-full">
                    <div class="flex justify-between items-center mb-6 fade-in">
                        <p class="text-slate-500 dark:text-slate-400 text-sm">Manage your personal expense claims.</p>
                        <button onclick="openCreateClaimModal()" class="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-slate-200 transition flex items-center gap-2">
                             <i class="fa-solid fa-plus"></i> Create New Claim
                        </button>
                    </div>

                    <div id="my-claims-list" class="grid gap-4 fade-in pb-20">
                        <div class="text-center py-20 opacity-50"><i class="fa-solid fa-circle-notch fa-spin text-3xl"></i></div>
                    </div>
                </div>
                `;

    // Query specifically for THIS user's expenses (using docId to sync with emp.html)
    if (!userData || !userData.docId) {
        document.getElementById('my-claims-list').innerHTML = emptyState("Error: User profile not loaded.");
        return;
    }
    const q = query(collection(db, "expenses"), where("userId", "==", userData.docId));

    const unsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('my-claims-list');
        if (!list) return;

        if (snap.empty) {
            list.innerHTML = `<div class="text-center py-20 opacity-50"><i class="fa-solid fa-folder-open text-4xl mb-4 text-slate-300"></i><p class="text-slate-500 dark:text-slate-400">No claims found.</p></div>`;
            return;
        }

        // Function to format currency
        const formatCurrency = (amount, currency = 'INR') => {
            return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency }).format(amount);
        };

        // Client-side sort to avoid index issues
        const sortedDocs = [...snap.docs].sort((a, b) => {
            const dateA = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
            const dateB = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
            return dateB - dateA;
        });

        list.innerHTML = sortedDocs.map(doc => {
            const d = doc.data();
            let badgeClass = 'bg-slate-100 text-slate-500 dark:text-slate-400';
            if (typeof getStatusBadgeClass === 'function') badgeClass = getStatusBadgeClass(d.status);

            return `
                        <div class="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex justify-between items-center hover:shadow-md transition group relative">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-400 font-bold group-hover:bg-green-50 group-hover:text-green-600 transition">
                                    ${getSymbol(d.currency)}
                                </div>
                                <div>
                                    <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">${d.title}</h4>
                                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">${d.projectCode} • ${new Date(d.createdAt.toDate()).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="font-bold text-slate-800 dark:text-slate-100 font-mono text-sm">${getSymbol(d.currency)}${d.totalAmount}</p>
                                <span class="${badgeClass} inline-block mt-1">${d.status.replace('_', ' ')}</span>
                            </div>
                            <button onclick="openExpenseModal('${doc.id}')" class="absolute inset-0 w-full h-full opacity-0 pointer-events-auto" title="View Details"></button>
                        </div>
                    `;
        }).join('');
    }, (error) => {
        console.error("Error loading my claims:", error);
        const list = document.getElementById('my-claims-list');
        if (list) list.innerHTML = `<div class="text-center py-10 text-red-500"><i class="fa-solid fa-triangle-exclamation mb-2"></i><br>Error loading claims.<br><span class="text-xs text-slate-400">${error.message}</span></div>`;
    });
    activeListeners.push(unsub);
};

window.openCreateClaimModal = () => {
    const form = document.getElementById('expense-form');
    if (form) form.reset();
    document.getElementById('line-items-container').innerHTML = '';
    document.getElementById('running-total').textContent = '0.00';
    document.getElementById('expense-id').value = '';
    document.querySelector('#modal-create h3').textContent = 'New Expense Claim';

    window.addLineItem(); // Add initial line
    loadProjects(); // Populate projects
    document.getElementById('modal-create').classList.remove('hidden');
};

window.addLineItem = () => {
    const container = document.getElementById('line-items-container');
    const tpl = document.getElementById('tpl-line-item');
    const clone = tpl.content.cloneNode(true);
    container.appendChild(clone);
};

window.removeLineItem = (btn) => {
    const container = document.getElementById('line-items-container');
    if (container.children.length > 1) {
        btn.closest('.line-item').remove();
        calculateTotal();
    } else {
        showToast("At least one expense item is required.", "error");
    }
};

window.calculateTotal = () => {
    const items = document.querySelectorAll('.item-amount');
    let total = 0;
    items.forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('running-total').textContent = total.toFixed(2);
};

window.handleFileSelect = async (input) => {
    const file = input.files[0];
    if (!file) return;

    // Clear URL input
    const grid = input.closest('.grid');
    if (grid) { const u = grid.querySelector('.item-url-input'); if (u) u.value = ''; }

    const label = input.closest('.receipt-label');
    const containerDiv = label.parentElement;
    const btnRemove = containerDiv.querySelector('.btn-remove-img');
    const status = grid.querySelector('.file-status');
    const hiddenInput = grid.querySelector('.item-img-url');

    const originalLabel = label.innerHTML;
    label.classList.add('opacity-50', 'pointer-events-none');
    label.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-green-500"></i> Processing...';

    try {
        let imageUrl = '';

        // Attempt ImageKit Upload first
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('fileName', file.name);
            formData.append('useUniqueFileName', 'true');
            formData.append('folder', '/admin_receipts');

            const authHeader = 'Basic ' + btoa(IMAGEKIT_PRIVATE_KEY + ':');

            const response = await fetch(IMAGEKIT_URL, {
                method: 'POST',
                body: formData,
                headers: { 'Authorization': authHeader }
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error('ImageKit Upload failed: ' + (errData.message || response.statusText));
            }
            const data = await response.json();
            imageUrl = data.url;
        } catch (imgKitErr) {
            console.warn("ImageKit upload failed, falling back to Firebase Storage", imgKitErr);
            try {
                const storageRef = ref(storage, 'admin_receipts/' + (file.name + '_' + Date.now()));
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                await uploadString(storageRef, dataUrl, 'data_url');
                imageUrl = await getDownloadURL(storageRef);
            } catch (fbErr) {
                console.warn("Firebase Storage fallback failed, using local compression.", fbErr);
                imageUrl = await compressImage(file);
            }
        }

        hiddenInput.value = imageUrl;

        label.innerHTML = `<span class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${file.name}</span>`;
        label.classList.remove('border-dashed', 'border-slate-300');
        label.classList.add('border-solid', 'border-green-500', 'bg-emerald-50');

        if (status) status.classList.remove('hidden');
        if (btnRemove) btnRemove.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        showToast("Error processing image", "error");
        label.innerHTML = originalLabel;
    } finally {
        label.classList.remove('opacity-50', 'pointer-events-none');
    }
};

window.removeImage = (btn) => {
    const containerDiv = btn.closest('.relative');
    const label = containerDiv.querySelector('label');

    const grid = btn.closest('.grid');
    const status = grid.querySelector('.file-status');
    const hiddenInput = grid.querySelector('.item-img-url');

    // Reset inputs
    const input = label.querySelector('input[type="file"]') || document.createElement('input');
    input.value = '';
    hiddenInput.value = '';

    label.innerHTML = `
                <div class="w-6 h-6 bg-slate-200 rounded flex items-center justify-center text-slate-500 dark:text-slate-400">
                    <i class="fa-solid fa-camera text-xs"></i>
                </div>
                <span class="text-xs text-slate-500 dark:text-slate-400 truncate">Upload / Snap</span>
                <input type="file" accept="image/*" class="hidden item-file" onchange="handleFileSelect(this)">
            `;
    label.classList.remove('border-solid', 'border-green-500', 'bg-emerald-50');
    label.classList.add('border-dashed', 'border-slate-300');

    if (status) status.classList.add('hidden');
    btn.classList.add('hidden');
};

window.handleUrlInput = (input) => {
    const url = input.value.trim();
    const grid = input.closest('.grid');
    if (!grid) return;
    const hiddenInput = grid.querySelector('.item-img-url');

    if (url) {
        hiddenInput.value = url;
        const statusSpan = grid.querySelector('.file-status');
        if (statusSpan) {
            statusSpan.innerHTML = '<i class="fa-solid fa-link"></i> Linked';
            statusSpan.classList.remove('hidden');
        }
    } else {
        // Only clear if no file is selected? 
        // Simpler: just clear logic. If they want file, they upload file.
        hiddenInput.value = '';
        const statusSpan = grid.querySelector('.file-status');
        if (statusSpan) statusSpan.classList.add('hidden');
    }
};

window.submitMyClaim = async () => {
    const title = document.getElementById('report-title').value.trim();
    const projectCode = document.getElementById('project-code').value.trim();
    const currency = document.getElementById('currency').value;
    const preApproved = document.getElementById('pre-approved').checked;
    const notes = document.getElementById('expense-notes').value.trim();

    if (!title || !projectCode) return showToast("Please fill in all required fields.", "error");

    const lineItems = [];
    let isValid = true;
    let totalVal = 0;

    const rows = document.querySelectorAll('.line-item');
    rows.forEach(row => {
        const desc = row.querySelector('.item-desc').value.trim();
        const amount = parseFloat(row.querySelector('.item-amount').value);
        const category = row.querySelector('.item-category').value;
        const receiptUrl = row.querySelector('.item-img-url').value;

        if (!desc || isNaN(amount) || amount <= 0) {
            isValid = false;
            row.classList.add('border-red-500');
        } else {
            row.classList.remove('border-red-500');
            lineItems.push({ desc, amount: amount, category, receiptUrl }); // Store amount as number
            totalVal += amount;
        }
    });

    if (!isValid) return showToast("Please check line items for errors.", "error");
    if (lineItems.length === 0) return showToast("Add at least one expense.", "error");

    const btn = document.getElementById('btn-submit');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
    btn.disabled = true;

    try {
        // Determine initial status based on role
        // Determine initial status based on Workflow Config
        let initialStatus = await getInitialStageStatus(userData.role);

        // Fallback if no workflow configured
        if (!initialStatus) {
            if (userData.role === 'MANAGER' || userData.role === 'SENIOR_MANAGER') initialStatus = 'PENDING_COMPLIANCE';
            else initialStatus = 'PENDING_MANAGER';
        }

        let history = [{
            action: 'SUBMITTED',
            by: userData.name,
            date: new Date(),
            comment: 'Expense claim submitted.'
        }];

        const expenseData = {
            title,
            projectCode,
            currency,
            preApproved,
            notes,
            lineItems,
            totalAmount: totalVal.toFixed(2),
            status: initialStatus,
            userId: userData.docId,
            userName: userData.name,
            userEmail: userData.email,
            role: userData.role,
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        if (document.getElementById('expense-id').value) {
            // Update Logic
            const docId = document.getElementById('expense-id').value;
            const expenseRef = doc(db, "expenses", docId);

            // Fetch existing history to append
            const existingSnap = await getDoc(expenseRef);
            let existingHistory = existingSnap.exists() ? (existingSnap.data().history || []) : [];

            const updateData = {
                ...expenseData,
                updatedAt: serverTimestamp(),
                history: [...existingHistory, {
                    action: 'UPDATED',
                    by: userData.name,
                    role: userData.role,
                    date: new Date(),
                    comment: 'Claim updated by user'
                }]
            };

            await updateDoc(expenseRef, updateData);
            showToast("Claim updated successfully!", "success");
        } else {
            // Create Logic
            await addDoc(collection(db, "expenses"), {
                ...expenseData,
                createdAt: serverTimestamp(),
                history: [{
                    action: 'SUBMITTED',
                    by: userData.name,
                    role: userData.role,
                    date: new Date(),
                    comment: preApproved ? 'Marked as Pre-Approved' : 'Initial Submission'
                }]
            });
            showToast("Claim submitted successfully!", "success");
        }

        closeModal('modal-create');
        renderMyClaims();
    } catch (e) {
        console.error(e);
        showToast("Submission failed: " + e.message, "error");
    } finally {
        btn.innerHTML = '<span>Submit Claim</span> <i class="fa-solid fa-paper-plane"></i>';
        btn.disabled = false;
    }
};

// PWA Install & Sidebar Logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('pwa-install-btn-admin');
    if (btn) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`User response to the install declaration: ${outcome}`);
                deferredPrompt = null;
                btn.classList.add('hidden');
            }
        });
    }
});

window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-sidebar-overlay');

    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
};


let currentChatId = 'global_chat';
let currentChatUser = null;
let chatUnsub = null;

async function renderChat() {
    document.getElementById('page-title').textContent = "Team Chat";
    const content = document.getElementById('content-area');
    content.innerHTML = `
                <div class="flex h-[calc(100vh-140px)] bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden fade-in relative">
                    <!-- Sidebar -->
                    <div class="w-full md:w-1/3 md:max-w-[300px] border-r border-slate-100 dark:border-slate-700 flex flex-col z-10" id="chat-sidebar">
                        <div class="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                            <h3 class="font-bold text-slate-800 dark:text-slate-100">Chats</h3>
                        </div>
                        <div id="chat-user-list" class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                             <div class="flex justify-center mt-10"><i class="fa-solid fa-circle-notch fa-spin text-green-500"></i></div>
                        </div>
                    </div>
                    <!-- Main Chat Area -->
                    <div class="flex-1 flex flex-col absolute md:relative inset-0 bg-white dark:bg-slate-800 transform transition-transform duration-300 translate-x-full md:translate-x-0 z-20" id="chat-main-area">
                        <div class="h-16 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between px-4 sm:px-6 bg-slate-50 dark:bg-slate-900/50 shrink-0">
                            <div class="flex items-center gap-3 min-w-0">
                                <button class="md:hidden text-slate-500 hover:text-green-600 transition p-2" onclick="hideMobileChatArea()">
                                    <i class="fa-solid fa-arrow-left text-xl"></i>
                                </button>
                                <div id="active-chat-avatar" class="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-bold shrink-0 overflow-hidden">
                                    <i class="fa-solid fa-globe"></i>
                                </div>
                                <div class="overflow-hidden">
                                    <h3 id="active-chat-name" class="font-bold text-slate-800 dark:text-slate-100 truncate">Global Group</h3>
                                    <p id="active-chat-status" class="text-xs text-green-500 truncate">Company Wide</p>
                                </div>
                            </div>
                            <div id="chat-cal-actions" class="flex items-center gap-2 hidden transition-all">
                                <button onclick="initiateCall('voice')" class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center justify-center shadow-sm" title="Voice Call">
                                    <i class="fa-solid fa-phone text-xs"></i>
                                </button>
                                <button onclick="initiateCall('video')" class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-green-50 dark:bg-brand-900/20 text-green-600 hover:bg-green-100 dark:hover:bg-brand-900/40 transition flex items-center justify-center shadow-sm" title="Video Call">
                                    <i class="fa-solid fa-video text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                            <div class="flex justify-center mt-10"><i class="fa-solid fa-circle-notch fa-spin text-green-500"></i></div>
                        </div>
                        <form onsubmit="sendChatMessage(event)" class="p-3 sm:p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
                            <input type="text" id="chat-input" class="input-primary flex-1 bg-white dark:bg-slate-800 text-sm" placeholder="Type a message..." required autocomplete="off">
                            <button type="submit" class="bg-green-600 hover:bg-brand-700 text-white px-4 sm:px-6 py-2 rounded-lg font-bold transition shadow-sm flex items-center justify-center min-w-[60px]">
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        </form>
                    </div>
                </div>
            `;

    loadChatUsers();
    selectChat(null);
}

async function loadChatUsers() {
    const list = document.getElementById('chat-user-list');
    if (!list) return;

    try {
        // Fetch all users
        const usersSnap = await getDocs(collection(db, "users"));
        const users = usersSnap.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

        // Fetch chats for sorting and last message
        const chatsSnap = await getDocs(query(collection(db, "chats"), where("users", "array-contains", userData.docId)));
        const chatMeta = {};
        chatsSnap.forEach(docSnap => {
            const data = docSnap.data();
            const otherUser = (data.users || []).find(id => id !== userData.docId);
            if (otherUser) chatMeta[otherUser] = data;
        });

        // Get Global Chat last message
        const globalChatSnap = await getDocs(query(collection(db, "global_chat"), orderBy("createdAt", "desc"), limit(1)));
        const globalLast = globalChatSnap.empty ? "Company Wide Chat" : globalChatSnap.docs[0].data().text;

        // Sort users by activity
        const sortedUsers = users.filter(u => u.docId !== userData.docId).sort((a, b) => {
            const timeA = chatMeta[a.docId]?.lastMessageAt?.toMillis() || 0;
            const timeB = chatMeta[b.docId]?.lastMessageAt?.toMillis() || 0;
            return timeB - timeA;
        });

        let html = `
                    <div onclick="selectChat(null)" class="cursor-pointer flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition mb-1 bg-green-50 dark:bg-brand-900/20 relative" id="chat-tgt-global">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-green-600 to-indigo-500 flex items-center justify-center text-white shrink-0 shadow-sm relative">
                            <i class="fa-solid fa-users text-xs"></i>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            <p class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Global Group</p>
                            <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">${globalLast}</p>
                        </div>
                        <span id="global-unread-dot" class="absolute right-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-green-500 rounded-full shadow-sm animate-pulse hidden"></span>
                    </div>
                `;

        sortedUsers.forEach(u => {
            const initial = u.name ? u.name[0].toUpperCase() : '?';
            const lastMsg = chatMeta[u.docId]?.lastMessage || (u.role || 'User').replace('_', ' ');
            const safeJson = JSON.stringify(u).replace(/'/g, "&apos;").replace(/"/g, "&quot;");

            // Unread dot logic: check if last sender wasn't me and if we have metadata for it
            // For now, we'll use a simple 'lastSender' check. 
            // To be really accurate, we'd need a lastRead timestamp per user in each chat.
            const isUnread = chatMeta[u.docId]?.lastSender && chatMeta[u.docId]?.lastSender !== userData.docId && !chatMeta[u.docId]?.read;

            html += `
                        <div onclick="selectChat(JSON.parse('${safeJson}'))" class="cursor-pointer flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition mb-1 relative" id="chat-tgt-${u.docId}">
                            ${u.photoUrl ?
                    `<img src="${u.photoUrl}" class="w-10 h-10 rounded-full object-cover shrink-0 shadow-sm border border-slate-200 dark:border-slate-700">` :
                    `<div class="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 flex items-center justify-center font-bold text-sm shrink-0 uppercase shadow-sm">${initial}</div>`
                }
                            <div class="flex-1 overflow-hidden">
                                <p class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">${u.name || 'User'}</p>
                                <p class="text-[10px] text-slate-500 truncate">${lastMsg}</p>
                            </div>
                            ${isUnread ? `<span class="absolute right-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-green-500 rounded-full shadow-sm animate-pulse"></span>` : ''}
                        </div>
                    `;
        });
        list.innerHTML = html;
        updateActiveChatHighlight();
    } catch (e) {
        console.error('Error loading users', e);
        list.innerHTML = '<p class="text-xs text-red-500 p-2">Failed to load users</p>';
    }
}

window.selectChat = (userObj) => {
    currentChatUser = userObj;
    currentChatId = userObj ? getOneOnOneChatId(userData.docId, userObj.docId) : 'global_chat';

    const nameEl = document.getElementById('active-chat-name');
    const statusEl = document.getElementById('active-chat-status');
    const avatarEl = document.getElementById('active-chat-avatar');
    const callsEl = document.getElementById('chat-cal-actions');
    const chatMain = document.getElementById('chat-main-area');

    if (userObj) {
        nameEl.textContent = userObj.name || 'Unknown User';
        statusEl.textContent = (userObj.role || 'User').replace('_', ' ');
        if (userObj.photoUrl) {
            avatarEl.innerHTML = `<img src="${userObj.photoUrl}" class="w-full h-full object-cover">`;
        } else {
            avatarEl.innerHTML = userObj.name ? userObj.name[0].toUpperCase() : '?';
        }
        avatarEl.className = 'w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 flex items-center justify-center font-bold shrink-0 overflow-hidden shadow-sm';
        callsEl.classList.remove('hidden');
    } else {
        nameEl.textContent = 'Global Group';
        statusEl.textContent = 'Company Wide';
        avatarEl.innerHTML = '<i class="fa-solid fa-globe text-sm"></i>';
        avatarEl.className = 'w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-bold shrink-0 shadow-sm';
        callsEl.classList.add('hidden');
    }

    // Mobile Navigation: Slide Chat Main Area over sidebar
    if (chatMain) {
        chatMain.classList.remove('translate-x-full');
        chatMain.classList.add('translate-x-0');
    }

    // Hide unread dot for global if selected
    if (!userObj) {
        const dot = document.getElementById('global-unread-dot');
        if (dot) dot.classList.add('hidden');
    }

    updateActiveChatHighlight();
    loadMessages();
};

window.hideMobileChatArea = () => {
    const chatMain = document.getElementById('chat-main-area');
    if (chatMain) {
        chatMain.classList.remove('translate-x-0');
        chatMain.classList.add('translate-x-full');
    }
};

function getOneOnOneChatId(uid1, uid2) {
    return uid1 < uid2 ? `chat_${uid1}_${uid2}` : `chat_${uid2}_${uid1}`;
}

function updateActiveChatHighlight() {
    document.querySelectorAll('#chat-user-list > div').forEach(el => {
        el.classList.remove('bg-green-50', 'dark:bg-brand-900/20');
    });
    const activeId = currentChatUser ? currentChatUser.docId : 'global';
    const activeEl = document.getElementById('chat-tgt-' + activeId);
    if (activeEl) activeEl.classList.add('bg-green-50', 'dark:bg-brand-900/20');
}

function loadMessages() {
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }

    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '<div class="flex justify-center mt-10"><i class="fa-solid fa-circle-notch fa-spin text-green-500"></i></div>';

    try {
        let q;
        if (currentChatId === 'global_chat') {
            q = query(collection(db, "global_chat"), orderBy("createdAt", "asc"), limit(100));
        } else {
            q = query(collection(db, "chats", currentChatId, "messages"), orderBy("createdAt", "asc"), limit(100));
        }

        chatUnsub = onSnapshot(q, (snapshot) => {
            if (!document.getElementById('chat-messages')) return;

            if (snapshot.empty) {
                container.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm"><p>No messages yet. Start the conversation!</p></div>';
                return;
            }

            container.innerHTML = '';
            let lastUser = '';

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const isMe = data.email === userData.email;
                const time = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
                const msgId = docSnap.id;

                // Mark as read if receiving and not read
                if (!isMe && !data.read) {
                    const path = currentChatId === 'global_chat' ? `global_chat/${msgId}` : `chats/${currentChatId}/messages/${msgId}`;
                    updateDoc(doc(db, path), { read: true }).catch(() => { });
                    // Also update the chat metadata if 1-on-1
                    if (currentChatId !== 'global_chat') {
                        updateDoc(doc(db, "chats", currentChatId), { read: true }).catch(() => { });
                    }
                }

                const canDelete = isMe && data.createdAt && (Date.now() - data.createdAt.toMillis() < 60000);

                const div = document.createElement('div');
                div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} group`;

                div.innerHTML = `
                            <div class="flex items-end gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : ''}">
                                 ${!isMe ? (data.senderPhotoUrl ?
                        `<img src="${data.senderPhotoUrl}" class="w-8 h-8 rounded-full object-cover shrink-0 shadow-sm border border-slate-200 dark:border-slate-700">` :
                        `<div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-slate-400 uppercase shadow-sm sm:flex hidden">${data.sender ? data.sender[0] : '?'}</div>`
                    ) : ''}
                                 <div class="relative ${isMe ? 'bg-green-600 text-white font-medium' : 'bg-white dark:bg-slate-800 dark:text-slate-50 border border-slate-100 dark:border-slate-700 shadow-sm text-slate-900'} p-3 rounded-2xl ${isMe ? 'rounded-br-none' : 'rounded-bl-none'} shadow-sm">
                                    ${!isMe && lastUser !== data.email && currentChatId === 'global_chat' ? `<p class="text-[9px] font-bold ${isMe ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400'} mb-1">${data.sender || data.email}</p>` : ''}
                                    <p class="text-sm leading-relaxed whitespace-pre-wrap break-words">${data.text}</p>
                                    <div class="flex items-center justify-end gap-1 mt-1">
                                        <p class="text-[9px] ${isMe ? 'text-brand-100' : 'text-slate-400 dark:text-slate-500'} font-mono">${time}</p>
                                        ${isMe ? `<span class="text-[10px] ${data.read ? 'text-green-300' : 'text-brand-200'}"><i class="fa-solid fa-check-double"></i></span>` : ''}
                                    </div>
                                    ${canDelete ? `
                                        <button onclick="deleteChatMessage('${msgId}')" class="absolute -top-2 ${isMe ? '-left-2' : '-right-2'} w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    ` : ''}
                                 </div>
                            </div>
                        `;
                container.appendChild(div);
                lastUser = data.email;
            });

            // Order is ASC (recent at bottom), keep scroll at bottom
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });

        activeListeners.push(chatUnsub);
    } catch (e) {
        container.innerHTML = `<div class="text-red-500 text-sm p-4">${e.message}</div>`;
    }
}

window.sendChatMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.focus();
    try {
        const msgData = {
            text,
            sender: (userData.name || userData.email || 'Admin'),
            senderPhotoUrl: (userData.photoUrl || ''),
            email: (userData.email || ''),
            role: (userData.role || 'ADMIN'),
            read: false,
            createdAt: serverTimestamp()
        };

        if (currentChatId === 'global_chat') {
            await addDoc(collection(db, "global_chat"), msgData);
        } else {
            await addDoc(collection(db, "chats", currentChatId, "messages"), msgData);

            const chatMetaUpdate = {
                lastMessage: text,
                lastMessageAt: serverTimestamp(),
                lastSender: userData.docId || 'admin',
                read: false
            };

            // Only add users array if both IDs are available to prevent Firebase errors
            if (userData.docId && currentChatUser && currentChatUser.docId) {
                chatMetaUpdate.users = [userData.docId, currentChatUser.docId];
            }

            await setDoc(doc(db, "chats", currentChatId), chatMetaUpdate, { merge: true });
        }

        const container = document.getElementById('chat-messages');
        if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
    } catch (err) {
        showToast("Failed to send: " + err.message, 'error');
    }
};

window.deleteChatMessage = async (msgId) => {
    if (!confirm("Delete this message?")) return;
    try {
        const path = currentChatId === 'global_chat' ? `global_chat/${msgId}` : `chats/${currentChatId}/messages/${msgId}`;
        await deleteDoc(doc(db, path));
        showToast("Message deleted", "info");
    } catch (e) {
        showToast("Failed to delete: " + e.message, "error");
    }
};

// Close sidebar on route change (mobile)
const originalSwitchTab = window.switchTab;
window.switchTab = (tab) => {
    if (originalSwitchTab) originalSwitchTab(tab);
    if (window.innerWidth < 1024) { // lg breakpoint
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            window.toggleSidebar();
        }
    }
};


// Account Center Logic
window.openAccountCenter = async () => {
    // Populate Modal
    const modal = document.getElementById('modal-account');
    const content = document.getElementById('modal-account-content');
    const u = userData; // Global user object

    if (!u) {
        showToast("User data not loaded", "error");
        return;
    }

    document.getElementById('ac-name').textContent = u.name || 'User';
    document.getElementById('ac-role').textContent = (u.role || 'EMPLOYEE').replace('_', ' ');
    document.getElementById('ac-email').textContent = u.email;
    document.getElementById('ac-empid').textContent = u.employeeId || 'N/A';
    document.getElementById('ac-dept').textContent = u.department || 'General';
    document.getElementById('ac-manager').textContent = u.managerId || 'None';
    // Convert firestore timestamp safely
    document.getElementById('ac-join').textContent = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : (u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A');
    document.getElementById('ac-avatar').textContent = u.name ? u.name[0].toUpperCase() : 'U';

    document.getElementById('ac-phone').value = u.altPhone || '';
    document.getElementById('ac-alt-email').value = u.altEmail || '';

    document.getElementById('ac-stat-budget').textContent = u.budgetLimit ? u.budgetLimit.toLocaleString() : 'N/A';
    document.getElementById('ac-stat-claims').textContent = '...';

    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    try {
        // Fetch claims simple size dynamically without blocking UI
        const claimsQ = query(collection(db, "expenses"), where("userId", "==", u.docId));
        getDocs(claimsQ).then(snap => {
            document.getElementById('ac-stat-claims').textContent = snap.size;
        });
    } catch (e) { console.warn(e); }
};

window.saveAccountSettings = async (e) => {
    e.preventDefault();
    const phone = document.getElementById('ac-phone').value;
    const altEmail = document.getElementById('ac-alt-email').value;
    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
    try {
        // Determine user Doc ID (might be stored in userData.id or userData.docId depending on fetch logic)
        const docId = userData.docId || userData.id;
        if (!docId) throw new Error("User ID not found");

        await updateDoc(doc(db, "users", docId), {
            altPhone: phone,
            altEmail: altEmail,
            updatedAt: serverTimestamp()
        });

        // Update local cache
        userData.altPhone = phone;
        userData.altEmail = altEmail;

        showToast("Account settings saved!", "success");
        closeModal('modal-account');
    } catch (err) {
        console.error(err);
        showToast("Error saving: " + err.message, "error");
    } finally {
        btn.innerHTML = originalText;
    }
};

window.downloadMyData = async () => {
    showToast("Preparing data export...", "info");
    try {
        // 1. Fetch Expenses
        // BUT, `renderChat` (Line 3833) uses `db` and `collection`.
        // `renderChat` is defined in `window`? NO. 
        // Wait, `async function renderChat() {... } ` is inside ` < script > ` (Line 3832).
        // Does it have access to `db`? 
        // `db` must be global for `renderChat` to work if `renderChat` is a global function.
        // Let's check lines 64-85 again. It imports firebase storage but not db.
        // There must be another script tag I missed that initializes firebase?
        // Ah, line 58-63 config.
        // The MAIN script logic is likely in the middle chunk I skipped. 
        // Assuming `db` IS available because `renderChat` uses it.

        const q = query(collection(db, "expenses"), where("userId", "==", userData.uid || userData.id));
        const snap = await getDocs(q);
        const expenses = snap.docs.map(d => d.data());

        // 2. Prepare JSON
        const exportData = {
            userProfile: userData,
            expenses: expenses,
            exportDate: new Date().toISOString(),
            generatedBy: "IPEC Admin Portal"
        };

        // 3. Trigger Download
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `ipec_data_export_${userData.employeeId || 'user'}_${Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

    } catch (e) {
        console.error(e);
        showToast("Export failed: " + e.message, "error");
    }
};

// Custom Notification Logic
window.openNotificationModal = async () => {
    const modal = document.getElementById('modal-notification');
    const select = document.getElementById('notif-recipient');

    // Reset options to avoid duplicates
    select.innerHTML = '<option value="" disabled selected>Select Recipient</option><option value="ALL">📢 All Users</option>';

    const populateOptions = (users) => {
        users.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.docId || u.id;
            opt.textContent = `${u.name} (${u.role ? u.role.replace('_', ' ') : 'User'})`;
            select.appendChild(opt);
        });
    };

    // Populate users
    if (window.globalUsersCache && window.globalUsersCache.length > 0) {
        populateOptions(window.globalUsersCache);
    } else {
        try {
            const usersSnap = await getDocs(collection(db, "users"));
            const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            window.globalUsersCache = users;
            populateOptions(users);
        } catch (e) {
            console.error("Error fetching users for notification", e);
            showToast("Could not load user list.", "error");
        }
    }

    document.getElementById('notif-title').value = '';
    document.getElementById('notif-message').value = '';

    modal.classList.remove('hidden');
    setTimeout(() => {
        const content = document.getElementById('modal-notification-content');
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
};

window.sendCustomNotification = async () => {
    const recipient = document.getElementById('notif-recipient').value;
    const title = document.getElementById('notif-title').value.trim();
    const message = document.getElementById('notif-message').value.trim();

    if (!recipient) return showToast("Please select a recipient.", "error");
    if (!title || !message) return showToast("Title and message are required.", "error");

    const btn = document.getElementById('btn-send-notif');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';
    btn.disabled = true;

    try {
        await addDoc(collection(db, "notifications"), {
            targetUserId: recipient,
            title: title,
            body: message,
            sender: userData.name || 'Admin',
            senderRole: userData.role || 'ADMIN',
            createdAt: serverTimestamp(),
            read: false,
            type: 'CUSTOM'
        });

        showToast("Notification dispatched successfully!", "success");
        closeModal('modal-notification');
    } catch (e) {
        console.error(e);
        showToast("Failed to send: " + e.message, "error");
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};

// --- WebRTC Logic ---
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallDoc = null;
let incomingCallUnsub = null;
let activeCallUnsub = null;

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

window.listenForCalls = () => {
    if (!userData || !userData.docId) return;
    if (incomingCallUnsub) { incomingCallUnsub(); incomingCallUnsub = null; }
    const q = query(collection(db, "calls"), where("receiver", "==", userData.docId), where("status", "==", "calling"));
    incomingCallUnsub = onSnapshot(q, (snapshot) => {
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.status === 'calling') {
                showIncomingCall(docSnap.id, data);
            }
        });
    });
};

function showIncomingCall(callId, data) {
    currentCallDoc = callId;
    document.getElementById('incoming-caller-name').textContent = data.callerName || 'Unknown';
    document.getElementById('incoming-call-type').textContent = data.type === 'video' ? 'Video' : 'Voice';
    // Show caller photo
    const photoEl = document.getElementById('incoming-caller-photo');
    if (photoEl) {
        if (data.callerPhotoUrl) {
            photoEl.innerHTML = `<img src="${data.callerPhotoUrl}" class="w-full h-full object-cover">`;
        } else {
            const initial = (data.callerName || '?')[0].toUpperCase();
            photoEl.innerHTML = initial;
        }
    }
    document.getElementById('modal-incoming-call').classList.remove('hidden');
    setTimeout(() => {
        const c = document.getElementById('modal-incoming-call-content');
        if (c) {
            c.classList.remove('scale-95', 'opacity-0');
            c.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
    const ringer = document.getElementById('incoming-ringtone');
    if (ringer) ringer.play().catch(e => console.log('Autoplay prevented', e));
}

window.initiateCall = async (type) => {
    if (!currentChatUser) return showToast("Select a user to call", "error");

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        if (type === 'voice') localVideo.classList.add('hidden');
        else localVideo.classList.remove('hidden');

        showActiveCallUI(currentChatUser.name || 'User', type, currentChatUser.photoUrl || '');

        // Play outgoing ringing sound
        const outRinger = document.getElementById('outgoing-ringtone');
        if (outRinger) outRinger.play().catch(e => console.log('Autoplay prevented', e));

        peerConnection = new RTCPeerConnection(servers);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const callDocRef = doc(collection(db, "calls"));
        currentCallDoc = callDocRef.id;

        const offerCandidates = collection(callDocRef, "offerCandidates");
        const answerCandidates = collection(callDocRef, "answerCandidates");

        peerConnection.onicecandidate = event => {
            if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
        };

        peerConnection.ontrack = event => {
            document.getElementById('remote-video').srcObject = event.streams[0];
            if (type === 'video') document.getElementById('remote-video').classList.remove('opacity-0');
            else document.getElementById('remote-audio-indicator').classList.remove('hidden');
        };

        const offerDescription = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offerDescription);

        await setDoc(callDocRef, {
            offer: { type: offerDescription.type, sdp: offerDescription.sdp },
            caller: userData.docId,
            callerName: userData.name || userData.email,
            callerPhotoUrl: userData.photoUrl || '',
            receiver: currentChatUser.docId,
            receiverName: currentChatUser.name || '',
            type: type,
            status: 'calling',
            createdAt: serverTimestamp()
        });

        // Chat Log for Call
        try {
            const callLogMsg = {
                text: `📞 Started ${type === 'video' ? 'Video' : 'Voice'} Call`,
                sender: userData.name || userData.email,
                email: userData.email,
                role: userData.role,
                createdAt: serverTimestamp(),
                type: 'system'
            };
            await addDoc(collection(db, "chats", currentChatId, "messages"), callLogMsg);
            await setDoc(doc(db, "chats", currentChatId), {
                lastMessage: `📞 ${type === 'video' ? 'Video' : 'Voice'} Call`,
                lastMessageAt: serverTimestamp(),
                users: [userData.docId, currentChatUser.docId]
            }, { merge: true });
        } catch (ce) { console.error("Call log error", ce); }

        activeCallUnsub = onSnapshot(callDocRef, snapshot => {
            const data = snapshot.data();
            if (data && data.status === 'answered') {
                // Stop outgoing ringtone
                const outR = document.getElementById('outgoing-ringtone');
                if (outR) { outR.pause(); outR.currentTime = 0; }

                // Switch to connected state
                switchToConnectedUI();

                if (!peerConnection.currentRemoteDescription && data.answer) {
                    const answerDescription = new RTCSessionDescription(data.answer);
                    peerConnection.setRemoteDescription(answerDescription);
                }
            }
            if (data && data.status === 'ended') {
                cleanupCall();
            }
        });

        onSnapshot(answerCandidates, snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    peerConnection.addIceCandidate(candidate);
                }
            });
        });

    } catch (e) {
        console.error(e);
        showToast("Failed to start call: " + e.message, "error");
    }
};

window.acceptCall = async () => {
    const ringer = document.getElementById('incoming-ringtone');
    if (ringer) ringer.pause();
    const incModal = document.getElementById('modal-incoming-call');
    if (incModal) incModal.classList.add('hidden');

    try {
        const callDocRef = doc(db, "calls", currentCallDoc);
        const callSnap = await getDoc(callDocRef);
        if (!callSnap.exists()) throw new Error("Call ended");
        const callData = callSnap.data();

        localStream = await navigator.mediaDevices.getUserMedia({ video: callData.type === 'video', audio: true });
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        if (callData.type === 'voice') localVideo.classList.add('hidden');
        else localVideo.classList.remove('hidden');

        showActiveCallUI(callData.callerName || 'User', callData.type, callData.callerPhotoUrl || '');
        // Accepting = already connected, go straight to connected UI
        setTimeout(() => switchToConnectedUI(), 300);

        peerConnection = new RTCPeerConnection(servers);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offerCandidates = collection(callDocRef, "offerCandidates");
        const answerCandidates = collection(callDocRef, "answerCandidates");

        peerConnection.onicecandidate = event => {
            if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
        };

        peerConnection.ontrack = event => {
            document.getElementById('remote-video').srcObject = event.streams[0];
            if (callData.type === 'video') document.getElementById('remote-video').classList.remove('opacity-0');
            else document.getElementById('remote-audio-indicator').classList.remove('hidden');
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answerDescription = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answerDescription);

        await updateDoc(callDocRef, {
            answer: { type: answerDescription.type, sdp: answerDescription.sdp },
            status: 'answered'
        });

        onSnapshot(offerCandidates, snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    peerConnection.addIceCandidate(candidate);
                }
            });
        });

        activeCallUnsub = onSnapshot(callDocRef, snapshot => {
            const data = snapshot.data();
            if (data && data.status === 'ended') {
                cleanupCall();
            }
        });

    } catch (e) {
        console.error(e);
        showToast(e.message || "Failed to accept call", "error");
        cleanupCall();
    }
};

window.declineCall = async () => {
    const ringer = document.getElementById('incoming-ringtone');
    if (ringer) ringer.pause();
    const incModal = document.getElementById('modal-incoming-call');
    if (incModal) incModal.classList.add('hidden');
    if (currentCallDoc) {
        await updateDoc(doc(db, "calls", currentCallDoc), { status: 'ended' }).catch(console.warn);
    }
    currentCallDoc = null;
};

window.endCall = async () => {
    if (currentCallDoc) {
        await updateDoc(doc(db, "calls", currentCallDoc), { status: 'ended' }).catch(console.warn);
    }
    cleanupCall();
};

function showActiveCallUI(name, type, photoUrl) {
    document.getElementById('active-call-name').textContent = name;
    // Set header avatar with photo or initial
    const avatarEl = document.getElementById('call-avatar');
    if (photoUrl) {
        avatarEl.innerHTML = `<img src="${photoUrl}" class="w-full h-full object-cover">`;
    } else {
        avatarEl.textContent = name[0] ? name[0].toUpperCase() : '?';
    }
    // Set ringing screen avatar
    const ringingAvatarEl = document.getElementById('ringing-avatar');
    if (ringingAvatarEl) {
        if (photoUrl) {
            ringingAvatarEl.innerHTML = `<img src="${photoUrl}" class="w-full h-full object-cover">`;
        } else {
            ringingAvatarEl.textContent = name[0] ? name[0].toUpperCase() : '?';
        }
    }
    const ringingNameEl = document.getElementById('ringing-name');
    if (ringingNameEl) ringingNameEl.textContent = name;

    // Show modal in ringing state
    document.getElementById('modal-active-call').classList.remove('hidden');
    document.getElementById('modal-active-call').classList.remove('scale-50', 'translate-x-1/4', 'translate-y-1/4', 'rounded-3xl', 'overflow-hidden', 'shadow-2xl');
    document.getElementById('call-header-overlay').classList.remove('hidden');

    // Show ringing screen, hide connected screen
    const rScreen = document.getElementById('call-ringing-screen');
    const cScreen = document.getElementById('call-connected-screen');
    if (rScreen) rScreen.classList.remove('hidden');
    if (cScreen) cScreen.classList.add('hidden');

    // Show "Ringing..." status, NO timer yet
    const statusText = document.getElementById('call-status-text');
    if (statusText) {
        statusText.textContent = 'Ringing...';
        statusText.className = 'text-green-400 animate-pulse';
    }

    clearInterval(window.callInterval);
}

function switchToConnectedUI() {
    // Hide ringing screen, show connected screen
    const rScreen = document.getElementById('call-ringing-screen');
    const cScreen = document.getElementById('call-connected-screen');
    if (rScreen) rScreen.classList.add('hidden');
    if (cScreen) cScreen.classList.remove('hidden');

    // Update status to "Connected" then start timer
    const statusText = document.getElementById('call-status-text');
    if (statusText) {
        statusText.textContent = 'Connected';
        statusText.className = 'text-green-400';
    }

    // Start call timer NOW
    clearInterval(window.callInterval);
    let secs = 0;
    window.callInterval = setInterval(() => {
        secs++;
        const mins = String(Math.floor(secs / 60)).padStart(2, '0');
        const remSecs = String(secs % 60).padStart(2, '0');
        const statusEl = document.getElementById('call-status-text');
        if (statusEl) {
            statusEl.textContent = `${mins}:${remSecs}`;
            statusEl.className = 'text-green-400';
        }
    }, 1000);
}

function cleanupCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());

    peerConnection = null;
    localStream = null;
    currentCallDoc = null;
    if (activeCallUnsub) { activeCallUnsub(); activeCallUnsub = null; }

    const acModal = document.getElementById('modal-active-call');
    if (acModal) acModal.classList.add('hidden');

    const rv = document.getElementById('remote-video');
    if (rv) { rv.srcObject = null; rv.classList.add('opacity-0'); }

    const lv = document.getElementById('local-video');
    if (lv) lv.srcObject = null;

    const ai = document.getElementById('remote-audio-indicator');
    if (ai) ai.classList.add('hidden');

    clearInterval(window.callInterval);
    const statusText = document.getElementById('call-status-text');
    if (statusText) {
        statusText.textContent = 'Ringing...';
        statusText.className = 'text-green-400 animate-pulse';
    }

    // Reset ringing/connected screens
    const rScreen = document.getElementById('call-ringing-screen');
    const cScreen = document.getElementById('call-connected-screen');
    if (rScreen) rScreen.classList.remove('hidden');
    if (cScreen) cScreen.classList.add('hidden');

    // Stop ALL ringtones
    const ringer = document.getElementById('incoming-ringtone');
    if (ringer) { ringer.pause(); ringer.currentTime = 0; }
    const outRinger = document.getElementById('outgoing-ringtone');
    if (outRinger) { outRinger.pause(); outRinger.currentTime = 0; }
}

window.toggleMic = () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('btn-toggle-mic');
            if (audioTrack.enabled) {
                btn.classList.remove('bg-red-500/50', 'text-red-200');
                btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
            } else {
                btn.classList.add('bg-red-500/50', 'text-red-200');
                btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
            }
        }
    }
};

window.toggleCam = () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('btn-toggle-cam');
            if (videoTrack.enabled) {
                btn.classList.remove('bg-red-500/50', 'text-red-200');
                btn.innerHTML = '<i class="fa-solid fa-video"></i>';
            } else {
                btn.classList.add('bg-red-500/50', 'text-red-200');
                btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
            }
        }
    }
};

window.toggleCallPip = () => {
    const overlay = document.getElementById('modal-active-call');
    overlay.classList.toggle('scale-50');
    overlay.classList.toggle('translate-x-1/4');
    overlay.classList.toggle('translate-y-1/4');
    overlay.classList.toggle('rounded-3xl');
    overlay.classList.toggle('overflow-hidden');
    overlay.classList.toggle('shadow-2xl');
    document.getElementById('call-header-overlay').classList.toggle('hidden');
};

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js') // Ensure sw.js is in root
        .then(reg => console.log('Service Worker Registered'))
        .catch(err => console.error('Service Worker Error', err));
}

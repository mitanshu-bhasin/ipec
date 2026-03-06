// common.js - Shared JavaScript for admin.html and emp.html

// ===== Tailwind Configuration =====
// This must run after the Tailwind CDN script loads
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                fontFamily: { sans: ['Inter', 'sans-serif'] },
                colors: {
                    slate: {
                        700: '#2F3336',
                        800: '#16181C',
                        900: '#000000'
                    },
                    ipec: {
                        red: '#D93025',
                        green: '#1E8E3E',
                        dark: '#0F172A'
                    },
                    brand: {
                        50: '#ecfdf5',
                        100: '#d1fae5',
                        200: '#a7f3d0',
                        300: '#6ee7b7',
                        400: '#34d399',
                        500: '#10b981',
                        600: '#059669',
                        700: '#047857',
                        800: '#065f46',
                        900: '#064e3b'
                    }
                }
            }
        }
    };
}

// ===== Service Worker Registration =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.error('Service Worker Error', err));
    });
}

// ===== Notification Permission =====
if ('Notification' in window && Notification.permission === 'default') {
    window.addEventListener('load', () => {
        setTimeout(() => {
            Notification.requestPermission().then(perm => {
                if (perm === 'granted') {
                    setTimeout(() => {
                        const title = "Test Notification";
                        const opts = {
                            body: "This is a test notification to confirm setup.",
                            icon: "assets/images/cropped-ipec-logo-32x32.png"
                        };
                        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                            navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts));
                        }
                    }, 5000);
                }
            });
        }, 3000);
    });
}

// ===== Shared Utility Functions =====

/**
 * Close a modal by ID
 */
window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
};

/**
 * Get status color classes for expense status badges
 */
window.getStatusColor = (status) => {
    const colors = {
        'PENDING_MANAGER': 'bg-green-100 text-green-700 border border-green-200',
        'PENDING_FINANCE': 'bg-indigo-100 text-indigo-700 border border-indigo-200',
        'FINANCE_APPROVED': 'bg-purple-100 text-purple-700 border border-purple-200',
        'PENDING_ACCOUNTS': 'bg-orange-100 text-orange-700 border border-orange-200',
        'PENDING_COMPLIANCE': 'bg-pink-100 text-pink-700 border border-pink-200',
        'PENDING_TREASURY': 'bg-amber-100 text-amber-700 border border-amber-200',
        'PAID': 'bg-emerald-100 text-green-700 border border-emerald-200',
        'AUDITED': 'bg-teal-100 text-green-700 border border-teal-200',
        'REJECTED': 'bg-red-100 text-red-700 border border-red-200',
    };
    return colors[status] || 'bg-slate-100 text-slate-500 dark:text-slate-400';
};

/**
 * Get currency symbol
 */
window.getSymbol = (curr) => {
    const sym = { 'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£' };
    return sym[curr] || '₹';
};

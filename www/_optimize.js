const fs = require('fs');

let content = fs.readFileSync('js/admin-logic.js', 'utf8');

// Helper injection
const helpers = `
// ======== INJECTED INTERNATIONALIZATION & ERROR HELPERS ========
window.formatCurrency = (amount, currency = 'INR') => {
    try {
        return Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(amount || 0);
    } catch(e) { return '₹' + amount; }
};
window.formatDateUtc = (dateInput) => {
    if (!dateInput) return '';
    try {
        const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
        return Intl.DateTimeFormat(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    } catch(e) { return new Date(dateInput).toLocaleDateString(); }
};
window.safeFirebaseFetch = async (fetchPromise) => {
    try {
        return await fetchPromise;
    } catch (error) {
        console.error("Firebase Network Error:", error);
        if (typeof showToast === 'function') {
            showToast("Slow network or offline. Please try again.", "warning");
        }
        throw error;
    }
};
// ================================================================
`;

if (!content.includes('INJECTED INTERNATIONALIZATION')) {
    content = content.replace(/(let userData = null;)/, helpers + '\n$1');
}

// 1. Currency Replacements
// ₹${totalPaid.toLocaleString()} -> ${formatCurrency(totalPaid, 'INR')}
content = content.replace(/₹\$\{([^}]+)\.toLocaleString\(\)\}/g, "\\${formatCurrency($1, 'INR')}");

// ₹${stats.total.toLocaleString()} -> ${formatCurrency(stats.total, 'INR')}
content = content.replace(/₹\$\{(stats\.[a-zA-Z0-9_]+)\.toLocaleString\(\)\}/g, "\\${formatCurrency($1, 'INR')}");

// ₹${total.toLocaleString()} 
content = content.replace(/₹\$\{(total)\.toLocaleString\(\)\}/g, "\\${formatCurrency($1, 'INR')}");

// ${getSymbol(e.currency)}${e.totalAmount} -> ${formatCurrency(e.totalAmount, e.currency)}
content = content.replace(/\$\{getSymbol\(e\.currency\)\}\$\{e\.totalAmount\}/g, "\\${formatCurrency(e.totalAmount, e.currency)}");

// ₹${parseFloat(e.totalAmount).toLocaleString()} -> ${formatCurrency(parseFloat(e.totalAmount), e.currency || 'INR')}
content = content.replace(/₹\$\{(parseFloat\([^)]+\))\.toLocaleString\(\)\}/g, "\\${formatCurrency($1, e.currency || 'INR')}");

// 2. Date Replacements
// new Date(e.createdAt?.toDate()).toLocaleDateString()
content = content.replace(/new Date\(([^)]+)\)\.toLocaleDateString\(\)/g, "formatDateUtc($1)");

// 3. API Fetch Error Handling
// Since there's 64 await getDocs/getDoc etc... many are already in a try/catch block (like in renderOverview)
// So wrapping all naked awaits in `safeFirebaseFetch` is safer.
// Let's replace `await getDocs(...)` -> `await safeFirebaseFetch(getDocs(...))`
// Careful not to double wrap if ran multiple times.

content = content.replace(/await\s+(getDocs\([^)]+\))/g, "await safeFirebaseFetch($1)");
content = content.replace(/await\s+(getDoc\([^)]+\))/g, "await safeFirebaseFetch($1)");

// Write back
fs.writeFileSync('js/admin-logic.js', content);
console.log('Optimizations applied successfully!');

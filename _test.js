const fs = require('fs');

const content = fs.readFileSync('js/admin-logic.js', 'utf8');
const lines = content.split('\n');

const finds = {
    currency: [],
    date: [],
    firebase: []
};

lines.forEach((line, i) => {
    if (line.includes('₹') || line.includes('toLocaleString')) {
        finds.currency.push({ line: i + 1, content: line.trim() });
    }
    if (line.includes('toLocaleDateString') || line.includes('toLocaleTimeString')) {
        finds.date.push({ line: i + 1, content: line.trim() });
    }
    if (line.match(/await\s+(getDocs|getDoc|updateDoc|setDoc|addDoc)\b/) && !line.includes('try {')) {
        finds.firebase.push({ line: i + 1, content: line.trim() });
    }
});

fs.writeFileSync('result.txt', JSON.stringify({
    currency: finds.currency.length,
    date: finds.date.length,
    firebase: finds.firebase.length
}, null, 2));

console.log(`Found ${finds.currency.length} currency lines, ${finds.date.length} date lines, ${finds.firebase.length} firebase calls.`);

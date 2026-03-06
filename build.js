const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, 'www');

if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
}

const filesToCopy = fs.readdirSync(__dirname);
const ignoreList = ['node_modules', '.git', 'android', 'www', 'functions', '.github'];

filesToCopy.forEach(file => {
    if (ignoreList.includes(file)) return;

    const srcPath = path.join(__dirname, file);
    const destPath = path.join(dest, file);

    try {
        fs.cpSync(srcPath, destPath, { recursive: true });
    } catch (err) {
        // Some files might be locked, ignore
    }
});

console.log('Copied source files to www/ for Appflow/Capacitor build.');

// ============================================
// Mobile-Specific Patches (www/ only)
// ============================================

// Remove Google Sign-in from admin.html and emp.html
const googleSigninRegex = /<div id="google-signin-container"[\s\S]*?<\/div>\s*(?=\n)/g;

['admin.html', 'emp.html'].forEach(file => {
    const filePath = path.join(dest, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        const before = content.length;
        content = content.replace(googleSigninRegex, '<!-- Google Sign-in removed for mobile app -->');
        if (content.length !== before) {
            fs.writeFileSync(filePath, content);
            console.log(`  ✓ Removed Google Sign-in from www/${file}`);
        }
    }
});

console.log('Mobile patches applied.');


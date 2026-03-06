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

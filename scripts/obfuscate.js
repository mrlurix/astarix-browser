const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'build-staging');

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: true,
  rotateStringArray: true,
  selfDefending: false,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'build-staging' || entry.name === 'dist' || entry.name === '.git') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions).getObfuscatedCode();
  fs.writeFileSync(filePath, result, 'utf8');
  console.log('Obfuscated:', path.relative(staging, filePath));
}

fs.rmSync(staging, { recursive: true, force: true });
copyDir(root, staging);

fs.rmSync(path.join(staging, 'scripts'), { recursive: true, force: true });
fs.mkdirSync(path.join(staging, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'after-pack.js'), path.join(staging, 'scripts', 'after-pack.js'));

obfuscateFile(path.join(staging, 'main.js'));
obfuscateFile(path.join(staging, 'preload.js'));
obfuscateFile(path.join(staging, 'renderer', 'app.js'));

try {
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(staging, 'node_modules'), 'junction');
} catch (e) {
  console.warn('node_modules junction failed (falling back to electronVersion in config):', e.message);
}

console.log('Staging ready:', staging);

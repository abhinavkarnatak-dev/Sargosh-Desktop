import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest, storeVersion, payloadFiles, assertPayloadMatches } from './msix-utils.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Store package on Windows x64.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`);
}
const identity = JSON.parse(readFileSync('packaging/msix/identity.json', 'utf8'));
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifestXml = manifest(identity, version);
const sdkRoot = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
const candidates = existsSync(sdkRoot) ? readdirSync(sdkRoot).filter(name => /^10\.0\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).map(name => path.join(sdkRoot, name, 'x64', 'makeappx.exe')) : [];
const makeappx = process.env.SARGOSH_MAKEAPPX || candidates.find(candidate => existsSync(candidate));
if (!makeappx || !existsSync(makeappx)) throw new Error('Install the Windows SDK with MSIX Packaging Tools, or set SARGOSH_MAKEAPPX to makeappx.exe.');
const source = path.resolve('out/Sargosh-win32-x64');
for (const filename of ['Sargosh.exe', 'resources/app.asar', 'resources/sargosh-helper/sargosh-helper.exe']) {
  if (!existsSync(path.join(source, filename))) throw new Error('Missing app payload. Run npm run package first.');
}
// Reject stale output and private configuration before creating another distribution artifact.
run(process.execPath, ['scripts/check-packaged-app.mjs', source]);
payloadFiles(source);
mkdirSync('work/msix', { recursive: true });
const staging = mkdtempSync(path.resolve('work/msix/store-'));
const destination = path.join(staging, 'app');
cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
const assets = path.join(staging, 'StoreAssets');
mkdirSync(assets);
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('scripts/build-msix-assets.ps1'), '-Source', path.resolve('assets/app-icon.png'), '-Destination', assets]);
writeFileSync(path.join(staging, 'AppxManifest.xml'), manifestXml, 'utf8');
const fileCount = assertPayloadMatches(source, destination);
const outputDirectory = path.resolve('out/make/msix/x64');
mkdirSync(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, `Sargosh-${storeVersion(version)}-x64.msix`);
run(makeappx, ['pack', '/o', '/d', staging, '/p', output]);
// Unpack the actual artifact and compare every application file, including the Python runtime.
const verification = mkdtempSync(path.resolve('work/msix/verify-'));
run(makeappx, ['unpack', '/p', output, '/d', verification, '/o']);
assertPayloadMatches(source, path.join(verification, 'app'));
if (readFileSync(path.join(verification, 'AppxManifest.xml'), 'utf8') !== manifestXml) throw new Error('MSIX identity/manifest does not match the intended Store submission.');
for (const filename of ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png']) {
  if (!readFileSync(path.join(assets, filename)).equals(readFileSync(path.join(verification, 'StoreAssets', filename)))) throw new Error('MSIX icon mismatch.');
}
console.log(`Verified ${fileCount} app files, manifest, and icons in ${output}`);
console.log('This unsigned package is for Partner Center upload. It has not been Store-signed, installed, published, or tested under Store identity.');
console.log('Do not distribute it as a trusted installer. Store installation and all core features still require testing.');
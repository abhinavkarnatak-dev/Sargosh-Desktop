const path = require('node:path');
const fs = require('node:fs');
const { version } = require('./package.json');
// An allowlist keeps secrets, local history, source, and tooling out of the app.
function ignore(file) {
  const name = file.replace(/\\/g, '/');
  if (!name) return false;
  if (/\/node_modules\/\./.test(name)) return true;
  return !(/^\/package\.json$/.test(name) || /^\/dist($|\/)/.test(name) || /^\/node_modules($|\/)/.test(name) || /^\/assets$/.test(name) || /^\/assets\/(app-icon\.png|sargosh\.ico)$/.test(name));
}
module.exports = {
  packagerConfig: {
    asar: { unpack: '**/*.node' }, executableName: 'Sargosh', icon: 'assets/sargosh',
    ignore,
    download: { cacheRoot: path.resolve('work/electron-cache'), tempDirectory: path.resolve('work/build-tmp') },
    tmpdir: path.resolve('work/build-tmp'),
    extraResource: ['helper/dist/sargosh-helper'],
    appCopyright: 'Copyright Abhinav Karnatak'
  },
  hooks: {
    prePackage: async (_config, platform, arch) => {
      fs.mkdirSync(path.resolve('work/build-tmp'), { recursive: true });
      if (platform !== 'win32' || arch !== 'x64') throw new Error('This beta targets Windows x64.');
      for (const file of ['dist/main/entry.js', 'dist/renderer/index.html', 'dist/desktop-config.json', 'helper/dist/sargosh-helper/sargosh-helper.exe']) {
        if (!fs.existsSync(path.resolve(file))) throw new Error('Run npm run prepare:desktop before packaging.');
      }
    }
  },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'Sargosh', authors: 'Abhinav Karnatak', setupIcon: 'assets/sargosh.ico', setupExe: `Sargosh-${version}-beta-Setup.exe`, noMsi: true } }]
};

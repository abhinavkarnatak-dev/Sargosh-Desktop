// Installer events must finish before storage, authentication, or windows start.
if (process.windowsStore || !require('electron-squirrel-startup')) require('./main');

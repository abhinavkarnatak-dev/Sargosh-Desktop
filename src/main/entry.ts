// Installer events must finish before storage, authentication, or windows start.
if (!require('electron-squirrel-startup')) require('./main');

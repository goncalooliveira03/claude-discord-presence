// Daemon life-cycle helpers shared by daemon.js and install.js.
const fs = require('fs');
const net = require('net');
const path = require('path');

// A daemon exits as soon as something connects to its lock pipe.
// Resolves once the connection closes, or right away when nothing is listening.
function stopDaemon(pipePath) {
  return new Promise((resolve) => {
    const pipe = net.connect(pipePath);
    pipe.on('error', () => { /* not running; 'close' follows */ });
    pipe.on('close', resolve);
  });
}

// Copies config.json from the data folder used before the rename, once.
// Returns true when it copied. Never overwrites a newer config.json.
function migrateLegacyConfig(fromDir, toDir) {
  const from = path.join(fromDir, 'config.json');
  const to = path.join(toDir, 'config.json');
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  return true;
}

module.exports = { stopDaemon, migrateLegacyConfig };

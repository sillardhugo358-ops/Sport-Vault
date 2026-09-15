const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.join(__dirname, 'server.js');
let source = fs.readFileSync(filename, 'utf8');

// Fix the over-escaped email validation in the current prototype without
// duplicating the full server implementation.
source = source.replace(
  '!/^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$/.test(email)',
  '!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)'
);

const app = new Module(filename, module);
app.filename = filename;
app.paths = Module._nodeModulePaths(__dirname);
app._compile(source, filename);

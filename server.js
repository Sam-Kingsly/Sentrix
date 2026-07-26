const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

// Force production mode to use your built files
const app = next({ dev: false }); 
const handle = app.getRequestHandler();

// Grab Catalyst's assigned port securely
const port = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 3000;

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, '0.0.0.0', (err) => {
    if (err) throw err;
    console.log(`> Sentrix securely running on http://0.0.0.0:${port}`);
  });
});
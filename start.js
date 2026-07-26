// Grab the Catalyst port, default to 3000 if not found
process.env.PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 3000;

// Force Next.js to open to the outside world
process.env.HOSTNAME = '0.0.0.0';

console.log("Catalyst Booting Next.js on port: " + process.env.PORT);

// Boot the standalone Next.js server
require('./server.js');
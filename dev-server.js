const http = require('http');
const { getDashboard, discoverDevices, setDevice } = require('./marstek-client');

const PORT = 3000;

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ip' && args[i + 1]) {
      result.ip = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      result.port = parseInt(args[++i], 10);
    }
  }
  return result;
}

async function init() {
  const args = parseArgs();

  if (args.ip) {
    // IP fournie en argument
    setDevice(args.ip, args.port || 30000);
    console.log(`Using device: ${args.ip}:${args.port || 30000}`);
  } else {
    // Auto-détection
    console.log('Discovering Marstek devices...');
    const devices = await discoverDevices(3000);

    if (devices.length === 0) {
      console.error('\n❌ No Marstek device found on network.');
      console.error('Usage: node dev-server.js --ip <IP> [--port <PORT>]');
      console.error('Example: node dev-server.js --ip 192.168.1.69\n');
      process.exit(1);
    }

    const device = devices[0];
    setDevice(device.ip, device.port);
    console.log(`✓ Found: ${device.device} v${device.ver} @ ${device.ip}:${device.port}`);

    if (devices.length > 1) {
      console.log(`  (${devices.length - 1} other device(s) ignored)`);
    }
  }

  // Démarrer le serveur HTTP
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/dashboard') {
      try {
        const data = await getDashboard();
        res.end(JSON.stringify(data));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(PORT, () => {
    console.log(`Dev server running on http://localhost:${PORT}`);
  });
}

init();

const dgram = require('dgram');

const DEFAULT_PORT = 30000;
const TIMEOUT_MS = 5000;

let deviceIp = null;
let devicePort = DEFAULT_PORT;

function setDevice(ip, port = DEFAULT_PORT) {
  deviceIp = ip;
  devicePort = port;
}

function getDevice() {
  return { ip: deviceIp, port: devicePort };
}

function discoverDevices(timeout = 3000) {
  return new Promise((resolve) => {
    const devices = [];
    const client = dgram.createSocket('udp4');

    client.on('message', (msg, rinfo) => {
      try {
        const response = JSON.parse(msg.toString());
        if (response.result?.device) {
          // Éviter les doublons
          if (!devices.find(d => d.ip === rinfo.address)) {
            devices.push({
              ip: rinfo.address,
              port: DEFAULT_PORT,
              ...response.result
            });
          }
        }
      } catch {}
    });

    client.bind(() => {
      client.setBroadcast(true);
      const message = JSON.stringify({
        id: 0,
        method: 'Marstek.GetDevice',
        params: { ble_mac: '0' }
      });
      client.send(message, DEFAULT_PORT, '255.255.255.255');
    });

    setTimeout(() => {
      client.close();
      resolve(devices);
    }, timeout);
  });
}

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!deviceIp) {
      reject(new Error('Device not configured. Call setDevice(ip, port) first.'));
      return;
    }

    const client = dgram.createSocket('udp4');
    const message = Buffer.from(JSON.stringify(command));

    const timeout = setTimeout(() => {
      client.close();
      reject(new Error(`Timeout après ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    client.once('message', (msg) => {
      clearTimeout(timeout);
      client.close();
      try {
        const response = JSON.parse(msg.toString());
        resolve(response.result || {});
      } catch (e) {
        reject(new Error(`Erreur parsing JSON: ${e.message}`));
      }
    });

    client.send(message, devicePort, deviceIp, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        reject(err);
      }
    });
  });
}

async function getDashboard() {
  // Appels séquentiels - le device ne gère qu'une requête UDP à la fois
  const device = await sendCommand({ id: 1, method: 'Marstek.GetDevice', params: { ble_mac: '0' } }).catch(() => ({}));
  const energy = await sendCommand({ id: 2, method: 'ES.GetStatus', params: { id: 0 } }).catch(() => ({}));
  const battery = await sendCommand({ id: 3, method: 'Bat.GetStatus', params: { id: 0 } }).catch(() => ({}));
  const wifi = await sendCommand({ id: 4, method: 'Wifi.GetStatus', params: { id: 0 } }).catch(() => ({}));
  const mode = await sendCommand({ id: 5, method: 'ES.GetMode', params: { id: 0 } }).catch(() => ({}));
  const meter = await sendCommand({ id: 6, method: 'EM.GetStatus', params: { id: 0 } }).catch(() => ({}));

  return {
    device,
    battery,
    energy,
    mode,
    meter,
    wifi,
    timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

module.exports = { sendCommand, getDashboard, discoverDevices, setDevice, getDevice };

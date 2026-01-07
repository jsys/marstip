const dgram = require('dgram');

const DEVICE_IP = '192.168.1.69';
const DEVICE_PORT = 30000;
const TIMEOUT_MS = 5000;

function sendCommand(command) {
  return new Promise((resolve, reject) => {
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

    client.send(message, DEVICE_PORT, DEVICE_IP, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        reject(err);
      }
    });
  });
}

async function getDashboard() {
  const [device, energy, battery, wifi, mode, meter] = await Promise.all([
    sendCommand({ id: 1, method: 'Marstek.GetDevice', params: { ble_mac: '0' } }).catch(() => ({})),
    sendCommand({ id: 2, method: 'ES.GetStatus', params: { id: 0 } }).catch(() => ({})),
    sendCommand({ id: 3, method: 'Bat.GetStatus', params: { id: 0 } }).catch(() => ({})),
    sendCommand({ id: 4, method: 'Wifi.GetStatus', params: { id: 0 } }).catch(() => ({})),
    sendCommand({ id: 5, method: 'ES.GetMode', params: { id: 0 } }).catch(() => ({})),
    sendCommand({ id: 6, method: 'EM.GetStatus', params: { id: 0 } }).catch(() => ({})),
  ]);

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

module.exports = { sendCommand, getDashboard };

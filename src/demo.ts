import { parseArgs } from 'node:util';
import type { AddressInfo } from 'node:net';
import { numberInRange } from './config-values.js';
import { startInteractiveDemo } from './demo/server.js';

async function main() {
  const { values } = parseArgs({ options: { 'udp-port': { type: 'string' }, 'hub-port': { type: 'string' }, 'control-port': { type: 'string' }, devices: { type: 'string' }, hz: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run demo:interactive -- [--udp-port 9000] [--hub-port 3000] [--control-port 3100] [--devices 50] [--hz 20]\nLancer le hub séparément. Arrêter tout autre simulateur sur ces mêmes identifiants.\nOuvrir http://127.0.0.1:3100 : surchauffe, coupure, reprise et redémarrage à la demande.\nLe contrôleur et les émissions UDP restent sur 127.0.0.1. Ctrl+C arrête uniquement cette démo.'); return;
  }
  const port = (key: 'udp-port' | 'hub-port' | 'control-port', fallback: number) => numberInRange(values[key] ?? fallback, key, 1, 65535);
  const demo = await startInteractiveDemo({ udpPort: port('udp-port', 9000), hubPort: port('hub-port', 3000), controlPort: port('control-port', 3100),
    devices: numberInRange(values.devices ?? 50, 'devices', 1, 200), hz: numberInRange(values.hz ?? 20, 'hz', 1, 100) });
  console.log(`Démo interactive : http://127.0.0.1:${(demo.server.address() as AddressInfo).port}\nÉmetteur UDP local actif. Utiliser un seul simulateur par plage d’identifiants.`);
  const stop = () => { void demo.close().catch(e => { console.error(e); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch((e: unknown) => { console.error(`Démo interactive : ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });

import { parseArgs } from 'node:util';
import { loadConfig, numberInRange, type Config } from './config.js';
import { startHub } from './server.js';

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, 'udp-port': { type: 'string' }, 'http-port': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('npm run hub -- [--config fichier.json] [--udp-port 9000] [--http-port 3000]'); return; }
  const overrides: Partial<Config> = {};
  if (values['udp-port']) overrides.udpPort = numberInRange(values['udp-port'], 'udp-port', 1, 65535);
  if (values['http-port']) overrides.httpPort = numberInRange(values['http-port'], 'http-port', 1, 65535);
  const config = loadConfig(values.config, overrides);
  const hub = await startHub(config);
  console.log(`PulseHub | UDP ${config.udpHost}:${config.udpPort} | http://${config.httpHost}:${config.httpPort}`);
  const stop = () => { void hub.close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch((error: unknown) => { console.error(`Impossible de démarrer PulseHub: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

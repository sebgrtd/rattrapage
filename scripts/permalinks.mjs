import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const hash = git('rev-parse', 'HEAD');
const remote = git('remote', 'get-url', 'origin').replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
if (!/^https:\/\/(github\.com|gitlab\.com)\//.test(remote)) throw new Error('Remote GitHub/GitLab HTTPS ou SSH attendu');
const definitions = [
  ['KISS / traitement explicite', 'Le décodeur valide chaque champ avec Buffer et retourne un résultat typé ; aucune couche de parsing générique.', 'src/protocol.ts', 'export function decode', 'export function encode'],
  ['Séparation des responsabilités', 'Le séquenceur décide uniquement de l’ordre et des trous, indépendamment du réseau, des alertes et de l’affichage.', 'src/sequence.ts', 'export class Sequencer', null],
  ['Injection de dépendance', 'Fleet reçoit sa configuration et son horloge ; les tests avancent le temps sans attendre.', 'src/fleet.ts', 'export class Fleet', '  private apply'],
  ['Règles pilotées par les données', 'Un même moteur évalue les limites et durées de chaque règle JSON ; ajouter une règle ne demande pas de nouvelle condition spécifique.', 'src/processing/alerts.ts', 'export const alertsFactory', null],
  ['Extension par composition', 'Les étapes implémentent un contrat commun ; une nouvelle factory rejoint le registre sans modifier les étapes existantes.', 'src/processing/pipeline.ts', 'export const stepFactories', null],
  ['Frontière réseau / métier', 'Les adaptateurs UDP et HTTP délèguent le traitement métier à Fleet et diffusent des instantanés.', 'src/server.ts', 'export async function startHub', null],
];
const rows = definitions.map(([name, explanation, file, start, end]) => {
  const lines = git('show', `${hash}:${file}`).split('\n');
  const first = lines.findIndex(line => line.includes(start));
  const last = end ? lines.findIndex((line, index) => index > first && line.includes(end)) : lines.length;
  if (first < 0 || last <= first) throw new Error(`Bornes introuvables pour ${file}`);
  const segment = remote.includes('gitlab.com') ? '/-/blob/' : '/blob/';
  return `| ${name} | ${explanation} | [${file}, lignes ${first + 1}–${last}](${remote}${segment}${hash}/${file}#L${first + 1}-L${last}) |`;
});
let readme = readFileSync('README.md', 'utf8');
readme = readme.replace(/<!-- PRINCIPLES:START -->[\s\S]*?<!-- PRINCIPLES:END -->/, `<!-- PRINCIPLES:START -->\n| Principe | Preuve concrète | Code immuable |\n| --- | --- | --- |\n${rows.join('\n')}\n<!-- PRINCIPLES:END -->`);
const report = JSON.parse(readFileSync('docs/benchmark-isolated.json', 'utf8'));
const results = report.results;
const successful = results.filter(r => r.sustained);
const best = successful.length ? Math.max(...successful.map(r => r.target)) : 0;
const failed = results.find(r => r.target > best && !r.sustained);
const table = results.map(r => `| ${r.target} | ${r.offeredFramesPerSecond} | ${r.receivedFramesPerSecond} | ${r.deliveryPercent} % | ${r.inferredLost} | ${r.maxRssMiB} | ${r.httpP95Ms} | ${r.sustained ? 'Oui' : 'Non'} |`).join('\n');
const summary = `Mesure du ${report.at}, sur ${report.cpu.trim()}, ${report.os}, Node ${report.node}, avec ${report.workers} émetteurs et ${report.secondsPerStep} s par palier. Plus haut palier testé validé : **${best} trames/s demandées**${failed ? ` ; le palier ${failed.target} échoue aux critères malgré une émission suffisante` : ' ; le plafond n’a pas été atteint parmi les paliers testés'}. Ces processus partagent la machine avec ses autres applications ; ce n’est pas une isolation matérielle.`;
const core = `Le traitement synchrone seul atteint **${report.core.framesPerSecond} trames/s**, sur ${report.core.accepted} trames acceptées en ${report.core.processingSeconds} s de traitement cumulé. Cette mesure exclut UDP, HTTP, persistance et encodage ; elle ne constitue pas le débit soutenu du serveur complet.`;
readme = readme.replace(/<!-- BENCHMARK:START -->[\s\S]*?<!-- BENCHMARK:END -->/, `<!-- BENCHMARK:START -->\n${summary}\n\n| Cible /s | Émis /s | Reçus /s estimés | Livraison | Trous | RSS max Mio | HTTP p95 ms | Soutenu |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${table}\n\n${core}\n<!-- BENCHMARK:END -->`);
writeFileSync('README.md', readme);
console.log(`Permaliens générés sur ${hash} ; tableau de benchmark actualisé.`);

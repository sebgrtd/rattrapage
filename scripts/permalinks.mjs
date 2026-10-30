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
  ['Règles pilotées par les données', 'Un même moteur évalue les limites et durées de chaque règle JSON ; ajouter une règle ne demande pas de nouvelle condition spécifique.', 'src/fleet.ts', '    for (const measurement', '  private pruneBuckets'],
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
const report = JSON.parse(readFileSync('docs/benchmark.json', 'utf8'));
const results = report.results;
const successful = results.filter(r => r.sustained);
const best = successful.length ? Math.max(...successful.map(r => r.target)) : 0;
const failed = results.find(r => r.target > best && !r.sustained);
const table = results.map(r => `| ${r.target} | ${r.actualFramesPerSecond} | ${r.deliveryPercent} % | ${r.inferredLost} | ${r.maxRssMiB} | ${r.maxHttpMs} | ${r.sustained ? 'Oui' : 'Non'} |`).join('\n');
const summary = `Mesure du ${report.at}, sur ${report.cpu.trim()}, ${report.os}, Node ${report.node}. Plus haut palier validé : **${best} trames/s demandées**${failed ? ` ; le palier ${failed.target} échoue aux critères. Cette mesure porte sur la chaîne simulée complète ; la saturation du simulateur ne permet pas d’isoler le plafond du hub seul` : ' ; le plafond n’a pas été atteint parmi les paliers testés'}.`;
readme = readme.replace(/<!-- BENCHMARK:START -->[\s\S]*?<!-- BENCHMARK:END -->/, `<!-- BENCHMARK:START -->\n${summary}\n\n| Cible /s | Émis /s mesurés | Livraison | Trous | RSS max Mio | HTTP max ms | Soutenu |\n| --- | --- | --- | --- | --- | --- | --- |\n${table}\n<!-- BENCHMARK:END -->`);
writeFileSync('README.md', readme);
console.log(`Permaliens générés sur ${hash} ; tableau de benchmark actualisé.`);

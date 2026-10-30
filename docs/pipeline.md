# Configurer et étendre le traitement

La liste `pipeline` du JSON déclare les étapes et leur ordre. Elle remplace entièrement la liste par défaut. Les règles `alerts` restent dans le même fichier de configuration et sont sélectionnées par les étapes de type `alerts`.

```json
{
  "pipeline": [
    { "id": "selection", "type": "filter", "excludeDeviceIds": [50] },
    { "id": "temperature-mean", "type": "aggregate", "label": "Moy. 5 s", "metricId": 1, "operation": "mean", "windowMs": 5000, "maxSamples": 128 },
    { "id": "voltage-min", "type": "aggregate", "label": "Min. 10 s", "metricId": 2, "operation": "min", "windowMs": 10000, "maxSamples": 256 },
    { "id": "physical-alerts", "type": "alerts", "ruleIds": ["temperature", "voltage", "current"] }
  ]
}
```

Cet exemple est livré dans `config/pipeline-example.json` :

```sh
npm run hub -- --config config/pipeline-example.json
```

Sous PowerShell, utiliser `npm.cmd` pour transmettre les options. Le port reste 9000, l’interface reste sur http://127.0.0.1:3000. L’appareil 50 est toujours détecté au niveau transport, mais ses mesures sont filtrées ; la table indique qu’elles ne sont pas disponibles. Les appareils 1 à 49 affichent une moyenne de température sur 5 secondes et un minimum de tension sur 10 secondes.

## Sémantique des étapes

| Type | Paramètres | Comportement |
| --- | --- | --- |
| `filter` | `deviceIds` facultatif, `excludeDeviceIds`, `metricId` facultatif, `min`, `max` | Conserve seulement les appareils autorisés et les télémétries dont la mesure sélectionnée existe et respecte les bornes inclusives |
| `aggregate` | `metricId`, `operation` (`mean`, `min`, `max`), `windowMs`, `maxSamples`, `label` | Calcule par appareil sur les valeurs acceptées dans la fenêtre et les N derniers échantillons maximum |
| `alerts` | `ruleIds` facultatif | Évalue les règles nommées ; absence de sélection = toutes les règles configurées |

Tous les filtres précèdent les calculs. Une configuration qui place un filtre après une agrégation ou une alerte est refusée au démarrage : on évite les calculs partiels sur une trame ensuite rejetée. Les identifiants d’étape sont uniques ; les types et les références aux règles sont validés. Au maximum 32 étapes peuvent être déclarées.

Le protocole et le séquencement restent obligatoires **avant** la chaîne configurable. Le filtrage ne doit pas fabriquer de pertes réseau. Une trame filtrée compte donc parmi les trames acceptées par le transport, et incrémente aussi `filtered`, qui est un sous-compteur. Elle actualise la présence de l’appareil, mais efface ses mesures courantes, agrégations et temporisations d’alerte : une ancienne mesure saine ne doit pas masquer une nouvelle mesure refusée. Les heartbeats ne sont pas soumis au filtre de valeur, puisqu’ils ne portent pas de mesures ; un filtre d’identifiant s’applique également aux heartbeats.

Les agrégats utilisent les valeurs entières du protocole. L’interface effectue la conversion en °C, V et A. La moyenne est une moyenne arithmétique des **échantillons**, pas une moyenne pondérée par le temps. `maxSamples` borne la mémoire ; à haut débit, la période effective peut donc être plus courte que `windowMs`. Une valeur périmée s’affiche comme indisponible. Les agrégats ne remplacent pas les mesures brutes utilisées par les alertes.

Un redémarrage confirmé vide toutes les fenêtres et temporisations du seul appareil concerné. Aucun échantillon d’avant redémarrage n’entre dans les nouvelles moyennes.

## Ajouter une nouvelle catégorie de traitement

1. Créer un module sous `src/processing/` qui exporte un `StepFactory`.
2. Implémenter `validate` pour les paramètres JSON et `create` pour construire l’étape. `process(frame, context)` retourne `true` pour poursuivre, `false` pour filtrer. Une étape qui peut filtrer doit déclarer `phase: 'filter'` et ne doit pas modifier les données.
3. Importer cette fabrique dans `src/processing/pipeline.ts` et ajouter une entrée à `stepFactories`.
4. Ajouter l’étape au JSON et ses tests. Les modules `filter.ts`, `aggregate.ts`, `alerts.ts` et la classe `Fleet` existants restent inchangés.

Le test « new processing type plugs into the registry » injecte une fabrique supplémentaire et vérifie son ordre d’exécution autour d’une agrégation existante. C’est une preuve de l’extension, pas seulement un schéma théorique.

Les étapes sont du code local de confiance ; le JSON ne charge pas de module arbitraire et n’exécute pas de texte JavaScript. Les chaînes vides ou sans étape `alerts` sont possibles, mais désactivent les fonctions correspondantes : ce sont des choix explicites de l’opérateur, pas la configuration livrée par défaut.

## Détection de redémarrage

La section `restart` contient tous les seuils :

| Paramètre | Défaut | Rôle |
| --- | --- | --- |
| `maxUptimeMs` | 5000 | Nouvelle session observée dans ses cinq premières secondes |
| `maxSequence` | 128 | Les numéros candidats doivent se situer au début de la séquence |
| `minUptimeDropMs` | 250 | Baisse minimale d’uptime qui déclenche une candidature |
| `confirmFrames` | 3 | Nombre de trames distinctes et progressives nécessaires |
| `confirmWindowMs` | 1500 | Délai maximum pour obtenir la confirmation |
| `uptimeToleranceMs` | 1000 | Tolérance entre progression de l’uptime et temps de réception |

Les premières trames candidates sont écartées et comptées dans `restartPending` ; elles ne rafraîchissent pas l’état affiché. À confirmation, seule la trame courante est appliquée, sans inventer de trous entre les deux sessions. `restarts` compte les événements confirmés, globalement et par appareil. Les compteurs historiques de réception restent cumulatifs.

Une trame normale de la session précédente interrompt la candidature. Les copies d’une même trame ne peuvent pas confirmer un redémarrage. Après confirmation, une progression d’uptime incompatible avec le temps écoulé permet d’écarter les paquets manifestement issus de l’ancienne session. Les bouclages naturels uint32 restent traités par arithmétique modulaire.

**Limite du protocole v1 :** sans identifiant de démarrage, aucune heuristique ne peut distinguer tous les cas. Plusieurs anciens paquets cohérents peuvent ressembler à un redémarrage ; un redémarrage très précoce, trop tardivement observé ou hors des seuils peut ne pas être détecté. Les tests couvrent les scénarios annoncés, pas une garantie d’authenticité. Pour lever cette ambiguïté, une version suivante du protocole devrait porter un `bootId`.

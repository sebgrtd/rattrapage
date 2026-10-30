# Démonstration interactive

Cette page pilote un **simulateur local**. Les boutons modifient les futures trames UDP ; ils ne modifient jamais directement l’état du hub et ne commandent aucun appareil physique. La colonne « Observé par le hub » lit réellement son API. Les mêmes effets sont visibles dans le dashboard web et dans le CLI.

## Lancer

Arrêter avec `Ctrl+C` tout simulateur déjà lancé (`simulator`, `demo` ou `demo:restart`). Un seul émetteur doit utiliser les identifiants PH-001 à PH-050 : deux simulateurs concurrents rendraient les séquences et les incidents incohérents. Pour des compteurs à zéro, redémarrer également le hub ; l’historique existant reste conservé.

```sh
# Terminal 1 :
npm run hub
# Terminal 2 :
npm run demo:interactive
# Terminal 3, facultatif :
npm run cli
```

Ouvrir **http://127.0.0.1:3100** pour les commandes et **http://127.0.0.1:3000** pour le dashboard. Le contrôleur démarre avec 50 appareils nominaux, 20 Hz chacun. Il émet uniquement des télémétries valides, sans corruption, doublon ni retard artificiel. `npm run demo` reste disponible pour ces autres défauts.

![Surchauffe de PH-009 réellement détectée par le hub](demo-interactive.png)

## Parcours avec les seuils par défaut

1. Choisir **PH-009**. Vérifier « Active », une température autour de 43 °C et « Opérationnel » dans la colonne du hub.
2. Cliquer **Déclencher une surchauffe** : les prochaines trames portent environ 85 °C. Le hub passe en observation, puis en alerte après 3 secondes d’anomalie continue. **Refroidir l’appareil** rétablit une température normale.
3. Cliquer **Couper l’émission** : plus aucune trame ne part pour cet appareil. Ses mesures deviennent périmées après 2 secondes, puis il passe hors ligne après 3 secondes. **Reprendre l’émission** reprend la même session, sans remise à zéro de la séquence ni de l’uptime.
4. Cliquer **Redémarrer** : une seconde de silence, puis séquence et uptime repartent à zéro. Le hub confirme le redémarrage sur trois trames cohérentes ; son compteur augmente et les agrégats sont réinitialisés. La consigne de température est conservée : redémarrer ne refroidit pas l’appareil. Les commandes sont désactivées pendant cette seconde.
5. Cliquer **Revenir à la normale** : émission active et température nominale pour l’appareil sélectionné. Les compteurs, l’historique et les autres appareils sont conservés.

Une commande acceptée n’est pas encore une confirmation de son effet : attendre la colonne du hub, mise à jour après réception et traitement des vraies trames. Les descriptions correspondent à `config/default.json` ; modifier les seuils du hub change les délais réellement observés.

Le redémarrage nécessite au moins une seconde de télémétrie préalable et quatre trames émises. Cela évite une remise à zéro trop précoce pour l’heuristique du protocole v1. Les limites de détection, notamment sans `bootId`, restent celles décrites dans [pipeline.md](pipeline.md).

**Une coupure n’invente pas de pertes.** La séquence ne progresse pas pendant l’arrêt de l’émetteur : elle reprend au numéro suivant. Le silence est révélé par la fraîcheur et l’état hors ligne. La démo automatique montre séparément les trous de séquence provoqués par les corruptions et désordres.

Le journal conserve les 12 dernières commandes en mémoire. Il est réinitialisé avec le contrôleur ; l’historique durable reste celui du hub. Si le hub est indisponible, les commandes restent possibles mais la colonne observée indique « Indisponible ». Si le contrôleur est inaccessible, les boutons sont désactivés et la page tente de se reconnecter.

## Options et arrêt

```sh
npm.cmd run demo:interactive -- --udp-port 9001 --hub-port 3001 --control-port 3101 --devices 20 --hz 10
```

Les ports doivent correspondre au hub lancé. `devices` accepte 1 à 200 appareils et `hz` 1 à 100. Le serveur de commande et les émissions UDP restent sur `127.0.0.1`. L’API accepte seulement des objets JSON de taille limitée et refuse les origines web étrangères.

`Ctrl+C` dans le terminal du contrôleur arrête son serveur et ses émissions, sans arrêter le hub. Ses appareils deviennent ensuite hors ligne. Après compilation, utiliser `node dist/demo.js` en conservant `public/` à côté de `dist/`.

Les tests vérifient les transitions avec une horloge contrôlée, puis déclenchent de vraies commandes HTTP suivies de vraies émissions UDP et vérifient l’alerte, la coupure, la reprise et le redémarrage constatés par le hub.

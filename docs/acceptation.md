# Recette de validation

## Installation propre

1. Cloner le dépôt, sélectionner `v1.0`, lancer `npm ci` puis `npm run check`.
2. Ouvrir deux terminaux à la racine du projet.
3. Lancer `npm run hub` dans le premier, ouvrir http://127.0.0.1:3000.
4. Vérifier que les compteurs reçues, invalides, pertes, doublons, retards et les quatre cartes de flotte sont tous à zéro. Aucun appareil n’apparaît.

## Cas nominal

1. Lancer `npm run simulator` dans le second terminal.
2. Observer 50 appareils, environ 1 000 trames/s, 0 invalide et 0 perte dans un environnement local non saturé.
3. Vérifier que les valeurs sont plausibles : environ 40–46 °C, 23,7–24,3 V, 2,5–3 A.
4. Les heartbeats périodiques n’effacent pas les dernières mesures.
5. Arrêter le simulateur. Après 2 s, les mesures deviennent périmées ; après 3 s, les 50 appareils sont hors ligne. Le graphe converge vers zéro.

## Défauts et sécurité du décodage

1. Arrêter aussi le hub, puis relancer `npm run hub` et `npm run demo`.
2. Les compteurs invalides, trous, doublons et retards augmentent. Le hub reste réactif.
3. Les huit premiers appareils présentent une température élevée ; les alertes de température s’activent après 3 s de dépassement continu observé.
4. L’appareil `PH-007` cesse d’émettre après 8 s et passe hors ligne après environ 11 s.
5. Les appareils sains restent opérationnels ; la synthèse n’est pas remplacée par des logs défilants.
6. Rechercher `PH-007`, puis filtrer les appareils à surveiller et revenir à tous les états.

## Historique et navigateur

1. Attendre au moins 5 s. Ouvrir l’historique, choisir une date et constater le libellé « Lecture historique ».
2. Revenir au direct et vérifier que la réception continue à évoluer.
3. Redémarrer le hub ; les compteurs courants reviennent à zéro, mais l’historique reste consultable.
4. Ouvrir la page avec une largeur de 390 px ; vérifier les cartes sur deux colonnes et le défilement horizontal limité au tableau.
5. Arrêter le hub et vérifier le libellé « Déconnecté · données figées ». Relancer le hub : EventSource se reconnecte automatiquement.

## Contrôles automatisés

`npm run check` couvre le décodeur, la synthèse et les vrais échanges UDP/HTTP/SSE. Les tests injectent une horloge pour les temporisations métier : ils ne dépendent pas de pauses de plusieurs secondes. Le test d’intégration du simulateur utilise un réseau loopback et des durées réduites ; c’est le seul test métier nécessitant une émission réelle temporisée.

`npm run benchmark` produit des mesures et non des estimations théoriques. Voir la méthode, les seuils de réussite et les limites dans le README.


## Bonus : redémarrage et chaîne JSON

1. Avec le hub lancé, démarrer `npm run demo:restart`. Après environ six secondes, l’appareil 7 reprend ses émissions avec une nouvelle séquence et un nouvel uptime ; le compteur de redémarrages augmente une seule fois.
2. Vérifier que ses anciennes mesures et moyennes ne sont pas conservées après confirmation, puis que les nouvelles valeurs réapparaissent. Le compteur global de réception continue à augmenter.
3. Relancer le hub avec `npm.cmd run hub -- --config config/pipeline-example.json` sous PowerShell, puis le simulateur nominal. L’appareil 50 est détecté mais ses mesures sont filtrées ; les autres affichent les agrégats configurés.
4. Consulter l’historique et vérifier que les nouveaux instantanés conservent agrégats et compteurs de redémarrage. Les anciens instantanés sans ces champs restent lisibles.
5. Lancer `npm run benchmark` : le rapport distingue le débit émis, le débit reçu, l’atteinte de la cible par les émetteurs et la capacité du traitement métier sans I/O.

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

### Menus et contrôles personnalisés

1. Au clavier, ouvrir le filtre d’état avec `↓`, aller au dernier état avec `Fin`, puis `Entrée`. Sans appareil hors ligne, la table doit annoncer zéro résultat. Revenir à « Tous les états » avec la souris.
2. Saisir `009` dans la recherche de flotte, puis utiliser « Effacer la recherche » : une seule ligne, puis toute la flotte ; le focus revient au champ.
3. Ouvrir l’historique et sélectionner un instantané au clavier. Vérifier « Lecture historique », puis le retour au direct.
4. Dans l’atelier, ouvrir les appareils, chercher `050`, valider avec `Entrée` : le panneau observé doit afficher PH-050. Chercher ensuite un identifiant inexistant : « Aucun résultat ». `Échap` ferme en conservant PH-050 et rend le focus au sélecteur.
5. Vérifier qu’un clic extérieur et `Tab` ferment les menus sans modifier la valeur. Le focus doit poursuivre vers la commande suivante, sans rester bloqué dans la liste.
6. À 390 px de largeur, ouvrir les menus du dashboard et de l’atelier : aucun débordement de la page, menus dans la fenêtre, tableau défilable horizontalement.
7. Survoler une mesure et sa moyenne : les infobulles utilisent le thème de l’application et restent cohérentes après les mises à jour SSE. Vérifier les contrastes du texte et la distinction des états avec leurs libellés.

Validation du 30 octobre 2026 : filtres, historique, recherche/effacement, choix d’appareil à la souris et au clavier, aucun résultat, Échap, Tab, affichages desktop et 390 px contrôlés dans Chrome. Les captures du README proviennent des interfaces en fonctionnement. Les tests d’intégration vérifient aussi la disponibilité et les types MIME des ressources partagées sur les deux serveurs.

## Contrôles automatisés

`npm run check` couvre le décodeur, la synthèse et les vrais échanges UDP/HTTP/SSE. Les tests unitaires injectent une horloge pour les temporisations métier. Les tests d’intégration des simulateurs automatique et interactif utilisent de vrais sockets loopback et des délais réduits.

`npm run benchmark` produit des mesures et non des estimations théoriques. Voir la méthode, les seuils de réussite et les limites dans le README.

## Démo pilotée depuis le navigateur

Suivre le [parcours interactif](demo-interactive.md) : surchauffe → alerte après la durée configurée, coupure → hors ligne, retour au nominal, redémarrage → compteur augmenté. Vérifier les effets dans le panneau de contrôle, le dashboard web et le CLI. Garder un seul simulateur actif sur les identifiants utilisés.


## Bonus : redémarrage et chaîne JSON

1. Avec le hub lancé, démarrer `npm run demo:restart`. Après environ six secondes, l’appareil 7 reprend ses émissions avec une nouvelle séquence et un nouvel uptime ; le compteur de redémarrages augmente une seule fois.
2. Vérifier que ses anciennes mesures et moyennes ne sont pas conservées après confirmation, puis que les nouvelles valeurs réapparaissent. Le compteur global de réception continue à augmenter.
3. Relancer le hub avec `npm.cmd run hub -- --config config/pipeline-example.json` sous PowerShell, puis le simulateur nominal. L’appareil 50 est détecté mais ses mesures sont filtrées ; les autres affichent les agrégats configurés.
4. Consulter l’historique et vérifier que les nouveaux instantanés conservent agrégats et compteurs de redémarrage. Les anciens instantanés sans ces champs restent lisibles.
5. Lancer `npm run benchmark` : le rapport distingue le débit émis, le débit reçu, l’atteinte de la cible par les émetteurs et la capacité du traitement métier sans I/O.

# Préparer la soutenance individuelle

Ce document aide à comprendre et démontrer le livrable. Il ne remplace pas la lecture du code. Refaire les expériences et reformuler les explications avec ses propres mots.

## Parcours de 20 minutes

| Temps | Démonstration | Ce qu’il faut expliquer |
| --- | --- | --- |
| 0–2 min | Problème de régie et vue d’architecture | Centaines d’appareils, réception non fiable, besoin d’une synthèse exploitable |
| 2–5 min | Hub vide puis simulateur nominal | Zéro à l’ouverture, apparition de 50 appareils, environ 1 000 trames/s |
| 5–8 min | Redémarrer les deux processus, lancer la démo | Corruption, doublons, retards, pertes estimées, surchauffe temporisée, appareil arrêté |
| 8–11 min | Ouvrir `protocol.ts` et son premier test | Offsets, longueur, endian, int16 signé et XOR F6 |
| 11–14 min | Ouvrir `sequence.ts` puis `fleet.ts` | Différence modulaire, wrap, pertes, âge des mesures, horloge injectée |
| 14–16 min | Historique, filtres et reconnexion | Lecture différée et données figées lors d’une déconnexion |
| 16–18 min | `npm run check`, CI et benchmark | Tests réellement exécutés, méthode de charge et portée des résultats |
| 18–20 min | Compromis, limites, usage de l’IA | Détection de redémarrage et ambiguïtés restantes, chaîne configurable, historique borné, assistance déclarée |

## Expliquer le protocole, sans réciter

Une trame contient 15 octets fixes avant les mesures, puis 3 octets par mesure et 1 octet de checksum. La longueur totale est donc `16 + 3 × count`. Un heartbeat n’a aucune mesure et mesure 16 octets. Trois mesures produisent 25 octets.

`readUInt16BE(4)` lit l’identifiant sur les octets 4 et 5, octet fort en premier. `readUInt32BE(6)` lit une séquence non signée sur quatre octets. `readInt16BE(offset + 1)` est signé pour permettre une température négative. 4250 devient 42,5 °C ; 24000 devient 24 V. Ne pas afficher les unités brutes comme des volts ou degrés.

La longueur est contrôlée avant les accès : un datagramme trop court ne provoque pas d’exception de lecture. Le résultat est une union discriminée `{ ok: true, frame }` ou `{ ok: false, error }`. Le hub compte une erreur de données attendue et continue.

Le XOR du checksum et de tous les autres octets vaut zéro. Une corruption compensée de plusieurs bits peut passer : ce mécanisme n’est ni une signature cryptographique ni une authentification.

## Expliquer la séquence

Pour `10, 12, 12, 11`, le hub accepte 10 puis 12, compte un trou (11), écarte le deuxième 12 comme doublon, puis écarte 11 comme retard. La mesure de 12 reste courante. Le trou n’est pas « réparé » dans les statistiques.

`>>> 0` convertit le résultat en entier non signé 32 bits. Après `0xffffffff`, recevoir 0 donne un delta égal à 1 : progression normale. À partir d’un écart de 2³¹, on ne peut plus ordonner sans ambiguïté les deux numéros sur l’anneau ; cette implémentation rejette.

Un redémarrage qui remet `seq` et `uptimeMs` à zéro pourrait ressembler à un paquet retardé du début de session. Le protocole n’a pas de `bootId`. La solution confirme un redémarrage sur trois trames distinctes dont les compteurs repartent bas et progressent de manière cohérente. Les premières trames candidates sont écartées. À confirmation, les mesures, moyennes et durées d’alerte sont réinitialisées sans inventer de pertes entre sessions. Les compteurs de réception restent cumulés. Une protection sur l’uptime rejette les anciens paquets manifestement incompatibles ; sans `bootId`, elle ne peut pas garantir tous les cas. Voir les paramètres et limites dans `docs/pipeline.md`.

## Expliquer les temporisations

Deux horloges ont des rôles différents : `performance.now()` mesure les durées locales sans sauts d’horloge civile ; `new Date().toISOString()` donne une date humaine aux instantanés. `uptimeMs` vient de l’appareil et ne sert pas de référence temporelle globale.

Une règle garde l’instant du premier dépassement. Si une mesure suivante reste anormale et arrive avant la péremption, la durée continue. Une valeur normale efface ce début. Une longue absence casse la continuité : on ne transforme pas un seul échantillon anormal en preuve d’une surchauffe prolongée.

Un heartbeat actualise `lastSeen`, pas l’horodatage des mesures. C’est la différence entre « cet appareil répond » et « je connais encore sa température ».

L’horloge du métier est un paramètre du constructeur de `Fleet`. Dans les tests, une variable `now` remplace le temps réel : on vérifie exactement les seuils sans attendre physiquement 3 secondes.

## Expliquer les ressources et la visualisation

L’état conserve une entrée par appareil, trois dernières mesures, un début de dépassement par règle et des fenêtres d’agrégation bornées ; il ne stocke pas toutes les trames. La chaîne JSON choisit les filtres, moyennes/minima/maxima et règles exécutées. Une fabrique par type permet d’ajouter une catégorie sans modifier les étapes existantes. Le débit utilise 20 compartiments, pas un tableau contenant chaque réception. Le registre et le nombre de clients sont bornés. L’historique a une rotation et au plus une écriture en attente.

Le navigateur reçoit une synthèse à 2 Hz alors que les appareils émettent à 20 Hz. Les trames sont toutes traitées, mais l’affichage n’a pas besoin de se redessiner 1 000 fois par seconde. SSE suffit car le flux va du serveur vers le navigateur. Les champs affichés sont affectés via `textContent`, pas injectés en HTML.

## Questions à savoir traiter

1. Pourquoi les compteurs « invalides » et « perdues » peuvent-ils concerner une même trame ?
2. Pourquoi on ne connaît pas les pertes avant le premier paquet ou après le dernier ?
3. Que se passe-t-il si la température est exactement 70 °C ? Et 70,01 °C ?
4. Que voit-on si un appareil n’émet plus que des heartbeats ?
5. Que devient le temps de surchauffe après une mesure normale ou une longue absence ?
6. Pourquoi un doublon ne rafraîchit-il pas la présence ?
7. Que faire si deux appareils ont le même `deviceId` ? Pourquoi le hub ne peut-il pas les distinguer ?
8. Comment changer le seuil de tension sans toucher au code ?
9. Quelle différence entre « 20 000 trames/s demandées » et « débit effectivement mesuré » ?
10. Que faudrait-il ajouter avant une exploitation sur un réseau ouvert ?
11. Pourquoi le checksum n’est-il pas une protection contre un appareil malveillant ?
12. Où s’arrête la garantie de l’historique local après un crash ou une rotation ?

## Exercices rapides de compréhension

- Changer uniquement la température limite dans un fichier JSON partiel comportant le tableau complet des règles, puis constater le changement.
- Écrire sur papier les résultats des séquences `4294967294, 4294967295, 0, 0, 2, 1` : quatre acceptées, un doublon, un retard, un trou.
- Ajouter un test vérifiant que 7000 n’active pas la règle de température, alors que 7001 commence une observation.
- Refaire la démo sans anomalies physiques et expliquer pourquoi des trous n’impliquent pas forcément une surchauffe.

Pour l’IA, décrire honnêtement l’assistance de Codex à la génération, à la correction et à la validation du projet. Ne revendiquer une compréhension qu’après avoir lu le code, refait les essais et su répondre aux questions ci-dessus.


## Démontrer les bonus ajoutés

- Lancer `npm run demo:restart` : l’appareil 7 repart à zéro après une seconde de silence, sans redémarrer le hub. Montrer `restarts` et expliquer pourquoi deux trames candidates n’actualisent pas encore l’état.
- Utiliser `config/pipeline-example.json` : l’appareil 50 est filtré, les autres affichent une moyenne de température et un minimum de tension. Montrer les trois modules de traitement et le registre commun.
- Expliquer la différence entre les trames acceptées au transport et les trames retenues après filtrage. Une trame filtrée n’invente pas de perte de séquence et ne doit pas laisser une ancienne mesure saine affichée comme actuelle.
- Comparer les résultats UDP et le calcul métier isolé. Si l’émetteur n’atteint pas sa consigne, ne pas attribuer son plafond au hub ; si la réception perd des paquets, la pile réseau et le code partagent encore le même chemin.

# PulseHub dans le terminal

Le CLI est une seconde interface du même hub. Il lit `/api/state` toutes les 500 ms après la fin de la requête précédente, avec un délai maximum de 2 secondes. Les mesures, états, agrégations et compteurs viennent du serveur ; aucun appareil ni alerte n’est inventé par cette interface. Le navigateur peut rester ouvert en parallèle.

Cette interface est incluse dans le rendu complet tagué **`v1.0`**, également disponible sur `main`.

```sh
npm run hub
# Dans un deuxième terminal :
npm run demo
# Dans un troisième terminal :
npm run cli
```

![Aperçu du moteur de rendu terminal, alimenté par le hub local](terminal.png)

L’image est une exportation du moteur de rendu avec les données de la démo locale au moment de la capture. L’application interactive s’actualise en continu.

Le CLI partage la palette du site : fond noir `#000000`, texte blanc et accents orange `#ff9900`. « Hub » apparaît en noir sur un bloc orange ; graphe, sélection et raccourcis reprennent cet accent. Les états conservent leurs libellés et leurs couleurs dédiées : vert pour opérationnel, jaune pour observation/alerte, rouge pour hors ligne. Après une mise à jour du code, quitter le CLI avec `q` puis relancer `npm run cli` pour charger le thème.

Utiliser Windows Terminal, PowerShell ou un terminal compatible ANSI. Préférer **130 colonnes × 42 lignes** avec une police monospace comme Cascadia Mono. Le minimum est de 73 colonnes × 29 lignes ; sous 111 colonnes, la table devient compacte, avec les pertes et agrégats dans le détail de l’appareil sélectionné. Les couleurs sont désactivées avec `NO_COLOR` ou `--no-color`.

## Navigation

| Touche | Action |
| --- | --- |
| `↑` / `↓` ou `k` / `j` | Sélectionner un appareil et afficher ses détails |
| `Page précédente` / `Page suivante` ou `p` / `n` | Changer de page dans la flotte |
| `Début` / `Fin` | Premier / dernier appareil |
| `/` puis un identifiant, `Entrée` | Rechercher, par exemple `009` ou `PH-009` |
| `Échap` | Annuler la saisie ou effacer la recherche |
| `f` | Filtres : tous, à surveiller, hors ligne, opérationnels |
| `Espace` | Figer / reprendre l’affichage live ; la réception du hub continue |
| `h` | Afficher le dernier instantané d’historique / revenir au direct |
| `[` / `]` ou `←` / `→` | Instantané précédent / suivant dans l’historique |
| `r` | Recharger l’historique et afficher son dernier instantané |
| `?` | Aide ; `?` ou `Échap` pour la fermer |
| `q` / `Ctrl+C` | Quitter le CLI, en laissant le hub et le simulateur actifs |

Les valeurs suivies de `~` sont périmées. Une moyenne périmée s’affiche `—`. La colonne « MOY. TEMP. » affiche la première moyenne de température configurée ; le détail indique son libellé et le nombre d’échantillons ainsi que les autres agrégats. Les alertes en observation sont distinguées des alertes actives.

La courbe représente les derniers échantillons de débit observés par le CLI, avec une échelle verticale automatique. En historique, elle utilise les débits des instantanés enregistrés. L’heure en haut est celle des données affichées. La pause et l’historique sont explicitement signalés pour ne pas les confondre avec le direct.

En cas de coupure du hub, l’écran signale la déconnexion et conserve le dernier état connu. La reconnexion est automatique. Les séquences de contrôle présentes dans les libellés sont supprimées avant affichage ; les caractères non pris en charge par la grille sont remplacés. Le CLI ne modifie ni la configuration ni les équipements.

## Autre adresse ou sortie texte

```sh
npm.cmd run cli -- --url http://127.0.0.1:3010
npm.cmd run cli -- --once --no-color
node --import tsx src/cli.ts --once > etat.txt
```

Sous PowerShell, `npm.cmd` assure la transmission des options. Sans terminal interactif, ou avec `TERM=dumb`, le CLI produit un seul instantané texte puis quitte. `--once` renvoie un code d’erreur si le hub est indisponible. L’export affiche une page de flotte, pas un export exhaustif ; `/api/state` reste la source pour tous les appareils. Après `npm run build`, `node dist/cli.js` est également utilisable.

## Vérification manuelle

1. Lancer le hub, la démo et le CLI : les 50 appareils et les compteurs correspondent à l’API et au navigateur, à un rafraîchissement près.
2. Chercher `/009`, valider : une seule ligne et le détail du redémarrage apparaissent. Effacer avec `Échap`, paginer, puis filtrer les hors-ligne : PH-007 est présent après son arrêt.
3. Appuyer sur `Espace` : l’heure et les valeurs affichées restent figées malgré l’arrivée de trames. Appuyer de nouveau pour reprendre.
4. Ouvrir `h`, parcourir avec `←` et `→`, puis revenir au direct avec `h`.
5. Arrêter le hub : le bandeau de déconnexion apparaît. Relancer le hub : le CLI retrouve les données sans être redémarré.
6. Redimensionner le terminal, ouvrir l’aide, quitter avec `q` : le curseur et l’écran du shell sont restaurés.

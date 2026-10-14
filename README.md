# Hackathon Gendarmerie — missions multi-drones

Prototype web d’aide à la décision pour planifier puis conduire une opération multi-drones **simulée**. Aucune commande réelle, aucun SDK drone, aucun backend.

Contenu du README initial conservé : « APEDOH SENAM KOSSI AMENIO DORIATH KING ».

## Installation et lancement

Node.js **22.18+** et npm dans le PATH (Node 24 LTS recommandé).

```sh
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

Ouvrir l’URL HTTP indiquée par Vite, normalement `http://localhost:5173`. **Ne pas ouvrir index.html directement avec file://** : les modules TypeScript sont servis par Vite. Le build statique est dans `dist/` (non versionné). `npm ci` utilise le lockfile versionné.

## Fonctionnel

- Accueil : nouvelle planification ou import direct d’une mission JSON.
- Configuration : nom, coordonnées WGS84, date/heure locale avec conversion ISO, environnement rural/urbain et scénario TP1/TP2.
- Carte Leaflet plan : déplacement, zoom, dessin natif par clics de la zone d’opération et de plusieurs priorités, fermeture/annulation/suppression.
- Météo horaire pluie via Open-Meteo, avec erreurs et prévisions indisponibles affichées proprement.
- Estimation puis placement déterministe, couvertures, métriques et explication de la configuration proposée.
- Quantités réellement disponibles par modèle, comparaison et recalcul ; couverture partielle acceptée.
- Import fichier ou texte JSON 1.0, validation runtime et export depuis planning/ressources/conduite.
- Conduite : drones/télépilotes distincts, glisser-déposer, altitude, cap/angle, conflits et indisponibilité.
- Réorganisation locale facultative : au plus un drone déplacé, sans aggravation du nombre de conflits.
- Fin de mission avec confirmation et retour interpolé vers chaque télépilote ; urgence confirmée et atterrissage sur place.

La mission fictive intégrée se charge depuis l’écran d’import pour une démonstration rapide. Pour un dispositif multi-drones plus étendu, dessiner un rectangle d’environ 4–6 km autour de Rennes et une priorité centrale. Voir [DEMO.md](docs/DEMO.md).

## Simplifications du prototype

Heuristique gloutonne, pas une optimisation exacte. Projection locale et surfaces estimées sur une grille bornée. Le rayon de simulation est égal à la portée du scénario hackathon (1 km ou 2 km), sans représentation d’un capteur constructeur. Drones et télépilotes sont initialement à la même position, avec références distinctes ; les altitudes commencent à 10 m sur des niveaux séparés.

La portée TP1 « en vue » reste inconnue : son calcul est désactivé. Jour/nuit reste `unknown` (aucune heure fixe arbitraire). Satellite : aucune source autorisée/configurée fournie, vue plan seule. Pas de Street View, relief, vent/température/visibilité, moteur physique ou contrôle aéronautique réel.

Limites : zone locale <= 50 km de côté, centre de zone à latitude <= 75° en valeur absolue, 32 drones au maximum, 20 priorités, 300 sommets par anneau et fichiers <= 2 Mo. Les secteurs très fins et les limites de couverture restent approximatifs. Les positions et résultats ne survivent pas à un rechargement sans export JSON. Une importation reprend par les ressources et reconstruit le dispositif : elle ne reprend pas une animation interrompue. Les mouvements d’urgence/retour durent quatre secondes de démonstration.

## Architecture et dépendances

React + TypeScript strict + Vite + Leaflet direct. Aucune dépendance ajoutée depuis la fondation. Pas de routeur, wrapper Leaflet, bibliothèque de dessin/géométrie/UI/état/test. Tests natifs `node:test` en `.mjs` important les sources `.ts`.

| Dossier | Responsabilité |
| --- | --- |
| `src/app`, `src/pages`, `src/components`, `src/styles` | Contexte, parcours, rendu et horloge de simulation |
| `src/types` | Contrats communs |
| `src/engines/geometry` | Projection, validation, échantillonnage, disques/secteurs et métriques |
| `src/engines/planning` | Estimation, placement glouton et altitudes initiales |
| `src/engines/operations` | Conflits, recalcul ciblé, réorganisation locale et transitions simulées |
| `src/services` | Adaptateur météo, stockage JSON et conversion mission/plan |
| `src/data` | Catalogue limité au brief et mission fictive |
| `tests` | Géométrie, planning, conduite, stockage, météo et parcours métier complet |

Voir [architecture](docs/ARCHITECTURE.md), [exigences](docs/REQUIREMENTS.md), [contrats](docs/API_CONTRACT.md), [intégration](docs/INTEGRATION.md) et [validation](docs/VALIDATION.md).

## Git et contrôles

Branche de cette itération : `feature/core-application`, depuis `main` contenant la fondation `b04003e`. Commits par incréments, aucune fusion ni push automatique. Avant PR : `npm test`, `npm run build`, `git diff --check` et contrôle navigateur. Ne pas versionner `node_modules`, `dist`, `.env` ou secrets. Coordonner toute évolution des contrats et dépendances.

## Services externes

La carte utilise les tuiles [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) avec attribution, sans téléchargement massif/hors ligne. Leur disponibilité réseau n’est pas garantie ; les objets métier restent affichables sans fond. La météo envoie seulement coordonnées et créneau demandés à [Open-Meteo](https://open-meteo.com/en/docs), sans clé. Respecter les conditions d’usage avant un déploiement hors hackathon. Pas de transfert de fichier mission à un backend.

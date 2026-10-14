# Hackathon Gendarmerie — missions multi-drones

Prototype web d’aide à la décision pour planifier puis conduire une opération multi-drones **simulée**. Aucune commande réelle, aucun SDK drone, aucun backend.


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
- Configuration : nom, adresse française ou coordonnées WGS84 (Mirepoix par défaut), date et heure en français (JJ/MM/AAAA, 24 h) avec conversion ISO, environnement rural/urbain et scénario TP1/TP2.
- Carte Leaflet plein écran sans défilement de page, plan OSM et imagerie satellite IGN ; panneaux coulissants et flotte à droite. Dessin par clics, fermeture au premier sommet ou automatique via Terminer, annulation et suppression. Les autres actions sont bloquées pendant le dessin.
- Météo automatique à chaque date/localisation, pluie Open-Meteo et calcul astronomique jour/nuit local. Badge compact et erreurs propres ; Mini/Mavic exclus la nuit ou sous pluie selon la politique de simulation.
- Estimation dans un panneau à droite, placement déterministe avec mélange TP1/TP2, préférence TP1 à service équivalent, secteurs/rayons adaptés puis découpés à l’opération. Réglage du cap/angle/rayon dès la planification.
- Quantités réellement disponibles par modèle, comparaison et recalcul ; couverture partielle acceptée.
- Import fichier ou texte JSON 1.0, validation runtime et export nommé via une boîte de dialogue depuis planning/ressources/conduite. Catalogue personnalisé et paramètres inclus si présents.
- Conduite : drones/télépilotes distincts, glisser-déposer ou clic de placement avec recalcul, altitude, aperçu cap/angle en direct avant validation, conflits et indisponibilité.
- Flotte : un drone par ligne, hauteur simulée et état. Aucune batterie ou télémétrie inventée.
- Ressources : ajout de modèles (nom, pluie, nuit, vent, zoom), fiches DJI sourcées et quantités réelles.
- Paramètres mémorisés : séparation verticale 30 m par défaut, chevauchement maximal 20 %, catalogue par défaut. Autorisation préfectorale facultative par mission (référence, effectif/période déclarés).
- Réorganisation locale facultative : au plus un drone déplacé, sans aggravation du nombre de conflits.
- Fin de mission avec confirmation et retour interpolé vers chaque télépilote ; urgence confirmée et atterrissage sur place.

La mission fictive intégrée se charge depuis l’écran d’import pour une démonstration rapide. Pour un dispositif multi-drones plus étendu, dessiner un rectangle d’environ 4–6 km autour de Mirepoix et une priorité centrale. Voir [DEMO.md](docs/DEMO.md).

## Mode carte « Occupation » (où décoller)

Troisième fond de carte à côté de Plan et Satellite. Il colore la carte cellule par cellule (~10 m) : libre, libre non confirmé, accès éloigné (> 100 m d’une voie), pente > 12°, marge obstacle (< 10 m) ou occupé (bâti, chaussée, eau, végétation, sursol LiDAR, ligne/pylône…). Un clic sur une couleur donne la cause. C’est un tri sur données ouvertes (OSM, IGN BD TOPO, LiDAR HD, BD ORTHO), **jamais une autorisation** : l’emplacement est vérifié sur le terrain.

- **Mirepoix (09194)** : carte précalculée de la commune entière, `public/occupancy/commune-09194.json`, affichée immédiatement.
- **Ailleurs** : calcul en direct de la zone visible, par tuiles fixes d’environ 800 m (10–20 s par tuile, centre de l’écran d’abord, cache de session). Il faut zoomer à 20 tuiles visibles au plus. Ce calcul utilise le backend Python du module *drone-pilot-site-finder* (branche `feature/drone-pilot-site-finder-occupancy`, `POST /api/v1/occupancy/tile`) :

```sh
uv run uvicorn drone_site_finder.main:app --host 127.0.0.1 --port 8000
```

En développement, le site l’appelle sur `http://127.0.0.1:8000` ; sinon définir `VITE_OCCUPANCY_API_URL` (vide pour désactiver). Sans backend, seule la carte précalculée s’affiche et le reste de l’application est inchangé. Le backend accepte par défaut les origines `localhost:5173` (`DRONE_CORS_ORIGINS`).

## Simplifications du prototype

Heuristique gloutonne, pas une optimisation exacte. Projection locale et surfaces estimées sur une grille bornée. Le rayon de travail est inférieur ou égal à la portée TP1 (1 km) / TP2 (2 km), sans représentation d’un capteur constructeur ; un TP2 de rayon ≤ 1 km est converti en TP1. Drones et télépilotes sont initialement à la même position, avec références distinctes ; les altitudes commencent à 10 m, séparées par défaut de 30 m lorsque les zones se chevauchent, sous le plafond.

Le scénario TP1 « en vue » utilise 500 m et un plafond de 120 m selon la règle complémentaire du brief. Jour/nuit est calculé au seuil solaire −6°, indépendamment de l’horizon météo. La vue « Satellite » utilise les orthophotos IGN en France ; leur couverture et disponibilité dépendent du service. Aucune télémétrie réelle n’est disponible. Pas de Street View, relief, vent/température/visibilité, moteur physique ou contrôle aéronautique réel.

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
| `src/services` | Adaptateurs météo et adresses, stockage JSON et conversion mission/plan |
| `src/data` | Catalogue limité au brief et mission fictive |
| `tests` | Géométrie et dessin, planning, conduite, stockage, météo, adresses et parcours métier complet |

Voir [architecture](docs/ARCHITECTURE.md), [exigences](docs/REQUIREMENTS.md), [contrats](docs/API_CONTRACT.md), [intégration](docs/INTEGRATION.md) et [validation](docs/VALIDATION.md), [algorithmes](docs/ALGORITHMES.md), [fiches constructeur](docs/DRONE_SPECS.md) et [format JSON](docs/FORMAT_JSON.md).

## Git et contrôles

Branche de cette itération : `codex/operational-planning`, depuis `main` `5f6d220`. Commits par incréments, aucune fusion ni push automatique. Avant PR : `npm test`, `npm run build`, `git diff --check` et contrôle navigateur. Ne pas versionner `node_modules`, `dist`, `.env` ou secrets. Coordonner toute évolution des contrats et dépendances.

## Services externes

La carte utilise les tuiles [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) avec attribution, sans téléchargement massif/hors ligne. Leur disponibilité réseau n’est pas garantie ; les objets métier restent affichables sans fond. La météo envoie seulement coordonnées et créneau demandés à [Open-Meteo](https://open-meteo.com/en/docs), sans clé. Respecter les conditions d’usage avant un déploiement hors hackathon. Pas de transfert de fichier mission à un backend.

La vue satellite utilise le [WMTS public IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/) (orthophotos, attribution IGN). La recherche d’adresses françaises utilise le [géocodage IGN / BAN](https://ignf.github.io/cartes.gouv.fr-documentation/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) : requête après 600 ms, annulation des recherches obsolètes, cache de session et délai maximal de 7 s. La saisie d’adresse est envoyée à ce service ; les coordonnées peuvent être utilisées sans géocodage.

La règle de simulation « Matrice 4T autorisé sous pluie » se distingue de la fiche DJI : le Matrice 4T n’est pas étanche. Les caractéristiques affichées et leurs sources sont documentées dans DRONE_SPECS. Le simulateur ne vérifie pas la validité juridique d’une autorisation saisie.

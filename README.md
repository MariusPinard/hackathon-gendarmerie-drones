# Hackathon Gendarmerie — missions multi-drones

Prototype web d’aide à la décision pour planifier puis conduire une opération multi-drones **simulée**. Aucune commande réelle, aucun SDK drone et aucun backend intégré ; le calcul d’occupation en direct utilise un service facultatif séparé.


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

## Simplifications du prototype

Heuristique gloutonne, pas une optimisation exacte. Projection locale et surfaces estimées sur une grille bornée. Le rayon de travail est inférieur ou égal à la portée TP1 (1 km) / TP2 (2 km), sans représentation d’un capteur constructeur ; un TP2 de rayon ≤ 1 km est converti en TP1. Drones et télépilotes sont initialement à la même position, avec références distinctes ; les altitudes commencent à 10 m, séparées par défaut de 30 m lorsque les zones se chevauchent, sous le plafond.

Le scénario TP1 « en vue » utilise 500 m et un plafond de 120 m selon la règle complémentaire du brief. Jour/nuit est calculé au seuil solaire −6°, indépendamment de l’horizon météo. La vue « Satellite » utilise les orthophotos IGN en France ; leur couverture et disponibilité dépendent du service. Aucune télémétrie réelle n’est disponible. Pas de Street View, relief, vent/température/visibilité, moteur physique ou contrôle aéronautique réel.

Limites : zone locale <= 50 km de côté, centre de zone à latitude <= 75° en valeur absolue, 20 priorités, 300 sommets par anneau et fichiers <= 2 Mo. Aucune limite fixe d’effectif n’est imposée ; le calcul dépend des moyens, de la couverture utile et des éventuelles limites saisies par le chef de mission. Les secteurs très fins et les limites de couverture restent approximatifs. Les positions et résultats ne survivent pas à un rechargement sans export JSON. Une importation reprend par les ressources et reconstruit le dispositif : elle ne reprend pas une animation interrompue. Les mouvements d’urgence/retour durent quatre secondes de démonstration.

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

### Rectification 3

Les unités disponibles en supplément sont conservées dans la carte et la flotte en réserve. Sélectionner une unité, la placer par clic ou glisser-déposer, régler son secteur puis l’engager ; sa couverture et les conflits sont alors recalculés. Cette édition est disponible dans les ressources avant lancement et pendant la conduite. La réserve ne compte pas comme couverture active et ne décolle pas automatiquement.

Après l’atterrissage d’urgence simulé, « Relancer l’opération » restaure les positions, altitudes, secteurs et disponibilités précédents. L’instantané est exporté dans les nouvelles missions en urgence ; les anciens fichiers sans instantané nécessitent un nouveau calcul. Les paramètres sont accessibles uniquement dans le planificateur. Les champs sont gris clair avec texte noir dans les deux thèmes.

L’accueil utilise une console d’accès aux missions, le logo et les icônes de `/public/image`. La carte montre les arcs de portée en pointillés uniquement hors de l’opération et dans l’angle du secteur de travail, garde les zones de travail découpées et supprime le calque de cellules non couvertes. Les métriques et les cibles de réorganisation restent calculées. Les orthophotos IGN utilisent la matrice publiée PM_0_19 ; le plan reste affiché sous les tuiles en chargement ou en erreur.

### Occupation et présentation de l’accueil

Reprise ciblée depuis `feature/occupancy-map-mode` (`a322a93`) : service d’occupation, calque Leaflet, carte précalculée de Mirepoix et tests. Aucune fusion de la branche complète ni ajout du moteur de recherche d’emplacements. Le troisième bouton « Occupation » affiche les couleurs du terrain et leurs causes au clic. Les demandes en direct partent uniquement après « Lancer le calcul », avec deux requêtes simultanées, 24 tuiles par lancement et cache de session. Le nombre de tuiles énumérées reste borné lors d’un dézoom mondial pour éviter de bloquer l’interface.

Mirepoix est disponible immédiatement depuis `public/occupancy/commune-09194.json`. Pour les autres secteurs, configurer `VITE_OCCUPANCY_API_URL` vers le service compatible `POST /api/v1/occupancy/tile` ; en développement l’adresse par défaut est `http://127.0.0.1:8000`. Sans service, la carte précalculée reste consultable. La légende et les fenêtres de détail signalent les possibilités et limites d’accès au terrain ; cette analyse aide au choix d’un emplacement et ne valide pas une autorisation.

Les zones non couvertes sont de nouveau représentées par les petits points rouges de la V1, jamais par des cellules hachurées. Les arcs extérieurs ambre suivent uniquement l’angle de travail et les contours des drones sont plus fins. L’accueil ordinateur affiche les grands logos Gendarmerie et Division Drone, détourés sur fond transparent. L’icône de flotte reste distincte. Sources et prompts du détourage : [LOGOS.md](docs/LOGOS.md).

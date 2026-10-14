# Contrats communs — schéma JSON 1.0

Sources de vérité : `src/types/`, `src/data/droneCatalog.ts`, moteurs purs et `src/services/missionStorage.ts`. Cette itération, autorisée pour l’ensemble de l’application, étend les contrats de la fondation sans modifier les champs JSON obligatoires. Les anciens exemples 1.0 restent importables.

## Conventions et types

Coordonnées WGS84 `[longitude, latitude]`, deux nombres finis. Distances/rayons en mètres, surfaces en m², altitude AGL (au-dessus du sol) en mètres. Cap `[0, 360[`, angle `]0, 360]` dans le JSON ; conduite par formulaire de 1° à 360°. Dates ISO avec secondes et `Z` ou décalage explicite ; la saisie locale est convertie en UTC.

| Type | Contrat |
| --- | --- |
| Coordinates / Polygon | Tuple WGS84 ; Polygon GeoJSON à anneaux fermés, extérieur puis trous |
| OperationZone / PriorityZone | Features Polygon avec `properties.id`, `name`, `kind` |
| CoverageArea | `center`, `radiusMeters`, `headingDegrees`, `workingAngleDegrees` |
| DroneModel / DroneCapability | Catalogue et scénarios TP/mode/portée nullable/plafonds rural-urbain |
| DroneInstance / Pilot | Identités mission, associations par IDs, positions indépendantes, altitude/couverture/état |
| AvailableResources / ResourceEstimate | Comptes par chacun des trois modèles ; estimation avec nombre de télépilotes et hypothèses |
| MissionConstraints | Environnement, séparation >= 10 m, angle initial 360°, `capabilityId` optionnel pour anciens fichiers |
| PlanningInput | Localisation, date, zones, météo, contraintes, catalogue, ressources et `capabilityId` optionnel |
| PlanningResult | Mission ID, estimation des moyens utilisés, télépilotes/drones proposés, zones et avertissements |
| CoverageMetrics | Surfaces et pourcentages total/priorité/chevauchement, compte drones, nombre et maille des échantillons et points perdus bornés |
| Conflict | ID/type/droneIds/message ; `approximatePosition` et `altitudeDifferenceMeters` optionnels |
| MissionChange | `move_drone`, `move_pilot`, `set_altitude`, `set_coverage`, `set_availability` (active/unavailable) |
| OperationsResult | Nouvelle mission, métriques, conflits et avertissements |
| WeatherInfo | Disponibilité, localisation/date, pluie boolean ou null, statut jour/nuit et source nullable |

DroneStatus : `ready`, `active`, `unavailable`, `returning`, `emergency_landing`, `completed`. MissionStatus : `draft`, `planned`, `ready`, `active`, `emergency`, `returning`, `completed`. DayNightStatus : `day`, `night`, `unknown` (cette version n’émet que unknown).

## API métier

```ts
estimateResources(input: PlanningInput): ResourceEstimate
generatePlan(input: PlanningInput): PlanningResult
computeCoverage(plan: PlanningResult): CoverageMetrics

detectConflicts(mission: Mission): Conflict[]
inspectMission(mission: Mission): OperationsResult
startMission(mission: Mission): OperationsResult
recalculateMission(mission: Mission, change: MissionChange): OperationsResult
proposeLocalReorganization(mission: Mission): OperationsResult
triggerEmergencyLanding(mission: Mission): OperationsResult
triggerReturnToHome(mission: Mission): OperationsResult
advanceSimulation(initialMission: Mission, progress: number): OperationsResult
```

Toutes les fonctions sont synchrones et indépendantes du navigateur. Elles ne modifient jamais leurs entrées. Les exceptions décrivent une entrée/transition invalide ; avertissements et conflits décrivent les limites d’un résultat valide. `advanceSimulation` reçoit un instantané initial et une progression [0,1] ; ne pas cumuler plusieurs interpolations depuis des états déjà interpolés.

Les exports geometry incluent projection/inverse, distance haversine, point-in-polygon, validation, échantillonnage, point-in-coverage, polygone de disque/secteur, chevauchement et métriques. `missionPlanningInput` déduit le scénario des contraintes, du premier drone ancien, sinon TP1 hors vue. `applyPlan` conserve l’estimation initiale et passe la mission à ready.

## Heuristique de planification

1. Valider la géométrie et le domaine local. Projeter en mètres par projection équirectangulaire centrée sur la bounding box.
2. Construire une grille cible de 44 subdivisions sur le plus grand côté (<= 1 936 points), gardant les points dans le polygone et hors trous. Candidats : grille de 16 subdivisions (<= 256).
3. Pré-calculer les cibles couvertes par chaque candidat/rayon. Priorité : union des zones prioritaires à l’intérieur de l’opération, poids 4 contre 1 ailleurs.
4. Sélection gloutonne : nouveau point prioritaire +4, autre nouveau point +1 ; point déjà couvert hors priorité −0,3. Un point prioritaire couvert une seule fois peut apporter +0,1 de redondance, puis est pénalisé.
5. Modèles compatibles sélectionnés par rotation dans l’ordre du catalogue. Choisir le candidat au meilleur gain ; les égalités suivent l’ordre fixe de la grille. Au moins un point nouveau requis.
6. Arrêt : ressources épuisées, gain non positif, 32 drones, ou couverture totale >= 98 % et priorité >= 99 %. Un arrêt avant cible est expliqué comme couverture partielle.

`estimateResources` explore un budget de 32 unités par modèle, avec limite totale 32, sans tenir compte de l’inventaire réel. `generatePlan` respecte les quantités reçues et exclut Mini si pluie. La première configuration n’est pas une combinaison optimale de modèles : leurs capacités sont identiques pour un même scénario dans le brief. Le rayon initial est la portée du scénario (1 km / 2 km). Le scénario en vue sans portée et un angle initial différent de 360° sont refusés explicitement.

Un télépilote par drone, initialement à la même position. Altitudes : essayer 10 m, puis incréments de la séparation configurée ; retenir le premier niveau sans conflit avec les drones précédents, sous le plafond. Si aucun ne convient, garder le plafond (sans le dépasser), produire un avertissement puis un conflit qui bloque le lancement.

## Couverture et conflits

Chaque point de la grille cible représente une cellule carrée. Surface totale approximative = nombre de points × surface cellule. Couverture = cellules touchées par au moins un drone ready/active ; priorité = cellules dans l’union des priorités ; chevauchement = cellules couvertes au moins deux fois (comptées une seule fois). Les pourcentages total et chevauchement ont pour dénominateur la surface opération, donc restent [0,100]. Priorité sans point : null, affichée « — ». `uncoveredPoints` contient au plus 120 points répartis pour l’affichage ; ce ne sont pas des contours exacts de zones perdues.

Disque : test distance projetée <= rayon. Secteur : même test plus cap relatif, nord = 0°, sens horaire. Chevauchement disque/disque par distance entre centres ; secteurs par sommets et intersection de segments, arcs approximés par pas <= 5°. Les conflits peuvent être détectés hors de la zone opération si les couvertures s’y chevauchent. La position de conflit vertical est un milieu des centres, seulement un indicateur approximatif (pas un polygone d’intersection exact).

Conflit vertical si couvertures chevauchantes et écart d’altitude < séparation configurée. Autres types : pluie/Mini, portée/plafond/qualification/référence/scénario, effectifs engagés dépassant l’inventaire. Absence de conflit ne signifie pas une validation aéronautique.

## Recalcul et états

`startMission` exige planned/ready, au moins un drone ready et zéro conflit ; drones ready -> active. Couverture partielle et météo inconnue restent des avertissements, permettant la simulation.

`recalculateMission` exige mission active. Chaque changement ne touche que l’élément ciblé ; déplacement drone synchronise le centre, déplacement télépilote vérifie la portée sans déplacer les drones. Plafonds et valeurs non finies sont refusés à la saisie moteur. Rendre unavailable retire la couverture ; réactiver la restitue et réévalue les conflits.

Réorganisation facultative : au plus 8 drones × 5 points perdus, un seul mouvement, respect de la portée au télépilote ; gain = progression couverture totale + 4 × progression couverture prioritaire, seuil > 0,5 point, sans augmentation du nombre de conflits. En l’absence de gain : message et dispositif conservé.

Fin : active -> returning, drones active -> returning, interpolation vers pilotPosition et altitude 0 ; à progression 1 ils deviennent completed. Quand plus aucun drone ne revient, mission completed ; unavailable exclus. Urgence : active/returning -> emergency, drones active/returning -> emergency_landing, descente sur place ; à 1 drones completed, mission reste emergency. Aucun transport réel.

## Météo et stockage

```ts
getWeather(latitude: number, longitude: number, dateTime: string, options?): Promise<WeatherInfo>
validateMission(value: unknown): asserts value is Mission
serializeMission(mission: Mission): string
parseMission(json: string): Mission
importMission(file: Blob): Promise<Mission>
exportMission(mission: Mission): void
```

L’adaptateur [Open-Meteo](https://open-meteo.com/en/docs) demande `rain,showers`, 16 jours, temps Unix et GMT. Il sélectionne la fin d’heure supérieure ou égale au créneau demandé, correspondant au cumul de l’heure précédente ; pluie si rain + showers > 0 mm. Date passée/hors horizon, HTTP/réseau, timeout 7 s, données nulles/malformées ou heure manquante -> unavailable, pluie null. Aucune prévision inventée. `options` permet horloge/fetch injectés pour tests et signal d’annulation ; le fournisseur reste invisible aux pages et moteurs. Jour/nuit reste unknown.

JSON requis : schemaVersion 1.0 ; metadata (id/name/createdAt/updatedAt) ; scheduledAt ; location ; operationZone ; priorityZones ; weather ; constraints ; estimate nullable ; availableResources ; pilots ; drones ; status. Exemple : `src/data/exampleMission.json`. Champs supplémentaires tolérés et conservés, sans signification métier automatique. Les anciennes couvertures sauvegardées restent lisibles ; le nouveau placement utilise les rayons scénario.

Validation : objets/listes/enums/champs critiques, coordonnées/unités finies, calendrier/date avec fuseau, références et IDs uniques, anneaux fermés non dégénérés/non croisés, trous contenus et disjoints, centre égal à dronePosition, bornes d’interactivité et domaine géographique. Une mission sans zone reste un formulaire, pas un JSON 1.0. Le stockage n’exige pas un plan exempt de conflits : le moteur les détecte avant lancement.

Parser et sérialiser revalident ; erreurs visibles dans l’UI sans crash. Fichiers/textes <= 2 Mo. Export navigateur par Blob/URL temporaire. Pas de backend/localStorage. L’import conduit aux ressources puis à un recalcul explicite, pas à la reprise d’une animation enregistrée.

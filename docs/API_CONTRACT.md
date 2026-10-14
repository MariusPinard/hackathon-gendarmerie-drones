# Contrats communs — schéma 1.0

Sources de vérité : `src/types/`, `src/data/droneCatalog.ts` et `src/services/missionStorage.ts`. Ces fichiers sont partagés et nécessitent coordination. Les fonctions moteur sont synchrones et métier pur ; elles devront être sans effet de bord ni mutation des entrées.

## Conventions

Coordonnées WGS84 sous forme `[longitude, latitude]`, degrés, deux nombres finis. La frontière Leaflet inverse l’ordre. Distances/rayons/surfaces : mètres et mètres carrés. Altitude : mètres au-dessus du sol. Cap dans `[0, 360[`, angle de travail dans `]0, 360]` ; défaut 360. Date/heure ISO 8601 avec secondes et `Z` ou décalage explicite. Les identifiants sont des chaînes non vides ; références par identifiant.

## Types

| Type | Contenu / rôle |
| --- | --- |
| `Coordinates`, `Polygon` | Position et géométrie GeoJSON Polygon, anneaux fermés ; premier extérieur, suivants trous |
| `OperationZone`, `PriorityZone` | Features GeoJSON Polygon avec propriétés `id`, `name`, `kind` |
| `CoverageArea` | `center`, `radiusMeters`, `headingDegrees`, `workingAngleDegrees` |
| `DroneModel` | Identité catalogue, incompatibilité pluie et scénarios disponibles |
| `DroneCapability` | Qualification, mode de vol, portée nullable, plafonds rural/urbain |
| `DroneInstance` | Identité mission, `modelId`, `capabilityId`, `pilotId`, position drone, altitude, couverture et état |
| `Pilot` | Identité, nom, qualification TP1/TP2 et `pilotPosition` |
| `AvailableResources` | Quantités entières non négatives par chacun des trois `DroneModelId` |
| `MissionConstraints` | Environnement, séparation verticale minimale (>= 10), angle de travail par défaut |
| `WeatherInfo` | Disponibilité, position, date/heure, pluie `boolean \| null`, jour/nuit, source nullable |
| `PlanningInput` | Mission ID, localisation, horaire, zones, météo, contraintes, catalogue et disponibilité |
| `ResourceEstimate` | Quantités par modèle, nombre de télépilotes et hypothèses explicites |
| `PlanningResult` | Mission ID, estimation, positions proposées drones/télépilotes, zones et avertissements |
| `CoverageMetrics` | Surfaces opération/priorités, surfaces couvertes et chevauchements hors priorités |
| `Conflict` | ID, type, IDs drones concernés et message ; liste vide possible pour déficit sans drone identifié |
| `MissionChange` | Union discriminée : déplacer drone/télépilote, changer altitude ou cap/angle |
| `OperationsResult` | Nouvelle mission, métriques, conflits et avertissements recalculés |

Types de conflits réservés : `vertical_separation`, `rain_incompatibility`, `capability_limit`, `resource_shortage`. Une liste de conflits n’implique pas que toute règle soit validée ; les moteurs définiront la complétude avant intégration.

Les unions `DroneStatus`, `MissionStatus`, `DayNightStatus` et leurs valeurs sont détaillées dans REQUIREMENTS.md. Il n’y a pas encore de machine à états. Les qualificatifs/scénarios ne sont pas déduits automatiquement les uns des autres.

## Signatures figées pour la prochaine phase

```ts
// src/engines/planning/index.ts
estimateResources(input: PlanningInput): ResourceEstimate
generatePlan(input: PlanningInput): PlanningResult
computeCoverage(plan: PlanningResult): CoverageMetrics

// src/engines/operations/index.ts
detectConflicts(mission: Mission): Conflict[]
recalculateMission(mission: Mission, change: MissionChange): OperationsResult
triggerEmergencyLanding(mission: Mission): OperationsResult
triggerReturnToHome(mission: Mission): OperationsResult

// src/services/weather.ts (latitude en premier pour cette API seulement)
getWeather(latitude: number, longitude: number, dateTime: string): Promise<WeatherInfo>

// src/services/missionStorage.ts
validateMission(value: unknown): asserts value is Mission
serializeMission(mission: Mission): string
parseMission(json: string): Mission
importMission(file: Blob): Promise<Mission>
exportMission(mission: Mission): void
```

Les sept fonctions moteur lèvent actuellement `EngineNotImplementedError`. Elles ne doivent pas être affichées comme des fonctions opérationnelles. `getWeather` renvoie `status: unavailable`, `rainDetected: null`, `dayNight: unknown`, `source: null`, sans réseau. L’adaptateur futur utilisera `fetch()` et traduira le fournisseur vers ce contrat.

Le moteur operations pourra convertir la mission en `PlanningResult` si nécessaire ou développer ses propres helpers ; aucun import UI. Les déclenchements d’urgence et retour devront produire un état simulé, jamais des commandes réelles.

## Mission JSON sauvegardable

Exemple complet importable : `src/data/exampleMission.json`. Tous les champs suivants sont requis, même les listes vides et les valeurs nullables :

```text
schemaVersion: "1.0"
metadata: { id, name, createdAt, updatedAt }
scheduledAt: date/heure ISO avec fuseau
location: Coordinates
operationZone: OperationZone
priorityZones: PriorityZone[]
weather: WeatherInfo
constraints: MissionConstraints
estimate: ResourceEstimate | null
availableResources: AvailableResources
pilots: Pilot[]
drones: DroneInstance[]
status: MissionStatus
```

Une mission brouillon peut avoir une estimation `null` et des listes drones/télépilotes vides. La zone d’opération est néanmoins obligatoire dans le schéma 1.0 : l’édition d’un brouillon sans zone nécessitera un état de formulaire distinct, ou un changement coordonné du contrat.

L’estimation est conservée pour comparer les ressources disponibles ; elle doit être invalidée/recalculée si ses données d’entrée changent. Les drones et télépilotes sauvegardent les positions définies dans l’application. `coverage.center` doit être égal à `dronePosition`. Le rayon 300 m dans l’exemple est illustratif, ne provient ni d’un calcul ni d’une caractéristique constructeur. La météo y est inconnue. L’état `draft` ne signifie pas qu’un plan a été calculé.

Les métriques, géométries dérivées de couverture et conflits ne sont pas sauvegardés. Les champs supplémentaires sont tolérés et conservés au round-trip ; ils n’acquièrent aucune signification métier sans coordination. Une version autre que `1.0` est rejetée, sans migration silencieuse.

## Validation et responsabilité

Le stockage vérifie version, objets/listes critiques, enums, unités numériques finies, dates avec fuseau, coordonnées, anneaux fermés (>= 4 positions et trois sommets distincts), quantités entières, identifiants uniques des zones/drones/télépilotes et références catalogue/scénario/télépilote. Il impose aussi l’égalité centre/position et la séparation configurée >= 10 m. Une erreur mentionne le champ problématique.

Ce contrôle n’est pas un solveur métier : ni auto-intersections, orientation des anneaux, containment, compatibilité qualification, plafonds/portées, conflit réel, fraîcheur météo/estimation, ni transitions d’état ne sont validés ici. La lecture des dates contrôle format et parsabilité, sans validation calendaire exhaustive. Les futurs moteurs devront traiter ces points, avec tests dédiés.

`parseMission` ne renvoie une `Mission` qu’après validation runtime, sans simple cast du JSON. `serializeMission` revalide avant sauvegarde. `importMission` lit un Blob/File ; `exportMission` déclenche un téléchargement navigateur et libère son URL temporaire. Pas de localStorage, base de données ou backend.

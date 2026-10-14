# Hackathon Gendarmerie — missions multi-drones

Application web d’aide à la planification et à la conduite **simulée** d’une opération multi-drones. Cette branche prépare seulement une fondation technique pour trois développements indépendants.

Contenu du README initial conservé : « APEDOH SENAM KOSSI AMENIO DORIATH KING ».

## Installation et commandes

Prérequis : Node.js **22.18+** (Node 24 LTS recommandé), avec npm accessible dans le terminal.

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

Vite indique l’URL locale, normalement `http://localhost:5173`. `preview` sert le build local, ce n’est pas un serveur de production. `package-lock.json` est versionné ; `npm ci` peut être utilisé pour une installation reproductible.

## Stack et architecture

TypeScript strict, React, Vite, Leaflet natif et JSON/GeoJSON. Aucun backend. Les tests utilisent `node:test` et l’exécution TypeScript native de Node, sans bibliothèque de tests. React DOM et les déclarations TypeScript sont les seules dépendances directes supplémentaires indispensables. Pas de wrapper React Leaflet ni de plugin React Vite : le runtime JSX automatique suffit, sans Fast Refresh React.

| Dossier | Responsabilité |
| --- | --- |
| `src/app`, `src/pages`, `src/components`, `src/styles` | État React, navigation interne et présentation |
| `src/types` | Contrats communs versionnés |
| `src/engines/planning` | Futur moteur de planification, TypeScript pur |
| `src/engines/operations` | Futur moteur de conduite simulée, TypeScript pur |
| `src/services` | Adaptateur météo et stockage JSON |
| `src/data` | Catalogue limité au brief et mission d’exemple |
| `tests` | Validation des imports et garde-fous des contrats |

Voir [architecture](docs/ARCHITECTURE.md), [exigences](docs/REQUIREMENTS.md), [contrats](docs/API_CONTRACT.md) et [intégration](docs/INTEGRATION.md).

## Workflow Git

Fondation : `setup/project-foundation`. Branches suivantes proposées : `feature/frontend`, `feature/planning`, `feature/operations`. Partir de la fondation une fois intégrée, utiliser une branche par lot et une PR vers `main`. Ne pas pousser ni committer directement sur `main`. Coordonner tout changement des contrats ou des dépendances.

Avant commit : `npm test`, `npm run build`, `git diff --check`. Ne pas versionner `node_modules`, `dist`, clés API ou fichiers `.env`.

## Statut et contraintes

Disponible : accueil, navigation interne, pages réservées, carte Leaflet centrée sur Rennes, catalogue et types, exemple JSON `1.0`, validation/import/export JSON par fonctions de service, météo indisponible explicite et documentation.

À développer : dessin et vue satellite, formulaire mission/ressources/import, API météo, calcul jour/nuit, estimation, placement, géométrie de couverture, conflits et simulation. Les moteurs lèvent `EngineNotImplementedError` ; ils ne produisent pas de faux résultats. Le contexte React charge une mission fictive au démarrage ; aucun stockage automatique ni maintien de page après rechargement.

Contraintes : couverture 360° par défaut, séparation verticale minimale de 10 m en cas de chevauchement, positions drone/télépilote distinctes, Mini incompatible avec pluie détectée. Portée « en vue » à préciser ; jour/nuit reste `unknown`. Pas de zones interdites, de SDK drone, de contrôle réel, d’optimisation avancée ou d’interface finale dans cette fondation.

Le fond plan utilise les tuiles OpenStreetMap publiques et nécessite Internet ; aucune donnée mission n’est envoyée à un backend. Respecter la [politique des tuiles](https://operations.osmfoundation.org/policies/tiles/) et choisir ultérieurement un fournisseur satellite/licence. Guides utilisés : [Vite](https://vite.dev/guide/) et [Leaflet](https://leafletjs.com/examples/quick-start/).

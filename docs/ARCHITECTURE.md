# Architecture de la fondation

Le prototype est une application statique React/TypeScript construite avec Vite. Leaflet est utilisé directement dans un composant React qui crée la carte à son montage et la détruit au démontage, y compris sous StrictMode. Le composant traduit `[longitude, latitude]` en `[latitude, longitude]` uniquement à la frontière Leaflet.

## Responsabilités

- `app/` : contexte mission en mémoire et navigation interne par union de pages, sans routeur.
- `pages/` : composition des workflows ; trois pages sont réservées aux développements suivants.
- `components/Map/` : rendu Leaflet ; `Layout/` : conteneur ; `Controls/` et `Panels/` réservés aux futurs éléments UI.
- `engines/planning/` : estimation et génération de plan, puis métriques de couverture.
- `engines/operations/` : recalcul après changement, conflits, arrêt et retour simulés.
- `types/` : vocabulaire partagé et contrats ; aucun import React/Leaflet.
- `services/` : météo fournisseur-indépendante et sérialisation/validation/import/export JSON.
- `data/` : catalogue connu et mission fictive, sans caractéristiques commerciales inventées.
- `tests/` : tests Node sans dépendance ; `public/assets/` : futurs fichiers statiques.

## Circulation des données

```text
JSON -> missionStorage (unknown -> validation -> Mission) -> AppContext -> pages
pages -> PlanningInput -> moteur planning -> PlanningResult -> mise à jour Mission
pages -> Mission + MissionChange -> moteur operations -> OperationsResult -> AppContext
pages -> service weather -> WeatherInfo -> Mission / PlanningInput
Mission -> missionStorage -> JSON 1.0 / téléchargement
```

Les deux lignes moteur décrivent l’intégration future. Les pages actuelles ne les appellent pas. Elles ne font aucun calcul géométrique. `Mission` est l’état sauvegardé ; les moteurs recevront un instantané et devront retourner de nouvelles données sans mutation de l’entrée. L’UI restera responsable de l’application d’un résultat et des messages d’erreur.

## Contrats et dépendances

Les types sont réutilisés via `import type` ; aucun objet React ou Leaflet ne traverse les moteurs. `ResourceEstimate` est défini avec les ressources dans `drone.ts` et réexporté par `planning.ts`, évitant un cycle mission/planning. Les moteurs ne dépendent pas des services réseau ni du DOM.

`missionStorage` dépend du catalogue pour valider les références modèles/scénarios. Seul `exportMission` nécessite un navigateur ; parser et sérialiser sont utilisables dans les tests Node. Le service météo est un adaptateur asynchrone qui ne contacte aucun fournisseur pour le moment.

Le JSON conserve les zones, positions, paramètres de couverture et estimation métier nullable. Les surfaces, pourcentages, polygones de couverture et conflits devront être recalculés ; ils ne sont pas persistés. `coverage.center` est redondant avec `dronePosition` pour respecter le descripteur demandé : la validation impose leur égalité.

## Choix délibérés et limites

Pas de plugin React Vite nécessaire pour le socle : Vite traite TSX et le runtime JSX automatique. Les mises à jour peuvent recharger la page ; pas de Fast Refresh React garantissant la conservation de l’état. Pas de bibliothèque de dessin, de calcul géographique, de composants UI, de gestion d’état ou de tests.

Les moteurs lèvent une erreur commune jusqu’à leur implémentation. La météo inconnue ne signifie jamais « pas de pluie ». Les règles TP et altitude sont des contraintes du hackathon ; aucune extension à d’autres scénarios n’est déduite. Les décisions encore ouvertes sont dans REQUIREMENTS.md.

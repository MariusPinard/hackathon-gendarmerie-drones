# Architecture du prototype

Application statique React/TypeScript/Vite. Aucun serveur applicatif. Les contrats partagés séparent strictement l’interface, les moteurs métier et les services. Les moteurs n’importent ni React, ni Leaflet, ni DOM, ni service réseau.

## Responsabilités et circulation

```text
Import fichier/texte -> missionStorage -> Mission validée -> AppContext
Formulaire + dessin Leaflet -> PlanningInput -> planning -> PlanningResult
PlanningResult -> Mission planifiée -> ressources réelles -> nouveau PlanningResult
Mission prête -> startMission -> Mission active
Drag/altitude/cap/angle/disponibilité -> MissionChange -> recalculateMission
Mission + progression -> advanceSimulation -> Mission mise à jour -> carte et panneaux
Mission -> serializeMission / exportMission -> JSON 1.0
Coordonnées + date -> service weather -> WeatherInfo -> PlanningInput / Mission
```

`app/` gère la mission en mémoire et une navigation interne typée. Un brouillon sans zone reste dans le formulaire local : aucune `Mission` invalide n’est créée. La configuration modifiée invalide le plan précédent. Date ou localisation modifiées invalident aussi la météo ; un identifiant de requête empêche une ancienne réponse de remplacer le nouveau créneau.

`components/Map/MissionMap.tsx` encapsule Leaflet : nettoyage StrictMode, redimensionnement, conversion de l’ordre des coordonnées, couches zones/couverture/pertes, marqueurs et dessin. La carte est créée une seule fois par montage. Les mises à jour de couches ne recentrent pas le plan ; le fit des zones change uniquement quand la géométrie de l’opération change. Les noms importés sont rendus comme texte, jamais injectés comme HTML.

`components/Controls/` contient saisie drone et confirmations modales natives ; `Panels/` contient les métriques ; `Layout/` le header. `pages/` orchestre le parcours sans développer de calcul géométrique. `styles/` contient les règles responsive et le panneau de conduite à défilement indépendant.

`components/Map/mapSources.ts` isole les URL, attribution et zoom des fonds cartographiques. La source plan OSM est configurée ; satellite reste null jusqu’au choix d’une source autorisée. Aucun faux bouton de bascule n’est proposé dans cette version.

`engines/geometry/` expose les primitives métier et métriques. `engines/planning/` utilise ces primitives pour estimer les moyens, choisir des emplacements et attribuer les altitudes. `engines/operations/` reçoit un instantané de mission et retourne de nouvelles données sans modifier l’entrée. Les algorithmes sont documentés dans API_CONTRACT.

`services/weather.ts` est le seul endroit connaissant Open-Meteo et `fetch`. `services/missionStorage.ts` valide la structure et les limites géométriques via le module pur geometry. `services/missionPlanning.ts` construit l’entrée planning et applique un résultat en conservant l’estimation initiale pour la comparaison.

`AppContext` fournit aussi l’horloge de démonstration : elle avance une animation de retour/atterrissage toutes les 150 ms, sur 4 s, même si la page de conduite est démontée. Le moteur reçoit une progression depuis un instantané initial immuable. Remplacer la mission ou recharger l’application interrompt naturellement cette simulation en mémoire.

## Données persistées / calculées

JSON : metadata, date/heure avec fuseau, localisation, zones GeoJSON, météo, contraintes, estimation nullable, ressources, télépilotes, drones, positions, altitude, descripteur de couverture et états. `coverage.center` est conservé pour compatibilité mais doit correspondre à `dronePosition`.

Métriques, échantillons non couverts, géométries dérivées et conflits sont recalculés. Pas de localStorage, base de données ou backend. L’import revient aux ressources et la régénération remplace les positions et états antérieurs après une action explicite de recalcul.

## Dépendances et limites

Pas de nouvelle dépendance. Le runtime JSX automatique de Vite suffit ; les modifications de source peuvent recharger l’application (pas de Fast Refresh React). Tous les imports relatifs doivent se résoudre et le graphe reste sans cycle, y compris entre types mission/planning.

Les règles métier sont celles du hackathon. Projection locale, portée utilisée comme rayon de simulation, échantillonnage et séparation AGL sans relief ne valident pas une sécurité aéronautique réelle. Les erreurs de saisie, API et import sont présentées à l’utilisateur ; une configuration ayant des conflits ne peut pas être lancée.

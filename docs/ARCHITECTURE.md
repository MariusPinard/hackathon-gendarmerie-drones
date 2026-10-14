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
Adresse -> service geocoding -> Coordinates -> centrage carte
Coordonnées + date -> service weather -> WeatherInfo -> PlanningInput / Mission
```

`app/` gère la mission en mémoire et une navigation interne typée. Un brouillon sans zone reste dans le formulaire local : aucune `Mission` invalide n’est créée. La configuration modifiée invalide le plan précédent. Date ou localisation modifiées invalident aussi la météo ; un identifiant de requête empêche une ancienne réponse de remplacer le nouveau créneau.

`components/Map/MissionMap.tsx` encapsule Leaflet : nettoyage StrictMode, redimensionnement, conversion de l’ordre des coordonnées, couches zones/couverture/pertes, marqueurs et dessin. La carte est créée une seule fois par montage. Les mises à jour de couches ne recentrent pas le plan ; le fit des zones change uniquement quand la géométrie de l’opération change. Les noms importés sont rendus comme texte, jamais injectés comme HTML.

`components/Controls/` contient recherche adresse/coordonnées, saisie drone, notifications et confirmations modales ; `Panels/` contient métriques, météo et flotte ; `Layout/MapWorkspace` positionne les panneaux coulissants sur la carte. `pages/` orchestre le parcours sans développer de calcul géométrique. `styles/` contient les règles responsive et les panneaux à défilement indépendant dans une fenêtre cartographique de hauteur 100dvh.

`components/Map/mapSources.ts` isole les URL, attribution et zoom des fonds cartographiques. Plan utilise OSM, Satellite les orthophotos publiques IGN. Une seule couche de tuiles est active, avec attribution associée. Une erreur réseau conserve les objets métier et permet le retour au plan.

`engines/geometry/` expose les primitives métier et métriques. `engines/planning/` utilise ces primitives pour estimer les moyens, choisir des emplacements et attribuer les altitudes. `engines/operations/` reçoit un instantané de mission et retourne de nouvelles données sans modifier l’entrée. Les algorithmes sont documentés dans API_CONTRACT.

`services/weather.ts` connaît Open-Meteo ; `services/geocoding.ts` connaît le géocodage IGN et valide les résultats GeoJSON. La recherche d’adresse est temporisée, annulable, mise en cache et protégée contre les réponses obsolètes. `services/missionStorage.ts` valide la structure et les limites géométriques via le module pur geometry. `services/missionPlanning.ts` construit l’entrée planning et applique un résultat en conservant l’estimation initiale pour la comparaison.

`AppContext` fournit aussi l’horloge de démonstration : elle avance une animation de retour/atterrissage toutes les 150 ms, sur 4 s, même si la page de conduite est démontée. Le moteur reçoit une progression depuis un instantané initial immuable. Remplacer la mission ou recharger l’application interrompt naturellement cette simulation en mémoire.

## Données persistées / calculées

JSON : metadata, date/heure avec fuseau, localisation, zones GeoJSON, météo, contraintes, estimation nullable, ressources, télépilotes, drones, positions, altitude, descripteur de couverture et états. `coverage.center` est conservé pour compatibilité mais doit correspondre à `dronePosition`.

Métriques, échantillons non couverts, géométries dérivées et conflits sont recalculés. Pas de localStorage, base de données ou backend. L’import revient aux ressources et la régénération remplace les positions et états antérieurs après une action explicite de recalcul.

## Dépendances et limites

Pas de nouvelle dépendance. Le runtime JSX automatique de Vite suffit ; les modifications de source peuvent recharger l’application (pas de Fast Refresh React). Tous les imports relatifs doivent se résoudre et le graphe reste sans cycle, y compris entre types mission/planning.

Les règles métier sont celles du hackathon. Projection locale, portée utilisée comme rayon de simulation, échantillonnage et séparation AGL sans relief ne valident pas une sécurité aéronautique réelle. Les erreurs de saisie, API et import sont présentées à l’utilisateur ; une configuration ayant des conflits ne peut pas être lancée.

## Interactions cartographiques

Mirepoix est le centre initial de nouvelle planification. Un identifiant de recentrage permet de revenir au même résultat de recherche après déplacement de la carte. `closeDrawnPolygon` est pur : fermeture sans mutation, 3–300 sommets et validation topologique/domaine/surface par les moteurs existants. Les sommets sont aussi conservés dans une ref synchrone pour les clics rapides ; la navigation est verrouillée dans AppContext jusqu’à validation ou annulation.

Cap/angle construisent un résultat dérivé pour la carte, sans modifier la mission sauvegardée avant Appliquer. Le déplacement drag/drop ou clic de placement appelle le même moteur `recalculateMission`. Sur écran étroit, les boutons de panneaux ferment la flotte avant ouverture ; le choix d’un drone ouvre ses réglages. FleetPanel affiche hauteur et état sans batterie. Le catalogue embarqué dans une mission est facultatif pour la compatibilité des anciens fichiers.

## Planificateur opérationnel

La météo est automatiquement recherchée après stabilisation du créneau/localisation ; solar calcule indépendamment jour/nuit. Un changement de compatibilité invalide l’estimation restaurée, et une réponse obsolète est annulée. Les contraintes viennent des préférences puis sont sauvegardées dans la mission. Les modèles ajoutés aux ressources appartiennent à la mission ; ceux ajoutés dans Paramètres servent de défauts aux nouvelles missions. Les paramètres de période d’autorisation ne sont pas persistés avec les défauts locaux.

Geometry expose coveragePolygons pour l’intersection vectorielle du secteur avec l’opération, concavités et trous compris ; les moteurs utilisent clipPolygon dans les métriques/conflits. Planning ajuste cap/angle/rayon et mélangeTP1/TP2 ; adjustPlanningCoverage conserve les positions. Une proposition manuellement réglée est conservée dans Resources si l’inventaire/contraintes restent inchangés ; sinon recalcul explicite. Les composants se recentrent sur demande, pas sur chaque modification.

Voir ALGORITHMES et FORMAT_JSON pour les contraintes, bornes de recherche et extensions du stockage. Les spécifications ne remplacent pas des limites opérationnelles constructeur ; la compatibilité pluie/nuit est une politique de simulation distincte.

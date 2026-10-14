# Exigences métier

Ce document reprend le brief du hackathon. Les règles TP ci-dessous sont les règles du prototype, sans interprétation réglementaire supplémentaire.

## Planification à développer

1. Définir localisation, date et heure avec fuseau explicite.
2. Afficher une carte et basculer plan/satellite.
3. Dessiner une zone d’opération et plusieurs zones prioritaires en polygones GeoJSON.
4. Obtenir une météo simple et signaler la pluie.
5. Estimer les moyens et produire un plan qui privilégie les zones prioritaires et minimise les chevauchements hors de ces zones.
6. Sauvegarder la mission en JSON, puis passer aux ressources.

Pas de zones interdites. La fondation ne fournit que la carte plan minimale et les contrats ; aucun dessin ni placement avancé.

## Lancement et conduite à développer

1. Importer directement une mission JSON, indépendamment de la planification.
2. Saisir les quantités réellement disponibles par modèle et comparer avec l’estimation.
3. Lancer une simulation, afficher séparément drones et télépilotes ainsi que les couvertures.
4. Utiliser une couverture 360° par défaut, modifiable par cap et angle de travail.
5. Déplacer manuellement drone ou télépilote puis transmettre un `MissionChange` au moteur.
6. Recalculer couverture et conflits après changement.
7. Déclencher un arrêt d’urgence simulé ou terminer avec retour simulé de chaque drone vers son télépilote.

Aucune connexion réelle à des drones. Les boutons de simulation et leur logique restent à développer.

## Catalogue et capacités imposées

Modèles : DJI Matrice 4T, DJI Mavic 3 Enterprise, DJI Mini 5. Les capacités hackathon sont partagées par les modèles dans ce socle ; elles ne décrivent pas leurs spécifications commerciales.

| Scénario | Portée | Hauteur max rural | Hauteur max urbain |
| --- | --- | --- | --- |
| TP1 en vue | À préciser (`null`) | 120 m/sol | 120 m/sol |
| TP1 hors vue | 1 000 m | 50 m/sol | 80 m/sol |
| TP2 hors vue | 2 000 m | 120 m/sol | 120 m/sol |

Les Mini deviennent incompatibles si la pluie est détectée. Aucun autre effet météo n’est défini. `rainDetected: null` signifie une information inconnue ; il ne faut pas en déduire une compatibilité. Jour/nuit doit être déterminé ultérieurement selon coordonnées et date/heure, jamais par une heure fixe. Valeurs : `day`, `night`, `unknown`.

## Géométrie, positions et états

GeoJSON WGS84, ordre longitude/latitude. Couverture conceptuelle : centre, rayon en mètres, cap en degrés, angle de travail en degrés. Défaut 360° ; futur disque ou secteur. Le rayon de couverture n’est pas la portée drone-télépilote.

Représentation principalement 2D, altitude numérique en mètres au-dessus du sol (`Agl`). Deux couvertures qui se chevauchent exigent au moins 10 m de séparation verticale. La configuration est prête ; la détection et le solveur ne sont pas implémentés. Le relief et la comparaison d’altitudes AGL sur des terrains différents restent hors fondation.

Chaque drone référence un télépilote ; `pilotPosition` et `dronePosition` restent distincts. États drone : `ready`, `active`, `unavailable`, `returning`, `emergency_landing`, `completed`. États mission : `draft`, `planned`, `ready`, `active`, `emergency`, `returning`, `completed`. Les transitions seront définies par le moteur de conduite.

## Décisions à coordonner avant les fonctionnalités

- Distance/critère exact « en vue » ; éventuel scénario TP2 en vue et règles de qualification.
- Relation entre portée opérationnelle et rayon de couverture ; rayons d’exemple purement illustratifs.
- Méthode d’estimation, métriques/objectifs et stratégie de placement.
- Fournisseur satellite et droits d’usage ; fonctionnement hors ligne éventuel.
- Fournisseur météo, gestion des prévisions indisponibles et calcul astronomique jour/nuit.
- Politique pour pluie inconnue, ressources insuffisantes et affectation drone/télépilote.
- Containment des zones prioritaires, trous, auto-intersections, validation topologique et précision géométrique.
- Interprétation de la séparation verticale avec relief et limites d’altitude.
- Transitions de simulation, délais d’arrêt/retour, résolution des conflits et convention de changement d’état.
- Origine et synchronisation du rayon de couverture ; aucun changement de rayon n’est encore prévu dans `MissionChange`.

Toute évolution des contrats 1.0 doit être convenue entre les modules ; si des missions existantes deviennent incompatibles, prévoir version/migration.

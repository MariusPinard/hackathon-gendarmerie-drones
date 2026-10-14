# Exigences et état de réalisation

Règles de simulation du hackathon. Aucune commande réelle, aucun SDK drone, aucun backend, aucune zone interdite et aucun Street View.

## Fonctionnel

| Besoin | Réalisation |
| --- | --- |
| Planification et lancement direct | Accueil à deux actions ; import fichier/texte puis ressources |
| Nom, localisation, date et heure | Nom, latitude/longitude, date/heure locale -> ISO avec fuseau |
| Carte plan | Leaflet, zoom/déplacement et attribution OSM |
| Zone opération / plusieurs priorités | Dessin natif par clics, Terminer/double clic, annulation, retrait sommet et suppression |
| Météo simple | Pluie horaire Open-Meteo, avertissement et indisponibilité propre |
| Moyens estimés / disponibles | Estimation par modèle, compteurs manuels, comparaison et recalcul |
| Configuration expliquée | Heuristique déterministe, métriques et hypothèses visibles |
| Couverture | Disque 360° initial, secteur cap/angle en conduite |
| Positions drone/télépilote | Références distinctes, marqueurs D/T sélectionnables et déplaçables |
| Altitude / conflits | Plafond scénario, séparation 10 m en chevauchement, alerte explicite |
| Indisponibilité | Retrait couverture, affichage des pertes, réparation locale facultative |
| Fin / urgence | Confirmation, retour à chaque télépilote ou atterrissage sur place |
| JSON | Schéma 1.0, validation et export/import sauvegardable |

## Scénarios et modèles

DJI Matrice 4T, DJI Mavic 3 Enterprise, DJI Mini 5. Capacités hackathon partagées, sans caractéristiques commerciales inventées.

| Scénario | Portée | Hauteur max rural | Hauteur max urbain |
| --- | --- | --- | --- |
| TP1 en vue | Inconnue (`null`) ; estimation indisponible | 120 m/sol | 120 m/sol |
| TP1 hors vue | 1 000 m | 50 m/sol | 80 m/sol |
| TP2 hors vue | 2 000 m | 120 m/sol | 120 m/sol |

Scénario et environnement sélectionnables. Les Mini sont exclus de la planification si pluie détectée et signalés en conflit si une mission active en contient malgré la pluie. Pluie inconnue : avertissement, sans inventer une prévision. Pas d’effet vent, température ou visibilité.

Jour/nuit : `day`, `night`, `unknown`. Cette version conserve `unknown` : aucune heure fixe ou calcul astronomique non testé. Satellite : source à configurer ultérieurement, seule la vue plan est actuellement disponible.

## Simplifications explicites

Rayon simulé = portée du scénario ; ne décrit pas une empreinte réelle de capteur. Un télépilote proposé par drone, initialement au même point au sol. Les altitudes sont attribuées sur une échelle 10 m, 20 m, etc., bornée par le scénario et vérifiée contre les couvertures déjà placées. Une impossibilité est signalée et bloque le lancement via les conflits.

Projection locale, opérations <= 50 km de côté, hors pôles et antiméridien. Surfaces par grille régulière, priorités limitées à leur intersection avec la zone opération. Une priorité trop fine peut ne recevoir aucun échantillon : avertissement explicite. Les secteurs sont dessinés par segments d’arc <= 5° ; de minuscules intersections près des limites peuvent être approximées.

Le recalcul normal préserve les positions des autres éléments. La réorganisation demandée explore au plus 8 drones actifs et 5 points perdus ; elle applique au plus un déplacement si le gain pondéré progresse sans augmenter le nombre de conflits. Aucun placement optimal garanti.

En retour/urgence, les drones cessent immédiatement de contribuer à la couverture. Interpolation de 4 s, sans physique. Les indisponibles restent indisponibles et sont exclus des mouvements. Le retour finit en mission `completed` ; après atterrissage d’urgence la mission reste `emergency`, drones engagés `completed` à 0 m. Les positions indisponibles ne sont pas déplacées.

## Bornes et sujets restant ouverts

32 drones par dispositif/import, 100 télépilotes, 20 priorités, 20 anneaux par polygone, 300 sommets par anneau, 100 unités disponibles par modèle et JSON <= 2 Mo. Les limites servent l’interactivité, pas une règle opérationnelle.

À décider avant une utilisation élargie : portée/critères en vue, qualification hiérarchique TP2/TP1 (aucune équivalence supposée), rayon réel de capteur, vérification de positions télépilotes sur terrain, relief/altitudes absolues, calcul astronomique, fournisseur satellite/licences, politique météo inconnue, finesse adaptative pour zones très étroites et stratégie de résolution de conflits complexes.

Les transitions acceptées par les moteurs et le schéma sont décrits dans API_CONTRACT. Toute évolution incompatible devra prévoir une version/migration coordonnée.

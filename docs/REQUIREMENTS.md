# Exigences et état de réalisation

Règles de simulation du hackathon. Aucune commande réelle, aucun SDK drone, aucun backend, aucune zone interdite et aucun Street View.

## Fonctionnel

| Besoin | Réalisation |
| --- | --- |
| Planification et lancement direct | Accueil à deux actions ; import fichier/texte puis ressources |
| Nom, localisation, date et heure | Nom, adresse française ou latitude/longitude, Mirepoix initial, date/heure locale -> ISO avec fuseau |
| Carte plan / satellite | Leaflet plein écran sans scroll de page, OSM / orthophotos IGN avec attribution |
| Panneaux / flotte | Boutons carrés à flèche, panneaux coulissants, un drone par ligne à droite, état et hauteur, sans batterie |
| Zone opération / plusieurs priorités | Dessin par clics, fermeture au premier sommet ou automatique par Terminer, annulation et suppression ; actions verrouillées, notifications et validation |
| Météo simple | Météo automatique, pluie horaire Open-Meteo et jour/nuit astronomique local |
| Moyens estimés / disponibles | Estimation par modèle, compteurs manuels, comparaison et recalcul |
| Configuration expliquée | Heuristique déterministe, métriques et hypothèses visibles |
| Couverture | Secteurs/rayons adaptés et découpés à l’opération, réglage planning/conduite |
| Positions drone/télépilote | Références distinctes, marqueurs D/T sélectionnables et déplaçables ; drone par drag/drop ou clic puis destination, recalcul automatique |
| Altitude / conflits | Plafond scénario, séparation configurable, 30 m par défaut en chevauchement, alerte explicite |
| Indisponibilité | Retrait couverture, affichage des pertes, réparation locale facultative |
| Fin / urgence | Confirmation, retour à chaque télépilote ou atterrissage sur place |
| JSON | Schéma 1.0, validation et export/import sauvegardable |

## Scénarios et modèles

DJI Matrice 4T, DJI Mavic 3 Enterprise, DJI Mini 5. Capacités hackathon partagées, sans caractéristiques commerciales inventées.

| Scénario | Portée | Hauteur max rural | Hauteur max urbain |
| --- | --- | --- | --- |
| TP1 en vue | 500 m (règle de simulation du brief) | 120 m/sol | 120 m/sol |
| TP1 hors vue | 1 000 m | 50 m/sol | 80 m/sol |
| TP2 hors vue | 2 000 m | 120 m/sol | 120 m/sol |

Scénario et environnement sélectionnables. Mavic et Mini sont exclus sous pluie ou de nuit selon la politique demandée ; Matrice est retenu par la simulation, distinctement de sa non-étanchéité constructeur. Pluie inconnue : avertissement, sans inventer une prévision. Pas d’effet vent, température ou visibilité.

Jour/nuit : `day`, `night`, `unknown`. Calcul solaire local au seuil −6° pour les dates valides ; `unknown` réservé aux entrées invalides/imports historiques. Satellite : orthophotos IGN publiques en France, retour au plan en cas d’indisponibilité.

## Simplifications explicites

Rayon simulé ≤ portée du scénario ; ne décrit pas une empreinte réelle de capteur. Un télépilote proposé par drone, initialement au même point au sol. Les altitudes sont attribuées sur des niveaux 10 m + multiples de la séparation (30 m par défaut), bornée par le scénario et vérifiée contre les couvertures déjà placées. Une impossibilité est signalée et bloque le lancement via les conflits.

Projection locale, opérations <= 50 km de côté, hors pôles et antiméridien. Surfaces par grille régulière, priorités limitées à leur intersection avec la zone opération. Une priorité trop fine peut ne recevoir aucun échantillon : avertissement explicite. Les secteurs sont dessinés par segments d’arc <= 5° ; de minuscules intersections près des limites peuvent être approximées.

Le recalcul normal préserve les positions des autres éléments. Le calcul initial teste TP1/TP2, évite les drones redondants et préfère TP1 à bénéfice équivalent, sans garantie d’optimalité. La réorganisation demandée explore au plus 8 drones actifs et 5 points perdus ; elle applique au plus un déplacement si le gain pondéré progresse sans augmenter le nombre de conflits. Aucun placement optimal garanti.

En retour/urgence, les drones cessent immédiatement de contribuer à la couverture. Interpolation de 4 s, sans physique. Les indisponibles restent indisponibles et sont exclus des mouvements. Le retour finit en mission `completed` ; après atterrissage d’urgence la mission reste `emergency`, drones engagés `completed` à 0 m. Les positions indisponibles ne sont pas déplacées.

## Bornes et sujets restant ouverts

32 drones par dispositif/import, 100 télépilotes, 20 priorités, 20 anneaux par polygone, 300 sommets par anneau, 100 unités disponibles par modèle et JSON <= 2 Mo. Les limites servent l’interactivité, pas une règle opérationnelle.

À décider avant une utilisation élargie : validation des critères en vue, qualification hiérarchique TP2/TP1 (aucune équivalence supposée), rayon réel de capteur, vérification de positions télépilotes sur terrain, relief/altitudes absolues, conditions d’usage des services externes, politique météo inconnue, finesse adaptative pour zones très étroites et stratégie de résolution de conflits complexes.

Les transitions acceptées par les moteurs et le schéma sont décrits dans API_CONTRACT. Toute évolution incompatible devra prévoir une version/migration coordonnée.

Catalogue étendu dans les ressources : nom, pluie/nuit déclarés, vent et zoom ; fiches DJI sourcées. Paramètres persistés et catalogue de20modèles max. Autorisation facultative référence/effectif0–32/périodeISO : contrôles déclaratifs, aucune vérification juridique. Schéma1.0 étendu de champs facultatifs et imports historiques conservés.

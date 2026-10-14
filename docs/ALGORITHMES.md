# Algorithmes du simulateur

Les calculs sont déterministes et locaux au navigateur. Ils proposent un dispositif pour le hackathon ; ils ne garantissent ni le nombre minimal de drones ni une autorisation de vol. Les caractéristiques constructeur et les règles opérationnelles du scénario restent distinctes.

## Géométrie et zones de travail

Les coordonnées suivent GeoJSON : `[longitude, latitude]`, en degrés WGS84. Les calculs locaux utilisent une projection équirectangulaire centrée sur la zone, avec un rayon terrestre de 6 371 008,8 m. La distance télépilote/drone utilise une formule sphérique.

Une couverture conserve son centre, son rayon, son cap, son angle de travail et un `clipPolygon` facultatif. Ce masque correspond exactement à la zone d’opération. Il reste facultatif pour importer les anciennes missions ; l’interface applique aussi le contour de l’opération à leur affichage.

`pointInCoverage` vérifie le rayon, le secteur orienté depuis le nord dans le sens horaire, puis le masque. Les trous du polygone sont exclus. Les surfaces de travail ne débordent donc pas de l’opération.

`coveragePolygons` construit le disque ou secteur, puis son intersection vectorielle avec l’opération. Les arcs utilisent des segments espacés d’au plus 5°. Chaque anneau est orienté, ses arêtes sont découpées aux intersections, les portions intérieures sont conservées, puis les frontières sont assemblées. Les trous et les parties disjointes sont conservés : le résultat est une liste de polygones, pas forcément un cercle ou un seul anneau. Aucun nouveau moteur géométrique externe n’est nécessaire.

L’affichage et la détection des chevauchements géométriques utilisent ces polygones. Les métriques utilisent le test du disque/secteur sur une grille. L’approximation d’un arc de 5° peut produire un écart inférieur à 2 m pour un rayon de 2 km ; les très petites intersections proches d’une tangence restent une limite du prototype.

## Mesures de couverture

La grille métrique comporte normalement 44 cellules sur le plus grand côté de l’emprise. Seuls les centres de cellule appartenant à l’opération sont retenus. La fonction de grille est bornée à 2 500 points.

Les surfaces sont estimées par le nombre de cellules multiplié par leur aire. Les pourcentages total, prioritaire et de chevauchement sont donc des estimations, sensibles à la résolution. Le chevauchement global est le pourcentage de cellules de l’opération couvertes par au moins deux drones ; une cellule couverte par trois drones ne compte qu’une fois dans ce pourcentage. Le plafond configurable concerne aussi les cellules prioritaires.

Tous les points non couverts sont transmis à la carte, qui affiche leurs cellules hachurées et découpe l’overlay au contour exact de l’opération. Les drones indisponibles, en retour, en atterrissage ou terminés ne fournissent plus de couverture active.

## Placement et mix TP1/TP2

Le moteur exclut les modèles incompatibles avec la pluie ou la nuit. Dans le catalogue standard, seul le Matrice 4T est autorisé pour ces deux conditions selon la règle demandée pour cette simulation. Un modèle personnalisé utilise ses capacités explicitement déclarées.

Les positions candidates viennent d’une grille de 14 cellules sur le plus grand côté, soit au plus 196 positions. Une zone très étroite peut manquer cette grille tout en contenant des cellules métriques : le moteur utilise alors un sous-ensemble borné de ces cellules.

Le scénario TP1 en vue utilise un rayon maximal de 500 m et un plafond de 120 m, conformément à la valeur fournie pour cette simulation. Il peut être choisi explicitement ; le mix automatique utilise les profils hors vue de 1 km et 2 km. Les catalogues historiques dont la portée en vue vaut `null` restent importables, mais leur scénario non défini est refusé au calcul. Ces valeurs sont des règles de scénario, pas des performances constructeur.

À chaque étape, le moteur compare les profils disponibles et leurs positions candidates. Le score additionne les nouvelles cellules couvertes, avec un poids de 4 pour les priorités et de 1 ailleurs. Une cellule déjà couverte entraîne une pénalité de 0,02 en priorité et de 0,4 ailleurs. Toute proposition dépassant le pourcentage de chevauchement autorisé est écartée.

Le cap et l’angle proviennent de l’enveloppe angulaire des cellules encore utiles, avec quelques directions et angles plus étroits testés. En mode mixte, le rayon correspond au besoin observé, augmenté d’une marge liée à la grille, puis limité par la portée du profil. TP1 est limité à 1 km, TP2 à 2 km. À gain et score équivalents, TP1 est préféré ; aucun TP2 n’est proposé avec un rayon inférieur ou égal à 1 km. Les scénarios uniques des anciennes missions conservent leur rayon de portée, tout en appliquant le découpage à l’opération.

Le placement s’arrête à 98 % de couverture totale et 99 % de couverture prioritaire, ou lorsqu’aucun gain admissible n’est trouvé, que les ressources sont épuisées, ou que 32 drones ont été proposés. Une passe retire les unités devenues redondantes : elle conserve ces objectifs, ou la couverture déjà obtenue si le dispositif est partiel. La disponibilité des modèles n’est jamais dépassée.

Une autorisation facultative saisie par l’utilisateur peut réduire ce plafond. Son maximum est appliqué en plus des ressources disponibles et de la limite de 32 drones ; zéro produit un dispositif vide avec avertissement. Une date de mission hors de la période saisie produit un avertissement en planification et un conflit bloquant au lancement. Les bornes de période sont inclusives. Le contrôle porte sur l’heure prévue de la mission et sur les champs saisis ; aucune vérification administrative ou juridique de l’autorisation n’est effectuée.

Cette recherche gloutonne vise un nombre raisonnable de drones. Elle ne résout pas exactement un problème de couverture minimale ; un autre placement peut améliorer le résultat.

## Altitudes et conflits

Deux zones de travail qui se chevauchent forment une arête dans le graphe des drones. Les altitudes candidates commencent à 10 m puis augmentent de la séparation configurée, jusqu’au plafond du scénario. La séparation par défaut est 30 m ; une ancienne mission à 10 m conserve sa valeur.

L’affectation utilise un ordre DSatur : choisir les voisins présentant le plus de niveaux déjà occupés, puis les profils offrant le moins de niveaux et les plus grands voisinages. Une recherche avec retour arrière est bornée à 20 000 nœuds. Si elle ne trouve pas d’affectation, une affectation gloutonne fournit une proposition accompagnée d’avertissements explicites pour les drones concernés. L’épuisement de cette recherche ne constitue pas une preuve d’impossibilité.

La conduite vérifie à nouveau les altitudes, les qualifications, la portée télépilote/drone, les ressources, la pluie, la nuit et le chevauchement configurable. Une séparation insuffisante ou une autre violation empêche le lancement. Le catalogue enregistré dans la mission est utilisé pour les modèles personnalisés.

## Réglage d’une proposition

`adjustPlanningCoverage(input, plan, droneId, change)` clone la proposition et modifie le cap, l’angle et le rayon du drone sélectionné. Il conserve toutes les positions, applique le masque de l’opération, recalcule les altitudes et rafraîchit les avertissements de couverture et de chevauchement.

Un rayon ramené à 1 km ou moins convertit TP2 vers un profil TP1 compatible et ajuste la qualification proposée du télépilote. En mode mixte seulement, un rayon augmenté au-delà de la portée TP1 peut convertir vers TP2, sans dépasser 2 km. Le mode TP1 seul reste limité à 1 km. Les valeurs non finies et les bornes invalides sont rejetées.

## Limites et vérification

Les entrées restent bornées : zone locale de 50 km de côté au maximum, hors régions polaires au-delà de 75° et hors antiméridien, 300 sommets par anneau, 20 anneaux par polygone, 20 priorités, 32 drones engagés et 100 unités disponibles par modèle. Les très petites zones ou les zones trop étroites pour la grille métrique doivent être agrandies ou divisées.

Les tests couvrent notamment les concavités, trous, frontières coïncidentes, morceaux séparés, secteurs orientés, masques sans débordement, mix TP1/TP2, rayon adapté, pénurie, plafond de chevauchement nul, incompatibilités météo, modèles personnalisés, altitudes et immutabilité. Les tests de conduite vérifient un recalcul typique inférieur à une seconde sur l’environnement de test ; cela ne constitue pas une garantie pour tous les appareils ou tous les polygones.

Une mesure locale observée pendant la validation donne environ 0,4 s à froid pour une petite zone mixte et environ 0,1 s pour un rectangle allongé. Sur ce dernier cas, le dispositif mixte proposait 3 drones contre 7 en TP1 seul. Ces résultats illustrent un cas de test, pas un minimum garanti ni un engagement de performance.

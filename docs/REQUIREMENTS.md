# Parcours de démonstration

## Préparation

npm install, puis npm run dev ; ouvrir l’URL HTTP de Vite. Réseau utile pour fonds OSM/IGN, adresses et météo, aucune clé nécessaire. Exporter avant de recharger. Les labels D et T distinguent drone et télépilote même quand les positions initiales sont identiques.

## Parcours dessiné

1. Planifier une mission, ouvrir le panneau Mission et saisir nom/date à venir en JJ/MM/AAAA et heure 24 h. Mirepoix est le centre initial. Chercher « Place du Capitole Toulouse » dans la barre Adresse puis sélectionner la proposition, ou basculer sur Coordonnées.
2. Centrer la carte, dessiner un rectangle d’environ 4–6 km. Ouvrir Zones puis « Dessiner la zone d’opération ». Clic = sommet ; clic sur le premier sommet ou Terminer = fermeture. La barre Terminer/Annuler est sur la carte ; aucune autre action métier n’est accessible avant la fin. Un dessin incomplet/croisé est refusé avec notification et reste ouvert ; Annuler conserve les zones validées.
3. Dessiner une priorité au centre. Les priorités orange sont pondérées quatre fois plus.
4. Renseigner la date et l’heure dans Mission : la météo arrive automatiquement, avec Jour/Nuit calculé même hors horizon météo. Avec une date éloignée : message d’indisponibilité. Avec pluie ou nuit : seuls les Matrice 4T sont retenus, y compris avec des modèles personnalisés dans le catalogue.
5. Calculer l’estimation. Le résultat s’ouvre à droite. Lire couverture totale/prioritaire, chevauchement, mix TP1/TP2, hypothèses et limites. Cliquer un drone pour modifier cap/angle/rayon dès la planification. Exporter et nommer le fichier JSON.
6. Préparer l’opération, réduire un modèle, recalculer. Couverture partielle autorisée ; lancement bloqué seulement en cas de dispositif vide ou de conflits.
7. Lancer ; sélectionner D1 dans la flotte de droite (une ligne par drone avec hauteur, sans batterie). Changer cap à 90° et angle à 90° : le secteur apparaît immédiatement sur la carte. Appliquer pour sauvegarder. Sur petit écran, un seul panneau est ouvert à la fois.
8. Glisser un drone ou un télépilote. Pour un drone, essayer aussi « Déplacer le drone sur la carte » puis cliquer la destination. Observer le journal de recalcul ; les autres positions ne sont pas réorganisées.
9. Rapprocher deux disques puis leur donner la même altitude pour montrer le conflit, sans dépasser les plafonds. Rétablir 30 m de séparation ou déplacer le drone pour résoudre.
10. Rendre un drone indisponible : sa couverture disparaît et les points perdus apparaissent. Essayer la réorganisation locale facultative ; elle peut expliquer qu’aucun gain limité n’est possible.
11. Fin de mission : annuler une fois pour montrer la confirmation, puis confirmer. Les drones engagés reviennent vers leur télépilote et la mission devient terminée en environ quatre secondes.
12. Préparer un nouveau dispositif et recalculer pour recommencer. Confirmer l’arrêt d’urgence : descente sur place, mission urgence persistante. Exporter l’état final.

## Parcours import

Accueil -> Lancer une opération -> importer le JSON exporté (fichier ou texte) -> ressources -> recalcul -> lancement. L’estimation initiale est conservée pour comparer. Un JSON invalide affiche un message sans crash. Le bouton de mission fictive permet un parcours court avec la zone intégrée ; un seul drone peut suffire pour ce petit secteur.

## Limites à expliquer au jury

Configuration proposée et métriques approximatives, sans promesse d’optimalité. Rayon de simulation lié au scénario, pas au capteur. Positions télépilotes non validées sur terrain, relief absent et jour/nuit inconnu. La vue satellite IGN est une orthophoto française ; aucune télémétrie drone n’est disponible. Toutes les actions sont simulées.

La carte occupe la fenêtre sous l’en-tête. Les boutons carrés à flèche ouvrent les panneaux par-dessus la carte ; seuls les panneaux longs défilent. Basculer Plan/Satellite pour montrer le vrai fond IGN.

## Nouveaux contrôles de démonstration

- Terminer le dessin : le panneau Zones se rouvre. Le calcul et la préparation sont en bas de carte.
- Centrer la carte : bouton en haut à gauche ; légende verticale en bas à droite, contours contrastés et arcs extérieurs ambre en pointillés, limités au secteur de travail, et points rouges non couverts.
- Paramètres, accessibles dans le planificateur : séparation30m/chevauchement20% initiaux ; réduire la tolérance et recalculer. Une absence d’altitudes valides ou un conflit bloque le lancement. Une autorisation facultative plafonne l’effectif et signale un créneau hors période.
- Ressources réelles : ajouter un modèle fictif, renseigner pluie/nuit/vent/zoom, régler la quantité et recalculer ; exporter/importer conserve le catalogue. Ajouter un modèle par défaut dans Paramètres puis recharger pour vérifier sa mémorisation.

Le Matrice4T est déclaré compatible pluie dans cette simulation, mais DJI le déclare non étanche. Montrer les caractéristiques sourcées avant d’expliquer cette règle.

- Ajouter une unité au-delà du besoin, recalculer et ouvrir la flotte : elle reste visible en réserve. La placer, l’engager et vérifier les métriques avant lancement.
- Déclencher l’urgence puis attendre quatre secondes : « Relancer l’opération » rétablit le dispositif et ses altitudes.

- Sur Mirepoix, choisir « Occupation » : carte précalculée et légende ; cliquer une couleur pour afficher la cause et le verdict. Le calcul d’autres secteurs nécessite le service d’occupation configuré et se lance explicitement.
- L’accueil ordinateur affiche les deux grands logos transparents et les accès Planificateur/Conduite.

Itération occupation/accueil : import ciblé du seul mode Occupation depuis `feature/occupancy-map-mode` ; données précalculées de Mirepoix et interface facultative de calcul en direct. Arcs de portée extérieurs restreints à l’angle de travail, ambre et plus fins ; points rouges V1 rétablis. Logos fournis, grands et transparents, accueil ordinateur renouvelé. Aucun développement supplémentaire de version téléphone demandé.

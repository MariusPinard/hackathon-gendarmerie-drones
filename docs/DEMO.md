# Parcours de démonstration

## Préparation

npm install, puis npm run dev ; ouvrir l’URL HTTP de Vite. Réseau utile pour fonds OSM/IGN, adresses et météo, aucune clé nécessaire. Exporter avant de recharger. Les labels D et T distinguent drone et télépilote même quand les positions initiales sont identiques.

## Parcours dessiné

1. Planifier une mission, ouvrir le panneau Mission et saisir nom/date à venir. Toulouse est le centre initial. Chercher « Place du Capitole Toulouse » dans la barre Adresse puis sélectionner la proposition, ou basculer sur Coordonnées.
2. Centrer la carte, dessiner un rectangle d’environ 4–6 km. Ouvrir Zones puis « Dessiner la zone d’opération ». Clic = sommet ; clic sur le premier sommet ou Terminer = fermeture. La barre Terminer/Annuler est sur la carte ; aucune autre action métier n’est accessible avant la fin. Un dessin incomplet/croisé est refusé avec notification et reste ouvert ; Annuler conserve les zones validées.
3. Dessiner une priorité au centre. Les priorités orange sont pondérées quatre fois plus.
4. Ouvrir Météo puis obtenir la prévision. Observer le petit badge pluie/soleil. Avec une date éloignée : message d’indisponibilité. Avec pluie : Mini exclus. Jour/nuit reste inconnu.
5. Calculer l’estimation. Lire couverture totale/prioritaire, chevauchement, nombre de drones, hypothèses et limites. Exporter le JSON.
6. Préparer l’opération, réduire un modèle, recalculer. Couverture partielle autorisée ; lancement bloqué seulement en cas de dispositif vide ou de conflits.
7. Lancer ; sélectionner D1 dans la flotte de droite (une ligne par drone avec hauteur et batterie fictive). Changer cap à 90° et angle à 90° : le secteur apparaît immédiatement sur la carte. Appliquer pour sauvegarder. Sur petit écran, un seul panneau est ouvert à la fois.
8. Glisser un drone ou un télépilote. Pour un drone, essayer aussi « Déplacer le drone sur la carte » puis cliquer la destination. Observer le journal de recalcul ; les autres positions ne sont pas réorganisées.
9. Rapprocher deux disques puis leur donner la même altitude pour montrer le conflit, sans dépasser les plafonds. Rétablir 10 m de séparation ou déplacer le drone pour résoudre.
10. Rendre un drone indisponible : sa couverture disparaît et les points perdus apparaissent. Essayer la réorganisation locale facultative ; elle peut expliquer qu’aucun gain limité n’est possible.
11. Fin de mission : annuler une fois pour montrer la confirmation, puis confirmer. Les drones engagés reviennent vers leur télépilote et la mission devient terminée en environ quatre secondes.
12. Préparer un nouveau dispositif et recalculer pour recommencer. Confirmer l’arrêt d’urgence : descente sur place, mission urgence persistante. Exporter l’état final.

## Parcours import

Accueil -> Lancer une opération -> importer le JSON exporté (fichier ou texte) -> ressources -> recalcul -> lancement. L’estimation initiale est conservée pour comparer. Un JSON invalide affiche un message sans crash. Le bouton de mission fictive permet un parcours court avec la zone intégrée ; un seul drone peut suffire pour ce petit secteur.

## Limites à expliquer au jury

Configuration proposée et métriques approximatives, sans promesse d’optimalité. Rayon de simulation lié au scénario, pas au capteur. Positions télépilotes non validées sur terrain, relief absent et jour/nuit inconnu. La vue satellite IGN est une orthophoto française ; la batterie affichée est fictive. Toutes les actions sont simulées.

La carte occupe la fenêtre sous l’en-tête. Les boutons carrés à flèche ouvrent les panneaux par-dessus la carte ; seuls les panneaux longs défilent. Basculer Plan/Satellite pour montrer le vrai fond IGN.

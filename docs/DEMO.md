# Parcours de démonstration

## Préparation

npm install, puis npm run dev ; ouvrir l’URL HTTP de Vite. Réseau utile pour fond OSM et météo, aucune clé nécessaire. Exporter avant de recharger. Les labels D et T distinguent drone et télépilote même quand les positions initiales sont identiques.

## Parcours dessiné

1. Planifier une mission, saisir nom, coordonnées autour de Rennes et date/heure à venir.
2. Centrer la carte, dessiner un rectangle d’environ 4–6 km. Clic = sommet ; Terminer ou double clic = fermeture. Une zone croisée est refusée avec explication.
3. Dessiner une priorité au centre. Les priorités orange sont pondérées quatre fois plus.
4. Obtenir la météo. Avec une date éloignée : message d’indisponibilité. Avec pluie : Mini exclus. Jour/nuit reste inconnu.
5. Calculer l’estimation. Lire couverture totale/prioritaire, chevauchement, nombre de drones, hypothèses et limites. Exporter le JSON.
6. Préparer l’opération, réduire un modèle, recalculer. Couverture partielle autorisée ; lancement bloqué seulement en cas de dispositif vide ou de conflits.
7. Lancer ; sélectionner D1, changer cap à 90° et angle à 90°, appliquer : le disque devient secteur.
8. Glisser un drone ou un télépilote. Observer le journal de recalcul ; les autres positions ne sont pas réorganisées.
9. Rapprocher deux disques puis leur donner la même altitude pour montrer le conflit, sans dépasser les plafonds. Rétablir 10 m de séparation ou déplacer le drone pour résoudre.
10. Rendre un drone indisponible : sa couverture disparaît et les points perdus apparaissent. Essayer la réorganisation locale facultative ; elle peut expliquer qu’aucun gain limité n’est possible.
11. Fin de mission : annuler une fois pour montrer la confirmation, puis confirmer. Les drones engagés reviennent vers leur télépilote et la mission devient terminée en environ quatre secondes.
12. Préparer un nouveau dispositif et recalculer pour recommencer. Confirmer l’arrêt d’urgence : descente sur place, mission urgence persistante. Exporter l’état final.

## Parcours import

Accueil -> Lancer une opération -> importer le JSON exporté (fichier ou texte) -> ressources -> recalcul -> lancement. L’estimation initiale est conservée pour comparer. Un JSON invalide affiche un message sans crash. Le bouton de mission fictive permet un parcours court avec la zone intégrée ; un seul drone peut suffire pour ce petit secteur.

## Limites à expliquer au jury

Configuration proposée et métriques approximatives, sans promesse d’optimalité. Rayon de simulation lié au scénario, pas au capteur. Positions télépilotes non validées sur terrain, relief absent, jour/nuit inconnu et vue satellite non configurée. Toutes les actions sont simulées.

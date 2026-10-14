# Validation du prototype et de la carte

Validation réalisée le 14 octobre 2026. Fondation présente sur main via le merge 8e51c6c ; aucune modification de main, aucun push/merge de cette itération.

## Contrôles automatisés

`npm test` : **61 tests réussis**, sans test ignoré. `npm run build` : réussi, comprenant `tsc --noEmit`. `git diff --check` : réussi à chaque phase. `npm install` : réussi, aucune nouvelle dépendance directe, audit sans vulnérabilité détectée lors de cette validation.

Tests métier : rectangle, priorité centrale, ressources insuffisantes et nulles, estimation reproductible, altitude impossible explicite, conflits à même altitude / séparation 10 m, déplacement drone et télépilote, indisponibilité et réparation locale limitée, disques/secteurs, pluie + Mini, urgence, retour, états interdits, round-trip JSON et parcours complet sauvegardé/importé.

Tests d’erreurs : coordonnées/valeurs non finies, plafonds/cap/angle, polygones croisés/dégénérés, version inconnue, références/IDs, calendrier, portée en vue inconnue, grande zone, effectifs/fichier trop grands. Météo avec fetch/horloge injectés : pluie/averses, sec, horizon, nulls, heure absente, HTTP/réseau.

Environnement utilisé : Node 24.19.0, npm 12.2.0. Node/npm étaient absents du PATH initial ; un runtime temporaire a servi aux commandes. Les scripts sont standard et demandent seulement les prérequis du README. npm a bloqué le script optionnel fsevents ; le serveur, ses rechargements et le build ont fonctionné. Aucun changement de configuration globale de l’ordinateur.

## Contrôles navigateur manuels

Parcours réellement effectué dans le navigateur intégré en HTTP via Vite :

1. Accueil -> planification, nom et date/heure, fond Leaflet chargé.
2. Échéance 2030 -> prévision indisponible ; échéance proche -> réponse réelle Open-Meteo disponible (pas de pluie sur le créneau testé).
3. Rectangle dessiné par quatre clics, fermeture par Terminer, puis priorité centrale orange.
4. Estimation : **12 drones (4 par modèle), 94,6 % total, 100 % priorité**, 1 584 échantillons, maille ~122 m. Résultat reproductible après import.
5. Réduction d’un Mini puis recalcul : **11 drones, 92,6 % total, 100 % priorité** ; comparaison d’inventaire et avertissement partiel visibles.
6. Lancement, drones D et télépilotes T distincts ; modification cap 90°/angle 90° -> secteur visible et métriques modifiées.
7. Glisser-déposer drone puis télépilote ; messages et recalculs observés à **3–5 ms** sur ce scénario (mesure indicative locale).
8. Conflit vertical provoqué et affiché avec IDs, écart et position approximative. Drone indisponible -> couverture supprimée, pertes visibles ; proposition de réparation limitée sans modification injustifiée.
9. Fin de mission : confirmation annulée puis acceptée, état returning puis completed, drones à 0 m. Export final parsé et vérifié : chaque drone engagé est à la position de son télépilote.
10. Nouveau dispositif, recalcul/lancement ; urgence : confirmation annulée puis acceptée, emergency_landing puis completed à 0 m, mission restant emergency.
11. Export JSON natif téléchargé, accueil -> import de ce fichier -> ressources -> lancement. Version 2.0 invalide via texte : erreur propre sans crash.
12. Retrait d’un sommet, annulation du dessin et fermeture d’un triangle par double clic vérifiés.

Vues inspectées à 1 366 × 900, 1 024 × 768 et 760 × 900 : pas de débordement horizontal, carte redimensionnée, disposition empilée à largeur réduite. Panneau de conduite défile indépendamment sur laptop. Aucune erreur console ni warning React important observé.

## Revue statique et limites

106 imports applicatifs vérifiés : chemins résolus, graphe sans cycle, aucun import externe React/Leaflet/UI dans engines. Recherche de secrets potentiels et de TODO/placeholders incohérents : aucun dans les sources finales. JSON exemple validé par les tests. node_modules/dist ignorés, aucun artefact de navigateur/téléchargement/screenshot versionné.

Les scénarios automatisés sont des tests métier, pas une suite Playwright ajoutée au dépôt. Les essais UI sont manuels et tracés ici. Les limites de géométrie locale, grille/secteurs, rayon de simulation, météo/horizon, jour/nuit inconnu, satellite non configuré et stockage en mémoire sont documentées dans README, REQUIREMENTS et API_CONTRACT.

## Itération map-workspace — 14 octobre 2026

Branche `codex/map-workspace` depuis `main` `f0e0e57`. Aucune nouvelle dépendance ni évolution du schéma JSON. Les validations historiques ci-dessus décrivent l’ancienne interface ; retrait de sommet supprimé et satellite désormais implémenté.

`npm test` : **68 tests réussis** (61 existants + 4 géocodage + 3 dessin). Build avec TypeScript strict réussi. Nouveaux tests : mapping et URL IGN, entrées malformées, erreurs HTTP/réseau, fermeture/non-mutation, premier sommet sans duplication, anneau croisé/incomplet et bornes.

Essais navigateur réels : Toulouse par défaut, recherche du Capitole via IGN, saisie coordonnée, chargement de 24/24 tuiles IGN et attribution correctement remplacée, dessin fermé par le premier sommet et par Terminer, deux sommets refusés, polygone croisé refusé sans déverrouiller, Annuler libérant les commandes. Prévision réelle affichée « Beau temps ». Rectangle/priorité : 7 drones, 94,1 % total, 100 % priorité, 17,4 % chevauchement, 1 672 points. Export JSON puis import fichier et recalcul reproductibles.

En conduite : flotte avec batteries fictives dans les trois couleurs et hauteurs, aperçu 90°/90° avant validation avec flotte conservée sur ordinateur, déplacement au clic puis glisser-déposer et recalcul/conflict de portée. Carte à 1280 × 720, 1024 × 768 et 390 × 844 : dimensions du document égales au viewport, sans défilement de page. Les essais UI restent manuels, sans dépendance Playwright ajoutée.

Derniers contrôles : ouverture réciproque Informations/Flotte sur mobile fermant l’autre panneau, confirmation de retour jusqu’à Terminée (toutes les hauteurs à 0 m), nouveau dispositif lancé à nouveau. Aucune erreur ou alerte console. Revue statique : 137 imports résolus, graphe sans cycle, moteurs indépendants du navigateur. `git diff --check` réussi ; lockfile inchangé.

À largeur <= 1100 px, les panneaux sont ouverts un à la fois pour préserver la carte ; choix d’un drone vérifié à la largeur réelle 903 px, flotte fermée et secteur 90°/90° visible.

## Itération operational-planning — 14 octobre 2026

Les sections précédentes décrivent les versions historiques. Cette itération traite la liste des changements puis les règles compatibles : mix TP1/TP2, zones non circulaires, jour/nuit, séparation30m, TP1en vue500m et autorisation déclarée facultative. Elle n’implémente pas les suggestions de patrouilles, machine de vol complète, découpage de puissance, StreetView, journal ou nouvelles démonstrations.

Branche `codex/operational-planning` depuis `main` `5f6d220`. Aucune nouvelle dépendance ; sources constructeur dans DRONE_SPECS et format1.0 rétrocompatible dans FORMAT_JSON. Moteurs/algorithmes détaillés dans ALGORITHMES.

Automatisation : **122 tests réussis**, build TypeScript/Vite et diffcheck réussis. Nouveaux tests : intersections concaves et trous, morceaux disjoints et contact frontière, secteurs, préférence TP1/promotion-conversion, ressources insuffisantes, grille étroite, séparation/plafonds, limite de chevauchement, pluie/nuit/customcatalog, autorisation/période/max0, soleil contre cas de référence NOAA/NREL, calendrier/offsets invalides, catalogue portable, préférences corrompues, URLs/pollutionprototype, exportnommé et anciennes missions.

Essais UI réels en preview production : date française, 31février refusé puis correction, Nuit affichée automatiquement même horshorizon ; estimation nocturne4Matrice et0Mavic/Mini, 99,7%total/12,5%chevauchement. Fin dessinrouvreZones. Satellite IGN chargé18/18 ; contours contrastés et couvertures découpées strictement au rectangle. Édition45°/900m produit conversionTP1 et pertes hachurées ; retourResources/recalcul conserve le réglage manuel. Exportrefusechemin puis télécharge un nomaccentué exact ; Escapeferme le dialogue. Flotte affiche état/hauteur sans batterie. Formats métriquesfr-FR.

Responsive1280×720,1024×768,390×844 : document cartographique égal auviewport, workspace sans défilement après autofocus, panneaux défilants seuls ; commandes/résultats/légende/notifications séparés. Les preuves sont conservées horsduGit. Aucun secret, artefactexporté ou nouvelle bibliothèque versionné.

Contrôles finaux après reprise : ajout UI d’un modèle nocturne personnalisé (vent10m/s, zoomoptique3×), quantité1 réellement utilisée ; export avec nom accentué puis réimport restituant les quatre caractéristiques. Période d’autorisation excluant la mission : conflit explicite et bouton de lancement désactivé. Catalogue des imports historiques séparé des modèles par défaut locaux ; autorisation de brouillon remise à celle du fichier importé. Bilan restauré depuis Resources affichant les effectifs réellement placés.

## Rectification 3 — 14 octobre 2026

127 tests réussis ; TypeScript strict et build Vite réussis, `git diff --check` sans erreur. Nouveaux scénarios : surplus conservé en réserve et exportable ; placement/engagement avant et après lancement ; secteur/altitude personnalisés ; atterrissage puis restitution exacte du dispositif avec réserve et indisponibilité ; calcul/import au-delà de 32 drones et quantités supérieures à 100 ; arcs extérieurs découpés aux limites de l’opération, trous inclus.

Essais navigateur en production locale : 12 unités disponibles donnent 1 drone prêt et 11 réserves visibles dans la carte/flotte. Placement par clic, engagement et lancement de deux drones ; arrêt d’urgence, bouton de relance désactivé pendant l’atterrissage puis restauration des deux actifs et des dix réserves. Export du dispositif relancé réussi. Version finale rechargée : trois unités, engagement d’une réserve à 40 m et secteur 90°, troisième unité conservée en réserve. Aperçu de secteur avant validation vérifié. Les unités en réserve sont réparties dans la zone pour éviter l’empilement des marqueurs.

Satellite IGN : 20/20 tuiles chargées, matrice PM_0_19, aucun calque de cellules carrées. Fond plan conservé sous l’imagerie en chargement/erreur. L’indisponibilité du fournisseur reste signalée. Contours de portée extérieurs en pointillés et zone de travail intérieure découpée vérifiés visuellement. Logo fourni et icônes de flotte visibles. Paramètres absents de l’accueil/ressources/conduite, présents dans les outils du planificateur. Largeur 390 px : aucun débordement horizontal ; dialogue accessible. Champs dans les deux thèmes : fond rgb(237,237,237), texte rgb(17,17,17). La taille native de fenêtre a été rétablie après contrôle.

Captures locales hors dépôt : `rectification3-accueil.png` et `rectification3-flotte-satellite.png`. La suppression du calque de pertes remplace le rendu hachuré des validations historiques ; les métriques et cibles de réparation restent calculées.

Retour ressources → planificateur → édition du secteur → ressources : inventaire de trois unités conservé alors qu’une seule unité est estimée nécessaire. L’actualisation d’une pluie inconnue vers une absence de pluie conserve le dispositif, car les modèles compatibles restent les mêmes ; une nouvelle pluie incompatible continue d’invalider la proposition.

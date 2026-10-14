# Validation de l’itération core-application

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

# Intégration des développements parallèles

La fondation est préparée sur `setup/project-foundation`. Après revue/intégration, chaque développeur part de la même référence commune et travaille dans sa branche. Branches suggérées : `feature/frontend`, `feature/planning`, `feature/operations`. Pas de commit/push direct sur `main` ; intégrer par PR et éviter les modifications simultanées des contrats.

## Répartition

| Développeur / agent futur | Zone de travail |
| --- | --- |
| Frontend | `src/components/`, `src/pages/`, `src/app/`, `src/styles/` |
| Planning | `src/engines/planning/`, `tests/planning/` |
| Operations | `src/engines/operations/`, `tests/operations/` |

Partagés, **ne pas modifier sans coordination** : `src/types/`, `src/data/droneCatalog.ts`, `docs/API_CONTRACT.md`, `package.json`, `package-lock.json`. Coordonner également `src/services/`, l’exemple JSON, les configurations et le helper d’erreur moteur commun.

Les dossiers Controls/Panels/assets sont gardés avec `.gitkeep` parce qu’ils sont encore vides. Retirer ces marqueurs lorsque du contenu utile est ajouté. Ne pas créer des composants ou tests vides.

## Règles d’intégration

1. Lire ARCHITECTURE, REQUIREMENTS et API_CONTRACT avant développement.
2. Implémenter les signatures existantes ; ne pas importer React, Leaflet, DOM ou services réseau dans les moteurs.
3. Conserver les entrées immuables ; retourner les résultats via les contrats communs.
4. Traiter météo inconnue et portée non renseignée explicitement ; ne pas inventer de règle.
5. Si un contrat bloque, proposer sa modification aux deux autres développeurs avant de modifier code, documentation, JSON et tests ensemble.
6. Vérifier la nécessité d’une dépendance avant tout ajout. Utiliser `fetch()` natif ; pas de bibliothèque géométrique/état/routeur/UI/test lourde dans ce socle.
7. Exécuter `npm test`, `npm run build`, `git diff --check` avant PR, et tester l’UI si elle change.

Les tests `.mjs` utilisent `node:test` et importent les sources `.ts` grâce au support natif de Node >= 22.18. Aucun compilateur de tests séparé ni `@types/node` n’est requis. `npm run typecheck` vérifie les sources applicatives et la configuration Vite. Ajouter les nouveaux fichiers de tests à la commande `test` coordonnée dans package.json.

Les tests qui vérifient les erreurs des moteurs devront être remplacés par de vrais scénarios métier lors de leur implémentation. La fondation n’appelle pas ces moteurs dans l’UI. L’import/export est prêt au niveau service ; sa présentation appartient au frontend. Les transitions d’état et les animations simulées doivent être convenues avec operations.

## Fin d’un lot

PR avec problème résolu, comportement final, changements de contrats éventuels, commandes de validation et limites réelles. Ne pas inclure fichiers générés, secrets, dépendances non justifiées ou fonctionnalités d’un autre lot. La branche de fondation s’arrête avant ces trois développements.

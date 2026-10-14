# Intégration

La fondation `b04003e` a été intégrée à main via `8e51c6c`. L’itération complète est sur `feature/core-application`. Ne pas pousser/fusionner automatiquement ; revue humaine du prototype avant intégration.

## Responsabilités futures

| Lot | Dossiers |
| --- | --- |
| Frontend | `src/app`, `src/pages`, `src/components`, `src/styles` |
| Géométrie/planning | `src/engines/geometry`, `src/engines/planning`, `tests/geometry`, `tests/planning` |
| Conduite | `src/engines/operations`, `tests/operations` |
| Services/contrats partagés | `src/services`, `src/types`, `src/data`, documentation et tests transversaux |

À coordonner : `src/types`, catalogue, API_CONTRACT, package.json/lockfile, services et format d’exemple. Cette itération avait une autorisation explicite pour toute l’application ; les évolutions futures doivent rester convenues entre lots.

Aucun import React/Leaflet/DOM/réseau dans engines. Les types partagés utilisent import type, les imports runtime TypeScript des moteurs portent `.ts` pour les tests Node natifs. Pas de nouvelle dépendance sans besoin justifié. Les tests en `.mjs` utilisent node:test ; `npm test` prend les fichiers `tests/*.test.mjs` et `tests/*/*.test.mjs`.

Après chaque lot : npm test, npm run build (incluant typecheck), git diff --check et test navigateur si UI modifiée. Les requêtes météo des tests sont injectées/mockées, aucune dépendance au réseau réel. Les tests métier complets passent via contrats et sérialisation ; les tests manuels Leaflet et confirmations sont tracés dans VALIDATION.

Les anciens tests de placeholders ont été remplacés par des scénarios métier. L’ancien helper EngineNotImplementedError et les .gitkeep des dossiers UI maintenant occupés ont été retirés. `public/assets` reste réservé et vide.

L’app se sert via Vite en HTTP, jamais par ouverture directe d’index.html. Exporter les missions avant rechargement ; le contexte est seulement en mémoire. Ne pas committer dist/node_modules/exports de validation/secrets. Pour une évolution incompatible du schéma, coordonner version et migration.

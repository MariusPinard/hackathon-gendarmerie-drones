# Missions JSON 1.0

Les missions exportées restent au format `schemaVersion: "1.0"`. L'import accepte les anciennes missions, y compris `weather.dayNight: "unknown"`, une séparation de 10 m et l'absence des champs ajoutés ci-dessous. Les extensions JSON sûres sont conservées lors de l'import/export ; les données d'une ancienne mission ne sont pas réécrites silencieusement.

## Champs facultatifs ajoutés

| Chemin | Valeur | Compatibilité |
| --- | --- | --- |
| `droneCatalog` | Tableau de 1 à 20 modèles, avec identifiants uniques. | Sans ce champ, les trois modèles intégrés sont utilisés. Avec ce champ, le catalogue complet de la mission est portable. |
| `constraints.capabilityId` | `mixed`, `tp1-in-sight`, `tp1-out-of-sight` ou `tp2-out-of-sight`. | Sans ce champ, l'application peut inférer le scénario historique des drones. |
| `constraints.maximumOverlapPercent` | Pourcentage fini entre 0 et 100. | Sans ce champ, les paramètres par défaut du planificateur s'appliquent. |
| `constraints.authorization` | Référence déclarée, plafond de drones et période autorisée. | Sans ce champ, aucun plafond ni période liés à cette déclaration ne sont appliqués. |
| `drones[].coverage.clipPolygon` | Géométrie Polygon strictement identique à `operationZone.geometry`. | Sans ce champ, la couverture historique conserve sa forme. Avec ce champ, son intersection avec la zone d'opération définit la zone de travail. |

Les cartes `availableResources.dronesByModel` et `estimate.dronesByModel` (si l'estimation existe) contiennent exactement une entrée par identifiant de `droneCatalog`, ou du catalogue intégré s'il est absent. Chaque quantité est un entier entre 0 et 100. Les instances de drone référencent un modèle du catalogue et un télépilote existant.

Chaque modèle comprend `id`, `name`, `incompatibleWithRain` et de un à trois scénarios `capabilities`. Les champs supplémentaires `nightCapable`, `windResistanceMetersPerSecond`, `zoom`, `specificationSource`, `manufacturerRainProtection` sont facultatifs pour la compatibilité historique. Les sources constructeur utilisent une URL HTTPS absolue sans identifiants de connexion ; les textes sont bornés, la tenue au vent est entre 0 et 50 m/s. Les identifiants sont composés de lettres minuscules, chiffres et tirets, avec une longueur de 1 à 80 caractères.

Les scénarios sont TP1 en vue (500 m), TP1 hors vue (1 000 m) et TP2 hors vue (2 000 m), selon les paramètres demandés pour le hackathon, indépendamment des portées radio constructeur. Ils sont uniques par modèle ; les plafonds rural et urbain sont positifs et ne dépassent pas 120 m. La compatibilité pluie/nuit relève de la politique de simulation expliquée dans [DRONE_SPECS.md](DRONE_SPECS.md).

Un ancien catalogue embarqué dont la portée TP1 en vue est `null` reste importable et conserve cette valeur ; une portée non renseignée ne permet pas de sélectionner ce scénario pour un nouveau calcul. Une mission sans catalogue embarqué utilise le catalogue courant avec la portée TP1 en vue de 500 m.

## Autorisation déclarée facultative

`constraints.authorization` contient quatre champs requis lorsqu'il est présent : `reference` (texte non vide, maximum 120 caractères), `maximumDrones` (entier de 0 à 32), `startAt` et `endAt` (instants ISO 8601 avec fuseau explicite). Le début ne peut pas suivre la fin, en comparant les instants UTC ; une période ponctuelle avec début égal à la fin est acceptée.

Ce champ transporte une déclaration saisie par l'utilisateur. La validation JSON contrôle sa structure et ses bornes ; elle ne vérifie pas l'existence de l'arrêté ni sa validité juridique. Les contraintes opérationnelles de plafond et de période sont évaluées par le moteur. Elles restent exportées avec la mission, mais ne sont pas enregistrées parmi les préférences par défaut du navigateur.

## Validation et fichiers

La limite d'import est de 2 Mo. Les tableaux de polygones, modèles, télépilotes et drones sont bornés. Les dates comportent un fuseau explicite et doivent correspondre à un jour du calendrier. Les coordonnées, anneaux fermés, références et valeurs numériques sont validés. Les clés `__proto__`, `constructor`, `prototype`, les objets avec un prototype personnalisé, les structures cycliques et les extensions trop profondes sont refusés.

Le nom choisi lors de l'export est un nom de fichier, jamais un chemin. L'application conserve les accents et caractères Unicode, neutralise les séparateurs et caractères de contrôle, ajoute `.json` et borne le résultat à 240 octets UTF-8. La mission sérialisée reste indépendante de ce nom.

## Préférences locales

Les paramètres du planificateur utilisent la clé locale `drone-planner-preferences-v1`. La séparation verticale et le pourcentage de chevauchement ainsi que les modèles personnalisés sont enregistrés. Les modèles DJI intégrés sont rechargés depuis le catalogue courant pour bénéficier des corrections constructeur. Une préférence corrompue ou un stockage indisponible retourne les valeurs par défaut sans interrompre l'application. Les préférences n'assurent pas à elles seules la sauvegarde d'une mission en cours.

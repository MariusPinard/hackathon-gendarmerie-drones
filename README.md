# Division Drone — Gendarmerie

Application web du hackathon Gendarmerie pour préparer et conduire une mission multi-drones **simulée**. Elle permet de dessiner une zone d’opération, estimer les moyens nécessaires, adapter les ressources disponibles et suivre la couverture sur une carte.

Le projet est un frontend autonome. Il ne commande aucun drone réel, n’intègre aucun SDK constructeur, aucune authentification et aucun backend métier. Le calcul d’occupation du terrain en direct repose sur un service externe facultatif. L’interface est destinée à un usage sur ordinateur.

## Installation

Prérequis : **Node.js 22.18 ou plus récent**, npm et Git. Les tests importent directement les sources TypeScript avec Node.

```sh
git clone https://github.com/MariusPinard/hackathon-gendarmerie-drones.git
cd hackathon-gendarmerie-drones
npm ci
npm run dev
```

Ouvrir l’adresse HTTP indiquée par Vite, généralement `http://localhost:5173`. Si le port est occupé, Vite peut en sélectionner un autre. Ne pas ouvrir `index.html` avec `file://` : les modules TypeScript doivent être servis par Vite.

### Commandes disponibles

| Commande | Usage |
| --- | --- |
| `npm ci` | Installer les dépendances à partir du lockfile |
| `npm run dev` | Démarrer le serveur de développement |
| `npm run typecheck` | Vérifier les types TypeScript |
| `npm test` | Exécuter les tests natifs `node:test` |
| `npm run build` | Vérifier les types puis générer le site statique dans `dist/` |
| `npm run preview` | Servir localement le dernier build pour vérification |
| `git diff --check` | Détecter les erreurs d’espacement dans les modifications |

Pour vérifier une version de production :

```sh
npm run build
npm run preview
```

Le serveur de prévisualisation utilise généralement le port 4173, sauf configuration ou occupation du port. Il sert le contenu de `dist/` ; il faut refaire le build après une modification des sources.

## Parcours utilisateur

### 1. Accueil

L’accueil propose deux entrées : **Préparer une mission** et **Reprendre une mission**. Les logos Gendarmerie et Division Drone sont intégrés sur fond transparent. Un thème clair et un thème sombre sont disponibles.

### 2. Planification

Le planificateur affiche une carte plein écran, avec des panneaux coulissants. La localisation initiale est **Mirepoix**. La recherche accepte une adresse française ou des coordonnées WGS84, dans l’ordre **longitude, latitude**.

Dans **Mission**, renseigner le nom, la date et l’heure locales, l’environnement rural ou urbain et le scénario de télépilotage. La date est saisie au format français, avec une heure sur 24 h ; elle est enregistrée en ISO avec conversion du fuseau local.

Dans **Zones**, dessiner la zone d’opération, puis éventuellement des zones prioritaires :

- Cliquer pour poser les sommets.
- Recliquer le premier sommet ou choisir **Terminer** pour fermer le polygone.
- **Terminer** relie automatiquement le dernier sommet au premier.
- **Annuler** abandonne le dessin en cours.
- Le dessin est validé avant enregistrement ; les autres actions sont bloquées pendant sa création.

La météo est demandée automatiquement pour le lieu et le créneau choisis. Le calcul Jour/Nuit reste disponible même lorsque la prévision ne l’est pas. Une prévision absente reste inconnue et n’est pas assimilée à un temps sec.

**Calculer l’estimation** propose les positions, les modèles et les télépilotes, puis affiche les métriques et les avertissements. Les secteurs proposés peuvent être ajustés en cap, angle et rayon avant de préparer l’opération.

### 3. Ressources et catalogue « Drone »

Dans **Moyens**, comparer les quantités estimées aux quantités réellement disponibles, modifier les effectifs et recalculer le dispositif. Une couverture partielle est possible si les ressources ou les contraintes ne permettent pas de couvrir toute la zone.

Le bouton **Drone**, placé à côté de **Moyens** dans les commandes de la carte, ouvre le catalogue de la mission. Il affiche tous les modèles enregistrés, même ceux dont la quantité disponible est nulle, avec leurs valeurs :

| Caractéristique | Affichage |
| --- | --- |
| Vol de nuit | Oui / Non |
| Vol sous la pluie | Oui / Non |
| Résistance au vent | Valeur en m/s, ou « Non renseignée » |
| Zoom | Valeur déclarée, ou « Non renseigné » |

Un modèle ajouté via **Ajouter un modèle de drone** dans Moyens apparaît immédiatement dans ce catalogue. Son ajout fournit une unité disponible dans la mission. Les modèles ajoutés dans **Paramètres → Ajouter un drone** sont enregistrés dans le catalogue par défaut et proposés aux nouvelles missions après sauvegarde des paramètres.

Les capacités déclarées du catalogue sont distinctes de la règle opérationnelle : **la nuit ou sous la pluie, seuls les Matrice 4T sont retenus**, même si un modèle personnalisé déclare ces capacités. Les caractéristiques constructeur et leurs sources peuvent être consultées dans les fiches de Moyens et dans [DRONE_SPECS.md](docs/DRONE_SPECS.md).

Après recalcul, **Dispositif** ouvre son propre panneau depuis la carte : couverture, avertissements, conflits et lancement. Le lancement est bloqué si des conflits subsistent ou si aucun drone n’est prêt.

### 4. Flotte, réserve et placement

La flotte affiche un drone par ligne, son modèle, son état et sa hauteur simulée au-dessus du sol. Elle représente les unités individuelles ; le panneau **Drone** représente les modèles du catalogue. Aucune batterie ni télémétrie réelle n’est affichée.

Les unités disponibles au-delà du besoin calculé restent sur la carte et dans la flotte **en réserve**. Elles ne contribuent pas à la couverture et ne sont pas engagées automatiquement.

Pour utiliser une réserve : sélectionner le drone, le placer par clic ou glisser-déposer, régler son secteur et l’engager. Lors du déplacement d’une réserve, son télépilote est également repositionné. Lors du déplacement d’un drone engagé, le télépilote reste distinct et la portée est contrôlée.

**Mettre le drone en réserve** retire sa couverture tout en conservant la possibilité de le déplacer et de le redéployer. Un drone indisponible peut être **remis en réserve** avant d’être placé. Ces actions sont disponibles dans les ressources après recalcul et pendant une opération active.

### 5. Conduite de l’opération

Après lancement, les drones prêts deviennent actifs ; les réserves restent en réserve. La sélection d’un drone permet de modifier son altitude, son cap et son angle de travail. L’aperçu du secteur et les métriques se mettent à jour avant validation. Les déplacements par clic ou glisser-déposer recalculent la couverture et les conflits.

Les contrôles portent sur les plafonds, la séparation verticale, le chevauchement autorisé, la portée, les qualifications, les ressources, la pluie, la nuit et les éventuelles limites d’autorisation saisies.

La réorganisation locale facultative recherche le déplacement d’au plus un drone actif, sans augmenter le nombre de conflits. Elle ne recalcule pas librement l’ensemble du dispositif.

**Fin de mission** demande confirmation et simule le retour des drones vers leurs télépilotes. **Arrêt d’urgence** demande confirmation et simule l’atterrissage sur place. Les animations durent quatre secondes. Les drones indisponibles restent immobiles.

Après l’atterrissage d’urgence, **Relancer l’opération** restaure les positions, altitudes, secteurs et états précédents. Cet instantané est inclus dans les exports récents ; un ancien fichier d’urgence sans instantané nécessite un nouveau dispositif.

## Fonds cartographiques et légende

| Mode | Données et comportement |
| --- | --- |
| Plan | Tuiles OpenStreetMap avec attribution |
| Satellite | Orthophotos IGN en France ; un fond Plan reste présent sous les images en chargement ou en erreur |
| Occupation | Analyse du terrain et indications de possibilités de décollage ; carte précalculée ou service externe facultatif |

Sur Plan et Satellite, les zones de travail sont découpées à la zone d’opération. Les arcs de portée en pointillés ambre apparaissent uniquement à l’extérieur de l’opération et dans l’angle de travail du drone. Les parties couvertes par plusieurs drones engagés sont jaunes ; les autres parties conservent leur couleur.

Les petites zones rouges non couvertes sont représentées par des **points**, sans cellules hachurées. Leur affichage utilise quatre sous-échantillons par cellule de la grille de calcul, sans modifier les métriques. Le mode Occupation utilise sa propre légende et masque les points rouges et le surlignage jaune pour garder les catégories du terrain lisibles.

## Algorithme de répartition

Le moteur utilise une **heuristique gloutonne déterministe de couverture**, puis retire les drones redondants. Il ne garantit pas une optimisation globale ni le nombre minimal de drones.

1. Filtrer les modèles compatibles avec la météo et le scénario, et contrôler les ressources et contraintes.
2. Échantillonner le polygone sur une grille de points et créer une grille de positions candidates.
3. Pour chaque position et scénario, comparer des caps, des rayons et des angles : disque complet si autorisé, secteur adapté aux points restants, puis angles plus étroits.
4. Noter chaque proposition selon les nouveaux points couverts : **+1** pour un point ordinaire, **+4** pour un point prioritaire. Un point déjà couvert coûte **0,4**, ou **0,02** en priorité. Rejeter tout dépassement du chevauchement maximal.
5. Ajouter la meilleure proposition et recommencer jusqu’à atteindre **98 % de couverture totale et 99 % des priorités**, ou jusqu’à épuisement des moyens ou des placements utiles admissibles. À gain équivalent, préférer TP1 à TP2.
6. Retirer les unités redondantes sans perdre les objectifs atteints ; pour un dispositif partiel, préserver la couverture obtenue.
7. Réattribuer les modèles standard interchangeables pour équilibrer Matrice 4T, Mavic et Mini selon les stocks et les capacités, sans changer les positions ou la couverture. Les tiers sont approchés avec des effectifs entiers ; la nuit ou sous la pluie, l’effectif est exclusivement en Matrice 4T.
8. Attribuer les altitudes aux drones qui partagent une surface, sous les plafonds et avec la séparation minimale. La recherche utilise un graphe de chevauchement et une recherche DSatur bornée ; un échec produit des avertissements et des conflits à résoudre.

Les pourcentages sont estimés à partir de points échantillonnés. La grille métrique utilise par défaut 44 divisions sur le plus grand côté ; les intersections utilisées pour les contours et les conflits géométriques sont calculées sur des polygones représentant les disques ou secteurs.

### Scénarios de vol du prototype

| Scénario | Portée maximale | Plafond rural | Plafond urbain |
| --- | --- | --- | --- |
| TP1 en vue | 500 m | 120 m | 120 m |
| TP1 hors vue | 1 000 m | 50 m | 80 m |
| TP2 hors vue | 2 000 m | 120 m | 120 m |

Ces valeurs sont les règles du prototype, pas une interprétation réglementaire. En mode mixte, le rayon est adapté au besoin ; un TP2 n’est pas retenu pour un rayon inférieur ou égal à 1 km. Un scénario unique conserve son rayon de référence. Les altitudes proposées commencent à 10 m ; la séparation par défaut est de 30 m et le chevauchement maximal par défaut de 20 %.

Voir [ALGORITHMES.md](docs/ALGORITHMES.md) pour les détails.

## Paramètres et persistance

**Paramètres** est accessible uniquement depuis le planificateur. Il permet de mémoriser sur cet appareil le catalogue par défaut, la séparation verticale minimale et le chevauchement maximal.

Une autorisation facultative peut déclarer une référence, un effectif maximal et une période. Le simulateur contrôle ces valeurs sans vérifier la validité juridique d’un arrêté. Les valeurs d’autorisation ne sont pas conservées comme paramètres par défaut des missions suivantes.

Les préférences et le thème sont persistés localement. **La mission courante reste en mémoire** : un rechargement ne la sauvegarde pas. Utiliser l’export JSON pour conserver les positions et les résultats.

## Import et export JSON

Depuis l’accueil, importer un fichier ou coller un JSON **schemaVersion `1.0`**. Une mission fictive du secteur de Rennes est disponible pour une démonstration immédiate. L’import passe par les ressources afin de vérifier ou recalculer les moyens avant lancement ; il ne reprend pas une animation interrompue.

Le bouton **Export JSON** est directement visible sur les cartes de planification, ressources et conduite. Une boîte de dialogue permet de choisir le nom du fichier. Le nom est nettoyé pour empêcher une interprétation comme chemin de fichier.

L’export contient notamment : métadonnées, date ISO, localisation, opération et priorités, météo, contraintes, estimation, effectifs disponibles, télépilotes, drones, état de mission et, si présents, catalogue personnalisé et instantané de récupération d’urgence. Les champs supplémentaires compatibles sont conservés après validation.

L’import contrôle les types, les dates, les coordonnées, la géométrie, les identifiants, les références, les effectifs et le catalogue. Les entrées malformées, trop volumineuses ou dangereuses sont rejetées avec un message.

- Exemple versionné : [src/data/exampleMission.json](src/data/exampleMission.json).
- Format détaillé : [FORMAT_JSON.md](docs/FORMAT_JSON.md).
- Contrats des moteurs : [API_CONTRACT.md](docs/API_CONTRACT.md).

## Services externes et configuration

L’application fonctionne sans clé API pour le plan, le satellite, le géocodage et la météo. Leur disponibilité dépend du réseau et des services. Les tuiles portent les attributions correspondantes.

| Service | Usage et données transmises |
| --- | --- |
| OpenStreetMap | Tuiles correspondant à la vue cartographique |
| IGN orthophotos | Imagerie satellite correspondant à la vue |
| IGN / BAN | Recherche d’adresse française ; le texte saisi est envoyé au géocodeur |
| Open-Meteo | Prévision au lieu et au créneau choisis |
| Service d’occupation facultatif | Emprise de la tuile demandée pour analyse du terrain |

La recherche d’adresses attend 600 ms après la saisie, annule les recherches obsolètes et utilise un cache de session. Géocodage et météo disposent d’un délai maximal de sept secondes. Une erreur météo conserve un état inconnu. Jour/Nuit est calculé localement au seuil solaire de −6°.

Les fichiers de mission ne sont pas transmis à un backend métier. Les requêtes cartographiques, d’adresse et de météo peuvent en revanche révéler le secteur consulté aux services correspondants.

### Occupation du terrain — facultative

Le dépôt fournit immédiatement l’analyse précalculée de **Mirepoix, INSEE 09194**, dans `public/occupancy/commune-09194.json`.

Pour une analyse en direct dans d’autres secteurs, démarrer séparément un service compatible avec **`POST /api/v1/occupancy/tile`**. Ce backend n’est pas inclus dans ce dépôt. En développement, l’URL par défaut est `http://127.0.0.1:8000`. Pour une autre URL, définir dans un fichier `.env.local` :

```dotenv
VITE_OCCUPANCY_API_URL=http://127.0.0.1:8000
```

Redémarrer Vite après modification. Pour un build statique, définir cette variable avant `npm run build`. Sans URL configurée en production, seules les analyses précalculées sont disponibles. Le service doit accepter les requêtes provenant de l’origine du frontend.

L’utilisateur déclenche l’analyse avec **Lancer le calcul**. Chaque lancement est limité à 24 tuiles, avec deux requêtes simultanées et un cache de session. Un dézoom très large n’entraîne pas une énumération illimitée. Les catégories et leurs causes sont consultables dans la légende et les détails au clic.

L’analyse indique notamment les obstacles, les pentes, l’accès et la portée. Elle aide au choix d’un emplacement ; elle ne constitue pas une autorisation de décollage. L’intégration reprend uniquement la partie occupancy map de `feature/occupancy-map-mode`, sans son moteur de recherche d’emplacements ni une fusion de la branche complète.

## Architecture

**React 19, TypeScript strict, Vite et Leaflet**. L’application utilise directement Leaflet, sans routeur, wrapper de carte, bibliothèque de dessin, moteur d’état supplémentaire ni dépendance de test dédiée.

| Répertoire | Responsabilité |
| --- | --- |
| `src/app` | Contexte de mission, préférences et horloge de simulation |
| `src/pages` | Accueil, import, planification, ressources et conduite |
| `src/components` | Carte, panneaux, flotte, formulaires et dialogues |
| `src/styles` | Thèmes et mise en page |
| `src/types` | Contrats des missions, drones, géométries, météo et résultats |
| `src/engines/geometry` | Projection locale, validation, clipping, échantillonnage et métriques |
| `src/engines/planning` | Estimation, placement, modèles et altitudes |
| `src/engines/operations` | Conflits, recalcul ciblé et transitions simulées |
| `src/services` | Météo, géocodage, occupation, JSON, préférences et conversion mission/plan |
| `src/data` | Catalogue standard et mission fictive |
| `public/image` | Logos transparents et icônes |
| `public/occupancy` | Analyse précalculée du terrain |
| `tests` | Tests `.mjs` important directement les sources `.ts` |
| `docs` | Documentation fonctionnelle et technique complémentaire |

Les moteurs sont distincts du rendu React. Le catalogue de la mission est utilisé pour les capacités et contrôles des modèles personnalisés. Voir [ARCHITECTURE.md](docs/ARCHITECTURE.md) et [INTEGRATION.md](docs/INTEGRATION.md).

## Tests et vérification

```sh
npm test
npm run build
git diff --check
```

Les tests couvrent la géométrie et le dessin, la couverture et ses intersections, les modèles et la météo, l’équilibrage des effectifs, les contraintes TP1/TP2, les altitudes, les réserves et le placement, les conflits, l’import/export, les services externes et les transitions d’urgence/retour. Un parcours complet vérifie l’estimation, le manque de ressources, le lancement, les modifications et la sauvegarde.

Pour la validation visuelle sur ordinateur, vérifier le dessin, les panneaux, le catalogue Drone après ajout d’un modèle, le déplacement d’une réserve, l’aperçu des secteurs, les trois fonds cartographiques et l’export nommé. Voir [VALIDATION.md](docs/VALIDATION.md).

## Déploiement statique

Construire avec `npm run build`, puis publier **tout le contenu de `dist/`** sur un serveur HTTP(S), avec les fichiers `image/` et `occupancy/` inclus. La configuration actuelle utilise des chemins d’assets absolus : servir le site à la racine du domaine ou de l’origine.

Aucune API métier n’est requise. L’occupation en direct nécessite son propre service si elle est activée. Les variables préfixées `VITE_` sont intégrées au frontend et ne doivent pas contenir de secrets. Ne pas versionner `node_modules/`, `dist/`, `.env*` ou des secrets. `npm run preview` sert à vérifier le build localement.

## Limites connues

- Projection locale ; zone limitée à **50 km de côté**, hors régions polaires et franchissement de l’antiméridien.
- Jusqu’à **20 zones prioritaires**, **300 sommets distincts par anneau** et fichiers JSON de **2 Mo maximum**.
- Les formulaires permettent l’ajout de modèles jusqu’à 20 modèles au total ; le catalogue importé ou fourni au moteur est validé séparément.
- Aucune limite fixe de 32 drones. L’effectif dépend des stocks, des placements utiles, de la grille et des éventuelles limites d’autorisation déclarées. Le coût du calcul augmente avec la taille du dispositif.
- Les pourcentages et les petites lacunes de couverture restent approximatifs, notamment pour des secteurs très fins.
- Rayon de travail simplifié, sans modèle de champ de vision ou de capteur constructeur.
- Drone et télépilote sont initialement au même emplacement ; aucune recherche automatique d’accès terrain n’est intégrée au placement.
- La résistance au vent et le zoom sont des valeurs du catalogue : aucune prévision de vent ni optimisation selon ces caractéristiques n’est appliquée.
- Pas de relief dans le moteur de couverture, de Street View, de moteur physique, de télémétrie, de communication radio réelle ou de contrôle aéronautique.
- Une configuration d’altitudes impossible peut être proposée avec des avertissements ; les conflits doivent être résolus avant lancement.
- La règle de simulation autorisant le Matrice 4T sous la pluie ne constitue pas une certification constructeur : sa fiche précise qu’il n’est pas étanche.
- La disponibilité des tuiles, du géocodage, de la météo et de l’occupation en direct n’est pas garantie. Sans fond cartographique, les objets de mission restent affichables.
- Pas de sauvegarde serveur ou automatique de la mission : exporter avant de recharger ou quitter.

## Documentation complémentaire

- [DEMO.md](docs/DEMO.md) — parcours de démonstration.
- [REQUIREMENTS.md](docs/REQUIREMENTS.md) — exigences fonctionnelles.
- [ALGORITHMES.md](docs/ALGORITHMES.md) — calculs et choix heuristiques.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — organisation de l’application.
- [API_CONTRACT.md](docs/API_CONTRACT.md) — contrats des moteurs.
- [FORMAT_JSON.md](docs/FORMAT_JSON.md) — sauvegardes et compatibilité.
- [INTEGRATION.md](docs/INTEGRATION.md) — intégration des composants.
- [VALIDATION.md](docs/VALIDATION.md) — contrôles fonctionnels.
- [DRONE_SPECS.md](docs/DRONE_SPECS.md) — caractéristiques et sources constructeur.
- [LOGOS.md](docs/LOGOS.md) — sources et préparation des logos.

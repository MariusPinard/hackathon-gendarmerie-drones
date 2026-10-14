# Catalogue des drones et météo

Caractéristiques constructeur vérifiées le 14 octobre 2026. Les portées TP1/TP2 et les plafonds du scénario restent des paramètres du simulateur, indépendants des performances radio annoncées par DJI.

Le scénario du hackathon fixe TP1 en vue à 500 m, TP1 hors vue à 1 000 m et TP2 hors vue à 2 000 m. Ces valeurs proviennent de la demande utilisateur et ne représentent pas des spécifications radio DJI. Les catalogues JSON historiques avec une portée TP1 en vue non renseignée (`null`) restent lisibles sans modifier la valeur sauvegardée.

## Caractéristiques constructeur

| Modèle affiché | Résistance au vent annoncée | Zoom annoncé | Imagerie et pluie |
| --- | --- | --- | --- |
| DJI Matrice 4T | 12 m/s, au décollage et à l'atterrissage | Téléobjectif : 16× numérique, 112× hybride ; thermique : 28× numérique | Thermique et éclairage proche infrarouge pour l'observation nocturne. **Non étanche** : DJI demande de retourner et atterrir si la pluie commence. |
| DJI Mavic 3 Enterprise (3E) | 12 m/s, au décollage et à l'atterrissage | Téléobjectif : 8× numérique, 56× hybride | Caméra visible, sans la caméra thermique du 3T. DJI demande de ne pas voler sous la pluie. |
| DJI Mini 5 Pro | 12 m/s | Photo 12 Mpx et 4K : 1–3× numérique ; FHD : 1–4× numérique | Caméra visible et détection d'obstacles en faible lumière. **Non étanche** : DJI demande de retourner et atterrir si la pluie commence. |

Sources officielles : [Matrice 4 — caractéristiques](https://enterprise.dji.com/matrice-4-series/specs) et [FAQ, observation nocturne et étanchéité](https://enterprise.dji.com/matrice-4-series/faq) ; [Mavic 3 Enterprise — caractéristiques](https://enterprise.dji.com/mavic-3-enterprise/specs) et [consignes de sécurité](https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20250916/DJI_Mavic_3_Enterprise_Series_Disclaimer_%26_Safety_Guidelines.pdf) ; [Mini 5 Pro — caractéristiques](https://www.dji.com/mini-5-pro/specs) et [FAQ, étanchéité](https://www.dji.com/mini-5-pro/faq).

Le libellé historique « DJI Mini 5 » désigne désormais le modèle constructeur documenté **DJI Mini 5 Pro**. L'identifiant JSON `dji-mini-5` est conservé pour relire les missions existantes. Les différents types de zoom sont explicités pour éviter de présenter un zoom numérique ou hybride comme un zoom optique.

## Politique de simulation demandée

Dans cette application, le Matrice 4T est le seul modèle par défaut accepté **de nuit ou sous la pluie** ; les Mavic 3 Enterprise et Mini 5 Pro sont exclus dans ces conditions. Cela correspond au choix du scénario demandé par l'utilisateur.

**La compatibilité pluie du Matrice 4T dans le simulateur ne constitue pas une certification constructeur. Elle diffère de la consigne DJI : le Matrice 4T n'est pas étanche.** `incompatibleWithRain` et `nightCapable` pilotent l'éligibilité dans la simulation ; `manufacturerRainProtection` présente séparément la consigne réelle. Les aptitudes renseignées pour un modèle personnalisé sont déclarées par l'utilisateur.

La résistance au vent et le zoom sont des informations du catalogue ; ils ne produisent pas une autorisation de vol et ne remplacent pas une prévision de vent. Aucun blocage « vent » n'est simulé à partir de ces seules fiches.

## Jour/nuit calculé localement

Le statut dépend du lieu et de l'instant ISO 8601 avec fuseau explicite. La nuit commence lorsque le centre du soleil atteint une élévation de −6°, conformément à la définition du crépuscule civil dans [SERA, article 2(97)](https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-standardised-european?erules-id=ERULES-1963177438-9812).

`src/services/solar.ts` calcule l'élévation géométrique, sans correction de réfraction, avec les équations NOAA/Meeus en siècles juliens : [méthode et limites du calcul NOAA](https://gml.noaa.gov/grad/solcalc/calcdetails.html), [formules publiées dans le calculateur](https://gml.noaa.gov/grad/solcalc/main.js). Le calcul reste disponible pour une date passée ou hors de l'horizon météo et sans réseau ; les coordonnées ou dates invalides donnent `unknown`. Il respecte les saisons, les hémisphères, les périodes polaires et les offsets horaires ; il ne repose pas sur des heures de lever ou coucher fixes.

Les tests vérifient également l'exemple numérique indépendant du [rapport NREL SPA, tableau A5.1](https://www.nlr.gov/docs/fy08osti/34302.pdf). L'implémentation utilise les équations NOAA, et n'embarque pas le logiciel SPA. Le calcul astronomique est une approximation de planification : relief et masques locaux ne sont pas modélisés.

La pluie provient séparément d'[Open-Meteo](https://open-meteo.com/en/docs), selon la somme `rain + showers` de l'heure contenant l'opération. Une erreur, une annulation ou une date hors des 16 jours de prévision laisse `rainDetected: null` ; elle ne devient jamais « beau temps ». Le calcul jour/nuit reste indépendant de cette disponibilité.

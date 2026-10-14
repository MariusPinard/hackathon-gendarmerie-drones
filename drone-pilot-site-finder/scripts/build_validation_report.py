"""Render the recorded real-data suite as a French, reviewable Markdown report."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "frontend/public/validation/v0.4"
OBSERVATIONS = {
    "urban": "Le moteur expose des portions mesurées de toits et de petites surfaces au sol. "
    "La capture montre un environnement très végétalisé dans la cour. "
    "Risque de faux positifs au sol sous la canopée : aucun examen "
    "terrain ne confirme leur dégagement. Les équipements du toit restent à inspecter.",
    "residential": "Des portions de toitures d’immeubles sont repérées, avec pente et hauteur. "
    "La fragmentation reflète les exclusions et le budget d’échantillonnage, pas "
    "une garantie d’espace utilisable. Les toitures d’immeubles sont visibles sur "
    "l’image ; escaliers, portance et garde-corps ne sont pas identifiés.",
    "rural": "Ce cas est un bourg en contexte rural, et non une preuve de fonctionnement dans "
    "tous les champs agricoles. Des espaces cartographiés au sol sont proposés. "
    "Le MNS LiDAR est absent : aucun toit n’est inventé ; le terrain utilise le repli "
    "RGE ALTI. Sans MNS, arbres/bâtiments non cartographiés restent des lacunes de visibilité.",
    "forest": "Aucune surface ouverte cartographiée suffisante n’est proposée dans ce couvert "
    "forestier continu. La capture est cohérente avec cette retenue, mais ne prouve "
    "pas l’absence de clairières : le moteur ne crée pas de zones à partir d’une "
    "image seule. Ce cas ne valide pas le rappel de la détection forestière.",
    "relief": "Aucun candidat sur ce versant forestier de Chamonix. L’absence de résultat "
    "dépend aussi du manque de surfaces positives cartographiées et de la disponibilité "
    "d’OSM ; elle ne démontre pas à elle seule que le filtre de pente est performant "
    "sur toutes les montagnes. Les tests automatisés vérifient séparément les pentes.",
    "mixed": "Les terrains de sport IGN et les toitures sont tous deux visibles. Les grandes "
    "surfaces au sol obtiennent des scores élevés, mais disponibilité, fréquentation "
    "et permission ne sont pas évaluées. Une panne OSM n’invalide pas les données IGN "
    "exploitables ; elle doit accroître l’incertitude et limiter toute conclusion.",
}


def french(value):
    return f"{value:,.2f}".replace(",", " ").replace(".", ",")


def build():
    run = json.loads((DATA / "run.json").read_text(encoding="utf-8"))
    cases = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))
    by_id = {case["id"]: case for case in cases}
    lines = [
        "# V0.4 — Rapport des six environnements réels",
        "",
        "**État : développement terminé, validation humaine en attente.** "
        "Publication autorisée sur une branche dédiée ; aucune intégration au hackathon. "
        "Les essais techniques et les "
        "captures ne constituent aucune validation de sécurité, d’accès ou d’autorisation.",
        "",
        f"Série enregistrée le `{run['recorded_at']}` (UTC), le 14 octobre 2026 en France. "
        "Chaque analyse a appelé le backend HTTP réel ; aucun fournisseur fictif ni "
        "substitution de données n’a été utilisé. Les réponses complètes conservent "
        "mesures, géométries, licences, attributions, dates disponibles et limites.",
        "",
        "## Examiner les résultats",
        "",
        "Double-cliquez sur `Visualiser-V0.4.cmd` à la racine du dépôt. Dans l’interface, "
        "ouvrez **Examiner les six environnements · V0.4**, choisissez le cas, puis "
        "**Afficher l’analyse enregistrée**. Le backend n’est pas nécessaire pour "
        "consulter ces captures. Le fond de carte exige une connexion. Cliquez sur "
        "un polygone ou une fiche, puis **Zoomer sur la zone** ; le toit a un bord pointillé, "
        "le sol un bord plein. La couleur représente un score indicatif, jamais une validation.",
        "",
        "**Préparer une nouvelle analyse** charge exactement le périmètre, les options et "
        "le nombre demandé du cas. Le bouton de recherche acquiert alors les données via "
        "le backend. La rétention/rejet ne vaut que pour l’inspection et figure dans l’export.",
        "",
        "## Synthèse de la série finale",
        "",
        "| Environnement | Sol | Toitures | Temps HTTP | État des données |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for case in run["cases"]:
        counts = case.get("counts", {})
        status = {
            "complete": "sources acquises",
            "partial": "données partielles",
            "no_candidates": "aucun candidat",
        }.get(case.get("status"), "erreur")
        lines.append(
            f"| {case['label']} | {counts.get('ground', '—')} | "
            f"{counts.get('rooftop', '—')} | {french(case['elapsed_seconds'])} s | {status} |"
        )
    lines += [
        "",
        "Les temps HTTP incluent transport et réponse. L’interface affiche le temps du "
        "moteur, légèrement inférieur. Les scores sol/toiture ont des profils distincts ; "
        "le classement alterne les types après classement au sein de chaque type. "
        "Ils ne sont ni des probabilités de sécurité, ni directement équivalents.",
        "",
        "## Protocole et sources",
        "",
        "Périmètre carré de 120 m de côté, extension de 150 m incluant l’intérieur, "
        "surface minimale 60 m², largeur 4 m, pente maximale au sol 12°, toiture 8°, "
        "recul du toit 3 m, grille régionale souhaitée 10 m et MNS local 3 m. "
        "Six candidats au maximum, douze portions de toit échantillonnées au maximum. "
        "L’altimétrie locale au sol est limitée à dix points par surface. Les requêtes "
        "sont séquentielles avec une pause ; les quotas publics restent variables.",
        "",
        "Sources : OSM via Overpass (ODbL), IGN BD TOPO/BD ORTHO et MNT/MNS LiDAR HD "
        "via Géoplateforme (Licence Ouverte 2.0), repli RGE ALTI au sol, Panoramax "
        "avec licence/auteur/date par image. Dates d’acquisition d’orthophoto/LiDAR "
        "non renseignées par ces réponses ; date de consultation ≠ date des données. "
        "[Détails des sources](data-sources.md).",
        "",
    ]
    for case in run["cases"]:
        key = case["id"]
        request = by_id[key]["request"]
        ring = request["operation_area"]["coordinates"][0][:-1]
        center = [sum(p[index] for p in ring) / len(ring) for index in [0, 1]]
        lines += [
            f"## {case['label']}",
            "",
            f"Centre du périmètre : {center[1]:.6f}, {center[0]:.6f} (latitude, longitude). "
            f"Temps HTTP : **{french(case['elapsed_seconds'])} s**. "
            f"[Réponse GeoJSON complète](../frontend/public/validation/v0.4/{key}.geojson).",
            "",
        ]
        if case.get("error"):
            lines += [f"Échec réel conservé : `{case['error']}`", ""]
            continue
        lines += [
            "| Zone | Type | Surface m² | Score /100 | Hauteur du toit m | Pente du toit ° |",
            "| --- | --- | ---: | ---: | ---: | ---: |",
        ]
        for index, zone in enumerate(case["zones"], 1):
            roof = zone.get("roof")
            lines.append(
                f"| {index:02d} · `{zone['id']}` | {'Toiture' if roof else 'Sol'} | "
                f"{french(zone['area_m2'])} | {french(zone['score'])} | "
                f"{french(roof['height_above_ground_m']) if roof else '—'} | "
                f"{french(roof['slope_deg']) if roof else '—'} |"
            )
        if not case["zones"]:
            lines.append(
                "| — | Aucun candidat avec les contraintes/données disponibles | — | — | — | — |"
            )
        lines += [
            "",
            "Acquisition : "
            + ", ".join(
                f"{s['name']} ({s['feature_count']} éléments)"
                for s in case["sources"]
                if s["status"] == "available"
            )
            + ".",
            "",
        ]
        gaps = [s for s in case["sources"] if s["status"] in {"partial", "unavailable"}]
        if gaps:
            lines += ["Limites de sources de cette analyse :", ""]
            lines += [f"- **{s['name']} — {s['status']}** : {s['detail']}" for s in gaps]
            lines.append("")
        else:
            lines += [
                "Aucune erreur d’acquisition signalée dans cette analyse. "
                "Cela ne prouve ni exhaustivité ni actualité.",
                "",
            ]
        diagnostics = case["diagnostics"]
        lines += [
            f"Portions de toit : {diagnostics.get('roof_buildings_sampled', 0)} échantillonnées "
            f"sur {diagnostics.get('roof_buildings_eligible', 0)} éligibles ; "
            f"{diagnostics.get('roof_without_surface_data', 0)} sans données suffisantes. "
            "Dans cette révision, les clés historiques `roof_buildings_*` comptent "
            "des portions présélectionnées et non des bâtiments uniques.",
            "",
            "Contrôles automatiques sur cette réponse : "
            + (
                "aucune incohérence détectée "
                "(schéma, géométrie, inclusion, somme des scores, accès toiture inconnu)."
                if not case["issues"]
                else "; ".join(case["issues"])
            ),
            "",
            "Observation visuelle / limite : " + OBSERVATIONS[key],
            "",
            f"![Carte réelle : {case['label']}](validation-v0.4/{key}.jpg)",
            "",
        ]
    lines += [
        "## Corrections et performances observées",
        "",
        "L’inspection initiale a révélé que le pas local des très grandes toitures "
        "pouvait atteindre 22,67 m. Les bâtiments sont désormais découpés en portions "
        "d’au plus 45 m de côté pour conserver le pas demandé de 3 m ; un budget réparti "
        "entre bâtiments limite la couverture. Les mesures portent sur la portion "
        "finale, après exclusions et filtre de largeur. Une source vectorielle "
        "indisponible maintient une incertitude élevée.",
        "",
        "Le profilage sur le **même jeu urbain acquis** a identifié le buffer global "
        "d’un réseau routier fortement fragmenté. Le remplacer par l’union des buffers "
        "de voies a ramené la génération au sol d’environ **20,355 s à 0,369 s**, "
        "avec trois surfaces dans les deux cas. Ce chiffre concerne cette étape, "
        "pas tous les sites ou le délai réseau. Les timings par phase sont dans le JSON.",
        "",
        "Premiers essais : refus temporaires OSM et orthophoto, MNS rural absent, "
        "absence de candidats forestiers/montagneux. Le premier cas mixte, au centre "
        "du campus, ne proposait que des toits lorsque OSM échouait. Le périmètre "
        "final a été déplacé vers le campus STAPS pour examiner effectivement "
        "terrains de sport et toitures. Les essais initiaux restent dans "
        "`initial-run.json` et `initial-cases.json` ; ils ne sont pas confondus "
        "avec la série finale.",
        "",
        "## Tests et vérifications techniques",
        "",
        "- 88 tests automatisés réussis, sans avertissement Python : contrats, géométrie, "
        "données manquantes, pentes, équipements, portions de toit, score d’accès "
        "inconnu, observateur sur toiture et obstacles vectoriels fins.",
        "- Ruff et formatage conformes ; compilation TypeScript/Vite réussie.",
        "- Six POST HTTP réels ; vérification des six captures dans l’interface.",
        "- Paramètres, aperçu enregistré, zoom, sélection et export à examiner "
        "avec la dernière version ; les observations détaillées figurent dans "
        "[verification.md](verification.md).",
        "",
        "Aucune campagne terrain annotée, expertise structurelle de bâtiment, "
        "évaluation de portance, contrôle des garde-corps, étude VLOS/radio ni "
        "validation réglementaire n’a été réalisée. Le modèle d’image reste "
        "RGB/texture, sans modèle neuronal. Les petites antennes, verrières et "
        "installations temporaires peuvent échapper au pas de 3 m.",
        "",
        "## Reproduire les analyses",
        "",
        "Depuis la racine `drone-pilot-site-finder`, dans un premier terminal :",
        "",
        "```powershell",
        "uv sync --locked",
        "uv run uvicorn drone_site_finder.main:app --host 127.0.0.1 --port 8000",
        "```",
        "",
        "Dans un second terminal :",
        "",
        "```powershell",
        "uv run python scripts/validate_environments.py",
        "# Un seul cas, sans remplacer le rapport complet de la série :",
        "uv run python scripts/validate_environments.py --case mixed --pause-seconds 10",
        "# Régénérer le rapport de la dernière série complète :",
        "uv run python scripts/build_validation_report.py",
        "```",
        "",
        "Les réponses sont enregistrées sous `frontend/public/validation/v0.4/`. "
        "Une requête en erreur supprime seulement la capture précédente du même "
        "cas pour éviter son affichage comme résultat récent. Un test par cas "
        "produit `run-<cas>.json` ; il ne remplace pas `run.json`. Les captures "
        "d’écran du rapport sont celles examinées pendant ce développement : "
        "elles ne sont pas mises à jour automatiquement par le script.",
        "",
        "Tests hors ligne et build :",
        "",
        "```powershell",
        "uv run pytest",
        "uv run ruff check .",
        "uv run ruff format --check .",
        "npm --prefix frontend ci",
        "npm --prefix frontend run build",
        "```",
        "",
        "Les résultats/temps peuvent changer avec les sources et leur cache en mémoire. "
        "Une erreur ou zéro candidat n’est jamais remplacé par un résultat fictif.",
        "",
        "## Retour utilisateur attendu",
        "",
        "Merci d’examiner les six cartes, notamment les portions de toit, les espaces "
        "urbains végétalisés et les grands terrains de sport. Pour un résultat "
        "discutable, indiquez environnement, numéro/identifiant de zone et motif "
        "(surface inadéquate, obstacle, pente, accès, score ou affichage). "
        "La V0.4 reste **en attente de votre retour**, même si tous les tests passent.",
        "",
    ]
    target = ROOT / "docs/validation-v0.4.md"
    target.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"Report: {target}")


if __name__ == "__main__":
    build()

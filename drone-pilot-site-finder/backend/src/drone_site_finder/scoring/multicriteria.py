import numpy as np

from drone_site_finder.geospatial.processing import cells_for_zone, image_fraction
from drone_site_finder.schemas.sites import CriterionScore

LABELS = {
    "accessibility": "Accès cartographié",
    "area": "Superficie",
    "slope": "Pente maximale échantillonnée",
    "obstacles": "Obstacles cartographiés",
    "openness": "Dégagement visuel indicatif",
    "proximity": "Proximité de l’opération",
}


def assess_zone(zone, area_m2, context, bundle, roads, obstacles, options):
    access = float(zone.distance(roads)) if not roads.is_empty else None
    obstacle = float(zone.distance(obstacles)) if not obstacles.is_empty else None
    distance = float(zone.distance(context.operation))
    slope, terrain_coverage = None, 0.0
    local = bundle.local_terrain.get(zone.wkb_hex)
    if local:
        slope, terrain_coverage = local["slope"], local["coverage"]
    elif bundle.terrain:
        grid = bundle.terrain
        cells = cells_for_zone(zone, grid)
        values = grid.slope[cells]
        terrain_coverage = float(np.mean(np.isfinite(values))) if len(values) else 0
        a, b, c, d = zone.bounds
        if (
            terrain_coverage >= 0.8
            and np.isfinite(values).sum() >= 3
            and grid.spacing <= min(c - a, d - b)
        ):
            slope = float(np.max(values[np.isfinite(values)]))
    openness = image_fraction(zone, bundle.imagery, context) if bundle.imagery else None
    values = {
        "accessibility": (
            access,
            "m",
            None if access is None else 100 * max(0, 1 - access / options.max_access_distance_m),
            "osm/ign",
            (
                "Distance minimale à une voie cartographiée ; ne prouve ni accès "
                "légal ni passage libre."
            ),
        ),
        "area": (
            area_m2,
            "m²",
            min(100, 100 * area_m2 / (options.min_area_m2 * 5)),
            "geometry",
            "Surface géodésique ; saturation à cinq fois la surface minimale configurée.",
        ),
        "slope": (
            slope,
            "°",
            None if slope is None else 100 * max(0, 1 - slope / options.max_slope_deg),
            "ign:local_alti" if local else "ign:alti/ign:lidar",
            f"Points valides : {terrain_coverage:.0%}. Pente estimée ; microrelief inconnu.",
        ),
        "obstacles": (
            obstacle,
            "m",
            None
            if obstacle is None
            else min(100, 100 * obstacle / (options.obstacle_buffer_m * 3)),
            "osm/ign",
            (
                "Distance aux obstacles vectoriels connus. Aucun obstacle "
                "cartographié ne signifie pas absence d’obstacles."
            ),
        ),
        "openness": (
            openness,
            "fraction",
            None if openness is None else 100 * openness,
            "ign:ortho",
            (
                "Fraction RGB à faible texture sans ombre/canopée probable ; proxy"
                " visuel, pas une segmentation sémantique validée."
            ),
        ),
        "proximity": (
            distance,
            "m",
            100 * max(0, 1 - distance / max(options.search_radius_m, 1)),
            "geometry",
            "Distance minimale du polygone candidat au polygone d’opération.",
        ),
    }
    total_weight = sum(options.weights.values())
    criteria = [
        CriterionScore(
            key=key,
            label=LABELS[key],
            value=value,
            unit=unit,
            score=score,
            source=source,
            weight=options.weights[key] / total_weight,
            explanation=explanation,
        )
        for key, (value, unit, score, source, explanation) in values.items()
    ]
    missing = [item.key for item in criteria if item.score is None]
    # Missing evidence contributes no favorable score; weights are not redistributed.
    score = round(sum(item.weight * (item.score or 0) for item in criteria), 1)
    coverage = sum(item.weight for item in criteria if item.score is not None)
    return score, criteria, missing, coverage


def assess_rooftop(zone, area_m2, context, assessment, openness, obstacles, options):
    """Same exchange keys, distinct roof semantics; street proximity never scores roof access."""
    obstacle = float(zone.distance(obstacles)) if not obstacles.is_empty else None
    distance = float(zone.distance(context.operation))
    access = 50.0 if assessment.access_status == "mapped" else None
    values = [
        (
            "accessibility",
            "Accès à la toiture",
            None,
            None,
            access,
            "osm:roof:access",
            "Accès explicitement cartographié, à confirmer"
            if access is not None
            else "Accès au toit inconnu. La proximité d’une rue ne prouve aucun accès au toit.",
        ),
        (
            "area",
            "Surface de toiture potentielle",
            area_m2,
            "m²",
            min(100, 100 * area_m2 / (options.min_area_m2 * 5)),
            "geometry",
            "Emprise horizontale après recul des bords et exclusions ; portance non évaluée.",
        ),
        (
            "slope",
            "Pente de toiture échantillonnée",
            assessment.slope_deg,
            "°",
            100 * max(0, 1 - assessment.slope_deg / options.max_roof_slope_deg),
            "ign:roof_alti",
            f"MNS local au pas de {assessment.sample_spacing_m:.2f} m ; "
            "pente de voisinage, obstacles fins non résolus.",
        ),
        (
            "obstacles",
            "Obstacles extérieurs cartographiés",
            obstacle,
            "m",
            None
            if obstacle is None
            else min(100, 100 * obstacle / (options.obstacle_buffer_m * 3)),
            "osm/ign",
            "Bâtiment porteur exclu de cette distance. Équipements en toiture "
            "analysés séparément, inventaire incomplet.",
        ),
        (
            "openness",
            "Dégagement aérien indicatif du toit",
            openness,
            "fraction",
            None if openness is None else 100 * openness,
            "ign:ortho",
            "RGB/texture, ombres et végétation ; aucune garantie d’absence de "
            "verrières, antennes ou équipements.",
        ),
        (
            "proximity",
            "Proximité de l’opération",
            distance,
            "m",
            100 * max(0, 1 - distance / max(options.search_radius_m, 1)),
            "geometry",
            "Distance horizontale à l’opération ; hauteur décrite séparément.",
        ),
    ]
    criteria = [
        CriterionScore(
            key=k,
            label=label,
            value=v,
            unit=unit,
            score=score,
            weight=options.weights[k] / sum(options.weights.values()),
            source=source,
            explanation=explanation,
        )
        for k, label, v, unit, score, source, explanation in values
    ]
    return (
        round(sum(c.weight * (c.score or 0) for c in criteria), 1),
        criteria,
        [c.key for c in criteria if c.score is None],
        sum(c.weight for c in criteria if c.score is not None),
    )

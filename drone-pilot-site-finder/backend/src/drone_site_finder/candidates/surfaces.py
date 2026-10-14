"""Continuous candidate surfaces from positive evidence and measured exclusions."""

import numpy as np
from shapely.ops import unary_union

from drone_site_finder.geospatial.processing import grid_transform, mask_geometry
from drone_site_finder.geospatial.surfaces import polygon_parts

FOOTPATHS = {"footway", "path", "track", "pedestrian", "bridleway"}
INACCESSIBLE_HIGHWAYS = {
    "motorway",
    "trunk",
    "motorway_link",
    "trunk_link",
    "construction",
    "proposed",
}


def road_width_m(properties):
    """Mapped carriageway width (2–30 m), else 2 m for paths and 6 m for roads."""
    footpath = properties.get("highway") in FOOTPATHS
    try:
        width = float(
            properties.get("largeur_de_chaussee")
            or properties.get("width")
            or (2 if footpath else 6)
        )
        return min(30, max(2, width))
    except (ValueError, TypeError):
        return 2 if footpath else 6


def road_is_accessible(properties):
    """Road/path usable as an access proxy: not motorway, private, fictitious or forbidden."""
    flags = {"true", "oui", "1"}
    return (
        properties.get("highway") not in INACCESSIBLE_HIGHWAYS
        and str(properties.get("prive", "")).lower() not in flags
        and str(properties.get("fictif", "")).lower() not in flags
        and properties.get("acces_pieton") not in {"Interdit", "Restreint"}
        and "autoroute" not in str(properties.get("cpx_classement_administratif", "")).lower()
    )


def extract_candidates(context, bundle, options):
    records = [(record, context.to_metric(record.geometry)) for record in bundle.records]
    positives, exclusions, roads, obstacles = [], [], [], []
    evidence = set()
    clip_region = context.search.envelope.buffer(options.obstacle_buffer_m + 30)
    for record, geom in records:
        geom = geom.intersection(clip_region)
        if geom.is_empty or not geom.intersects(context.search):
            continue
        kind = record.kind
        if kind == "open" or (
            kind == "farmland"
            and str(record.properties.get("cat_cult_p", "")).upper() in {"PP", "PT"}
        ):
            # Mapped open surfaces and declared grassland (RPG) are positive evidence.
            positives.extend(polygon_parts(geom))
            evidence.add(record.source_id)
        elif kind == "road":
            # Road carriageways are exclusions, not pilot areas. Path access remains a proxy.
            exclusions.append(geom.buffer(road_width_m(record.properties) / 2))
            if road_is_accessible(record.properties):
                roads.append(geom)
        elif kind in {"building", "obstacle", "rail"}:
            buffered = geom.buffer(options.obstacle_buffer_m)
            obstacles.append(geom)
            exclusions.append(buffered)
        elif kind in {"vegetation", "water", "restricted"}:
            exclusions.append(geom.buffer(2))
    if bundle.terrain:
        grid = bundle.terrain
        steep = np.isfinite(grid.slope) & (grid.slope > options.max_slope_deg)
        tall = (
            np.isfinite(grid.surface) & np.isfinite(grid.ground) & (grid.surface - grid.ground > 2)
        )
        exclusions.append(mask_geometry(steep | tall, grid_transform(grid), context.crs, context))
    if bundle.imagery:
        image = bundle.imagery
        exclusions.append(
            mask_geometry(image.obstruction_mask, image.transform, image.crs, context)
        )
    if not positives:
        return [], unary_union(roads), unary_union(obstacles), 0.0, evidence
    excluded = unary_union(exclusions).intersection(context.search)
    available = unary_union(positives).intersection(context.search).difference(excluded)
    access = unary_union(roads)
    if not access.is_empty:
        # Buffer distributes over union. Avoid buffering a highly noded road collection
        # whose many overlapping branches trigger a costly general buffer overlay.
        access_envelope = unary_union(
            [road.buffer(options.max_access_distance_m) for road in roads]
        )
        available = available.intersection(access_envelope)
    # Morphological opening removes narrow corridors, never adds land outside the evidence surface.
    half_width = options.min_width_m / 2
    available = available.buffer(-half_width).buffer(half_width).intersection(available)
    zones = []
    for zone in polygon_parts(available):
        # Simplify only inward, preserving evidence/exclusions and bounding response complexity.
        simplified = zone.simplify(1, preserve_topology=True).intersection(zone)
        for part in polygon_parts(simplified):
            vertices = len(part.exterior.coords) + sum(len(r.coords) for r in part.interiors)
            if part.area >= options.min_area_m2 and vertices <= 2000 and len(part.interiors) < 32:
                zones.append(part)
    zones.sort(key=lambda zone: (-zone.area, zone.bounds))
    return zones[:100], access, unary_union(obstacles), float(excluded.area), evidence

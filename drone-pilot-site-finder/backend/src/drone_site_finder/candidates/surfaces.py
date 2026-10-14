"""Continuous candidate surfaces from positive evidence and measured exclusions."""

import numpy as np
from shapely.ops import unary_union

from drone_site_finder.geospatial.processing import grid_transform, mask_geometry
from drone_site_finder.geospatial.surfaces import polygon_parts


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
        if kind == "open":
            positives.extend(polygon_parts(geom))
            evidence.add(record.source_id)
        elif kind == "road":
            # Road carriageways are exclusions, not pilot areas. Path access remains a proxy.
            footpath = record.properties.get("highway") in {
                "footway",
                "path",
                "track",
                "pedestrian",
                "bridleway",
            }
            try:
                width = float(
                    record.properties.get("largeur_de_chaussee")
                    or record.properties.get("width")
                    or (2 if footpath else 6)
                )
                width = min(30, max(2, width))
            except (ValueError, TypeError):
                width = 2 if footpath else 6
            exclusions.append(geom.buffer(width / 2))
            accessible = record.properties.get("highway") not in {
                "motorway",
                "trunk",
                "motorway_link",
                "trunk_link",
                "construction",
                "proposed",
            }
            accessible = accessible and str(record.properties.get("prive", "")).lower() not in {
                "true",
                "oui",
                "1",
            }
            accessible = accessible and str(record.properties.get("fictif", "")).lower() not in {
                "true",
                "oui",
                "1",
            }
            accessible = accessible and record.properties.get("acces_pieton") not in {
                "Interdit",
                "Restreint",
            }
            accessible = (
                accessible
                and "autoroute"
                not in str(record.properties.get("cpx_classement_administratif", "")).lower()
            )
            if accessible:
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

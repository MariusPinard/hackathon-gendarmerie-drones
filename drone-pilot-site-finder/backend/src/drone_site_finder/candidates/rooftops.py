"""Measured roof portions; a flat surface never establishes access or structural safety."""

import numpy as np
from rasterio.transform import from_origin
from scipy.ndimage import median_filter
from shapely.geometry import Point, box
from shapely.ops import unary_union

from drone_site_finder.geospatial.processing import image_fraction, mask_geometry
from drone_site_finder.geospatial.surfaces import polygon_parts
from drone_site_finder.providers.rasters import report, sample_elevations
from drone_site_finder.schemas.sites import RoofAssessment

ROOF_CHECKS = [
    "Accès réel au toit et autorisation du propriétaire.",
    "Capacité portante et état de la couverture, à vérifier par une personne compétente.",
    "Protections contre les chutes, cheminement et évacuation.",
    "Équipements, câbles, verrières, personnes et obstacles temporaires.",
]


def building_roofs(context, bundle, options):
    """Prefer IGN footprints, merge OSM roof tags, bound expensive surface sampling."""
    buildings = []
    for record in sorted(bundle.records, key=lambda r: r.source_id != "ign:batiment"):
        if record.kind != "building" or record.geometry.geom_type not in {
            "Polygon",
            "MultiPolygon",
        }:
            continue
        geom = context.to_metric(record.geometry)
        if not geom.intersects(context.search):
            continue
        duplicate = next(
            (
                b
                for b in buildings
                if b[0].intersects(geom)
                and b[0].intersection(geom).area > 0.6 * min(b[0].area, geom.area)
            ),
            None,
        )
        if duplicate:
            if record.source_id == "osm":
                duplicate[2].update(record.properties)
            continue
        buildings.append([geom, record.source_id, dict(record.properties)])
    groups = []
    for footprint, source, tags in buildings:
        if tags.get("access") in {"no", "private", "military"}:
            continue
        eligible = footprint.buffer(-options.roof_edge_setback_m).intersection(context.search)
        if eligible.is_empty:
            continue
        a, b, c, d = eligible.bounds
        # Bound patches, not resolution: a vast building must not inflate a 3 m request to 23 m.
        side = min(45, options.roof_sample_spacing_m * 15)
        patches = []
        for x in np.arange(a, c, side):
            for y in np.arange(b, d, side):
                patches.extend(
                    (part, footprint, source, tags)
                    for part in polygon_parts(eligible.intersection(box(x, y, x + side, y + side)))
                    if part.area >= options.min_area_m2
                )
        patches.sort(
            key=lambda item: (-item[0].area, item[0].distance(context.operation), item[0].bounds)
        )
        if patches:
            groups.append(patches)
    groups.sort(key=lambda group: (-group[0][0].area, group[0][0].bounds))
    # Spread the finite budget across buildings before revisiting another patch of one roof.
    candidates = [
        group[index]
        for index in range(max(map(len, groups), default=0))
        for group in groups
        if index < len(group)
    ]
    return candidates[: options.roof_shortlist_limit], len(candidates)


def measured_roof_parts(zone, ground, surface, spacing, transform, context, options):
    """Retain measured low-slope cells; remove raised residuals and unknown cells."""
    inside = np.array(
        [
            [
                zone.covers(Point(*(transform @ (col + 0.5, row + 0.5))))
                for col in range(surface.shape[1])
            ]
            for row in range(surface.shape[0])
        ]
    )
    valid = inside & np.isfinite(surface) & np.isfinite(ground) & (surface - ground >= 2)
    coverage = float(valid.sum() / max(1, inside.sum()))
    if coverage < 0.8 or valid.sum() < 9:
        return [], None
    # Median interpolation is only for neighborhood arithmetic; unknown cells stay excluded.
    filled = np.where(valid, surface, np.nanmedian(surface[valid]))
    smooth = median_filter(filled, size=3)
    dy, dx = np.gradient(smooth, spacing)
    slopes = np.rad2deg(np.arctan(np.hypot(dx, dy)))
    residual = filled - smooth
    equipment = valid & (residual > 0.6)
    acceptable = valid & (slopes <= options.max_roof_slope_deg) & (np.abs(residual) <= 0.6)
    available = mask_geometry(acceptable, transform, context.crs, context).intersection(zone)
    if equipment.any():
        available = available.difference(
            mask_geometry(equipment, transform, context.crs, context).buffer(1.5)
        )
    half_width = options.min_width_m / 2
    available = available.buffer(-half_width).buffer(half_width).intersection(available)
    parts = [p for p in polygon_parts(available) if p.area >= options.min_area_m2]
    return parts, {
        "coverage": coverage,
        "valid": valid,
        "slopes": slopes,
        "roughness": float(np.percentile(np.abs(residual[valid]), 90)),
        "equipment": bool(equipment.any()),
    }


async def analyse_rooftops(http, context, bundle, options):
    diagnostics = {
        "roof_buildings_eligible": 0,
        "roof_buildings_sampled": 0,
        "roof_without_surface_data": 0,
        "roof_no_suitable_portion": 0,
    }
    if not options.include_rooftops or not options.use_lidar:
        return (
            [],
            report(
                "ign:roof_alti",
                "Toitures LiDAR MNT/MNS",
                "disabled",
                "Roof analysis disabled or LiDAR disabled; no inferred flat roofs.",
            ),
            diagnostics,
        )
    shortlist, count = building_roofs(context, bundle, options)
    diagnostics["roof_buildings_eligible"] = count
    diagnostics["roof_buildings_sampled"] = len(shortlist)
    if not shortlist:
        return (
            [],
            report(
                "ign:roof_alti",
                "Toitures LiDAR MNT/MNS",
                "available",
                "No sufficiently large eligible building footprint in search area.",
            ),
            diagnostics,
        )
    frames, positions = [], []
    for zone, footprint, source, tags in shortlist:
        a, b, c, d = zone.bounds
        spacing = options.roof_sample_spacing_m
        cols, rows = (
            max(3, int(np.ceil((c - a) / spacing))),
            max(3, int(np.ceil((d - b) / spacing))),
        )
        transform = from_origin(a, d, spacing, spacing)
        coordinates = np.array(
            [transform @ (col + 0.5, row + 0.5) for row in range(rows) for col in range(cols)]
        )
        frames.append(
            (
                zone,
                footprint,
                source,
                tags,
                spacing,
                transform,
                rows,
                cols,
                len(positions),
                len(positions) + len(coordinates),
            )
        )
        positions.extend(coordinates)
    xy = np.array(positions)
    lon, lat = context.unproject.transform(xy[:, 0], xy[:, 1])
    ground, surface, failures = await sample_elevations(
        http, lon, lat, "ign_lidar_hd_mnx_mono_wld", multi=True
    )
    roofs = []
    image_obstructions = (
        mask_geometry(
            bundle.imagery.obstruction_mask, bundle.imagery.transform, bundle.imagery.crs, context
        )
        if bundle.imagery
        else None
    )
    mapped_equipment = unary_union(
        [
            context.to_metric(record.geometry).buffer(options.obstacle_buffer_m)
            for record in bundle.records
            if record.kind in {"obstacle", "rail"}
            and record.geometry.intersects(context.to_wgs84(context.search.envelope))
        ]
    )
    for zone, footprint, source, tags, spacing, transform, rows, cols, start, stop in frames:
        g, s = ground[start:stop].reshape(rows, cols), surface[start:stop].reshape(rows, cols)
        parts, metrics = measured_roof_parts(zone, g, s, spacing, transform, context, options)
        if metrics is None:
            diagnostics["roof_without_surface_data"] += 1
            continue
        if not parts:
            diagnostics["roof_no_suitable_portion"] += 1
        for part in parts:
            if sum(len(r.coords) for r in [part.exterior, *part.interiors]) > 2000:
                continue
            cells = (
                np.array(
                    [
                        [
                            part.covers(Point(*(transform @ (col + 0.5, row + 0.5))))
                            for col in range(cols)
                        ]
                        for row in range(rows)
                    ]
                )
                & metrics["valid"]
            )
            if cells.sum() < 4:
                continue
            if image_obstructions is not None:
                # Aerial shadows/vegetation are exclusion proxies; never roof-access evidence.
                clipped = part.difference(image_obstructions)
            else:
                clipped = part
            clipped = clipped.difference(mapped_equipment)
            half_width = options.min_width_m / 2
            clipped = clipped.buffer(-half_width).buffer(half_width).intersection(clipped)
            for portion in polygon_parts(clipped):
                if portion.area < options.min_area_m2:
                    continue
                if (
                    sum(len(r.coords) for r in [portion.exterior, *portion.interiors]) > 2000
                    or len(portion.interiors) >= 32
                ):
                    continue
                portion_cells = (
                    np.array(
                        [
                            [
                                portion.covers(Point(*(transform @ (col + 0.5, row + 0.5))))
                                for col in range(cols)
                            ]
                            for row in range(rows)
                        ]
                    )
                    & metrics["valid"]
                )
                if portion_cells.sum() < 4:
                    continue
                assessment = RoofAssessment(
                    building_source=source,
                    surface_elevation_m=float(np.median(s[portion_cells])),
                    height_above_ground_m=float(np.median((s - g)[portion_cells])),
                    slope_deg=float(np.max(metrics["slopes"][portion_cells])),
                    sample_spacing_m=spacing,
                    valid_sample_fraction=metrics["coverage"],
                    surface_samples=int(portion_cells.sum()),
                    roughness_m=metrics["roughness"],
                    equipment_status="suspected" if metrics["equipment"] else "not_resolved",
                    access_status="mapped"
                    if tags.get("roof:access") in {"yes", "designated"}
                    else "unknown",
                    edge_setback_m=options.roof_edge_setback_m,
                    checks_required=ROOF_CHECKS,
                )
                roofs.append(
                    (
                        portion,
                        footprint,
                        assessment,
                        image_fraction(portion, bundle.imagery, context)
                        if bundle.imagery
                        else None,
                    )
                )
    paired = int((np.isfinite(ground) & np.isfinite(surface)).sum())
    status = "available" if paired == len(positions) else "partial" if paired else "unavailable"
    detail = (
        f"{paired}/{len(positions)} paired local MNT/MNS samples; {failures} failed batches. "
        f"{len(shortlist)}/{count} building portions sampled. Bounded shortlist, equipment/edge "
        "proxies only; no access, structural capacity or fall-protection validation."
    )
    return (
        roofs,
        report("ign:roof_alti", "Toitures LiDAR MNT/MNS", status, detail, paired),
        diagnostics,
    )

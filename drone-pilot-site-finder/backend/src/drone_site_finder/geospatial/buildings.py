"""Explicit mapped building heights; no storey-to-height or flatness invention."""

import numpy as np


def positive_number(value):
    try:
        number = float(str(value).lower().replace(" m", "").replace(",", "."))
        return number if np.isfinite(number) and 0 < number < 9000 else None
    except (ValueError, TypeError):
        return None


def building_obstacles(bundle, context):
    known, unknown = [], []
    for record in bundle.records:
        if record.kind != "building" or record.geometry.geom_type not in {
            "Polygon",
            "MultiPolygon",
        }:
            continue
        geom = context.to_metric(record.geometry)
        if not geom.intersects(context.search.envelope):
            continue
        tags = record.properties
        absolute = positive_number(tags.get("altitude_maximale_toit"))
        height = positive_number(tags.get("hauteur") or tags.get("height"))
        floor = positive_number(tags.get("altitude_maximale_sol"))
        if absolute is None and height and floor:
            absolute = floor + height
        (known if absolute or height else unknown).append((geom, absolute, height))
    # The OSM duplicate without a height must not invalidate the same measured IGN building.
    unknown = [
        item
        for item in unknown
        if not any(
            measured[0].intersects(item[0])
            and measured[0].intersection(item[0]).area > 0.8 * item[0].area
            for measured in known
        )
    ]
    return known + unknown

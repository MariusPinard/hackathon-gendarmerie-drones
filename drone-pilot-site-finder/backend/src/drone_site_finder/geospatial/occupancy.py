"""Takeoff occupancy map: every search cell gets one primary status and its reason.

The map answers « where could a pilot take off? » at a regular cell size. It combines known
occupation (mapped features, measured raised surfaces, image obstruction proxies), obstacle
margins, measured slope, pilot range toward the operation area, sampled geometric masking and
access distance. Unknown inputs are reported as not assessed, never as free or blocked.
"""

import math

import numpy as np
import shapely
from pyproj import CRS, Transformer
from rasterio.features import rasterize, shapes
from rasterio.transform import from_origin
from scipy.ndimage import binary_opening, distance_transform_edt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import coverage_union_all
from shapely.geometry import MultiPolygon, mapping, shape

from drone_site_finder.candidates.surfaces import road_is_accessible, road_width_m
from drone_site_finder.geospatial.surfaces import geodesic_area_m2, polygon_parts
from drone_site_finder.geospatial.visibility import sample_grid
from drone_site_finder.schemas.sites import OccupancyMap, OccupancyZone

MAX_CELLS = 90_000
SUPERSAMPLE = 3
# A cell is occupied when at least this share of it is covered by a known feature.
OCCUPIED_SHARE = 0.34
RAY_STEPS = 64
RANGE_SAMPLES = 400
CHUNK = 6_000

# Occupation reasons, highest priority first when several apply to one cell.
OCCUPIED_REASONS = {
    "building": "Bâtiment",
    "water": "Eau",
    "rail": "Voie ferrée",
    "road": "Chaussée",
    "obstacle": "Ligne, pylône, clôture ou mât",
    "restricted": "Accès interdit ou militaire",
    "vegetation": "Végétation cartographiée",
    "raised_surface": "Sursol mesuré > 2 m (MNS LiDAR)",
    "image_obstruction": "Obstruction visible (orthophoto)",
}
STATUS_LABELS = {
    "occupied": "Occupée",
    "obstacle_buffer": "Marge de sécurité obstacle",
    "steep": "Pente excessive",
    "out_of_range": "Hors portée",
    "masked": "Vue masquée",
    "no_access": "Accès trop éloigné",
    "limited_range": "Portée partielle",
    "light_vegetation": "Végétation basse",
    "free_unconfirmed": "Libre non confirmé",
    "free": "Libre",
}
TAKEOFF = {
    "occupied": "impossible",
    "obstacle_buffer": "impossible",
    "steep": "impossible",
    "out_of_range": "impossible",
    "masked": "conditional",
    "no_access": "conditional",
    "limited_range": "conditional",
    "light_vegetation": "conditional",
    "free_unconfirmed": "conditional",
    "free": "possible",
}


def _cell_grid(region, cell_m):
    min_x, min_y, max_x, max_y = region.bounds
    cell = max(cell_m, math.sqrt((max_x - min_x) * (max_y - min_y) / MAX_CELLS))
    cols = max(1, math.ceil((max_x - min_x) / cell))
    rows = max(1, math.ceil((max_y - min_y) / cell))
    affine = from_origin(min_x, max_y, cell, cell)
    xs = min_x + (np.arange(cols) + 0.5) * cell
    ys = max_y - (np.arange(rows) + 0.5) * cell
    x, y = np.meshgrid(xs, ys)
    return cell, rows, cols, affine, x, y


def _coverage(geometries, rows, cols, cell, origin):
    """Share of each cell covered by the geometries, from a 3× supersampled rasterization."""
    items = [(mapping(g), 1) for g in geometries if g is not None and not g.is_empty]
    if not items:
        return np.zeros((rows, cols))
    fine = rasterize(
        items,
        out_shape=(rows * SUPERSAMPLE, cols * SUPERSAMPLE),
        transform=from_origin(*origin, cell / SUPERSAMPLE, cell / SUPERSAMPLE),
        fill=0,
        all_touched=False,
        dtype="uint8",
    )
    return fine.reshape(rows, SUPERSAMPLE, cols, SUPERSAMPLE).mean(axis=(1, 3))


def _range_fraction(x, y, operation, pilot_range_m):
    """Share of the operation area within pilot range, and distance to its nearest point."""
    min_x, min_y, max_x, max_y = operation.bounds
    step = max(1.0, math.sqrt(operation.area / RANGE_SAMPLES))
    gx, gy = np.meshgrid(
        np.arange(min_x + step / 2, max_x, step), np.arange(min_y + step / 2, max_y, step)
    )
    inside = shapely.contains_xy(operation, gx, gy)
    targets = np.column_stack([gx[inside], gy[inside]])
    if not len(targets):
        point = operation.representative_point()
        targets = np.array([[point.x, point.y]])
    flat_x, flat_y = x.ravel(), y.ravel()
    fraction = np.empty(flat_x.shape)
    for start in range(0, len(flat_x), CHUNK):
        dx = flat_x[start : start + CHUNK, None] - targets[None, :, 0]
        dy = flat_y[start : start + CHUNK, None] - targets[None, :, 1]
        fraction[start : start + CHUNK] = np.mean(dx * dx + dy * dy <= pilot_range_m**2, axis=1)
    nearest = shapely.distance(shapely.points(flat_x, flat_y), operation)
    return fraction.reshape(x.shape), nearest.reshape(x.shape)


def _visibility(x, y, operation, grid, options, evaluate):
    """Visible / evaluated target counts per cell along sampled rays (MNS when available)."""
    targets = [operation.representative_point()]
    a, b, c, d = operation.bounds
    targets += [
        shapely.Point(px, py)
        for px in np.linspace(a, c, 6)[1:-1]
        for py in np.linspace(b, d, 6)[1:-1]
        if operation.contains(shapely.Point(px, py))
    ]
    surface_available = np.isfinite(grid.surface).any()
    obstacles_raster = grid.surface if surface_available else grid.ground
    visible = np.zeros(x.shape, np.int16)
    evaluated = np.zeros(x.shape, np.int16)
    index = np.flatnonzero(evaluate.ravel())
    flat_x, flat_y = x.ravel()[index], y.ravel()[index]
    fractions = np.linspace(0, 1, RAY_STEPS)[:, None]
    for target in targets[:12]:
        target_ground = sample_grid(grid.ground, grid, [target.x], [target.y])[0]
        if not np.isfinite(target_ground):
            continue
        target_z = target_ground + options.target_height_agl_m
        for start in range(0, len(index), CHUNK):
            ox, oy = flat_x[start : start + CHUNK], flat_y[start : start + CHUNK]
            observer_ground = sample_grid(grid.ground, grid, ox, oy)
            rx = ox[None, :] + fractions * (target.x - ox[None, :])
            ry = oy[None, :] + fractions * (target.y - oy[None, :])
            heights = sample_grid(obstacles_raster, grid, rx, ry)
            line = observer_ground + options.observer_height_m
            line = line[None, :] + fractions * (target_z - line[None, :])
            known = np.isfinite(observer_ground) & np.isfinite(heights).all(axis=0)
            blocked = np.any(heights[1:] > line[1:], axis=0)
            cells = index[start : start + CHUNK]
            evaluated.ravel()[cells] += known
            visible.ravel()[cells] += known & ~blocked
    return visible, evaluated, surface_available


def _image_mask(x, y, image, context):
    to_image = Transformer.from_crs(context.crs, CRS.from_user_input(image.crs), always_xy=True)
    ix, iy = to_image.transform(x.ravel(), y.ravel())
    cols, rows = ~image.transform @ (np.asarray(ix), np.asarray(iy))
    cols, rows = np.floor(cols).astype(int), np.floor(rows).astype(int)
    height, width = image.obstruction_mask.shape
    valid = (rows >= 0) & (rows < height) & (cols >= 0) & (cols < width)
    mask = np.zeros(x.size, bool)
    mask[valid] = image.obstruction_mask[rows[valid], cols[valid]]
    return mask.reshape(x.shape), valid.reshape(x.shape)


LIGHT_VEGETATION_NATURES = {"haie", "lande ligneuse", "verger", "vigne"}
LIGHT_OSM = {"scrub", "heath", "tree_row", "orchard", "vineyard", "hedge"}
# RPG (registre parcellaire graphique) categories: grassland is open, arable land depends on
# the season, permanent crops (vines, orchards) are low vegetation.
RPG_GRASSLAND = {"PP", "PT"}
RPG_ARABLE = {"TA"}
RPG_PERMANENT = {"CP"}
MIN_FREE_CLUSTER = 3  # cells: an isolated free cell is not a usable takeoff area


def is_light_vegetation(properties):
    nature = str(properties.get("nature", "")).strip().lower()
    return nature in LIGHT_VEGETATION_NATURES or any(
        str(properties.get(key, "")).lower() in LIGHT_OSM
        for key in ("natural", "landuse", "barrier")
    )


def _walking_distance(passable, sources, cell, limit):
    """Shortest path length (m) from source cells through passable cells (8-neighbour)."""
    rows, cols = passable.shape
    index = np.arange(rows * cols).reshape(rows, cols)
    heads, tails, weights = [], [], []
    for dr, dc, step in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2))):
        r0, r1 = 0, rows - dr
        c0, c1 = max(0, -dc), cols - max(0, dc)
        a = passable[r0:r1, c0:c1] & passable[r0 + dr : r1 + dr, c0 + dc : c1 + dc]
        heads.append(index[r0:r1, c0:c1][a])
        tails.append(index[r0 + dr : r1 + dr, c0 + dc : c1 + dc][a])
        weights.append(np.full(int(a.sum()), step * cell))
    # Virtual node n reaches every source cell at (almost) zero cost: multi-source search.
    n = rows * cols
    source_cells = index[sources & passable]
    heads.append(np.full(len(source_cells), n))
    tails.append(source_cells)
    weights.append(np.full(len(source_cells), 1e-6))
    h, t, w = np.concatenate(heads), np.concatenate(tails), np.concatenate(weights)
    graph = coo_matrix(
        (np.concatenate([w, w]), (np.concatenate([h, t]), np.concatenate([t, h]))),
        shape=(n + 1, n + 1),
    ).tocsr()
    distance = dijkstra(graph, directed=True, indices=n, limit=limit + 2 * cell)
    return distance[:n].reshape(rows, cols)


def build_occupancy(context, bundle, options, *, relative_to_operation=True):
    """Occupancy of ``context.search``.

    With ``relative_to_operation=False`` (area-wide maps, e.g. a whole commune), the search area
    is mapped for itself: pilot range and masking toward an operation area are not assessed.
    """
    region = context.search
    cell, rows, cols, affine, x, y = _cell_grid(region, options.occupancy_cell_m)
    origin = (affine.c, affine.f)
    zeros = np.zeros(x.shape, bool)

    def share(geometries):
        return _coverage(geometries, rows, cols, cell, origin)

    inside = shapely.contains_xy(region, x, y)
    clip = region.envelope.buffer(options.obstacle_buffer_m + options.max_access_distance_m)
    # Surfaces occupy a cell above OCCUPIED_SHARE; thin features (lines, points: power lines,
    # pylons, tracks, waterways, fences) occupy every cell they cross, whatever its size.
    surfaces = {key: [] for key in OCCUPIED_REASONS}
    thin = {key: [] for key in OCCUPIED_REASONS}
    open_surfaces, accessible_roads, private_roads, all_roads, parkings = [], [], [], [], []
    light_vegetation, arable = [], []
    for record in bundle.records:
        geom = context.to_metric(record.geometry).intersection(clip)
        if geom.is_empty:
            continue
        kind, props = record.kind, record.properties
        if kind == "open":
            open_surfaces.append(geom)
            if props.get("amenity") == "parking":
                parkings.append(geom)
        elif kind == "farmland":
            category = str(props.get("cat_cult_p", "")).upper()
            if category in RPG_GRASSLAND:
                open_surfaces.append(geom)
            elif category in RPG_ARABLE:
                arable.append(geom)
            elif category in RPG_PERMANENT:
                light_vegetation.append(geom)
        elif kind == "road":
            surfaces["road"].append(geom.buffer(road_width_m(props) / 2))
            all_roads.append(geom)
            if road_is_accessible(props):
                accessible_roads.append(geom)
            elif str(props.get("prive", "")).lower() in {"true", "oui", "1"} or props.get(
                "access"
            ) in {"private", "permissive", "destination"}:
                private_roads.append(geom)
        elif kind == "vegetation" and is_light_vegetation(props):
            light_vegetation.append(geom if geom.area > 0 else geom.buffer(1))
        elif kind == "obstacle" and props.get("barrier") == "hedge":
            light_vegetation.append(geom.buffer(1))
        elif kind in {"building", "rail", "water", "vegetation", "restricted", "obstacle"}:
            (surfaces if geom.area > 0 else thin)[kind].append(geom.buffer(1))
    occupied = {}
    for key in OCCUPIED_REASONS:
        if surfaces[key] or thin[key]:
            occupied[key] = (share(surfaces[key]) >= OCCUPIED_SHARE) | (share(thin[key]) > 0)
    assessed = {
        "terrain": False,
        "surface_model": False,
        "imagery": False,
        "access": False,
        "masking": False,
        "farmland": any(r.kind == "farmland" for r in bundle.records),
    }
    grid = bundle.terrain
    steep = zeros.copy()
    slope = np.full(x.shape, np.nan)
    if grid is not None:
        ground = sample_grid(grid.ground, grid, x, y)
        surface = sample_grid(grid.surface, grid, x, y)
        raised = np.isfinite(surface) & np.isfinite(ground) & (surface - ground > 2)
        if raised.any():
            occupied["raised_surface"] = raised
        if grid.slope is not None:
            slope = sample_grid(grid.slope, grid, x, y)
            steep = np.isfinite(slope) & (slope > options.max_slope_deg)
        assessed["terrain"] = bool(np.isfinite(ground[inside]).any())
        assessed["surface_model"] = bool(np.isfinite(surface[inside]).any())
    if bundle.imagery is not None:
        mask, covered = _image_mask(x, y, bundle.imagery, context)
        occupied["image_obstruction"] = mask
        assessed["imagery"] = bool(covered[inside].any())
    hard = zeros.copy()
    for key in ("building", "obstacle", "rail"):
        if key in occupied:
            hard |= occupied[key]
    obstacle_distance = (
        distance_transform_edt(~hard) * cell if hard.any() else np.full(x.shape, 1e9)
    )
    near_obstacle = obstacle_distance <= options.obstacle_buffer_m
    any_occupied = zeros.copy()
    for value in occupied.values():
        any_occupied |= value
    # Walking access: path length from an accessible road, around buildings, water and rails.
    blocking = zeros.copy()
    for key in ("building", "water", "rail"):
        if key in occupied:
            blocking |= occupied[key]
    walk = np.full(x.shape, np.inf)
    far, cut_off, private_only = zeros.copy(), zeros.copy(), zeros.copy()
    if accessible_roads:
        road_cells = share(accessible_roads) > 0
        walk = _walking_distance(
            ~blocking | road_cells, road_cells, cell, options.max_access_distance_m
        )
        far = walk > options.max_access_distance_m
        straight = distance_transform_edt(~road_cells) * cell
        # Close as the crow flies but cut off by water or buildings.
        cut_off = far & (straight <= options.max_access_distance_m)
        if private_roads:
            private_cells = share(private_roads) > 0
            private_only = far & (
                distance_transform_edt(~private_cells) * cell <= options.max_access_distance_m
            )
        assessed["access"] = True
    if relative_to_operation:
        fraction, nearest = _range_fraction(x, y, context.operation, options.pilot_range_m)
    else:
        fraction, nearest = np.ones(x.shape), np.zeros(x.shape)
    assessed["range"] = relative_to_operation
    out_of_range = nearest > options.pilot_range_m
    # Useful reach relative to the best takeoff cell of this search area: a large operation
    # area (several pilots needed) or a surroundings-only search does not make every site
    # « partial »; only cells reaching much less than the best available ones are flagged.
    best = float(np.max(fraction[inside], initial=0))
    efficiency = fraction / best if best > 0 else np.zeros(x.shape)
    limited = ~out_of_range & (efficiency < 0.5)
    masked, masked_reason = zeros.copy(), zeros.copy()  # masked_reason: no target visible
    visible_share = np.full(x.shape, np.nan)
    if grid is not None and relative_to_operation:
        evaluate = inside & ~any_occupied & ~near_obstacle & ~steep & ~out_of_range
        visible, evaluated, _ = _visibility(x, y, context.operation, grid, options, evaluate)
        assessed["masking"] = bool(evaluated.any())
        with np.errstate(invalid="ignore", divide="ignore"):
            visible_share = np.where(evaluated > 0, visible / np.maximum(evaluated, 1), np.nan)
        masked = np.isfinite(visible_share) & (visible_share < 0.5)
        masked_reason = masked & (visible == 0)

    open_mask = share(open_surfaces) >= 0.5
    arable_mask = (share(arable) >= 0.5) & ~open_mask
    light_mask = share(light_vegetation) >= OCCUPIED_SHARE
    blocked = any_occupied | near_obstacle | steep | out_of_range | light_mask
    conditional = masked | far | limited
    takeoff_area = inside & ~blocked
    # Usable clearance around each cell; an isolated free cell is not a takeoff area.
    clearance = distance_transform_edt(takeoff_area) * cell
    # « Libre » needs a confirmed open patch of at least 3×3 cells (~30 m at 10 m cells).
    clustered = binary_opening(
        takeoff_area & open_mask, structure=np.ones((MIN_FREE_CLUSTER, MIN_FREE_CLUSTER), bool)
    )
    # Continuous 0–100 quality of takeoff cells: walking access, space, slope, obstacles, stop.
    access_term = np.clip(
        1 - np.nan_to_num(walk, posinf=1e9) / max(options.max_access_distance_m, 1), 0, 1
    )
    space_term = np.clip(clearance / 20, 0, 1)
    slope_term = np.where(
        np.isfinite(slope), np.clip(1 - np.nan_to_num(slope) / options.max_slope_deg, 0, 1), 0.5
    )
    obstacle_term = np.clip(obstacle_distance / 50, 0, 1)
    stop_cells = share(parkings + all_roads) > 0 if parkings or all_roads else zeros
    stop_term = (
        np.where(distance_transform_edt(~stop_cells) * cell <= 50, 1.0, 0.3)
        if stop_cells.any()
        else np.full(x.shape, 0.3)
    )
    score = 100 * (
        0.3 * access_term
        + 0.3 * space_term
        + 0.15 * slope_term
        + 0.15 * obstacle_term
        + 0.1 * stop_term
    )
    if relative_to_operation:
        score = score * np.where(np.isfinite(visible_share), 0.5 + 0.5 * visible_share, 1)
        score = score * np.clip(efficiency, 0.5, 1)
    band = np.where(score >= 70, "A", np.where(score >= 45, "B", "C"))

    # One primary status per cell: later assignments take precedence.
    codes = []
    status = np.full(x.shape, -1, np.int16)

    def assign(selection, name, reason=None, quality=None):
        selection = selection & inside
        if selection.any():
            codes.append((name, reason, quality))
            status[selection] = len(codes) - 1

    for quality in ("C", "B", "A"):
        level = band == quality
        assign(~open_mask & ~arable_mask & level, "free_unconfirmed", None, quality)
        assign(
            arable_mask & level, "free_unconfirmed", "Parcelle cultivée : selon la saison", quality
        )
        assign(open_mask & clustered & ~conditional & level, "free", None, quality)
    assign(open_mask & ~clustered, "free_unconfirmed", "Îlot libre trop petit (< 30 m)", "C")
    assign(limited & (efficiency >= 0.25), "limited_range", "25 à 50 % de la meilleure couverture")
    assign(limited & (efficiency < 0.25), "limited_range", "< 25 % de la meilleure couverture")
    assign(
        far & ~cut_off & ~private_only,
        "no_access",
        f"> {options.max_access_distance_m:.0f} m à pied d’une voie accessible",
    )
    assign(cut_off, "no_access", "Accès coupé par l’eau ou le bâti : long détour")
    assign(private_only, "no_access", "Accès par voie privée : autorisation du propriétaire")
    assign(masked & ~masked_reason, "masked", "Majorité des cibles masquées")
    assign(masked_reason, "masked", "Aucune cible visible")
    assign(light_mask, "light_vegetation", "Haie, lande, verger ou vigne")
    assign(
        out_of_range, "out_of_range", f"Zone d’opération à plus de {options.pilot_range_m:.0f} m"
    )
    assign(steep, "steep", f"Pente > {options.max_slope_deg:.0f}°")
    assign(near_obstacle, "obstacle_buffer", f"< {options.obstacle_buffer_m:.0f} m d’un obstacle")
    for key in reversed(list(OCCUPIED_REASONS)):
        if key in occupied:
            assign(occupied[key], "occupied", key)

    zones, areas = [], {}
    geometries, keys = [], []
    for code, key in enumerate(codes):
        selection = status == code
        if not selection.any():
            continue
        parts = [
            shape(geometry)
            for geometry, value in shapes(
                selection.astype("uint8"), mask=selection, transform=affine
            )
            if value == 1
        ]
        merged = coverage_union_all(parts).intersection(region)
        if merged.is_empty:
            continue
        geometries.append(merged)
        keys.append(key)
    if geometries:
        try:
            # Simplify the cells as one coverage so neighbouring statuses keep shared borders.
            geometries = list(shapely.coverage_simplify(geometries, cell * 0.35))
        except (shapely.errors.GEOSException, ValueError):
            pass
    for geometry, (name, reason, quality) in zip(geometries, keys, strict=True):
        parts = polygon_parts(context.to_wgs84(geometry))
        if not parts:
            continue
        geographic = MultiPolygon(parts)
        area = geodesic_area_m2(geographic)
        rounded = shapely.set_precision(geographic, 1e-7)
        rounded_parts = polygon_parts(rounded) or parts
        areas[name] = areas.get(name, 0) + area
        zones.append(
            OccupancyZone(
                status=name,
                reason=reason,
                label=STATUS_LABELS[name],
                reason_label=OCCUPIED_REASONS.get(reason, reason) if reason else None,
                takeoff=TAKEOFF[name],
                quality=quality,
                area_m2=round(area, 1),
                geometry=mapping(MultiPolygon(rounded_parts)),
            )
        )
    total = sum(areas.values()) or 1
    notes = [
        f"Grille de {cell:.0f} m · {int(inside.sum())} cellules évaluées · "
        "un statut principal par cellule.",
        f"Portée télépilote : {options.pilot_range_m:.0f} m. Portée partielle : la cellule "
        "atteint moins de la moitié de la surface couverte depuis les meilleures cellules."
        if relative_to_operation
        else "Carte de territoire : portée et masquage vers une zone d’opération non évalués "
        "(aucune opération définie).",
        "Priorité : occupée > marge obstacle > pente > hors portée > végétation basse > vue "
        "masquée > accès > portée partielle > libre. Libre : îlot d’au moins 30 m.",
        "Qualité A/B/C des cellules libres : accès à pied, espace dégagé, pente, distance aux "
        "obstacles, arrêt possible à moins de 50 m"
        + (", visibilité et portée." if relative_to_operation else "."),
        "« Libre » exige une surface ouverte cartographiée ; « Libre non confirmé » signifie "
        "seulement qu’aucune occupation n’est connue.",
    ]
    if not assessed["terrain"]:
        notes.append("Relief indisponible : pente, sursol et masquage non évalués.")
    elif not assessed["surface_model"]:
        notes.append(
            "MNS indisponible : masquage calculé sur le terrain seul (bâti et végétation ignorés)."
        )
    if not assessed["access"]:
        notes.append("Aucune voie accessible connue : distance d’accès non évaluée.")
    return OccupancyMap(
        cell_size_m=round(cell, 2),
        rows=rows,
        cols=cols,
        cells_evaluated=int(inside.sum()),
        pilot_range_m=options.pilot_range_m,
        zones=zones,
        area_by_status_m2={key: round(value, 1) for key, value in areas.items()},
        share_by_status={key: round(value / total, 4) for key, value in areas.items()},
        assessed=assessed,
        notes=notes,
    )

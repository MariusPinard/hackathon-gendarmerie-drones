import asyncio
import hashlib
import time
from itertools import zip_longest

import numpy as np
from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

from drone_site_finder.candidates.surfaces import extract_candidates
from drone_site_finder.geospatial.buildings import building_obstacles
from drone_site_finder.geospatial.occupancy import build_occupancy
from drone_site_finder.geospatial.processing import (
    AnalysisError,
    metric_context,
)
from drone_site_finder.geospatial.surfaces import geodesic_area_m2, polygon_parts
from drone_site_finder.geospatial.visibility import estimate_visibility
from drone_site_finder.providers.open_data import OpenDataProvider
from drone_site_finder.schemas.geojson import MultiPolygonGeometry, PolygonGeometry
from drone_site_finder.schemas.sites import (
    CandidateFeature,
    CandidateProperties,
    GroundPhoto,
    SearchMetadata,
    SearchResponse,
)
from drone_site_finder.scoring.multicriteria import assess_rooftop, assess_zone


class SiteFinderEngine:
    def __init__(self, provider=None):
        self.provider = provider or OpenDataProvider()

    async def search(self, request):
        started = time.perf_counter()
        context = metric_context(request)
        phases, diagnostics = {}, {}
        try:
            async with asyncio.timeout(140):
                bundle = await self.provider.acquire(context, request.options)
        except TimeoutError as exc:
            raise AnalysisError(
                "Délai des sources dépassé. Réduisez l’emprise ou réessayez."
            ) from exc
        critical = [
            source
            for source in bundle.sources
            if source.id in {"osm", "ign:batiment"} and source.status == "available"
        ]
        if not critical:
            raise AnalysisError(
                (
                    "Aucune couverture vectorielle bâtiments exploitable. Recherche "
                    "interrompue sans inventer de zones."
                ),
                sources=bundle.sources,
            )
        if request.options.require_terrain and bundle.terrain is None:
            raise AnalysisError("Altimétrie requise mais indisponible.", sources=bundle.sources)
        phases["acquisition"] = round(time.perf_counter() - started, 2)
        phase_start = time.perf_counter()

        def timed_occupancy():
            occupancy_start = time.perf_counter()
            result = build_occupancy(context, bundle, request.options)
            phases["occupancy"] = round(time.perf_counter() - occupancy_start, 2)
            return result

        (zones, roads, obstacles, excluded, evidence), occupancy = await asyncio.gather(
            asyncio.to_thread(extract_candidates, context, bundle, request.options),
            asyncio.to_thread(timed_occupancy)
            if request.options.include_occupancy
            else asyncio.sleep(0, None),
        )
        # Refine only a bounded shortlist; do not infer small-zone slope from a coarse region grid.
        zones = zones[: max(20, request.max_candidates * 5)]
        if not request.options.include_ground:
            zones = []
        geographic_search = context.to_wgs84(context.search)
        # Clip once in the exported CRS too: projected straight segments become curved
        # when reprojected, so differently densified boundaries can disagree slightly.
        zone_pairs = [
            (context.to_metric(part), part)
            for zone in zones
            for part in polygon_parts(context.to_wgs84(zone).intersection(geographic_search))
        ]
        zones = [zone for zone, _ in zone_pairs]
        phases["ground_geometry"] = round(time.perf_counter() - phase_start, 2)
        phase_start = time.perf_counter()

        async def refine_ground():
            if zones and hasattr(self.provider, "refine_terrain"):
                bundle.local_terrain, local_report = await self.provider.refine_terrain(
                    context, zones, request.options
                )
                if local_report:
                    bundle.sources.append(local_report)

        async def refine_roofs():
            if request.options.include_rooftops and hasattr(self.provider, "rooftop_zones"):
                roofs, roof_report, roof_diagnostics = await self.provider.rooftop_zones(
                    context, bundle, request.options
                )
                bundle.sources.append(roof_report)
                diagnostics.update(roof_diagnostics)
                return roofs
            return []

        _, roofs = await asyncio.gather(refine_ground(), refine_roofs())
        phases["local_3d"] = round(time.perf_counter() - phase_start, 2)
        phase_start = time.perf_counter()
        entries = [(zone, geo, None, None, None) for zone, geo in zone_pairs]
        for zone, footprint, roof, openness in roofs:
            entries.extend(
                (context.to_metric(part), part, roof, footprint, openness)
                for part in polygon_parts(context.to_wgs84(zone).intersection(geographic_search))
            )
        buildings = building_obstacles(bundle, context)
        features = []
        for zone, geographic, roof, footprint, openness in entries:
            area = geodesic_area_m2(geographic)
            if not np.isfinite(area) or area < request.options.min_area_m2:
                continue
            if roof:
                outside = unary_union(
                    [
                        context.to_metric(r.geometry)
                        for r in bundle.records
                        if r.kind in {"building", "obstacle", "rail"}
                        and not (
                            r.kind == "building"
                            and context.to_metric(r.geometry).intersection(footprint).area
                            > 0.6 * min(context.to_metric(r.geometry).area, footprint.area)
                        )
                    ]
                )
                score, criteria, missing, coverage = assess_rooftop(
                    zone, area, context, roof, openness, outside, request.options
                )
            else:
                score, criteria, missing, coverage = assess_zone(
                    zone, area, context, bundle, roads, obstacles, request.options
                )
            if request.options.require_terrain and "slope" in missing:
                continue
            nearest_m = zone.distance(context.operation)
            if nearest_m > request.options.pilot_range_m:
                # The pilot could not reach the operation area from here.
                diagnostics["out_of_range_zones"] = (
                    int(diagnostics.get("out_of_range_zones", 0)) + 1
                )
                continue
            farthest_m = max(
                zone.representative_point().distance(Point(xy))
                for xy in context.operation.exterior.coords
            )
            slope_value = next(item.value for item in criteria if item.key == "slope")
            if slope_value is not None and slope_value > (
                request.options.max_roof_slope_deg if roof else request.options.max_slope_deg
            ):
                continue
            photos = []
            for photo in bundle.photos:
                distance = zone.distance(context.to_metric(shape(photo["geometry"])))
                if distance <= 200:
                    photos.append(
                        GroundPhoto(
                            **{k: v for k, v in photo.items() if k != "geometry"},
                            distance_m=round(distance, 1),
                        )
                    )
            photos.sort(key=lambda photo: photo.distance_m)
            visibility = estimate_visibility(
                zone,
                context.operation,
                bundle.terrain,
                request.options,
                roof=roof,
                buildings=buildings,
                footprint=footprint,
            )
            features.append(
                CandidateFeature(
                    id=("roof-" if roof else "zone-")
                    + hashlib.sha256(geographic.wkb).hexdigest()[:12],
                    geometry=PolygonGeometry.model_validate(mapping(geographic)),
                    properties=CandidateProperties(
                        name="Zone candidate",
                        surface_type="rooftop" if roof else "ground",
                        score_profile="rooftop_v1" if roof else "ground_v1",
                        roof=roof,
                        score=score,
                        area_m2=area,
                        component_count=1,
                        relevance_level="high"
                        if score >= 80
                        else "moderate"
                        if score >= 70
                        else "low",
                        criteria=criteria,
                        evidence_coverage=round(coverage, 4),
                        missing_data=missing,
                        evidence=[
                            "Toiture mesurée dans le MNS ; recul des bords appliqué."
                            if roof
                            else "Surface ouverte cartographiée ; exclusions appliquées.",
                            "Accès, occupation et obstacles temporaires à vérifier sur le terrain.",
                        ],
                        source_ids=sorted(
                            evidence
                            | {s.id for s in bundle.sources if s.status in {"available", "partial"}}
                        ),
                        uncertainty="high"
                        if roof
                        or missing
                        or coverage < 0.85
                        or visibility.unknown_rays
                        or visibility.status != "surface_model"
                        or any(s.status in {"partial", "unavailable"} for s in bundle.sources)
                        else "medium",
                        justifications=[
                            f"Surface continue {'en toiture' if roof else 'au sol'} "
                            f"de {area:.0f} m² issue de données réelles. "
                            + (
                                "Accès, portance, protections et autorisation NON vérifiés."
                                if roof
                                else "Largeur, accès et obstacles connus filtrés."
                            ),
                            f"Distance à la zone d’opération : {nearest_m:.0f} m (point le plus "
                            f"proche) à ~{farthest_m:.0f} m (sommet le plus éloigné) ; portée "
                            f"télépilote {request.options.pilot_range_m:.0f} m"
                            + (
                                " — portée partielle."
                                if farthest_m > request.options.pilot_range_m
                                else "."
                            ),
                            f"Couverture pondérée : {coverage:.0%}. "
                            f"Critères manquants : {', '.join(missing) or 'aucun'}.",
                            (
                                "Score conservateur : les critères inconnus n’apportent aucun "
                                "point, sans redistribution des poids."
                            ),
                            (
                                "La position exacte et l’autorisation d’accès restent du ressort "
                                "de l’opérateur."
                            ),
                        ],
                        visibility_estimate=visibility,
                        ground_photos=photos[:3],
                    ),
                )
            )
        features.sort(
            key=lambda feature: (-feature.properties.score, -feature.properties.area_m2, feature.id)
        )
        ground_features = [f for f in features if f.properties.surface_type == "ground"]
        roof_features = [f for f in features if f.properties.surface_type == "rooftop"]
        # Preserve visible representation of each type; scores have different access semantics.
        features = [
            f for pair in zip_longest(ground_features, roof_features) for f in pair if f is not None
        ][: request.max_candidates]
        phases["scoring_visibility"] = round(time.perf_counter() - phase_start, 2)
        phase_start = time.perf_counter()
        if hasattr(self.provider, "nearby_photos"):
            nearby, photo_report = await self.provider.nearby_photos(
                context, features, request.options.use_panoramax
            )
            bundle.sources.append(photo_report)
            for feature in features:
                zone = context.to_metric(shape(feature.geometry.model_dump()))
                selected = []
                for photo in nearby.get(feature.id, []):
                    distance = zone.distance(context.to_metric(shape(photo["geometry"])))
                    if distance <= 200:
                        selected.append(
                            GroundPhoto(
                                **{k: v for k, v in photo.items() if k != "geometry"},
                                distance_m=round(distance, 1),
                            )
                        )
                selected.sort(key=lambda photo: photo.distance_m)
                feature.properties.ground_photos = selected[:3]
                if selected:
                    feature.properties.source_ids.append("panoramax")
        for index, feature in enumerate(features):
            kind = "toiture" if feature.properties.surface_type == "rooftop" else "sol"
            feature.properties.name = f"Zone {kind} {index + 1:02d}"
        phases["photos"] = round(time.perf_counter() - phase_start, 2)
        diagnostics.update(ground_shortlisted=len(zones), rooftop_portions=len(roofs))
        warnings = [
            f"{s.name}: {s.detail}"
            for s in bundle.sources
            if s.status in {"partial", "unavailable"}
        ]
        if not features:
            warnings.append(
                "Aucune surface ne satisfait les contraintes avec les éléments "
                "disponibles. Une absence de résultat n’est pas une absence de "
                "terrain utilisable."
            )
        geometry_class = (
            PolygonGeometry if geographic_search.geom_type == "Polygon" else MultiPolygonGeometry
        )
        return SearchResponse(
            features=features,
            occupancy=occupancy,
            metadata=SearchMetadata(
                count=len(features),
                requested_count=request.max_candidates,
                status="no_candidates" if not features else "partial" if warnings else "complete",
                sources=bundle.sources,
                warnings=warnings,
                search_area=geometry_class.model_validate(mapping(geographic_search)),
                metric_crs=context.crs.to_string(),
                excluded_area_m2=excluded,
                options=request.options,
                elapsed_seconds=round(time.perf_counter() - started, 2),
                phase_seconds=phases,
                diagnostics=diagnostics,
                terrain_sampling_m=bundle.terrain.spacing if bundle.terrain else None,
                limitations=[
                    (
                        "Aide à la décision, jamais une validation de sécurité ou une "
                        "autorisation opérationnelle."
                    ),
                    (
                        "Données datées/incomplètes, obstacles fins et temporaires, "
                        "personnes et occupations non garantis."
                    ),
                    (
                        "RGB et texture sont des indices visuels, sans modèle sémantique "
                        "entraîné ni validation terrain."
                    ),
                    (
                        "Visibilité géométrique échantillonnée ≠ VLOS réelle ≠ qualité de "
                        "liaison radio."
                    ),
                    "Toitures : accès, portance, protections contre les chutes et "
                    "autorisations non validés. Scores sol/toiture issus de profils "
                    "distincts ; classement alterné.",
                    (
                        "Les services publics reçoivent l’emprise de recherche ; ne pas "
                        "soumettre de géographie confidentielle sans infrastructure "
                        "approuvée."
                    ),
                ],
            ),
        )

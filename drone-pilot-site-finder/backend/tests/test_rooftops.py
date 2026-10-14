import asyncio

import numpy as np
import pytest
from conftest import FixtureProvider
from pydantic import ValidationError
from rasterio.transform import from_origin
from shapely.geometry import GeometryCollection, box

from drone_site_finder.candidates.rooftops import (
    ROOF_CHECKS,
    analyse_rooftops,
    building_roofs,
    measured_roof_parts,
)
from drone_site_finder.geospatial.buildings import positive_number
from drone_site_finder.geospatial.processing import mask_geometry, metric_context
from drone_site_finder.geospatial.visibility import estimate_visibility
from drone_site_finder.providers.models import DataBundle, GeoRecord, TerrainGrid
from drone_site_finder.providers.rasters import report
from drone_site_finder.schemas.sites import AnalysisOptions, RoofAssessment, SearchRequest
from drone_site_finder.scoring.multicriteria import assess_rooftop
from drone_site_finder.services.engine import SiteFinderEngine


def assessment(**changes):
    values = dict(
        building_source="offline-test",
        surface_elevation_m=120,
        height_above_ground_m=20,
        slope_deg=1,
        sample_spacing_m=3,
        valid_sample_fraction=1,
        surface_samples=25,
        roughness_m=0.1,
        edge_setback_m=3,
        checks_required=ROOF_CHECKS,
    )
    return RoofAssessment(**(values | changes))


@pytest.fixture
def context(polygon):
    return metric_context(
        SearchRequest(
            operation_area=polygon, options={"surroundings_only": False, "search_radius_m": 100}
        )
    )


def test_flat_roof_retains_measured_portion(context):
    g = np.zeros((12, 12))
    parts, metric = measured_roof_parts(
        box(0, 0, 60, 60), g, g + 20, 5, from_origin(0, 60, 5, 5), context, AnalysisOptions()
    )
    assert parts and metric["coverage"] == 1
    assert all(box(0, 0, 60, 60).covers(p) for p in parts)
    assert all(p.area >= 100 for p in parts)


def test_missing_mns_never_invents_roof(context):
    g = np.zeros((12, 12))
    parts, metric = measured_roof_parts(
        box(0, 0, 60, 60), g, g + np.nan, 5, from_origin(0, 60, 5, 5), context, AnalysisOptions()
    )
    assert parts == [] and metric is None


def test_steep_roof_excluded(context):
    g = np.zeros((12, 12))
    surface = 20 + np.indices(g.shape)[1] * 5 * 0.4
    assert not measured_roof_parts(
        box(0, 0, 60, 60), g, surface, 5, from_origin(0, 60, 5, 5), context, AnalysisOptions()
    )[0]


def test_isolated_roof_equipment_is_excluded(context):
    g = np.zeros((12, 12))
    s = g + 20
    s[5, 5] = 26
    parts, metrics = measured_roof_parts(
        box(0, 0, 60, 60), g, s, 5, from_origin(0, 60, 5, 5), context, AnalysisOptions()
    )
    assert metrics["equipment"]
    assert all(not p.intersects(box(25, 30, 30, 35)) for p in parts)


def test_roof_access_never_derived_from_street(context):
    roof = assessment()
    _, criteria, missing, coverage = assess_rooftop(
        box(0, 0, 30, 30), 900, context, roof, 0.9, GeometryCollection(), AnalysisOptions()
    )
    assert "accessibility" in missing and coverage <= 0.8
    assert next(c for c in criteria if c.key == "accessibility").value is None
    assert roof.structural_capacity == roof.fall_protection == roof.permission == "not_assessed"


def test_explicit_roof_access_is_only_indicative(context):
    _, criteria, _, _ = assess_rooftop(
        box(0, 0, 30, 30),
        900,
        context,
        assessment(access_status="mapped"),
        0.9,
        GeometryCollection(),
        AnalysisOptions(),
    )
    assert next(c for c in criteria if c.key == "accessibility").score == 50


def test_ign_osm_roof_duplicate_and_edge_recession(context):
    footprint = box(-20, -20, 40, 40)
    bundle = DataBundle(
        records=[
            GeoRecord(context.to_wgs84(footprint), "building", "ign:batiment"),
            GeoRecord(context.to_wgs84(footprint), "building", "osm", {"roof:access": "yes"}),
        ]
    )
    roofs, count = building_roofs(context, bundle, AnalysisOptions())
    assert count >= 1 and len(roofs) >= 1 and roofs[0][3]["roof:access"] == "yes"
    assert footprint.buffer(-2.99).covers(roofs[0][0])


def test_no_surface_data_reported_with_diagnostics(context):
    class Missing:
        async def json(self, *args, **kwargs):
            count = len(kwargs["body"]["lon"].split("|"))
            return {"elevations": [{"measures": []}] * count}

    bundle = DataBundle(
        records=[GeoRecord(context.to_wgs84(box(-20, -20, 40, 40)), "building", "osm")]
    )
    roofs, source, diagnostics = asyncio.run(
        analyse_rooftops(Missing(), context, bundle, AnalysisOptions())
    )
    assert not roofs and source.status == "unavailable"
    assert diagnostics["roof_without_surface_data"] >= 1


def test_roof_ground_mix_contract_and_representative_ranking(polygon):
    class Mixed(FixtureProvider):
        async def rooftop_zones(self, context, bundle, options):
            p = context.search.representative_point()
            zone = box(p.x - 15, p.y - 15, p.x + 15, p.y + 15)
            return (
                [(zone, zone.buffer(3), assessment(), 0.9)],
                report("ign:roof_alti", "offline fixture", "available", "offline"),
                {},
            )

    request = SearchRequest(operation_area=polygon, max_candidates=2)
    result = asyncio.run(SiteFinderEngine(Mixed()).search(request))
    assert {f.properties.surface_type for f in result.features} == {"ground", "rooftop"}
    roof = next(f for f in result.features if f.properties.surface_type == "rooftop")
    assert roof.properties.uncertainty == "high" and roof.properties.pilot_position is None
    assert result.metadata.validation_status == "awaiting_operator_review"


def test_visibility_uses_roof_observer_elevation_and_thin_vector_obstacle():
    g = np.full((31, 31), 100.0)
    grid = TerrainGrid(g, g.copy(), 0, 300, 10)
    zone, op = box(20, 120, 40, 160), box(250, 120, 270, 160)
    obstacle = [(box(145, 0, 146, 300), 110.0, None)]
    options = AnalysisOptions(target_height_agl_m=10)
    ground = estimate_visibility(zone, op, grid, options, buildings=obstacle)
    roof = estimate_visibility(zone, op, grid, options, roof=assessment(), buildings=obstacle)
    assert ground.blocked_rays > 0 and ground.vector_obstacles_tested > 0
    assert roof.clear_fraction == 1 and roof.observer_surface == "rooftop"
    unknown = estimate_visibility(
        zone, op, grid, options, buildings=[(box(145, 0, 146, 300), None, None)]
    )
    assert unknown.unknown_rays > 0 and unknown.clear_fraction is None


@pytest.mark.parametrize(
    "changes",
    [
        {"include_ground": False, "include_rooftops": False},
        {"roof_edge_setback_m": 0},
        {"roof_shortlist_limit": 21},
    ],
)
def test_invalid_roof_configuration(changes):
    with pytest.raises(ValidationError):
        AnalysisOptions(**changes)


def test_unknown_building_heights_not_guessed_from_storeys():
    assert positive_number("12 m") == 12
    assert positive_number("unknown") is None
    assert positive_number(9999) is None


def test_large_roofs_keep_fine_patch_resolution(context):
    footprint = box(-300, -300, 300, 300)
    bundle = DataBundle(
        records=[GeoRecord(context.to_wgs84(footprint), "building", "ign:batiment")]
    )
    patches, count = building_roofs(context, bundle, AnalysisOptions())
    assert count > 12 and len(patches) == 12
    assert all(
        max(p[0].bounds[2] - p[0].bounds[0], p[0].bounds[3] - p[0].bounds[1]) <= 45.00001
        for p in patches
    )


def test_raster_coverage_union_preserves_small_obstacles_and_holes(context):
    mask = np.random.default_rng(17).random((32, 32)) > 0.4
    geometry = mask_geometry(mask, from_origin(0, 64, 2, 2), context.crs, context)
    assert geometry.is_valid
    assert geometry.area == pytest.approx(mask.sum() * 4)


def test_mapped_roof_equipment_receives_setback(context):
    from shapely.geometry import Point

    class Flat:
        async def json(self, *args, **kwargs):
            count = len(kwargs["body"]["lon"].split("|"))
            return {
                "elevations": [
                    {
                        "measures": [
                            {"title": "IGN - MNT - test", "z": 100},
                            {"title": "IGN - MNS - test", "z": 120},
                        ]
                    }
                ]
                * count
            }

    footprint = box(-30, -30, 30, 30)
    antenna = Point(0, 0)
    bundle = DataBundle(
        records=[
            GeoRecord(context.to_wgs84(footprint), "building", "osm"),
            GeoRecord(context.to_wgs84(antenna), "obstacle", "osm"),
        ]
    )
    roofs, _, _ = asyncio.run(analyse_rooftops(Flat(), context, bundle, AnalysisOptions()))
    assert roofs and all(not roof[0].intersects(antenna.buffer(9.99)) for roof in roofs)
    # Reported measurements count only sample centers on the final exported portion,
    # after the equipment setback and final width filter.
    for portion, _, roof, _ in roofs:
        expected = 0
        for patch, *_ in building_roofs(context, bundle, AnalysisOptions())[0]:
            a, b, c, d = patch.bounds
            frame = from_origin(a, d, 3, 3)
            rows, cols = max(3, int(np.ceil((d - b) / 3))), max(3, int(np.ceil((c - a) / 3)))
            if patch.buffer(1e-7).covers(portion):
                expected = sum(
                    portion.covers(Point(*(frame @ (col + 0.5, row + 0.5))))
                    for row in range(rows)
                    for col in range(cols)
                )
                break
        assert roof.surface_samples == expected >= 4


def test_missing_vector_source_keeps_ground_uncertainty_high(polygon):
    class Partial(FixtureProvider):
        async def acquire(self, context, options):
            bundle = await super().acquire(context, options)
            bundle.sources.append(
                report("ign:batiment", "offline missing source", "unavailable", "test")
            )
            return bundle

    result = asyncio.run(SiteFinderEngine(Partial()).search(SearchRequest(operation_area=polygon)))
    assert result.features and all(f.properties.uncertainty == "high" for f in result.features)
    assert result.metadata.status == "partial"

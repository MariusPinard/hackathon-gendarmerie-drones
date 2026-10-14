import math

import pytest
from shapely.geometry import shape

from drone_site_finder.geospatial.surfaces import geodesic_area_m2
from drone_site_finder.schemas.sites import SearchResponse

ENDPOINT = "/api/v1/sites/search"


def test_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.4.0", "mode": "analysis"}


@pytest.mark.parametrize("count", [1, 3, 10])
def test_analysis_response_contract(client, polygon, count):
    response = client.post(ENDPOINT, json={"operation_area": polygon, "max_candidates": count})
    assert response.status_code == 200
    result = SearchResponse.model_validate(response.json())
    assert result.type == "FeatureCollection"
    assert result.metadata.count == len(result.features)
    assert 1 <= len(result.features) <= count
    assert result.metadata.requested_count == count
    assert result.metadata.is_demo is False
    assert result.metadata.provider == "open_geodata"
    assert result.metadata.candidate_kind == "pilot_zone"
    assert result.metadata.contract_version == "0.4"
    assert result.metadata.sources and result.metadata.limitations
    ids = set()
    for feature in result.features:
        ids.add(feature.id)
        geometry = shape(feature.geometry.model_dump())
        assert feature.geometry.type == "Polygon"
        assert geometry.is_valid and geometry.area > 0
        assert shape(result.metadata.search_area.model_dump()).buffer(1e-10).covers(geometry)
        site = feature.properties
        assert site.is_demo is False
        assert site.score_kind == "measured_heuristic"
        assert site.uncertainty in {"medium", "high"}
        assert site.pilot_position is None
        assert site.area_m2 == pytest.approx(geodesic_area_m2(geometry))
        assert site.area_method == "geodesic_wgs84"
        assert site.component_count == 1
        expected_level = "high" if site.score >= 80 else "moderate" if site.score >= 70 else "low"
        assert site.relevance_level == expected_level
        assert site.takeoff_position is None
        assert site.visibility == site.radio_link == "not_assessed"
        assert site.justifications
        assert all(criterion.source != "synthetic" for criterion in site.criteria)
        assert sum(criterion.weight for criterion in site.criteria) == pytest.approx(1)
        weighted = sum((criterion.score or 0) * criterion.weight for criterion in site.criteria)
        assert site.score == pytest.approx(round(weighted, 1))
    assert len(ids) == len(result.features)


def test_default_candidate_limit_and_determinism(client, polygon):
    first = client.post(ENDPOINT, json={"operation_area": polygon}).json()
    second = client.post(ENDPOINT, json={"operation_area": polygon}).json()
    assert first["features"] == second["features"]
    assert len(first["features"]) <= 3


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Point", "coordinates": [2.3, 48.8]},
        {"type": "MultiPolygon", "coordinates": []},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []}},
        {"type": "Polygon", "coordinates": []},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [2, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 91], [1, 0], [1, 1], [0, 91]]]},
        {"type": "Polygon", "coordinates": [[[181, 0], [1, 0], [1, 1], [181, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0, 12], [1, 0, 12], [1, 1, 12], [0, 0, 12]]]},
        {"type": "Polygon", "coordinates": [[["0", 0], [1, 0], [1, 1], ["0", 0]]]},
        {"type": "Polygon", "coordinates": [[[True, 0], [2, 0], [2, 1], [True, 0]]]},
        {"type": "Polygon", "coordinates": [[[179, 0], [-179, 0], [-179, 1], [179, 0]]]},
        {
            "type": "Polygon",
            "coordinates": [
                [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                [[5, 5], [6, 5], [6, 6], [5, 5]],
            ],
        },
    ],
)
def test_invalid_geometry_returns_serializable_422(client, geometry):
    response = client.post(ENDPOINT, json={"operation_area": geometry})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert error["details"]
    assert all(set(item) == {"location", "message", "type"} for item in error["details"])
    assert all("input" not in item and "ctx" not in item for item in error["details"])


@pytest.mark.parametrize("count", [0, 11, -1, 1.5, "3", True, None])
def test_invalid_limit(client, polygon, count):
    response = client.post(ENDPOINT, json={"operation_area": polygon, "max_candidates": count})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["location"][-1] == "max_candidates"


def test_missing_polygon_and_malformed_json(client):
    assert client.post(ENDPOINT, json={}).status_code == 422
    response = client.post(
        ENDPOINT,
        content='{ "operation_area":',
        headers={
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_unknown_fields_and_projected_crs_are_rejected(client, polygon):
    assert (
        client.post(ENDPOINT, json={"operation_area": polygon, "mode": "real"}).status_code == 422
    )
    polygon["crs"] = {"type": "name", "properties": {"name": "EPSG:2154"}}
    assert client.post(ENDPOINT, json={"operation_area": polygon}).status_code == 422


def test_total_vertex_limit(client):
    def ring(radius):
        vertices = [
            [radius * math.cos(i * math.tau / 1000), radius * math.sin(i * math.tau / 1000)]
            for i in range(1000)
        ]
        return vertices + [vertices[0]]

    geometry = {"type": "Polygon", "coordinates": [ring(2), ring(1)]}
    response = client.post(ENDPOINT, json={"operation_area": geometry})
    assert response.status_code == 422
    assert "2000 positions" in response.json()["error"]["details"][0]["message"]


def test_openapi_exposes_both_contracts(client):
    schema = client.get("/api/openapi.json").json()
    operation = schema["paths"][ENDPOINT]["post"]
    assert "200" in operation["responses"] and "422" in operation["responses"]
    assert "PolygonGeometry" in schema["components"]["schemas"]
    assert "MultiPolygonGeometry" in schema["components"]["schemas"]
    geometry = schema["components"]["schemas"]["CandidateFeature"]["properties"]["geometry"]
    assert geometry["discriminator"]["propertyName"] == "type"
    assert set(geometry["discriminator"]["mapping"]) == {"Polygon", "MultiPolygon"}
    assert "ErrorResponse" in schema["components"]["schemas"]
    assert client.get("/api/docs").status_code == 200


def test_cors_allows_local_frontend_and_rejects_other_origin(client):
    headers = {
        "Origin": "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    allowed = client.options(ENDPOINT, headers=headers)
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == headers["Origin"]
    headers["Origin"] = "https://untrusted.example"
    rejected = client.options(ENDPOINT, headers=headers)
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_custom_cors_configuration(monkeypatch):
    from fastapi.testclient import TestClient

    from drone_site_finder.main import create_app

    monkeypatch.setenv("DRONE_CORS_ORIGINS", " https://planning.example ")
    with TestClient(create_app()) as custom_client:
        response = custom_client.options(
            ENDPOINT,
            headers={
                "Origin": "https://planning.example",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert response.headers["access-control-allow-origin"] == "https://planning.example"

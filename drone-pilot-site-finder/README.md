# Drone Pilot Site Finder

Version **0.4**, awaiting operator review, is a standalone surface-based engine using real data.
It returns candidate **pilot zones**, not automatically selected pilot GPS positions. The React
frontend is replaceable; there is no dependency on the future hackathon application.

**Decision support only.** A score, polygon, aerial interpretation or geometric visibility
estimate is never flight-safety validation, permission to enter land, a VLOS assessment or a
radio-link guarantee. An operator must inspect the ground and choose the exact position.

## V0.4: ground and rooftop review

Candidates now carry `surface_type: ground | rooftop`, a separate `score_profile`, and measured
roof evidence where applicable. Roof portions require local paired LiDAR-derived MNT/MNS data,
at least 80% valid interior samples and measured low slope. Footprints alone never prove flatness.
The engine recedes from roof edges, excludes measured raised residuals/steep cells and aerial
shadow/vegetation proxies, and reports remaining equipment uncertainty. A mapped street does
**not** establish roof access. Structural capacity, fall protection and owner permission are never
assessed automatically. All rooftop results have high uncertainty and mandatory inspection checks.

Enable either/both surface types in the UI; configure roof edge setback and slope. API options
also include `roof_sample_spacing_m` (default 3 m) and `roof_shortlist_limit` (default 12, max 20).
Large roofs are split into portions at most 45 m across, preserving requested local spacing; it is reported per zone. Regional sampling is bounded to
roughly 41×41 nodes. Visibility also intersects mapped building footprints/heights analytically;
missing intersected heights make otherwise clear rays unknown. Roof observers use measured roof
elevation. Geometric masking still cannot establish VLOS or radio performance.

Scores rank within their respective surface profile; results alternate ground/roof to expose both
types. Roof access defaults to unknown/zero contribution, even on a flat roof. The API adds fields
without removing the existing request wrapper or polygon/criterion fields; response revision is
`0.4`. No integration with the main hackathon application is included.

### Examine and reproduce the six real environments

After starting the frontend, open **Examiner les six environnements · V0.4**, select an environment,
then **Afficher l’analyse enregistrée**. This explicitly loads a dated real-data capture without
requerying providers; it is never an automatic fallback for a failed live search. Choose
**Préparer une nouvelle analyse**, then search, to acquire data again through the backend.

With the backend running, from this repository root:

```powershell
uv run python scripts/validate_environments.py
# One environment only:
uv run python scripts/validate_environments.py --case urban
```

Requests, captured responses and machine-readable observations are under
`frontend/public/validation/v0.4/`. Queries are sequential to respect public resources. Source
outages and empty results are retained in the report rather than replaced with invented geometry.
The script checks schema, geometry, containment, score sums and unknown roof-access semantics;
passing these checks is **not human validation**. See [the V0.4 report](docs/validation-v0.4.md).

## Implemented pipeline

1. Validate a WGS84 operation Polygon and a bounded, configurable surrounding search area.
2. Acquire OSM/Overpass and IGN BD TOPO buildings, roads/paths, vegetation, water, railways,
   power lines, pylons and mapped open surfaces.
3. Fetch georeferenced IGN BD ORTHO imagery and derive conservative RGB/texture evidence.
4. Sample IGN LiDAR HD **derived MNT/MNS**; use RGE ALTI for missing ground elevations.
5. Intersect positively mapped open surfaces with the search area. Subtract known exclusions,
   road carriageways, steep/high-surface raster cells and image obstruction proxies; filter
   known access proximity, area and narrow corridors. Split continuous components.
6. Refine ground elevations inside a bounded shortlist of zones. Estimate local slopes from
   triangles contained in each surface, reject measured slopes above the configured limit.
7. Score measured criteria with configurable weights, retaining missing values as `null`.
8. Estimate sampled geometric masking toward the operation area at the requested target AGL.
9. Query licensed Panoramax photo metadata within 200 m of the final ranked zones.
10. Display/select/reject surfaces and export GeoJSON with measurements, provenance, limits and
    local operator-review state. Review retention is not operational approval.

There is **no production synthetic fallback**. An unavailable essential vector source stops the
search with HTTP 503. Optional missing data lowers evidence coverage and cannot add score points.
A successful analysis can return zero candidates; it does not fill the map with invented zones.
Synthetic spatial fixtures exist only in offline tests, never in the default provider.

## Installation and execution

Requirements: Python 3.11+ (3.13 used for development), uv, Node.js 22.12+ and npm. A network
connection is required for dependency installation and live data acquisition.

From this repository root:

```powershell
uv sync --locked
cd frontend
npm ci
cd ..
```

Backend, terminal 1:

```powershell
uv run uvicorn drone_site_finder.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend, terminal 2:

```powershell
cd frontend
npm run dev
```

Open [the interface](http://127.0.0.1:5173), [Swagger](http://127.0.0.1:8000/api/docs) or
[OpenAPI](http://127.0.0.1:8000/api/openapi.json). Ctrl+C stops each process. The interface is
French; developer documentation is English. Vite proxies `/api` to port 8000. `npm run build`
builds the frontend; `npm run preview` serves the build on port 4173 with the same API proxy.

Load the arbitrary Fontainebleau example or draw a small operation area, inspect **Paramètres de
recherche**, then search. A first analysis can take about 1–2 minutes. The UI permits up to three
minutes and clears obsolete results after geometry/settings changes. Repeated requests may use
the one-hour in-memory source cache. Use **Zoomer sur la zone** for small candidate surfaces.

## API and configuration

`POST /api/v1/sites/search` keeps the existing request wrapper and FeatureCollection envelope.
The response revision is now `metadata.contract_version: "0.4"`, `mode: "analysis"`,
`provider: "open_geodata"`, `is_demo: false`. Old synthetic responses are rejected by the UI.

```json
{
  "operation_area": {"type":"Polygon","coordinates":[[[2.672,48.401],[2.693,48.401],[2.701,48.411],[2.693,48.423],[2.672,48.420],[2.666,48.410],[2.672,48.401]]]},
  "max_candidates": 5,
  "options": {
    "search_radius_m": 300,
    "surroundings_only": true,
    "min_area_m2": 100,
    "min_width_m": 5,
    "obstacle_buffer_m": 10,
    "max_access_distance_m": 100,
    "max_slope_deg": 12,
    "terrain_spacing_m": 10,
    "target_height_agl_m": 30,
    "require_terrain": false
  }
}
```

PowerShell request with the backend running:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8000/api/v1/sites/search' -ContentType 'application/json' -Body (Get-Content -Raw examples/search-request.json)
```

| Option | Meaning / limits |
| --- | --- |
| `search_radius_m` | Expansion around the operation; 0–2000 m, default 300 |
| `surroundings_only` | Exclude the operation interior; default true, requires a positive radius |
| `min_area_m2` | Candidate area threshold; 25–100,000 m², default 100 |
| `min_width_m` | Morphological width filter; 2–100 m, default 5 |
| `obstacle_buffer_m` | Recession from mapped buildings/power/rail obstacles; 1–100 m, default 10 |
| `max_access_distance_m` | Distance to a mapped eligible road/path; 5–1000 m, default 100 |
| `max_slope_deg` | Known estimated slope cutoff; 1–40°, default 12 |
| `terrain_spacing_m` | Desired regional sample spacing; 5–100 m; coarsened to bound requests |
| `observer_height_m` | Hypothetical visibility observer height; 1–10 m, default 1.7 |
| `target_height_agl_m` | Visibility target above local terrain; 1–500 m, default 30; not an authorized flight altitude |
| `require_terrain` | Reject zones without sufficient slope measurements; default false |
| `use_osm`, `use_ign` | Enable OSM or BD TOPO vector queries; both default true |
| `use_imagery`, `use_lidar`, `use_panoramax` | Optional evidence sources; all default true |
| `weights` | All six keys below, each 0–1, positive total; normalized by the engine |

Geometry is strictly 2D [longitude, latitude], finite and topologically valid. Polygon holes are
supported. The study is limited to 25 km² and 7 km across including its buffer. The operation
input remains Polygon; candidate transport supports Polygon/MultiPolygon. Generated candidates
are individual continuous Polygons, retaining holes; no disconnected pieces are bridged.

Backend environment (set in the shell; `.env.example` is a reference, not autoloaded):
`DRONE_CORS_ORIGINS`, `DRONE_USER_AGENT`, and optional administrator-configured
`DRONE_OVERPASS_URL`. Frontend settings are in `frontend/.env.example`; copy to `.env.local`
and restart Vite. `VITE_TILES_ENABLED=false` disables only the basemap, not analysis sources.

## Explainable scoring

| Criterion | Default weight | Measurement and normalization |
| --- | --- | --- |
| `accessibility` | 20% | Minimum distance to a mapped eligible road/path; declines to zero at configured access distance |
| `area` | 15% | WGS84 geodesic area, saturating at five times the configured minimum |
| `slope` | 20% | Maximum estimated local triangle slope; declines to zero at the slope limit |
| `obstacles` | 15% | Distance to known vector obstacles, saturating at three times the obstacle buffer |
| `openness` | 20% | Fraction of aerial pixels with low texture and no shadow/canopy proxy |
| `proximity` | 10% | Minimum distance to the operation, declining across the search radius |

Unknown measurements and criterion scores are `null`. The total is a conservative weighted sum:
unknown criteria add no points and their weights are **not redistributed**. `evidence_coverage`
is the sum of weights with measured scores; it is not a spatial-completeness or safety probability.
No known obstacle in the downloaded vectors is treated as unknown clearance, not infinite clearance.
Colors are indicative score bands: green ≥80, amber ≥70, red <70. Uncertainty remains medium/high.

## Sources, licensing and privacy

- OSM through Overpass: [ODbL and attribution](https://www.openstreetmap.org/copyright),
  [public service resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
- IGN BD TOPO WFS and BD ORTHO WMS: [IGN service terms](https://cartes.gouv.fr/cgu/),
  Licence Ouverte 2.0 with attribution. No API key or paid source is needed.
- LiDAR HD derived MNT/MNS and RGE ALTI via the official
  [altimetry API](https://data.geopf.fr/altimetrie/api/index.html).
  Native product resolution and **actual sample spacing** are different; the latter is exposed.
- Panoramax [federated API](https://docs.panoramax.fr/backend/api/api/): image-level licence,
  author and capture date retained; metadata without a licence is skipped. Images without
  author attribution are linked for original-site inspection rather than embedded.
- The background map retains [OSM tile attribution and policy](https://operations.osmfoundation.org/policies/tiles/).

Every analysis reports source status, dataset/service, licence, attribution, consultation time,
known acquisition date and limitations. Unknown acquisition dates stay unknown. Cache consultation
is not proof of dataset freshness. OSM-derived exported databases can carry ODbL obligations;
retain all metadata and review exact redistribution requirements before publishing combined outputs.
Photos retain their own licence; they are not relicensed with GeoJSON.

Public providers receive the geographic query extent and sampled coordinates. The local application
has no authentication and does not deliberately persist operation requests. The bounded cache is
memory-only (64 MB / 128 entries / one-hour TTL). Use approved/self-hosted services for confidential
operations. Public services have no SLA. WFS is capped at 3000 features per layer and truncation is
explicitly reported. The UI displays missing sources and permits a restrictive terrain requirement.

## Limits and intentionally conservative behavior

The image module is **classical computer vision** (RGB, texture, morphology). It refines positively
mapped open surfaces; it never invents candidate ground solely from color. It does not identify
all trees/buildings/people or certify clear ground. A pretrained neural model was not made a default:
a suitable aerial model, its licence and representative evaluation must precede semantic claims.
No model is trained and no GPU/model download is required.

The regional 3D grid is bounded to roughly 41×41 nodes. Local ground slope refinement uses up to ten
interior points on each of at most 50 shortlisted surfaces. This can miss microrelief and narrow
obstacles. Missing DSM values make affected visibility rays unknown; RGE ground fallback never
pretends to provide building/canopy heights. Ground-only results are explicitly `terrain_only`.
Internal observer samples are mathematical probes, not proposed pilot GPS positions. Straight-line
rays ignore atmospheric/refraction effects and do not model radio propagation or human eyesight.

Known roads are access **proxies**, not proof of permission/passability. A parking polygon may be
occupied, a sports field unavailable, terrain slippery or vegetation seasonal. Restrictions not in
source data, people, fences, temporary obstacles and all operational authorizations need human checks.
Ranking is heuristic and not calibrated against a labelled field dataset. Coverage/date differences,
provider outages and the bounded shortlist can change the ordering or yield fewer/zero zones.

## Architecture

```text
backend/src/drone_site_finder/
  api/              versioned routes, admission control, errors
  schemas/          GeoJSON, configuration, criteria, provenance, visibility
  providers/        bounded HTTP/cache, OSM, IGN vectors/rasters, local terrain, Panoramax
  geospatial/       validation, metric projection, exclusions, components, area, masking
  image_analysis/   aerial RGB/texture evidence
  candidates/       continuous positive-evidence surface generation
  scoring/          normalized explainable criteria and unknown handling
  services/         source-independent orchestration and ranking
frontend/src/       map, geometry drawing, settings, evidence and local human review
backend/tests/      offline spatial fixtures, contracts, provider parsing, failure cases
```

FastAPI/Pydantic provide the exchange contract; Shapely/pyproj handle geometry and units;
Rasterio handles georeferencing/masks; NumPy/SciPy and Pillow handle raster evidence. Providers can
be replaced independently, and the service has a provider interface for offline tests. No database,
main hackathon UI, mission optimizer, drone inventory or deployment pipeline is introduced.

## Verification and next work

```powershell
uv run pytest
uv run ruff check .
uv run ruff format --check .
cd frontend
npm run build
```

Tests are offline and cannot silently query live providers. Real API/browser checks and their limits
are recorded in [verification.md](docs/verification.md). See [API contract](docs/api-contract.md),
[architecture](docs/architecture.md), [source details](docs/data-sources.md), and [roadmap](docs/roadmap.md).
The next priorities are field evaluation, better acquisition-date metadata, finer validated 3D
processing, an aerial-specific optional pretrained model and production job/authentication controls.

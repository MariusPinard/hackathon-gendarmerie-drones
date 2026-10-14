# V0.4 additive extension — pending human validation

The request wrapper, FeatureCollection, surface geometry and six criterion keys remain stable.
The response advertises `contract_version: "0.4"`; consumers that enforce an exact revision must
upgrade. Existing requests without new options still work, with ground and rooftop search enabled.
New options: `include_ground`, `include_rooftops`, `roof_edge_setback_m` (2–20, default 3),
`max_roof_slope_deg` (1–20, default 8), `roof_sample_spacing_m` (1–10, default 3) and
`roof_shortlist_limit` (1–20, default 12). Disabling both types is a validation error.

Feature properties add `surface_type: ground | rooftop`, `score_profile: ground_v1 | rooftop_v1`,
and nullable `roof`. Roof evidence reports measured surface elevation/height, slope, effective
sample spacing, valid fraction/sample count, roughness, suspected/not-resolved equipment,
mapped/unknown access, edge setback and mandatory human checks. `structural_capacity`,
`fall_protection` and `permission` remain `not_assessed`. A flat roof never establishes these.
No MNS support means no rooftop candidate, even if OSM tags describe a flat roof.

Roof access has different semantics from ground road proximity. Unknown access is null and adds
no score; explicitly mapped roof access receives only indicative evidence, never permission.
Weights are not redistributed. Roof uncertainty is always high. Ranking alternates the two
internally ranked surface profiles rather than claiming that their scores are directly equivalent.

Visibility adds `observer_surface` and `vector_obstacles_tested`. Roof observer elevation is based
on local MNS measurements; mapped building heights supplement raster rays. Metadata adds
`phase_seconds`, diagnostics, ranking semantics and `validation_status: awaiting_operator_review`.
Neither recorded captures nor test success changes this status. The historical V0.3 reference
below explains unchanged fields; its revision literal is superseded by this extension.



# Historical V0.3 ground contract

## Request

`POST /api/v1/sites/search` receives `operation_area` (WGS84 Polygon geometry), optional
`max_candidates` (1–10, default 3), and optional `options`. All configuration constraints and
weight keys are listed in the README and generated `/api/openapi.json`. The operation is limited
to 25 km² / 7 km including the buffer. Coordinate order is [longitude, latitude]; altitude
coordinates, projected CRS, unclosed/invalid rings and antimeridian-spanning inputs are rejected.

## Success

The response is a GeoJSON FeatureCollection of continuous Polygon candidates. The shared
geometry contract also accepts MultiPolygon with explicitly counted distinct components. No
Point recommendation is generated. The candidate count may be less than requested or zero.

| Property | Meaning |
| --- | --- |
| `id`, `geometry` | Geometry-derived identifier and complete candidate surface; not a persistent site identity |
| `is_demo` | Always false in production revision 0.3 |
| `area_m2`, `area_method` | Positive geodesic WGS84 surface area, including holes |
| `component_count` | Matches geometry; generated zones have one continuous component |
| `score`, `score_kind` | Conservative 0–100 heuristic ranking, `measured_heuristic` |
| `criteria[]` | Key/label, measured `value`/`unit`, nullable `score`, normalized weight, source and explanation |
| `evidence_coverage` | Sum of weights with measured scores; not a spatial/safety probability |
| `missing_data` | Unknown criterion keys; missing measurements and scores are null |
| `uncertainty` | Medium/high; external coverage and field conditions remain uncertain |
| `relevance_level` | High ≥80, moderate ≥70, low <70; never operational clearance |
| `evidence`, `justifications`, `source_ids` | Evidence interpretation, rule explanations and consulted source references |
| `visibility_estimate` | Model type, known/blocked/unknown ray counts, clear fraction, sampling, heights and limitations |
| `ground_photos[]` | Nearby Panoramax original/thumbnail links, author, capture date, image licence and distance |
| `pilot_position`, `takeoff_position` | Null; exact pilot placement and takeoff remain human/separate decisions |
| `visibility`, `radio_link` | Legacy fields remain `not_assessed`; sampled geometry is only in `visibility_estimate` |

Metadata identifies `contract_version: "0.3"`, `candidate_kind: "pilot_zone"`, `mode: "analysis"`,
`provider: "open_geodata"`, `is_demo: false`, counts, source reports, search polygon, metric CRS,
effective terrain spacing, elapsed seconds, applied options, excluded area, warnings and limits.
Source status is available/partial/unavailable/disabled. Available means a usable response, not
an exhaustive inventory. Unknown acquisition dates remain null; consultation/cached access time
is not acquisition time. Truncation and elevation NoData are never treated as complete evidence.

The UI export adds `metadata.operator_review` and `review_scope: "local_not_operational_approval"`.
This annotation is local user review, not a modified server measurement or authorization.
The tracked [example response](../examples/candidate-zones-response.json) is a dated real-data
snapshot; it is never loaded by the engine. Live ordering/availability may differ.

## Errors

- 422 invalid geometry/parameters: `error.code: invalid_request`, message and field-level details.
- 422 excessive study extent: `error.code: area_too_large`, message and source list.
- 429 another analysis is active: `error.code: analysis_busy`.
- 503 no usable essential building vector coverage, or required terrain unavailable:
  `error.code: analysis_unavailable`, message and `sources` reports.
- 504 analysis deadline exceeded: `error.code: analysis_timeout`.

Optional source failures can return 200 with partial metadata, null measurements and conservative
scores. Zero eligible surfaces returns 200, empty features and `status: no_candidates`; there is
no synthetic substitute. Unknown routes use FastAPI's normal 404 envelope.

## Migration and integration

Keep the request wrapper, endpoint and FeatureCollection integration boundary. Revision 0.2 was
synthetic; revision 0.3 uses false demo flags, `measured_heuristic`, nullable criteria and real source
metadata. Read the revision before interpreting data. Do not derive an automatic pilot coordinate
from a centroid or equate a geometric mask fraction with radio reliability or human VLOS.
A future planning application can replace the frontend and call the API or injected-provider
Python service. Human-chosen exact coordinates require an independent review model.

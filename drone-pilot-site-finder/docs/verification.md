# Verification records

## Version 0.4 — ground/rooftop development, pending user validation

On 2026-10-14: **88 tests passed**, without Python warnings; Ruff, formatting, locked dependency
verification and strict TypeScript/Vite build passed. Roof tests include measured flat/steep/missing
surface cases, unknown access, setbacks from equipment, final-portion sample counts, fine-resolution
patches on large buildings, roof-elevated visibility and missing vector-source uncertainty.

The final live HTTP suite covered Paris BnF, Avon, Janville-en-Beauce, Fontainebleau forest,
Chamonix's wooded slope and Grenoble campus STAPS. Ground/roof counts were respectively 3/3,
2/4, 4/0, 0/0, 0/0 and 3/3; HTTP times were 17.01, 17.71, 14.30, 6.10, 6.44 and 12.89 seconds.
Schema, geometry containment, weighted score sums and unknown roof access checks passed for all.
Rural MNS was unavailable, with explicit RGE ALTI ground fallback and no inferred roofs.
Earlier OSM 429/orthophoto outages are retained as earlier observations, not hidden.

All six recorded real results were inspected in the frontend over IGN imagery and captured under
`docs/validation-v0.4/`. The UI distinguishes recorded review from a new live request, ground from
roof via labels/boundaries, and unverified roof access/structure/fall protection from measurements.
The rooftop building diagnostic keys count shortlisted **portions**, not unique buildings.
The recorded example response is now a 0.4 snapshot; the 0.3 notes below are historical.

See [the French report](validation-v0.4.md) for per-zone surfaces/scores, provenance, screenshots,
observed limitations and exact reproduction commands. Tests do not constitute operational or human
validation. This version remains `awaiting_operator_review` until the user's feedback.

## Version 0.3 — real open-data analysis

Verified locally on Windows, 2026-10-14, with Python 3.13.1, Node.js 24.11.0 and locked
dependencies. Automated tests use isolated offline fixtures; the default live provider never
loads them. Live observations are evidence for this run, not promises about provider availability
or the quality of other locations.

| Check | Result |
| --- | --- |
| `uv run pytest` | **70 passed**, no warnings |
| Ruff checks and formatting | Passed |
| `npm run build` | Strict TypeScript and Vite production build passed |
| API contract | Revision `0.3`, real-data flags, nullable measurements, source/visibility schemas and documented validation/source/deadline errors |
| Geometry and scoring | Polygon holes, geodesic area, containment, minimum width, obstacle setbacks, missing criteria without weight redistribution, local slopes and configurable constraints |
| Provider parsing | OSM relation holes/private buildings, WFS truncation, LiDAR MNT/MNS distinction and NoData, photo author/licence/date and source failures |
| Visibility | Clear, obstructed, unknown and ground-only rays; no VLOS/radio claim |
| Unavailable data | Essential vector failure returns 503; optional gaps remain unknown; strict terrain requirement and zero-result response checked |
| Real sources | Actual OSM, BD TOPO, BD ORTHO, LiDAR-derived elevations and Panoramax responses obtained without a paid key |
| Browser through Vite/API | Real Fontainebleau example: 5 surfaces in 82.66 s, then 86.49 s after final backend restart, with the same measured ranking |
| Browser selection/review | Surface/card selection, zone zoom, retention for inspection and rejection verified; the exported review is explicitly not operational approval |
| Browser basemaps | OSM/IGN switch verified; actual orthophoto tiles and IGN attribution displayed beneath the surfaces |
| Browser console | No JavaScript errors in the final real-data run |
| Browser export | Downloaded GeoJSON verified with 5 real Polygon features, measurements, sources, photo licences and local rejection annotation |

The observed run used 6787 OSM records. IGN buildings reached the explicit 3000-feature cap;
the source was reported **partial** and uncertainty remained high. Other BD TOPO layers included
1643 road segments, 47 vegetation surfaces, 8 water surfaces, 26 sports surfaces and 2 power lines.
Orthophoto sampling was approximately 3.11 m/pixel. The regional elevation grid contained 506
paired samples at an actual spacing of **145.04 m**, despite the finer requested spacing; this
coarsening is exposed in the API/UI. Separate local refinement obtained 117 ground points.

Returned areas were approximately 823, 747, 862, 337 and 303 m², with indicative scores of
80.7, 80.0, 79.1, 78.6 and 77.4. The top zone had an estimated slope of 1.23°, a mapped-access
distance of 2.7 m and a 90.36% low-texture aerial fraction. These are heuristic measurements,
not field validation. Nearby Panoramax photographs credited geovelo, dated **2018-01-11**, with
their returned Licence Ouverte links visible. Their age limits present-day inspection value.

At this revision, `examples/candidate-zones-response.json` held a captured real response from this
run; it has since been replaced by a V0.4 capture. Such snapshots are never runtime fallbacks.
Historical 0.1/0.2 verification below refers to the earlier demo implementations;
their synthetic example response has been replaced by the 0.3 real snapshot.
The local final screenshot is saved in ignored `artifacts/real-analysis-orthophoto.jpg`.

Remaining limits: no field-labelled ranking benchmark, no pretrained semantic aerial model,
no raw LiDAR point-cloud processing, coarse regional visibility, bounded local terrain samples,
dated/incomplete public data and public-service quotas. Mobile hardware, distributed deployment
and future hackathon integration were not validated. The neural model and finer 3D work are
explicit roadmap items rather than claims made by this implementation.

## Version 0.2 — Candidate Pilot Zones

Verified locally on Windows, 2026-10-14, using the locked dependencies and existing Python 3.13.1 /
Node.js 24.11.0 environment.

| Check | Result |
| --- | --- |
| `uv run pytest` | **56 passed**, no warnings |
| Ruff checks and formatting | Passed |
| `npm run build` | Strict TypeScript and Vite production build passed |
| API surface contract | Polygon/MultiPolygon discriminated union, revision `0.2`, `pilot_zone` semantics |
| Geometry tests | Continuous positive-area contained polygons, holes preserved, non-overlapping fixtures, concave/tiny input and thin-input fallback |
| WGS84 area tests | Known equatorial area, latitude sensitivity, hole subtraction, winding invariance and multipart area sum |
| Multipart validation tests | Invalid overlaps/shared edges and rings rejected; aggregate vertex limit and component count checked |
| Browser: normal search | 3 colored continuous Polygon candidates with area, criteria, synthetic score and uncertainty |
| Browser: surface selection | Mouse and Enter selection update details; SVG focus preserved on selection |
| Browser: multipart fixture | MultiPolygon with two distinct components and an interior hole rendered correctly; component count and area displayed |
| Browser: export | GeoJSON file verified: revision `0.2`, `pilot_zone`, 3 Polygon features, positive area, demo flags, `pilot_position: null` |
| Browser: edit operation perimeter | Old surfaces cleared immediately; search disabled during editing; cancel/research works |
| Browser console | No runtime errors in the surface/multipart checks; existing Leaflet.draw edit deprecation warning remains |

The multipart browser check used an isolated temporary fixture server, not a change to production
generation: normal generation emits one continuous Polygon per candidate. No real surface
suitability, terrain, access, visibility, radio or operational authorization was assessed.
The complete example response is tracked in `examples/candidate-zones-response.json`.
The local screenshot is in ignored `artifacts/candidate-pilot-zones.jpg`.

## Version 0.1 — initialization (historical)

Executed locally on Windows, 2026-10-14, with Python 3.13.1, Node.js 24.11.0 and npm 11.6.1.
Dependency versions are recorded in `uv.lock` and `frontend/package-lock.json`.

| Check | Result |
| --- | --- |
| `uv run pytest` | **41 passed**, no Python warnings |
| `uv run ruff check .` | Passed |
| `uv run ruff format --check .` | Passed |
| `npm run build` | Strict TypeScript check and Vite production build passed |
| Initial npm installation audit | 0 vulnerabilities reported at installation time |
| Actual HTTP health and search through Vite proxy | HTTP success; 3-feature GeoJSON response, `is_demo: true` |
| Browser: load example and search | Polygon, 3 fictitious markers, score details and demo labels displayed |
| Browser: draw polygon manually | 4 vertices, closed polygon, successful API search |
| Browser: select map marker | Corresponding result card expanded |
| Browser: edit geometry | Vertex moved, geometry saved, indicative area changed; old results cleared |
| Browser: retain a demo candidate | Temporary review state displayed |
| Browser: export GeoJSON | Downloaded FeatureCollection with 3 features, collection demo flag and synthetic feature scores verified |
| Browser: delete geometry through map toolbar | Empty zone, results cleared, search disabled |
| Browser: stop backend and search | Visible API error and offline status; no stale candidates |
| Browser: restart backend and retry | Successful results and online status restored |

The optional live area tooltip in Leaflet.draw 1.0.4 initially raised a `ReferenceError` during
drawing in a strict bundle. It is disabled; the independent sidebar area estimate remains.
The four-vertex drawing and edit workflows were rerun successfully after this correction.
Leaflet.draw emits an upstream `_flat` deprecation warning during editing; no JavaScript
runtime error remained in the corrected drawing/editing test. The deliberate backend shutdown
test produces expected failed HTTP requests.

A local final screenshot is saved under ignored `artifacts/demo-overview.jpg`. Tests used only
arbitrary demonstration geography; no real site suitability, data acquisition, flight safety,
geometric visibility or radio-link assessment was performed. Responsive CSS is included, but
the browser smoke test used the desktop browser's available viewport, not a physical mobile device.

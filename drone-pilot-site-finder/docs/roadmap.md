# V0.4 — implemented, awaiting user review

- [x] Separate ground/rooftop types, score profiles and operator checks.
- [x] Local paired MNT/MNS roof slope/height, edge recession and equipment proxies.
- [x] Explicit unknown roof access, structural capacity, fall protection and permission.
- [x] Finer regional sampling, mapped building-height visibility and phase timings.
- [x] Reproducible real-data environment suite and deliberate recorded-result UI.
- [ ] User review of the six environments and explicit feedback before validation.
- [ ] Field checks with qualified building/site operators; calibrate screening errors.
- [ ] Finer roof sampling/raw clouds, validated aerial model and roof equipment inventory.
- [ ] Better dataset ages, durable jobs and resource limits for shared hosting.

Passing tests does not close the user-review item. The user authorized publication on a dedicated
branch of the hackathon repository; integration into the main app and merging remain out of scope.



# Roadmap after the real-data engine

## Implemented in 0.3

- [x] Real OSM and BD TOPO acquisition with bounds, caching, licences and failure statuses.
- [x] BD ORTHO RGB/texture evidence and optional inspection basemap.
- [x] LiDAR HD derived MNT/MNS with RGE ALTI ground fallback.
- [x] Configurable surrounding search, positive-evidence surfaces, exclusions, width/area/access filters.
- [x] Separate local terrain sampling and contained-triangle slope estimates.
- [x] Six measured/nullable criteria, custom weights, conservative scoring and missing-data reporting.
- [x] Sampled geometric masking with explicit terrain-only/DSM/unknown states.
- [x] Local Panoramax images with original links, author, licence and capture date.
- [x] Interactive polygons, settings, evidence, selection/rejection and provenance-preserving export.
- [x] Offline tests plus real provider, API and browser verification.

## Next: evaluate before expanding claims

Build a small licensed field-review dataset with accepted/rejected surfaces, dates and reasons.
Measure false-positive/false-negative screening and ranking stability, including parking occupancy,
private access, shadows, agricultural/seasonal changes and microrelief. Calibrate thresholds/weights
with operators. Human field checks and exact pilot selection remain mandatory.

## Better metadata and geography

Add acquisition dates from orthophoto mosaic footprints and dataset editions; verify vertical
reference compatibility per territory. Improve per-feature provenance and spatial completeness
masks. Add approved/self-hosted sources and recorded real-data regression fixtures with licences.
Improve Overpass relation/tag semantics and layer pagination/spatial subdivision while respecting
public quotas; never silently assume complete obstacle inventories.

## Higher-quality 3D and image analysis

Use clipped high-resolution raster/COPC processing where justified by area/cost. Add uncertainty
from native resolution, sampling, classification, age and occlusion; evaluate thin wires and
vegetation changes. Separate geometric masking, actual human VLOS and any future radio model.

Benchmark an optional pretrained aerial-specific segmentation model with verified weight/data
licences and representative labelled imagery. No training of a project-specific model is planned.
Classical RGB/texture output remains a low-confidence evidence layer, not semantic truth. Add
within-zone suitability variation rather than promoting one good sample to an entire-zone guarantee.

## Production and future hackathon integration

Introduce durable async jobs, progress/cancellation, authentication, resource budgets and distributed
rate limiting before shared/multi-worker hosting. Persist human reviews separately from immutable
analysis provenance. Add contract/version regression tests with the future main app once it exists.
The main app owns priority polygons, drone availability, resource estimates and coverage optimization.

The current engine is functional decision support, not a validated operational planning authority.

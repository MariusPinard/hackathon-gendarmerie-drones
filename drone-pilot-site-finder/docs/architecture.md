# V0.4 extensions

`candidates/rooftops.py` deduplicates IGN/OSM building footprints, recedes from edges and samples
a bounded shortlist using paired MNT/MNS. Local low-slope cells survive only with sufficient
finite coverage and at least 2 m surface/ground separation. Raised median-filter residuals are
equipment proxies and receive setbacks. Image shadows/vegetation further restrict measured
roof portions. This is screening, not structural or access assessment.

Ground terrain and rooftop refinement run concurrently under the shared IGN rate limiter.
Input geometry is clipped to the relevant metric extent before expensive ground unions. Regional
terrain has a roughly 41×41 cap, and phase timings expose real bottlenecks. Building footprints and
explicit heights supplement visibility rays, including thin buildings missed by the raster.
Unknown intersected building heights stay unknown; storey counts are never invented heights.

Roof scoring reuses criterion transport with a separate profile and different access semantics.
The engine alternates surface types after ranking within each type. The frontend marks roofs
with dashed boundaries, shows mandatory roof checks and explicitly distinguishes recorded real
captures from live searches. Captures live in public validation artifacts solely for deliberate
review. They are never queried by the live provider.

Human validation remains pending. Publication is limited to a dedicated branch containing this
independent module; no hackathon application integration is introduced.
The original V0.3 architecture below describes the underlying ground pipeline; the regional
23×23 cap is superseded by 41×41 and contract 0.3 by 0.4.



# Historical V0.3 ground architecture

## Dependency order

`schemas` validates operation geometry/options → `providers` acquires evidence → `geospatial`
projects/prepares data → `image_analysis` produces conservative raster evidence → `candidates`
extracts continuous surfaces → local terrain refinement → `scoring` ranks measured criteria →
`visibility` estimates sampled masking → Panoramax local inspection → GeoJSON API → replaceable UI.

`SiteFinderEngine` accepts a provider implementing `acquire(context, options)`, with optional
`refine_terrain` and `nearby_photos` stages. Tests inject offline fixtures; production defaults
exclusively to `OpenDataProvider`. No runtime import or path reads a fixture or demo response.

## Geometry and measurement

The user Polygon is strictly validated and never repaired. Provider geometries are converted to
2D and made valid when necessary. Processing uses a local WGS84 azimuthal equidistant projection
in metres; GEOS degree-squared areas are not reported as m². Output areas use WGS84 geodesics.
Output surfaces are clipped again in the exported CRS to avoid boundary differences caused by
reprojecting straight segments. Holes remain explicit and disconnected pieces stay separate.

Positive evidence is mapped grass/meadow/recreation/park/pitch/parking/bare-ground surfaces or
IGN sports surfaces, not unmapped land left over after subtraction. Road carriageways, known
buildings, vegetation, water, restrictions, rail/power obstacles, sampled steep/high-surface
cells and image obstruction proxies are subtracted. Access-distance filtering uses eligible
mapped roads/paths. Morphological opening rejects narrow corridors; simplification is clipped
inward. Minimum area, width, setbacks, search radius and slope are operator-configurable.

## Raster and 3D stages

BD ORTHO is requested in EPSG:3857 at bounded dimensions, with a pixel transform. RGB color and
local texture provide low-confidence canopy/shadow and clear-looking evidence, never a trained
semantic classification. Raster masks are transformed to the metric analysis CRS before clipping.

The regional elevation grid is roughly 23×23 nodes, with actual spacing exposed. LiDAR-derived
MNT and MNS are parsed separately; missing ground can fall back to RGE ALTI. Missing MNS remains
unknown. A shortlist of at most 50 surfaces receives up to ten internal ground samples each;
valid Delaunay triangles contained in each zone estimate maximum local slope. Missing/insufficient
samples remain unknown. Known steep zones are rejected; `require_terrain` rejects unknown slope.

Visibility tests up to three internal observer samples against up to ten operation-area targets
at configured observer/target AGL heights. Each straight ray samples the regional grid. Missing
values make a ray unknown. A ground-only model is labelled `terrain_only`; DSM support is labelled
`surface_model`. Counts/fraction refer to these rays, not every location in a zone. There is no
radio/VLOS assessment, atmospheric refraction model or thin/temporary-obstacle guarantee.

## Transport, resources and state

`/api/v1/sites/search` retains the existing JSON wrapper and FeatureCollection. Revision 0.3
changes synthetic flags/criterion types and adds real provenance/measurements; clients must
migrate. The generated OpenAPI documents schemas/errors. `pilot_position` stays null; a future
human-selected position belongs to a separate review/planning model.

HTTP requests have time/size bounds, a shared bounded in-memory one-hour cache, conservative IGN
rate limiting and source-specific failure reports. Heavy candidate geometry runs off the event
loop. One analysis is admitted per process; concurrent analysis requests receive 429. Optional
photo queries have a separate short deadline. The HTTP analysis deadline is 165 seconds; the UI
waits up to 180 seconds. Browser cancellation clears old results; it is not a persistent job
cancellation protocol. Use a job queue/shared limits before multi-worker production deployment.

The UI separates operation/search surfaces from candidate layers. It provides configuration,
criterion evidence, missing data, visibility assumptions, licensed photos, source reports, OSM
and IGN orthophoto basemaps, human selection/rejection and export. Review state is local browser
memory and an explicit export annotation, not an API safety approval or durable workflow.

Authentication, distributed jobs, weather, drone inventory, resource estimation and coverage
optimization are not part of this independent engine.

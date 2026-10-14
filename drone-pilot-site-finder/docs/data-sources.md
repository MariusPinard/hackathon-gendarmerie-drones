# Active data sources and licence notes

Verified 2026-10-14 by real HTTP requests around the arbitrary Fontainebleau example.

| Source | Active endpoint / product | Evidence / reuse |
| --- | --- | --- |
| OpenStreetMap | `https://overpass-api.de/api/interpreter` | Buildings, roads/paths, land use, parks/fields, water, restrictions, rail/power/barriers; ODbL 1.0, © OpenStreetMap contributors |
| IGN BD TOPO | `https://data.geopf.fr/wfs/ows` | `BDTOPO_V3:batiment`, `troncon_de_route`, `zone_de_vegetation`, `surface_hydrographique`, `terrain_de_sport`, `ligne_electrique`, `pylone`, `troncon_de_voie_ferree`; Licence Ouverte 2.0, © IGN |
| IGN BD ORTHO | `https://data.geopf.fr/wms-r` / `ORTHOIMAGERY.ORTHOPHOTOS` | Georeferenced aerial RGB/texture and optional inspection basemap; Licence Ouverte 2.0, © IGN |
| IGN LiDAR HD derivatives | Official elevation API, `ign_lidar_hd_mnx_mono_wld` and local-ground `ign_lidar_hd_mnt_mono_wld` | MNT/MNS sampled separately, not raw cloud downloads; Licence Ouverte 2.0, © IGN |
| IGN RGE ALTI | Official elevation API, `ign_rge_alti_wld` | Ground-only fallback, never invented building/canopy heights; Licence Ouverte 2.0, © IGN |
| Panoramax | `https://api.panoramax.xyz/api/search` | Per-zone 200 m queries, image-level licence, author and capture date preserved |

Elevation endpoint: `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json`.
The API returns -99999 for NoData; the engine converts it to unknown. IGN requests are kept below
five/s per process. Actual regional sampling is bounded/coarsened and exposed; native LiDAR product
resolution must not be presented as the engine's effective sampling resolution.

The vector interface uses CRS84 to avoid WFS latitude/longitude axis ambiguity. Third coordinates
in BD TOPO are explicitly dropped for horizontal geometry; elevation comes from documented raster
resources. Local processing uses metric projection and WGS84 area. Publication/licensing does not
prove completeness, accuracy, currency, permission to enter, absence of people or flight legality.

Sources are cached only in bounded memory for up to one hour. Large responses are rejected;
WFS pagination stops at 3000 features/layer and marks truncation partial. The live check reached
that building cap while OSM supplied usable additional coverage. Public-source availability is
best effort. A provider failure has a distinct status from a successful empty dataset.

Panoramax metadata without a licence link is omitted. A thumbnail is embedded only with an author;
otherwise the original-site link is available for inspection. The live example includes older
photos (2018), displayed as such. The dates do not establish current site conditions. Photo licences
remain independent of vector database licences; no image assets are copied into this repository.

The exported example is a derived geodata snapshot with source attribution/licences retained.
OSM-derived database reuse may be subject to ODbL; preserve attribution and assess redistribution
conditions before publishing a combined database. This document does not license third-party
content under a new licence or select a licence for the application's source code.

Primary references:

- [OSM copyright / ODbL](https://www.openstreetmap.org/copyright)
- [Overpass public resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [IGN service conditions](https://cartes.gouv.fr/cgu/)
- [Official IGN altimetry documentation](https://data.geopf.fr/altimetrie/api/index.html)
- [Panoramax STAC API](https://docs.panoramax.fr/backend/api/api/)
- [Federated picture licences](https://docs.panoramax.fr/federated-catalog/)
- [OSM basemap tile policy](https://operations.osmfoundation.org/policies/tiles/)

For confidential operation areas use approved/self-hosted infrastructure: public APIs receive
bounding extents and sampled coordinates. No Google Street View or paid API is used.

<div align="center">
  <img src="public/image/division-drone-transparent.png" alt="Division Drone emblem" width="130" />

  <h1>Division Drone</h1>

  <p><strong>Drone fleet planning and mission simulation</strong></p>
  <p>🥇 1st Place · French Gendarmerie Nationale Drone Hackathon · UPSSITECH</p>
  <p>React · TypeScript · Vite · Leaflet</p>

  <p>
    <a href="https://drone-planning.vercel.app/"><strong>Live demo</strong></a>
    · <a href="#quick-start">Quick start</a>
    · <a href="#planning-engine">Algorithms</a>
    · <a href="#documentation">Documentation</a>
  </p>
  <p><strong>English</strong> · <a href="README.fr.md">Français</a></p>
</div>

![Division Drone interface showing an operation area, a priority zone, drone positions and coverage metrics.](docs/images/mission-planning.jpg)

*Fictional mission in Rennes, France: one drone providing coverage and one reserve unit. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).*

## Overview

Built as a team in **9 hours** on **14 October 2026**, Division Drone won **first place** at the drone hackathon organized by the **Occitanie regional command of the French Gendarmerie Nationale**. The challenge: **allocate a drone fleet across an operation area, prioritize critical zones and limit unnecessary overlap.**

Operators draw an area on the map, specify mission constraints and available resources, then review and adjust a proposed deployment. The prototype brings together geospatial computation, coverage optimization and an interactive mission simulation in a single desktop web interface.

This README documents the **`main`** branch. The application runs in the browser and simulates operations; it does not control real aircraft.

## Features

| Area | Capabilities |
| --- | --- |
| **Interactive mapping** | Draw operation and priority polygons; switch between street maps, aerial imagery and terrain occupancy overlays. |
| **Fleet planning** | Estimate drone and remote pilot requirements, propose positions, and measure overall coverage, priority coverage and overlap. |
| **Mission constraints** | Account for TP1/TP2 scenarios, rural or urban environments, rain, day/night conditions, available stock and user-entered limits. |
| **Resource management** | Adjust available quantities, browse or extend the drone catalogue, retain reserve units and recalculate the deployment. |
| **Mission simulation** | Move drones and pilots, adjust coverage sectors and altitudes, detect conflicts, and simulate return or emergency landing. |
| **Import and export** | Save missions as JSON and restore their geometry, resources and state. |

Coverage sectors are clipped to the operation area. The map distinguishes priority zones, overlapping coverage and uncovered locations. Reserve drones remain visible without contributing to coverage.

## Try the demo

The [live demo](https://drone-planning.vercel.app/) requires no account. **The application interface is currently in French.** The steps below retain the on-screen labels so they are easy to find.

**Fastest route:** choose **Reprendre une mission** (resume a mission) → **Charger la mission de démonstration** (load the demo), then **Recalculer avec les ressources réelles** (recalculate using available resources). A fictional Rennes scenario lets you explore the map, resources and simulation without creating a file.

To create a mission:

1. Select **Préparer une mission** and enter a name, date, time and scenario.
2. Search for a French address or enter WGS84 coordinates in **longitude, latitude** order. The map initially opens at Mirepoix, France.
3. Draw the operation area and any priority zones. Close each polygon by clicking its first vertex or choosing **Terminer**.
4. Select **Calculer l’estimation**, review coverage and adjust the proposed sectors.
5. Prepare the operation, enter the resources actually available and recalculate. Resolve conflicts before starting the simulation.
6. Adjust the deployment and use **Export JSON** to save the mission.

**The current mission is held in memory: export it before reloading or closing the page.** Only the theme and preferences are saved automatically on the device.

## Planning engine

The engine searches for a **trade-off between coverage, priority zones and fleet size**. It combines several placement strategies, extending the initial greedy approach.

### From operation area to deployment

1. **Filter eligible resources** by drone model, scenario, weather, stock and declared constraints.
2. **Sample the operation polygon** on a point grid. Priority points receive a weight of **4**, compared with **1** for ordinary points.
3. **Compare candidate layouts** for increasing fleet sizes using greedy construction, *k-center* partitions and local position refinement. Full refinement applies to layouts of up to **12 drones**; hexagonal lattice layouts are also evaluated for larger deployments.
4. **Select a coverage trade-off** from non-dominated layouts. The engine first seeks **85% overall coverage** and **92% priority coverage**, where resources and constraints allow. It then evaluates the gain per additional drone, using a default threshold capped at **3 percentage points of weighted coverage**, reduced for very large areas.
5. **Finalize resource allocation:** remove redundant drones, rebalance interchangeable standard models within stock limits and assign remote pilots.
6. **Assign altitudes** using an overlap graph and a bounded DSatur search, subject to altitude ceilings and vertical separation. Infeasible assignments produce warnings and conflicts.

This is a **deterministic heuristic**, with no guarantee of a global optimum or a minimum fleet size. Coverage percentages are sampled estimates, and coverage targets may remain unattainable. The engine also exposes computed trade-offs through `result.tradeoff`; the experimental graphical selector is not integrated into `main`.

Sources: [planning engine](src/engines/planning/index.ts), [geometry engine](src/engines/geometry) and [optimizer tests](tests/planning/optimizer.test.mjs).

### Prototype flight scenarios

| Scenario | Maximum range | Rural altitude ceiling | Urban altitude ceiling |
| --- | --- | --- | --- |
| TP1, in sight | 500 m | 120 m | 120 m |
| TP1, out of sight | 1,000 m | 50 m | 80 m |
| TP2, out of sight | 2,000 m | 120 m | 120 m |

Mixed mode adapts the radius to the coverage requirement and prefers TP1 when gains are equivalent. Default settings are **30 m** of vertical separation and **20%** maximum overlap, both adjustable in the settings.

These are the hackathon prototype’s simulation rules. At night or in rain, its eligibility policy retains only the **DJI Matrice 4T**, even when custom models are available. This policy is neither regulatory validation nor manufacturer certification for flight in rain; sourced specifications are available in the [drone reference](docs/DRONE_SPECS.md).

## Quick start

**Requirements:** Node.js **22.18 or later**, npm and Git. Tests use Node.js’s native TypeScript support.

```sh
git clone https://github.com/MariusPinard/hackathon-gendarmerie-drones.git
cd hackathon-gendarmerie-drones
npm ci
npm run dev
```

Open the URL reported by Vite, usually **http://localhost:5173**. TypeScript modules must be served through Vite; opening `index.html` directly is insufficient.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server with hot reloading. |
| `npm run typecheck` | Check TypeScript types. |
| `npm test` | Run the `node:test` suite. |
| `npm run build` | Check types and generate the static site in `dist/`. |
| `npm run preview` | Preview the latest build locally. |

## Architecture

**React 19 · Strict TypeScript · Vite · Leaflet**

Geometry, planning and operations engines are separate from React rendering. The `main` branch is a standalone frontend, without a business backend or drone control SDK.

```text
src/
├── app/                  Mission context and simulation clock
├── pages/                Home, import, planning, resources and operations
├── components/           Leaflet map, panels, fleet and forms
├── engines/
│   ├── geometry/         Projection, validation, intersections and coverage
│   ├── planning/         Estimation, placement, models and altitudes
│   └── operations/       Conflicts, edits and simulated state transitions
├── services/             Weather, geocoding, occupancy, JSON and preferences
├── types/                TypeScript contracts
├── data/                 Standard catalogue and demo mission
└── styles/               Layout and themes
public/                   Images and precomputed occupancy data
tests/                    Unit tests and workflow tests
docs/                     Functional and technical documentation
```

### Data and external services

| Source | Purpose |
| --- | --- |
| OpenStreetMap | Street map tiles. |
| IGN | Aerial imagery in France and French address geocoding using BAN data. |
| Open-Meteo | Rain forecasts for the selected location and time. |
| Local astronomical calculation | Day/night determination, including when no forecast is available. |
| Occupancy data | Precomputed Mirepoix analysis, optionally supplemented by a compatible external service. |

The standard workflow requires no API key. Remote services depend on network availability; missing weather remains **unknown**, rather than being treated as dry conditions. Wind resistance and zoom are catalogue attributes and are not used by the optimizer.

Mission files remain in the browser until exported locally. Map, address and weather requests disclose the viewed area or search query to the corresponding providers.

### Terrain occupancy — optional configuration

A precomputed map for **Mirepoix — INSEE 09194** is included in [`public/occupancy/commune-09194.json`](public/occupancy/commune-09194.json). It displays terrain categories and takeoff suitability indicators without a live analysis service.

To analyze other areas, use an external service exposing **`POST /api/v1/occupancy/tile`**. That service is not shipped in `main`. Its URL can be set in `.env.local`:

```dotenv
VITE_OCCUPANCY_API_URL=http://127.0.0.1:8000
```

Development defaults to this local address. Production uses only precomputed data unless a service URL is configured. Restart Vite after changes and set the variable before building a static release. The service must allow the frontend’s origin through CORS; use HTTPS when the frontend is served over HTTPS.

Analysis starts through **Lancer le calcul**, with up to **24 tiles per request batch**, **2 concurrent requests** and session caching. The indicators require verification on the ground. They are not used to search automatically for remote pilot positions in `main`.

## Mission files and preferences

- **Mission data:** JSON import/export with `schemaVersion: "1.0"`, including zones, catalogue, weather, resources, positions and states. Import validates the data, then opens the resource review step.
- **Preferences:** default catalogue, vertical separation and maximum overlap are stored locally in the browser, along with the theme.
- **Emergency recovery:** recent exports can include a snapshot used to restore the deployment after a simulated emergency landing.

A [sample mission](src/data/exampleMission.json) and the [JSON format reference](docs/FORMAT_JSON.md) are included.

## Testing and quality

```sh
npm test
npm run build
git diff --check
```

The test suite covers geometry, placement strategies, priority zones, stock limits, TP1/TP2 scenarios, weather, altitude assignment, reserves, conflicts, import/export and external services. Workflow tests connect estimation, resource shortages, launch, edits, return and emergency handling.

Tests import TypeScript sources directly. The production build also checks types; [manual visual checks](docs/VALIDATION.md) complement automated verification for map rendering and interactions.

## Deployment

```sh
npm run build
```

Publish **all contents of `dist/`** to a static HTTP(S) host, retaining the `image/` and `occupancy/` directories. The current configuration expects deployment at the domain root.

For Vercel, use **`npm run build`** as the build command, **`dist`** as the output directory and a Node.js version meeting the project requirements. Deploy the occupancy service separately if needed. `VITE_` variables are bundled into public frontend code and must never contain secrets. Use `npm run preview` for local build verification.

## Scope and limitations

- **Simulation:** no telemetry, hardware commands, physical flight trajectories or real radio link. Altitude checks and flight scenarios do not replace operational validation.
- **Coverage model:** local projection, simplified radii and sampled metrics; no terrain elevation, sensor field-of-view or radio propagation model in the coverage engine.
- **Remote pilots:** each drone and its pilot initially share a position. The occupancy layer provides a separate visual aid rather than driving placement.
- **Geometry and imports:** operation bounds limited to 50 km per side, excluding polar regions and antimeridian crossings; up to 20 priority zones, 300 distinct vertices per ring and 2 MB per JSON file.
- **Fleet size:** no fixed 32-drone limit; computation cost grows with deployment size, available stock, feasible placements and declared constraints.
- **Persistence:** no automatic or server-side mission save; retain exported JSON files to resume work.

## Documentation

The supporting documents are currently in **French**.

| Document | Contents |
| --- | --- |
| [Demo walkthrough](docs/DEMO.md) | Presentation flow and map interactions. |
| [Requirements](docs/REQUIREMENTS.md) | Functional requirements for the prototype. |
| [Architecture](docs/ARCHITECTURE.md) | Application components and engines. |
| [Engine contracts](docs/API_CONTRACT.md) | Interfaces and data structures. |
| [JSON format](docs/FORMAT_JSON.md) | Mission files, validation and compatibility. |
| [Drone specifications](docs/DRONE_SPECS.md) | Capabilities and manufacturer sources. |
| [Validation](docs/VALIDATION.md) | Functional and visual check scenarios. |
| [Integration](docs/INTEGRATION.md) | Component integration notes. |
| [Algorithm history](docs/ALGORITHMES.md) | The original hackathon approach. |
| [Visual identity](docs/LOGOS.md) | Logo sources and preparation. |

Some documents describe earlier hackathon iterations, including earlier thresholds and the greedy approach. The [Planning engine](#planning-engine) section above and the `main` sources describe the current implementation.

## Team

Built by the **UPSSITECH — Université de Toulouse** team, winners of the hackathon:

[Alec Bossard](https://www.linkedin.com/in/alec-bossard/) · [Arthus D.](https://www.linkedin.com/in/arthus-d-539497287/) · [Guilhem Carmouze](https://www.linkedin.com/in/guilhem-carmouze/) · [Marius Pinard](https://www.linkedin.com/in/marius-pinard-65a344241/) · [Théo Jeanmart](https://www.linkedin.com/in/th%C3%A9o-jeanmart-433717214/)

Thank you to the **Occitanie regional command of the Gendarmerie Nationale** for organizing the event and providing a practical drone coordination challenge.

"""Live HTTP validation, explicit recorded outputs, never a production fallback."""

import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import httpx2 as httpx
from shapely.geometry import shape

from drone_site_finder.schemas.sites import SearchResponse

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend/public/validation/v0.4"


def verify(data):
    result = SearchResponse.model_validate(data)
    issues = []
    search = shape(result.metadata.search_area.model_dump())
    for feature in result.features:
        zone, p = shape(feature.geometry.model_dump()), feature.properties
        if not zone.is_valid or not search.buffer(1e-10).covers(zone):
            issues.append(f"{feature.id}: geometry or containment mismatch")
        expected = round(sum(c.weight * (c.score or 0) for c in p.criteria), 1)
        if abs(expected - p.score) > 0.11:
            issues.append(f"{feature.id}: score sum mismatch")
        if p.surface_type == "rooftop":
            if not p.roof or p.score_profile != "rooftop_v1" or p.uncertainty != "high":
                issues.append(f"{feature.id}: roof evidence/uncertainty missing")
            if (
                p.roof
                and p.roof.access_status == "unknown"
                and next(c for c in p.criteria if c.key == "accessibility").score is not None
            ):
                issues.append(f"{feature.id}: unknown roof access scored favorably")
    return result, issues


async def run(args):
    cases = json.loads((OUTPUT / "cases.json").read_text(encoding="utf-8"))
    if args.case:
        cases = [case for case in cases if case["id"] == args.case]
    records = []
    async with httpx.AsyncClient(timeout=190) as client:
        for case in cases:
            started = perf_counter()
            try:
                response = await client.post(
                    f"{args.api}/api/v1/sites/search", json=case["request"]
                )
                data = response.json()
                if response.status_code != 200:
                    raise RuntimeError(f"HTTP {response.status_code}: {data}")
                result, issues = verify(data)
                (OUTPUT / f"{case['id']}.geojson").write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
                record = {
                    "id": case["id"],
                    "label": case["label"],
                    "http_status": 200,
                    "elapsed_seconds": round(perf_counter() - started, 2),
                    "issues": issues,
                    "counts": {
                        kind: sum(f.properties.surface_type == kind for f in result.features)
                        for kind in ["ground", "rooftop"]
                    },
                    "phases": result.metadata.phase_seconds,
                    "diagnostics": result.metadata.diagnostics,
                    "status": result.metadata.status,
                    "sources": [s.model_dump() for s in result.metadata.sources],
                    "zones": [
                        {
                            "id": f.id,
                            "type": f.properties.surface_type,
                            "area_m2": round(f.properties.area_m2, 2),
                            "score": f.properties.score,
                            "missing": f.properties.missing_data,
                            "roof": f.properties.roof.model_dump() if f.properties.roof else None,
                        }
                        for f in result.features
                    ],
                }
            except Exception as failure:
                # Do not leave an earlier success masquerading as this failed run's capture.
                (OUTPUT / f"{case['id']}.geojson").unlink(missing_ok=True)
                record = {
                    "id": case["id"],
                    "label": case["label"],
                    "error": str(failure),
                    "elapsed_seconds": round(perf_counter() - started, 2),
                }
            records.append(record)
            print(
                json.dumps(
                    {k: v for k, v in record.items() if k not in {"sources", "zones"}},
                    ensure_ascii=False,
                ),
                flush=True,
            )
            if args.pause_seconds:
                await asyncio.sleep(args.pause_seconds)
    destination = OUTPUT / (f"run-{args.case}.json" if args.case else "run.json")
    destination.write_text(
        json.dumps(
            {
                "recorded_at": datetime.now(UTC).isoformat(),
                "validation_status": "awaiting_operator_review",
                "cases": records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    if any(r.get("error") or r.get("issues") for r in records):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=5,
        help="Pause between public-provider analyses (default: 5 seconds).",
    )
    parser.add_argument(
        "--case", choices=["urban", "residential", "rural", "forest", "relief", "mixed"]
    )
    args = parser.parse_args()
    if not 0 <= args.pause_seconds <= 60:
        parser.error("--pause-seconds must be between 0 and 60")
    asyncio.run(run(args))

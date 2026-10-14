"""Bounded, cached read-only public API access. No operation data is written to disk."""

import asyncio
import hashlib
import json
import os
import time
from collections import OrderedDict

import httpx2 as httpx

_CACHE: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
_CACHE_BYTES = 0
_IGN_LOCK = asyncio.Lock()
_IGN_LAST = 0.0


class SourceUnavailable(Exception):
    pass


class PublicHTTP:
    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": os.getenv("DRONE_USER_AGENT", "drone-pilot-site-finder/0.4 local")
            },
        )
        self.semaphore = asyncio.Semaphore(4)

    async def close(self):
        await self.client.aclose()

    async def request(self, url, *, params=None, body=None, form=None, ttl=3600):
        global _CACHE_BYTES, _IGN_LAST
        key = hashlib.sha256(
            json.dumps([url, params, body, form], sort_keys=True).encode()
        ).hexdigest()
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < ttl:
            return cached[1]
        async with self.semaphore:
            # Keep all IGN calls below the altimetry limit of 5 requests/s.
            if "data.geopf.fr" in url:
                async with _IGN_LOCK:
                    await asyncio.sleep(max(0, 0.23 - (time.monotonic() - _IGN_LAST)))
                    _IGN_LAST = time.monotonic()
            try:
                async with self.client.stream(
                    "POST" if body is not None or form is not None else "GET",
                    url,
                    params=params,
                    json=body,
                    data=form,
                ) as response:
                    response.raise_for_status()
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 24_000_000:
                            raise SourceUnavailable("Source response exceeds 24 MB limit.")
                        chunks.append(chunk)
                    data = b"".join(chunks)
            except httpx.HTTPStatusError as exc:
                raise SourceUnavailable(
                    f"HTTP {exc.response.status_code}: source request failed"
                ) from exc
            except (httpx.HTTPError, ValueError) as exc:
                raise SourceUnavailable(f"{type(exc).__name__}: source request failed") from exc
        previous = _CACHE.pop(key, None)
        if previous:
            _CACHE_BYTES -= len(previous[1])
        _CACHE[key] = (time.monotonic(), data)
        _CACHE_BYTES += len(data)
        while _CACHE_BYTES > 64_000_000 or len(_CACHE) > 128:
            _, (_, old) = _CACHE.popitem(last=False)
            _CACHE_BYTES -= len(old)
        return data

    async def json(self, url, **kwargs):
        try:
            return json.loads(await self.request(url, **kwargs))
        except (ValueError, UnicodeDecodeError) as exc:
            raise SourceUnavailable("Source returned invalid JSON.") from exc

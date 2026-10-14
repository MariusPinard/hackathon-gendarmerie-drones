"""Conservative RGB evidence, not a semantic obstacle detector or trained land-cover model."""

import io

import numpy as np
from PIL import Image
from scipy.ndimage import binary_opening, uniform_filter

from drone_site_finder.providers.models import ImageEvidence


def analyse_rgb(raw: bytes, transform, pixel_size_m: float) -> ImageEvidence:
    with Image.open(io.BytesIO(raw)) as image:
        if max(image.size) > 2048:
            raise ValueError("Imagery exceeds the bounded analysis size.")
        image.load()
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    if min(rgb.shape[:2]) < 16 or np.std(rgb) < 2:
        raise ValueError("Imagery is empty or uniform; no visual evidence available.")
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    gray = 0.299 * red + 0.587 * green + 0.114 * blue
    variance = np.maximum(0, uniform_filter(gray * gray, 5) - uniform_filter(gray, 5) ** 2)
    texture = np.sqrt(variance)
    green_like = (green > red * 1.08) & (green > blue * 1.04) & (green > 45)
    # Low-texture grass is not automatically classified as a tree canopy.
    canopy_like = binary_opening(green_like & (texture > 12), iterations=1)
    shadow = gray < 28
    clear_looking = (texture < 20) & ~canopy_like & ~shadow & (gray < 245)
    return ImageEvidence(clear_looking, canopy_like | shadow, transform, "EPSG:3857", pixel_size_m)

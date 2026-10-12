"""North-first grid geometry; scientific value conversions stay in each pipeline."""

import math

from rasterio.transform import from_origin


def snap_bounds(bounds, pixel):
    left, bottom, right, top = bounds
    return (
        math.floor(left / pixel) * pixel,
        math.floor(bottom / pixel) * pixel,
        math.ceil(right / pixel) * pixel,
        math.ceil(top / pixel) * pixel,
    )


def grid_from_bounds(bounds, pixel):
    left, bottom, right, top = bounds
    width, height = int((right - left) / pixel), int((top - bottom) / pixel)
    return from_origin(left, top, pixel, pixel), width, height

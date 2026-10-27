# Poseidon: boundary and study-area reference

Researched and calculated on 2026-10-13. This document records the geographic
data needed to prepare a Poseidon study area in MSP-Symphony. Creating this
document does not change the application's area, assets, configuration, or code.

## Project and boundary version

Use the currently permitted **Poseidon** project, formerly **Poseidon Nord**.
Poseidon Syd was withdrawn from the application in December 2023. The government
granted the wind-park permit on **2024-11-04**, decision **KN2023/00991**.
Earlier consultation documents can contain different coordinates and both
project sections; the seven corners in the permit are the authoritative input
used here. [Government decision, page 1][permit] · [Vattenfall project page][project]

| Field | Published information |
| --- | --- |
| Location | Southern Skagerrak, Swedish exclusive economic zone, outside Swedish territorial waters |
| Regional position | Approximately 40 km northwest of Gothenburg, offshore from Stenungsund |
| Project area | Approximately 152 km² |
| Developer | KonTiki Vind AB, jointly owned by Vattenfall and Zephyr; Vattenfall is majority owner |
| Maximum turbines | 81 |
| Maximum total turbine height | 340 m |
| Foundation concept | Floating foundations |
| Approximate installed capacity | 1,400 MW |
| Approximate annual production | 5.5 TWh |
| Planned commissioning | Early 2030s; a project estimate, not a confirmed date |

Source: [Vattenfall's current project description][project]. The permit defines
the project envelope; these corners are **not individual turbine positions**.
The final turbine layout remains subject to the permit's consultation and
approval requirements. [Government decision, pages 1–2][permit]

## Official boundary coordinates

The coordinates below are transcribed from page 1 of the
[government decision dated 2024-11-04][permit]. They were checked against the
rendered PDF page.

- Authoritative coordinate system: **SWEREF 99 TM, EPSG:3006**.
- Units: metres; coordinate pairs are **[easting, northing]**.
- Boundary order in the decision: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 1**.
- Longitude/latitude columns are calculated approximate WGS84 coordinates
  (**EPSG:4326**), rounded to six decimal places.

| Point | Easting (m) | Northing (m) | Longitude °E | Latitude °N |
| --- | ---: | ---: | ---: | ---: |
| 1 | 253118.60 | 6447499.29 | 10.809982 | 58.099880 |
| 2 | 254780.37 | 6448455.64 | 10.837100 | 58.109370 |
| 3 | 263678.20 | 6424446.46 | 11.011755 | 57.899081 |
| 4 | 267785.01 | 6424209.70 | 11.081107 | 57.899114 |
| 5 | 269043.79 | 6421569.61 | 11.104856 | 57.876107 |
| 6 | 260088.58 | 6422185.58 | 10.953626 | 57.876910 |
| 7 | 252814.98 | 6431907.42 | 10.821196 | 57.960038 |

Copyable authoritative ring, in EPSG:3006 metres. This is a coordinate array,
not WGS84 GeoJSON:

```json
[
  [253118.60, 6447499.29],
  [254780.37, 6448455.64],
  [263678.20, 6424446.46],
  [267785.01, 6424209.70],
  [269043.79, 6421569.61],
  [260088.58, 6422185.58],
  [252814.98, 6431907.42],
  [253118.60, 6447499.29]
]
```

## Wind-park footprint as WGS84 GeoJSON

GeoJSON coordinates use **[longitude, latitude]**. The exterior ring below is
counterclockwise, following points **1 → 7 → 6 → 5 → 4 → 3 → 2 → 1**; reversing
the official listing preserves the same boundary. The feature ID and display
name are proposed application identifiers.

```json
{
  "type": "Feature",
  "id": "poseidon-windpark",
  "properties": {
    "name": "Poseidon wind park",
    "kind": "Permitted wind-farm project envelope",
    "formerName": "Poseidon Nord",
    "source": "Swedish Government decision KN2023/00991, page 1",
    "sourceUrl": "https://www.regeringen.se/contentassets/dce098c5318e4a6d86d899b724758103/poseidon.pdf",
    "decisionDate": "2024-11-04",
    "sourceCrs": "EPSG:3006",
    "publishedAreaKm2": 152,
    "cornerOrder": [1, 7, 6, 5, 4, 3, 2, 1]
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [10.809982, 58.099880],
      [10.821196, 57.960038],
      [10.953626, 57.876910],
      [11.104856, 57.876107],
      [11.081107, 57.899114],
      [11.011755, 57.899081],
      [10.837100, 58.109370],
      [10.809982, 58.099880]
    ]]
  }
}
```

For precise spatial calculations, construct the polygon in EPSG:3006 from the
original coordinates and transform it to the target CRS. Densify its edges
before transformation when preservation of the projected boundary matters.
The compact GeoJSON above transforms only the corners and is suitable for an
overview; its straight geographic segments approximate the transformed edges.

## Calculated bounds and map position

All extents use **[minimum x, minimum y, maximum x, maximum y]**. In WGS84 this
means **[west longitude, south latitude, east longitude, north latitude]**.
Projected extents are in metres.

| Quantity | CRS | Value |
| --- | --- | --- |
| Exact bounds of the official projected polygon | EPSG:3006 | `[252814.98, 6421569.61, 269043.79, 6448455.64]` |
| Geographic enclosing bounds, rounded outward | EPSG:4326 | `[10.809982, 57.876107, 11.104857, 58.109370]` |
| Approximate bounds after transformation to Symphony's grid CRS | EPSG:3035 | `[4368835.22, 3864284.52, 4386649.38, 3890048.59]` |
| Approximate projected-polygon centroid, transformed to WGS84 | EPSG:4326 | `[10.907009, 57.970920]` |

The centroid is a convenient map focus, not a turbine location. The calculated
polygon area is approximately **152.197 km² in SWEREF 99 TM** or **152.10 km²
on the WGS84 ellipsoid**. These calculations agree with the published rounded
area of 152 km²; projected and ellipsoidal areas differ slightly.

## Encapsulating study-area options

These rectangles are calculated study-area suggestions. They are not additional
official project boundaries or approved impact zones. Their sizes do not
establish how far ecological effects extend.

| Option | EPSG:3035 extent in metres | Width × height | Area | Cells at 1 km | Cells at 250 m |
| --- | --- | --- | ---: | --- | --- |
| Smallest enclosing rectangle aligned to the 1 km grid | `[4368000, 3864000, 4387000, 3891000]` | 19 × 27 km | 513 km² | 19 × 27 | 76 × 108 |
| Suggested square preserving the existing POC dimensions | `[4358000, 3858000, 4397000, 3897000]` | 39 × 39 km | 1,521 km² | 39 × 39 | 156 × 156 |

The **39 × 39 km square** is the suggested starting point if retaining the
current MARELD study-area dimensions is useful. It is centred approximately on
Poseidon's projected bounding box and aligned to the kilometre grid. Its
margin around the park varies by direction; it is not a uniform-distance buffer.
The smaller rectangle is useful for a close view or a smaller data extraction.

Copyable grid definitions for the suggested square:

```json
{
  "suggestedReviewAreaName": "Poseidon POC review area",
  "studyAreaIsOfficialProjectBoundary": false,
  "simulationGrid": {
    "crs": "EPSG:3035",
    "extent": [4358000, 3858000, 4397000, 3897000],
    "width": 39,
    "height": 39,
    "cellMetres": 1000
  },
  "supplementalLayerGrid": {
    "crs": "EPSG:3035",
    "extent": [4358000, 3858000, 4397000, 3897000],
    "width": 156,
    "height": 156,
    "cellMetres": 250
  }
}
```

The grid definitions describe proposed dimensions; no simulation or data
preparation has been run for this area. For north-first raster arrays, the
250 m affine transform is `[250, 0, 4358000, 0, -250, 3897000]` in
`[a, b, c, d, e, f]` order, where `x = a*column + b*row + c` and
`y = d*column + e*row + f` refer to pixel corners. Cell centres use
`column + 0.5` and `row + 0.5`.

### Suggested review square as WGS84 GeoJSON

The ring follows southwest → southeast → northeast → northwest → southwest.
These transformed corners approximate the projected square in GeoJSON. The
EPSG:3035 extent above remains the exact definition; transform/densify its
projected edges when exact grid alignment is required.

```json
{
  "type": "Feature",
  "id": "poseidon-review-area",
  "properties": {
    "name": "Poseidon POC review area",
    "kind": "Suggested study area",
    "sourceCrs": "EPSG:3035",
    "sourceExtent": [4358000, 3858000, 4397000, 3897000],
    "areaKm2": 1521
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [10.62176586, 57.82235568],
      [11.27703941, 57.81769742],
      [11.28936639, 58.16831117],
      [10.62776888, 58.17302048],
      [10.62176586, 57.82235568]
    ]]
  }
}
```

## Implications for the existing MARELD POC

The current study-area and supplemental-raster extent is
`[4326000, 3873000, 4365000, 3912000]` in EPSG:3035. Poseidon's westernmost
projected coordinate is approximately `4368835`, east of that extent's eastern
edge. **The existing cropped supplemental rasters therefore do not cover the
Poseidon footprint.** This is an extent comparison, not an audit of the original
regional source rasters.

For a later implementation:

1. Use the permitted seven-corner polygon for the wind-park footprint and masks.
2. Select the enclosing study area separately. The 39 km square is a proposal,
   not a user-approved replacement already applied to the application.
3. Extract environmental and pressure layers from the original regional sources
   onto the chosen Poseidon grid. Recompute masks, support, provenance, and
   coverage statistics for both the park and surrounding study area.
4. Verify native baseline coverage and imported-boundary clipping for Poseidon.
   MARELD coverage percentages and extrapolation results do not transfer.
5. Update geographic labels and automatic area selection where needed. Keep
   geographic naming changes separate from decisions about the existing MARELD
   model/API names and biological configuration.

The following repository files document or currently hold the relevant MARELD
data; they were inspected but not changed for this research:

- `frontend/src/assets/pressures/mareld-windpark.json`: existing park footprint.
- `examples/ecotwin/data/hav-symphony-2019/mareld-review-area.json`: existing saved-area snapshot.
- `frontend/src/assets/mareld-layers/manifest.json`: cropped grid, park geometry,
  source attribution, and layer provenance.
- `plugins/ecotwin/docs/MARELD-POC.md`: current study-area and simulation operation.
- `plugins/ecotwin/docs/history/MARELD-LAYERS.md`: raster preparation, interpretation, and data contract.

This document provides the geographic inputs. Poseidon-specific environmental
coverage, ecological calibration, final turbine positions, and export-cable
routes have not been established by this research.

## Calculation method and precision

Coordinate transformations used Python `pyproj.Transformer.from_crs` with
`always_xy=True`: EPSG:3006 → EPSG:4326 for longitude/latitude and
EPSG:3006 → EPSG:3035 for the Symphony grid. Each original projected edge was
sampled at 1,001 evenly spaced positions when calculating transformed bounds.
The 19 × 27 km rectangle rounds minima down and maxima up to whole kilometres.
The 39 km square places its lower-left corner at the kilometre-rounded value of
the transformed bounding-box midpoint minus 19,500 m on each axis.

SWEREF 99 and WGS84 are close but not identical reference frames. These
conversions are appropriate for the kilometre-scale POC and map display, not
survey-grade positioning. Decimal places in the GeoJSON do not imply equivalent
absolute accuracy. Preserve the permit's EPSG:3006 values for future processing.
[Lantmäteriet: SWEREF 99 and its relationship to WGS84][sweref]

## Sources

- [Swedish Government: Poseidon permit decision, 2024-11-04][permit].
  Page 1 supplies the authoritative boundary; page 2 addresses final turbine
  placement; page 13 describes the remaining northern project.
- [Vattenfall: current Poseidon project page][project].
  Confirms the published area, project characteristics, removal of Poseidon Syd,
  and permit milestones. Accessed 2026-10-13.
- [Vattenfall: Poseidon overview map, PDF][map].
  Visual project reference; use the permit table for coordinate extraction.
- [Lantmäteriet: SWEREF 99][sweref].
  Reference-system context and relationship to WGS84.

[permit]: https://www.regeringen.se/contentassets/dce098c5318e4a6d86d899b724758103/poseidon.pdf
[project]: https://projekt.vattenfall.se/vindprojekt/projekt/hav/poseidon
[map]: https://projekt.vattenfall.se/siteassets/vindkraft/havsbaserad/poseidon/oversiktskarta-poseidon.pdf
[sweref]: https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Tredimensionella-system/SWEREF-99/


## Saved Symphony test calculation (2026-10-13)

The geographic specification above is now represented by ordinary saved Symphony
calculations in the local West 2019 installation. IDs are local to that database:

- **#7, Poseidon — EcoTwin reference:** unchanged native pressure inputs. The native
  result is preserved. Two legacy single-seed runs and two completed ten-seed
  ensembles are attached to its report.
- **#9, Poseidon — 50% bottom trawling:** a separate normal calculation after halving
  native pressure 3, retaining shipping noise. Its earlier single-seed appendix is
  kept for backward-compatibility review.
- **#8, Poseidon — native regression (no simulation):** matching native output,
  without an EcoTwin appendix.

For the preview/full-run workflow, select #7 in EcoTwin. The saved 40-step ensemble
uses seeds 100–109 (`24ef3e58-5b3c-40f0-a8ce-dab663aa872f`); the 80-step ensemble
uses seeds 200–209 (`c27cacf7-1de0-4120-8704-b14020728497`). Both use model
`2026-10-08`, show mean map frames and 95% Student t confidence bands, and remain
available after reload. These short runs verify the software workflow; they are
not a calibrated environmental assessment.

The actual native export needs a 40 × 40 grid to include raster edge pixels around
the 39 km vector area. Its domain is 1,143.875 km² in 1,227 model water cells.
See [the fixture manifest](data/poseidon/reference-calculation.json) for native
inputs, source fingerprints, all run IDs and the exact grid. See
[the workflow guide](../../plugins/ecotwin/docs/MARELD-POC.md) for current settings and assumptions.

## Simulation comparison fixture (2026-10-13)

Use **Compare calculations → Select a calculation** with #7 as baseline and #9 as
scenario, then enable **Include simulation comparison**. The matching full pair is:

| Calculation | Run ID | Settings |
|---|---|---|
| #7 reference | `c27cacf7-1de0-4120-8704-b14020728497` | Model `2026-10-08`, 80 steps / 20 days, seeds 200–209 |
| #9 50% bottom trawling | `80b59185-0f81-4467-8c60-05235d710374` | Same model, duration, sampling, domain and seeds |
| #18 saved implied baseline for #9 | `6ec6ec1c-d827-43a0-a9d4-b6b820b4c813` | Same settings; reproduces #7's ensemble exactly |

Alternatively choose **Implied baseline** and scenario #9: the explicit baseline
creation action has already saved counterpart #18 in this local database. Repeating
creation reuses #18. Native scenario #6 still has latest calculation #9. The native
comparison report statistics match whether using the transient implied baseline
or saved #18. The simulation baseline's per-seed totals and confidence intervals
also match #7 exactly; #9 has distinct results from its pressure change.

The report shows six species pairs with common axes and biomass as a percentage
of each seed's own initial value. Confidence bands are 95% Student t intervals.
The live checks covered modal print readiness, reversed implicit order, pinned
new-tab URLs and the A4 export. The reviewed PDF is
`output/playwright/poseidon-simulation-comparison.pdf` (7 pages, appendix on 5–7).
This is software verification with short runs, not an environmental impact claim.

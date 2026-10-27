#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "pyproj>=3.7,<4"]
# ///
"""Generate tiny, explicitly artificial native-calculation inputs for isolated CI."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import Transformer


def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    profile = dict(driver='GTiff', width=16, height=16, count=1, dtype='uint8',
                   crs='EPSG:3035', transform=from_origin(4357000, 3862000, 250, 250),
                   tiled=True, blockxsize=16, blockysize=16, compress='deflate')
    for filename, value in [('ecosystems.tif', 50), ('pressures.tif', 40),
                            ('ecosystems-support.tif', 1), ('pressures-support.tif', 1),
                            ('calculation-domain.tif', 1)]:
        count = 14 if filename.startswith('pressures') else (2 if filename.startswith('ecosystems') else 1)
        with rasterio.open(folder / filename, 'w', **{**profile, 'count': count}) as target:
            target.write(np.full((count, 16, 16), value, dtype='uint8'))
    digest = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    manifest = dict(version='native-input-support-v1', baselineName='HAV_2019_WEST_LOCAL',
                    crs='EPSG:3035', units='relative index 0–100', sourceUnits='artificial test intensity',
                    policy='Synthetic constant rasters; every cell is known. Not an ecological dataset.',
                    historicalLimitation='Disposable synthetic fixture, never a model validation result.',
                    domainFile='calculation-domain.tif', domainSha256=digest('calculation-domain.tif'),
                    sources={}, layers=[])
    for category, name in [('ECOSYSTEM', 'ecosystems'), ('PRESSURE', 'pressures')]:
        manifest['sources'][category] = dict(sha256=digest(name + '.tif'),
            supportFile=name + '-support.tif', supportSha256=digest(name + '-support.tif'))
        # The protocol fixture declares the reviewed source identities but contains
        # artificial constant pixels. This is explicit test input, not provenance evidence.
        declared = {3: 'b0c2bb630a7694306139512667058d275b88ffb8cebe33f21ac66806c9f331bf',
                    13: '716dbf1e91bb1dcd53b65a790799b8272682ea6eb44a973fa10d2392103d7dc1'}
        for band in ([0] if category == 'ECOSYSTEM' else [3, 13]):
            manifest['layers'].append(dict(category=category, bandNumber=band, title='Synthetic ' + name,
                sourcePath=name + '.tif', sourceSha256=declared[band] if category == 'PRESSURE' else digest(name + '.tif'),
                units=manifest['units']))
    (folder / 'calculation-input-support.json').write_text(json.dumps(manifest, indent=2) + '\n')
    transform = Transformer.from_crs(3035, 4326, always_xy=True).transform
    # Keep the test polygon away from TIFF edges and densify to preserve projected edges.
    points = []
    corners = [(4357500, 3858500), (4360500, 3858500), (4360500, 3861500), (4357500, 3861500)]
    for start, end in zip(corners, corners[1:] + corners[:1]):
        for index in range(12):
            points.append(list(transform(start[0] + (end[0] - start[0]) * index / 12,
                                         start[1] + (end[1] - start[1]) * index / 12)))
    points.append(points[0])
    geometry = dict(type='Polygon', coordinates=[points])
    feature = dict(type='Feature', properties=dict(name='Synthetic acceptance area', title='Synthetic acceptance area'), geometry=geometry)
    (folder / 'feature.json').write_text(json.dumps(feature) + '\n')
    catalogue = dict(type='ACCEPTANCE', en='Synthetic acceptance areas', sv='Synthetic acceptance areas',
        groups=[dict(en='Protocol fixtures', sv='Protocol fixtures', areas=[dict(name='Synthetic acceptance area',
            searchdata='Synthetic acceptance fixture', areaKm2=9, polygon=geometry)])])
    boundary = dict(areas=[dict(name='Synthetic acceptance boundary', polygon=geometry)])
    quote_json = lambda value: json.dumps(value).replace("'", "''")
    (folder / 'ui-seed.sql').write_text(f"""SET search_path=symphony,public;
-- Native formula/spatial fields and JSON type cannot be inferred by Hibernate DDL.
ALTER TABLE reliabilitypartition ADD COLUMN IF NOT EXISTS rp_polygon geometry(MultiPolygon,4326);
ALTER TABLE compoundcomparison ALTER COLUMN cmp_result TYPE json USING cmp_result::json;
ALTER TABLE nationalarea ALTER COLUMN narea_areas TYPE text;
ALTER TABLE nationalarea ALTER COLUMN narea_types TYPE text;
INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas,narea_types)
 SELECT 'SWE','TYPES','{{}}','["ACCEPTANCE"]'
 WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type='TYPES');
INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas)
 SELECT 'SWE','BOUNDARY','{quote_json(boundary)}'
 WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type='BOUNDARY');
INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas)
 SELECT 'SWE','ACCEPTANCE','{quote_json(catalogue)}'
 WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type='ACCEPTANCE');
""")
    polygon = json.dumps(geometry).replace("'", "''")
    (folder / 'seed.sql').write_text(f'''SET search_path = symphony, public;
-- Native spatial columns are transient ORM fields and installed explicitly in real deployments.
ALTER TABLE scenarioarea ADD COLUMN polygon geometry(MultiPolygon,4326);
ALTER TABLE scenarioarea ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE capolygon ALTER COLUMN cap_polygon TYPE text;
ALTER TABLE userdefarea ALTER COLUMN uda_polygon TYPE text;
ALTER TABLE capolygon ADD COLUMN IF NOT EXISTS pg_polygon geometry(MultiPolygon,4326);
-- Hibernate bootstrap creates a table for this view-mapped entity in the disposable DB.
DROP TABLE calculationresultslice;
CREATE VIEW calculationresultslice AS
SELECT cr.cares_id AS id, cr.cares_bver_id AS baselineversion_id,
 cr.cares_calculationname AS calculationname, cr.cares_timestamp AS "timestamp",
 cr.cares_owner AS owner, cr.cares_geotiff IS NULL AS ispurged,
 (((s.changes ->> 'baseChanges')::json) ->> 'PRESSURE') IS NOT NULL
 OR (((s.changes ->> 'baseChanges')::json) ->> 'ECOSYSTEM') IS NOT NULL
 OR ((SELECT count(ac.key) FROM json_each((s.changes ->> 'areaChanges')::json) ac
      WHERE ac.value::text <> '{{}}')) > 0 AS haschanges
 FROM scenariosnapshot s JOIN calculationresult cr ON cr.scenariosnapshot_id = s.id;
INSERT INTO baselineversion (bver_name,bver_title,bver_desc,bver_locale,bver_validfrom,bver_ecofilepath,bver_presfilepath)
 VALUES ('HAV_2019_WEST_LOCAL','Synthetic acceptance baseline','Not scientific data','en','2020-01-01',
 '/verification/fixtures/ecosystems.tif','/verification/fixtures/pressures.tif');
INSERT INTO meta_bands (metaband_bver_id,metaband_category,metaband_number,metaband_default_selected)
 SELECT bver_id,'Ecosystem',n,n=0 FROM baselineversion CROSS JOIN generate_series(0,1) n;
INSERT INTO meta_bands (metaband_bver_id,metaband_category,metaband_number,metaband_default_selected)
 SELECT bver_id,'Pressure',n,n IN (3,13) FROM baselineversion CROSS JOIN generate_series(0,13) n;
INSERT INTO meta_values (metaval_band_id,metaval_language,metaval_field,metaval_value)
 SELECT metaband_id,'en','title','Synthetic ' || metaband_category || ' ' || metaband_number FROM meta_bands;
INSERT INTO meta_values (metaval_band_id,metaval_language,metaval_field,metaval_value)
 SELECT metaband_id,'en','symphonytheme','Synthetic acceptance' FROM meta_bands;
INSERT INTO sensitivitymatrix (sensm_name,sensm_bver_id,sensm_owner)
 SELECT 'Synthetic matrix',bver_id,NULL FROM baselineversion;
INSERT INTO sensitivity (sens_pres_band_id,sens_eco_band_id,sens_sensm_id,sens_value)
 SELECT p.metaband_id,e.metaband_id,m.sensm_id,0.5 FROM meta_bands p CROSS JOIN meta_bands e CROSS JOIN sensitivitymatrix m
 WHERE p.metaband_category='Pressure' AND e.metaband_category='Ecosystem';
INSERT INTO areatype (atype_name,atype_coastalarea) VALUES ('Acceptance area',false);
INSERT INTO calculationarea (carea_name,carea_default,carea_maxvalue,carea_default_sensm_id,carea_atype_id)
 SELECT 'Synthetic acceptance area',true,10000,m.sensm_id,t.atype_id FROM sensitivitymatrix m CROSS JOIN areatype t;
INSERT INTO capolygon (cap_carea_id,cap_polygon,pg_polygon)
 SELECT carea_id,'{polygon}',ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('{polygon}'),4326)) FROM calculationarea;
INSERT INTO calcareasensmatrix (casen_carea_id,casen_sensm_id,casen_comment)
 SELECT a.carea_id,m.sensm_id,'Synthetic acceptance fixture' FROM calculationarea a CROSS JOIN sensitivitymatrix m;
INSERT INTO usersettings ("user",settings)
 SELECT 'acceptance',jsonb_build_object('activeBaselineId',bver_id) FROM baselineversion;
''')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    generate(parser.parse_args().folder)

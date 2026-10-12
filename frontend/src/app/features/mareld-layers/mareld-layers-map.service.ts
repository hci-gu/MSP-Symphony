import { effect, inject, Injectable } from '@angular/core';
import Map from 'ol/Map';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Stroke, Style } from 'ol/style';
import { transformExtent } from 'ol/proj';
import { rasterSource, registerGridProjection } from '../mareld-shared/map-raster';
import { layerPixels } from './mareld-layer-data';
import { MareldLayers } from './mareld-layers.service';

@Injectable({ providedIn: 'root' })
export class MareldLayersMap {
  private readonly state = inject(MareldLayers);
  private map?: Map;
  private group?: LayerGroup;
  private image?: ImageLayer<ImageStatic>;
  private revision = 0;

  constructor() {
    effect(() => {
      void this.render();
    });
    effect(() => {
      const opacity = this.state.opacity();
      this.image?.setOpacity(opacity);
    });
  }

  attach(map: Map): void {
    this.detach();
    registerGridProjection();
    this.map = map;
    this.image = new ImageLayer({ opacity: this.state.opacity() });
    const outlines = new VectorLayer({
      source: new VectorSource({
        features: new GeoJSON().readFeatures(
          {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', geometry: this.state.catalog.reviewGeometry, properties: {} },
              { type: 'Feature', geometry: this.state.catalog.windparkGeometry, properties: {} }
            ]
          },
          { dataProjection: 'EPSG:4326', featureProjection: map.getView().getProjection() }
        )
      }),
      style: [
        new Style({ stroke: new Stroke({ color: '#ffffff', width: 4 }) }),
        new Style({ stroke: new Stroke({ color: '#243f4a', width: 1.5 }) })
      ]
    });
    this.group = new LayerGroup({
      layers: [this.image, outlines],
      properties: { id: 'mareld-area-data' }
    });
    // Above native raster bands, below area editing and simulation result overlays.
    map.getLayers().insertAt(Math.min(2, map.getLayers().getLength()), this.group);
    this.state.activateContext();
    void this.render();
  }

  reset(): void {
    ++this.revision;
    this.state.reset();
    this.image?.setSource(null);
    this.group?.setVisible(false);
  }

  detach(): void {
    this.reset();
    if (this.group) this.map?.removeLayer(this.group);
    this.group?.getLayers().forEach((layer) => layer.dispose());
    this.group?.dispose();
    this.group = undefined;
    this.image = undefined;
    this.map = undefined;
  }

  fit(): void {
    if (!this.map) return;
    const extent =
      this.state.scope() === 'park'
        ? new GeoJSON()
            .readGeometry(this.state.catalog.windparkGeometry, {
              dataProjection: 'EPSG:4326',
              featureProjection: this.map.getView().getProjection()
            })
            .getExtent()
        : transformExtent(
            this.state.catalog.grid.extent,
            'EPSG:3035',
            this.map.getView().getProjection()
          );
    this.map.getView().fit(extent, { padding: [75, 60, 90, 450], maxZoom: 12, duration: 250 });
  }

  private async render(): Promise<void> {
    const asset = this.state.asset(),
      scope = this.state.scope();
    const provenance = this.state.showProvenance(),
      hatch = this.state.hatch();
    const revision = ++this.revision;
    if (!this.map || !this.image || !this.group) return;
    this.group.setVisible(!!asset);
    this.image.setSource(null);
    if (!asset) {
      this.state.finishLoading();
      return;
    }
    this.state.beginLoading();
    try {
      const { raster, park } = await this.state.load(asset.file);
      if (revision !== this.revision || !this.image) return;
      this.image.setSource(
        rasterSource(
          this.state.catalog.grid,
          layerPixels(raster, this.state.catalog.grid.width, park, scope, provenance, hatch),
          this.state.catalog.attribution
        )
      );
      this.state.finishLoading();
    } catch {
      if (revision !== this.revision) return;
      this.state.finishLoading('This MARELD layer could not be loaded. Select it again to retry.');
    }
  }
}

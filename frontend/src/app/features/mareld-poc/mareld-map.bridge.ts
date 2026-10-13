import { rasterSource } from '../mareld-shared/map-raster';
import { effect, inject, Injectable } from '@angular/core';
import Map from 'ol/Map';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import MultiLineString from 'ol/geom/MultiLineString';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { transformExtent } from 'ol/proj';
import { MareldSession } from './mareld-session.service';
import { framePixels } from './mareld-result';
import { MareldPressureLayer } from './mareld-pressure-layer.service';
import { IMPACT_KINDS, ImpactKind, impactPixels } from './mareld-impacts';
import { impactOutlineLines, IMPACT_OUTLINE_STYLES } from './mareld-impact-outline';

@Injectable({ providedIn: 'root' })
export class MareldMapBridge {
  private readonly session = inject(MareldSession);
  private readonly pressure = inject(MareldPressureLayer);
  private map?: Map;
  private group?: LayerGroup;
  private image?: ImageLayer<ImageStatic>;
  private outline?: VectorLayer<VectorSource>;
  private windpark?: VectorLayer<VectorSource>;
  private impactOutlines: Partial<Record<ImpactKind, VectorLayer<VectorSource>>> = {};
  private impactOutlineKey = '';
  private inputId = '';
  private frameKey = '';

  constructor() {
    effect(() => this.render());
  }

  attach(map: Map): void {
    this.detach();
    this.map = map;
    this.image = new ImageLayer();
    this.outline = new VectorLayer({
      source: new VectorSource(),
      style: new Style({ stroke: new Stroke({ color: '#107f8c', width: 2, lineDash: [6, 4] }) })
    });
    this.group = new LayerGroup({
      layers: [this.image, this.outline],
      properties: { id: 'mareld-poc' }
    });
    map.getLayers().insertAt(Math.min(3, map.getLayers().getLength()), this.group);
    this.windpark = new VectorLayer({
      source: new VectorSource({
        features: new GeoJSON().readFeatures(this.pressure.feature, {
          dataProjection: 'EPSG:4326',
          featureProjection: map.getView().getProjection()
        })
      }),
      style: new Style({
        fill: new Fill({ color: 'rgba(246, 182, 76, 0.28)' }),
        stroke: new Stroke({ color: '#ba5700', width: 3 }),
        text: new Text({
          text: this.pressure.feature.properties.name,
          font: '600 14px Roboto, sans-serif',
          fill: new Fill({ color: '#753600' }),
          stroke: new Stroke({ color: '#fffaf2', width: 4 })
        })
      }),
      // Keep the footprint legible above the selected-area fill and biomass image.
      zIndex: 20,
      properties: { id: 'mareld-windpark-pressure', category: 'PRESSURE' }
    });
    map.addLayer(this.windpark);
    for (const kind of IMPACT_KINDS) {
      const { color, lineDash } = IMPACT_OUTLINE_STYLES[kind];
      const layer = new VectorLayer({
        source: new VectorSource(),
        style: [
          new Style({
            stroke: new Stroke({ color: 'rgba(13, 35, 48, 0.85)', width: 5, lineDash })
          }),
          new Style({ stroke: new Stroke({ color, width: 3, lineDash }) })
        ],
        zIndex: 21,
        properties: { id: `mareld-${kind}-outline` }
      });
      this.impactOutlines[kind] = layer;
      map.addLayer(layer);
    }
    this.pressure.activateContext();
    this.render();
  }

  reset(): void {
    this.session.reset();
    this.pressure.reset();
    this.render();
  }

  detach(): void {
    this.session.reset();
    this.pressure.reset();
    for (const layer of Object.values(this.impactOutlines)) {
      this.map?.removeLayer(layer);
      layer.dispose();
    }
    this.impactOutlines = {};
    this.impactOutlineKey = '';
    if (this.windpark) {
      this.map?.removeLayer(this.windpark);
      this.windpark.dispose();
    }
    if (this.group) {
      this.map?.removeLayer(this.group);
      this.image?.setSource(null);
      this.group.getLayers().forEach((layer) => layer.dispose());
      this.group.dispose();
    }
    this.map = undefined;
    this.group = undefined;
    this.image = undefined;
    this.outline = undefined;
    this.windpark = undefined;
    this.inputId = '';
    this.frameKey = '';
  }

  fit(): void {
    const input = this.session.result()?.input || this.session.input();
    if (this.map && input)
      this.map
        .getView()
        .fit(
          transformExtent(input.grid.extent, input.grid.crs, this.map.getView().getProjection()),
          { padding: [70, 70, 70, 450], maxZoom: 11, duration: 450 }
        );
  }

  private render(): void {
    const result = this.session.result();
    const prepared = this.session.preparedImpacts();
    const preview = prepared?.layers.find((layer) => layer.kind === this.session.previewImpact());
    const input = preview ? this.session.input() : result?.input || this.session.input();
    const frame = this.session.frame(),
      species = this.session.species(),
      opacity = this.session.opacity();
    const pressureVisible = this.pressure.visible();
    this.windpark?.setVisible(pressureVisible);
    this.renderImpactOutlines();
    if (!this.map || !this.image || !this.outline) return;
    this.image.setOpacity(opacity);
    if (!input) {
      this.image.setSource(null);
      this.outline.getSource()!.clear();
      this.inputId = '';
      this.frameKey = '';
      return;
    }
    if (input.id !== this.inputId) {
      this.outline.getSource()!.clear();
      this.outline.getSource()!.addFeatures(
        new GeoJSON().readFeatures(input.geometry, {
          dataProjection: 'EPSG:4326',
          featureProjection: this.map.getView().getProjection()
        })
      );
      this.inputId = input.id;
      this.fit();
    }
    if (preview && prepared) {
      const key = `impact:${prepared.id}:${preview.kind}`;
      if (key !== this.frameKey) {
        this.image.setSource(rasterSource(input.grid, impactPixels(input, preview)));
        this.frameKey = key;
      }
      return;
    }
    if (!result) {
      this.image.setSource(null);
      this.frameKey = '';
      return;
    }
    const key = `${result.id}:${frame}:${species}`;
    if (key === this.frameKey) return;
    this.image.setSource(rasterSource(result.input.grid, framePixels(result, frame, species)));
    this.frameKey = key;
  }

  private renderImpactOutlines(): void {
    const { input, impacts } = this.session.mapImpacts();
    const visibility = this.session.impactOutlines();
    if (!this.map) return;
    const key = input && impacts ? `${input.id}:${impacts.id}` : '';
    for (const kind of IMPACT_KINDS) {
      const vector = this.impactOutlines[kind];
      if (!vector) continue;
      const layer = impacts?.layers.find((item) => item.kind === kind);
      if (key !== this.impactOutlineKey) {
        vector.getSource()!.clear();
        if (input && layer?.affectedCells) {
          const geometry = new MultiLineString(impactOutlineLines(input, layer));
          geometry.transform(input.grid.crs, this.map.getView().getProjection());
          vector.getSource()!.addFeature(new Feature(geometry));
        }
      }
      vector.setVisible(!!layer?.affectedCells && visibility[kind]);
    }
    this.impactOutlineKey = key;
  }
}

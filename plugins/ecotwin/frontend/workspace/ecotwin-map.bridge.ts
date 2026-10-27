import { rasterSource } from '../shared/map-raster';
import { effect, inject, Injectable, signal } from '@angular/core';
import Map from 'ol/Map';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import MultiLineString from 'ol/geom/MultiLineString';
import { Stroke, Style } from 'ol/style';
import { transformExtent } from 'ol/proj';
import { SimulationWorkspace } from './simulation-workspace';
import { framePixels } from './ecotwin-result';
import { IMPACT_KINDS, ImpactKind, impactPixels } from './ecotwin-impacts';
import { impactOutlineLines, IMPACT_OUTLINE_STYLES } from './ecotwin-impact-outline';

@Injectable({ providedIn: 'root' })
export class EcoTwinMapBridge {
  private readonly session = inject(SimulationWorkspace);
  private readonly active = signal(false);
  private readonly mapState = signal<Map | undefined>(undefined);
  private get map(): Map | undefined {
    return this.mapState();
  }
  private group?: LayerGroup;
  private image?: ImageLayer<ImageStatic>;
  private outline?: VectorLayer<VectorSource>;
  private impactOutlines: Partial<Record<ImpactKind, VectorLayer<VectorSource>>> = {};
  private impactOutlineKey = '';
  private inputId = '';
  private frameKey = '';

  constructor() {
    effect(() => this.render());
  }

  private overlayZIndex = 20;
  viewportPadding: () => number[] = () => [32, 32, 32, 32];
  attach(map: Map, overlayZIndex = 20, padding: () => number[] = () => [32, 32, 32, 32]): void {
    this.detach();
    this.overlayZIndex = overlayZIndex;
    this.viewportPadding = padding;
    this.mapState.set(map);
    this.render();
  }

  setActive(active: boolean): void {
    this.active.set(active);
    if (!active) this.session.pausePlayback();
    this.render();
  }

  private createLayers(): void {
    const map = this.map!;
    this.image = new ImageLayer({ visible: false });
    this.outline = new VectorLayer({
      source: new VectorSource(),
      style: new Style({ stroke: new Stroke({ color: '#107f8c', width: 2, lineDash: [6, 4] }) })
    });
    this.group = new LayerGroup({
      layers: [this.image, this.outline],
      properties: { id: 'ecotwin-overlay' },
      zIndex: this.overlayZIndex
    });
    map.addLayer(this.group);
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
        properties: { id: `ecotwin-${kind}-outline` }
      });
      this.impactOutlines[kind] = layer;
      this.group.getLayers().push(layer);
    }
  }

  reset(): void {
    this.session.reset();
    this.render();
  }

  detach(): void {
    if (this.map) this.session.detach();
    this.impactOutlines = {};
    this.impactOutlineKey = '';
    if (this.group) {
      this.map?.removeLayer(this.group);
      this.image?.setSource(null);
      this.group.getLayers().forEach((layer) => layer.dispose());
      this.group.dispose();
    }
    this.mapState.set(undefined);
    this.group = undefined;
    this.image = undefined;
    this.outline = undefined;
    this.inputId = '';
    this.frameKey = '';
  }

  fit(padding = this.viewportPadding()): void {
    const size = this.map?.getSize();
    if (size) {
      padding = [...padding];
      // Keep a usable map viewport even on small screens.
      for (const [a, b, limit] of [
        [1, 3, size[0] - 120],
        [0, 2, size[1] - 100]
      ]) {
        const total = padding[a] + padding[b];
        if (total > limit) {
          padding[a] *= Math.max(0, limit) / total;
          padding[b] *= Math.max(0, limit) / total;
        }
      }
    }
    const input = this.session.result()?.input || this.session.input();
    if (this.map && input)
      this.map
        .getView()
        .fit(
          transformExtent(input.grid.extent, input.grid.crs, this.map.getView().getProjection()),
          { padding, maxZoom: 11, duration: 450 }
        );
  }

  private render(): void {
    if (!this.map) return;
    const active = this.active();
    if (active && !this.group) this.createLayers();
    this.group?.setVisible(active);
    if (!active) return;
    const result = this.session.result();
    const prepared = this.session.preparedImpacts();
    const preview = prepared?.layers.find((layer) => layer.kind === this.session.previewImpact());
    const input = preview ? this.session.input() : result?.input || this.session.input();
    const frame = this.session.frame(),
      species = this.session.species(),
      opacity = this.session.opacity();
    this.renderImpactOutlines();
    if (!this.map || !this.image || !this.outline) return;
    this.image.setOpacity(opacity);
    // OpenLayers may retain the last frame during view animation. Hide the layer
    // before clearing its source so the retained renderer cannot dereference null.
    this.image.setVisible(!!input && !!(preview || result));
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

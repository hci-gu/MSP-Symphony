import { inject, Injectable, InjectionToken, Type } from '@angular/core';
import type Map from 'ol/Map';

/** Host-owned values only. Extensions translate this context inside their adapters. */
export interface ComparisonContext {
  baselineCalculationId: number | null;
  scenarioCalculationId: number | null;
  implicit: boolean;
  reverse: boolean;
}
export interface ComparisonContributionState {
  valid: boolean;
  query: Record<string, string>;
}
export interface ReportContext {
  kind: 'calculation' | 'comparison';
  calculationId?: number;
  comparison?: ComparisonContext;
  query: Record<string, string>;
}
export type RenderState = 'loading' | 'ready' | 'error';
export interface WorkspaceContribution {
  id: string;
  title: string;
  icon: 'grid' | 'info-circle';
  panel: Type<unknown>;
  overlay?: Type<unknown>;
  overlaySidebarControls?: boolean;
}
export interface MapLease {
  map: Map;
  /** Extensions own this overlay slot and must remove/dispose their resources. */
  overlayZIndex: number;
  /** Host UI occlusion: top, right, bottom, left, in CSS pixels. */
  padding: () => number[];
}
export interface HostExtension {
  id: string;
  workspace?: WorkspaceContribution;
  attachMap?: (lease: MapLease) => () => void;
  comparison?: Type<unknown>;
  report?: Type<unknown>;
}
export const HOST_EXTENSIONS = new InjectionToken<HostExtension[]>('Host extensions', {
  factory: () => []
});
/** Legacy link recognizers are distribution metadata, never plugin implementations. */
export const LEGACY_REQUIRED_EXTENSIONS = new InjectionToken<
  ((query: Record<string, string>) => string[])[]
>('Legacy required extensions', { factory: () => [] });
@Injectable({ providedIn: 'root' })
export class HostExtensions {
  readonly items = inject(HOST_EXTENSIONS);
  readonly workspaces = this.items.flatMap((item) => (item.workspace ? [item.workspace] : []));
  private readonly legacy = inject(LEGACY_REQUIRED_EXTENSIONS);
  required(query: Record<string, string>): string[] {
    return [
      ...new Set([
        ...(query['extensions']?.split(',').filter(Boolean) ?? []),
        ...this.legacy.flatMap((read) => read(query))
      ])
    ];
  }
  attachMap(map: Map, padding: () => number[]): () => void {
    const dispose = this.items.flatMap((item, index) =>
      item.attachMap ? [item.attachMap({ map, overlayZIndex: 20 + index, padding })] : []
    );
    return () => dispose.reverse().forEach((close) => close());
  }
}

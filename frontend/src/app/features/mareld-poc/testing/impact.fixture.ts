import { PreparedInput } from '../mareld-input';
import {
  defaultImpactSettings,
  ImpactSource,
  prepareImpact,
  PreparedImpacts
} from '../mareld-impacts';

export function impactSourceFixture(input: PreparedInput): ImpactSource {
  return {
    grid: input.grid,
    file: 'fixture.bin',
    sha256: 'fixture-hash',
    raster: {
      values: new Float32Array(input.water.length).fill(50),
      provenance: new Uint8Array(input.water.length).fill(1)
    }
  };
}

export function impactFixture(input: PreparedInput): PreparedImpacts {
  const settings = defaultImpactSettings();
  settings.noise.enabled = true;
  settings.trawling.enabled = true;
  return {
    id: 'impact-fixture',
    inputId: input.id,
    version: 'symphony-demo-impacts-v1',
    settings,
    layers: (['noise', 'trawling'] as const).map((kind) =>
      prepareImpact(input, kind, 1, impactSourceFixture(input))
    )
  };
}

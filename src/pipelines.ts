import {
  ClampHighlights,
  CNNM,
  CNNVL,
  CNNx2M,
  CNNx2VL,
  DoG,
  PresetPipeline,
  type Anime4KPipeline,
  type Anime4KPresetPipelineDescriptor,
} from 'anime4k-webgpu-async';
import type { Preset } from './modes.js';
import type { Size } from './layout.js';

/**
 * The presets, built from Anime4K's Mode A:
 *
 *   performance  DoG, CNNx2M, AutoDownscale                deblur, then upscale
 *   balanced     Clamp, CNNM, CNNx2M, AutoDownscale, ...  Mode A (Fast)
 *   quality      Clamp, CNNVL, CNNx2VL, AutoDownscale, ... Mode A (HQ)
 *
 * An x2 step only runs when the target is more than 1.2x the current size on both axes.
 */
class PresetChain extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor, preset: Preset) {
    super(descriptor);
    switch (preset) {
      case 'performance':
        this.addNode(DoG).addUpscaleX2IfNeeded(CNNx2M).addAutoDownscale();
        break;
      case 'balanced':
        this.addNode(ClampHighlights)
          .addNode(CNNM)
          .addUpscaleX2IfNeeded(CNNx2M)
          .addAutoDownscale()
          .addUpscaleX2IfNeeded(CNNx2M);
        break;
      case 'quality':
        this.addNode(ClampHighlights)
          .addNode(CNNVL)
          .addUpscaleX2IfNeeded(CNNx2VL)
          .addAutoDownscale()
          .addUpscaleX2IfNeeded(CNNx2M);
        break;
    }
  }
}

export function buildPreset(
  device: GPUDevice,
  inputTexture: GPUTexture,
  preset: Preset,
  native: Size,
  target: Size,
): Anime4KPipeline {
  return new PresetChain(
    { device, inputTexture, nativeDimensions: native, targetDimensions: target },
    preset,
  );
}

export { recordPipelineList } from 'anime4k-webgpu-async';

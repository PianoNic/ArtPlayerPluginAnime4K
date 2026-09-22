import {
  ClampHighlights,
  CNNM,
  CNNVL,
  CNNx2M,
  CNNx2VL,
  PresetPipeline,
  type Anime4KPipeline,
  type Anime4KPresetPipelineDescriptor,
} from 'anime4k-webgpu-async';
import type { Preset } from './modes.js';
import type { Size } from './layout.js';

/**
 * The three presets, built from the same primitives as upstream Anime4K's "Mode A" - the mode
 * Anime4K recommends for most anime, which is mastered at 720p or 1080p and blurred on the way
 * to the viewer.
 *
 *   performance  CNNx2M                                   upscale only, medium network
 *   balanced     Clamp, CNNM, CNNx2M, AutoDownscale, ...  Mode A with the fast (M) networks
 *   quality      Clamp, CNNVL, CNNx2VL, AutoDownscale, ... Mode A as shipped (the HQ variant)
 *
 * Every x2 step only runs when the target is more than 1.2x the current size on both axes, so a
 * 1080p episode in a 1080p window gets restoration but no upscale, and `performance` there is a
 * no-op pass-through. `AutoDownscale` brings an overshoot (x2 of 720p is 1440p on a 1080p screen)
 * back down with a proper filter instead of leaving it to the final bilinear sample.
 */
class PresetChain extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor, preset: Preset) {
    super(descriptor);
    switch (preset) {
      case 'performance':
        this.addUpscaleX2IfNeeded(CNNx2M).addAutoDownscale();
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

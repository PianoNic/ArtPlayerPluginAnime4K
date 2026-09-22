import type { Anime4KPipeline } from 'anime4k-webgpu-async';
import type { Preset } from './modes.js';
import type { Size } from './layout.js';

type PipelinesModule = typeof import('./pipelines.js');

/**
 * The Anime4K networks are several hundred KB of WGSL. Loading them lazily keeps them out of the
 * host's main bundle, and a browser without WebGPU never downloads them at all.
 */
let pipelinesModule: Promise<PipelinesModule> | null = null;
function loadPipelines(): Promise<PipelinesModule> {
  pipelinesModule ??= import('./pipelines.js');
  return pipelinesModule;
}

export interface GpuContext {
  device: GPUDevice;
  format: GPUTextureFormat;
  /** Identifies the adapter for the benchmark cache: vendor, architecture, device. */
  name: string;
}

/**
 * Asks for a WebGPU device. Resolves to null - never throws - when the browser has no WebGPU,
 * the adapter is blocklisted, or the request fails for any other reason.
 */
export async function acquireGpu(): Promise<GpuContext | null> {
  try {
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const info = adapter.info;
    const name =
      [info?.vendor, info?.architecture, info?.device, info?.description]
        .filter((part) => typeof part === 'string' && part !== '')
        .join('|') || 'unknown';
    return { device, format: gpu.getPreferredCanvasFormat(), name };
  } catch {
    return null;
  }
}

/**
 * The Anime4K pipelines allocate their own textures and expose no way to free them. Handing them
 * a device whose `createTexture` / `createBuffer` are recorded lets a rebuild destroy everything
 * the previous chain allocated, instead of waiting for the garbage collector to notice several
 * hundred MB of intermediate textures.
 */
class ResourceScope {
  readonly device: GPUDevice;
  private readonly owned: { destroy(): void }[] = [];

  constructor(device: GPUDevice) {
    const owned = this.owned;
    this.device = new Proxy(device, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'createTexture' || prop === 'createBuffer') {
          return (descriptor: GPUTextureDescriptor & GPUBufferDescriptor) => {
            const resource = (value as (d: unknown) => { destroy(): void }).call(
              target,
              descriptor,
            );
            owned.push(resource);
            return resource;
          };
        }
        return (value as (...args: unknown[]) => unknown).bind(target);
      },
    });
  }

  destroy(): void {
    for (const resource of this.owned.splice(0)) {
      try {
        resource.destroy();
      } catch {
        // Already destroyed with the device.
      }
    }
  }
}

const QUAD_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

@vertex
fn vert_main(@builtin(vertex_index) index : u32) -> VertexOutput {
  const pos = array(vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(-1.0, -1.0),
                    vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(-1.0, 1.0));
  const uv = array(vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0),
                   vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 0.0));
  var out : VertexOutput;
  out.position = vec4(pos[index], 0.0, 1.0);
  out.uv = uv[index];
  return out;
}

@group(0) @binding(0) var frameSampler : sampler;
@group(0) @binding(1) var frameTexture : texture_2d<f32>;

@fragment
fn frag_main(@location(0) uv : vec2f) -> @location(0) vec4f {
  return vec4(textureSampleBaseClampToEdge(frameTexture, frameSampler, uv).rgb, 1.0);
}
`;

interface Chain {
  scope: ResourceScope;
  input: GPUTexture;
  pipeline: Anime4KPipeline;
  native: Size;
}

async function buildChain(
  gpu: GpuContext,
  preset: Preset,
  native: Size,
  target: Size,
): Promise<Chain> {
  const { buildPreset } = await loadPipelines();
  const scope = new ResourceScope(gpu.device);
  try {
    const input = scope.device.createTexture({
      size: [native.width, native.height, 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const pipeline = buildPreset(scope.device, input, preset, native, target);
    return { scope, input, pipeline, native };
  } catch (error) {
    scope.destroy();
    throw error;
  }
}

/**
 * Copies the current video frame in and records the chain. Throws a `SecurityError` for a
 * cross-origin video without CORS - WebGPU refuses to read tainted pixels.
 */
async function encodeChain(
  gpu: GpuContext,
  chain: Chain,
  video: HTMLVideoElement,
): Promise<GPUCommandEncoder> {
  const { recordPipelineList } = await loadPipelines();
  gpu.device.queue.copyExternalImageToTexture({ source: video }, { texture: chain.input }, [
    chain.native.width,
    chain.native.height,
  ]);
  const encoder = gpu.device.createCommandEncoder();
  await recordPipelineList(encoder, [chain.pipeline]);
  return encoder;
}

/** Owns the canvas context and the one chain currently on screen. */
export class Renderer {
  private readonly context: GPUCanvasContext;
  private readonly sampler: GPUSampler;
  private readonly renderPipeline: Promise<GPURenderPipeline>;
  private chain: Chain | null = null;
  private bindGroup: GPUBindGroup | null = null;

  constructor(
    private readonly gpu: GpuContext,
    canvas: HTMLCanvasElement,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not get a WebGPU canvas context');
    this.context = context;
    context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });
    this.sampler = gpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const module = gpu.device.createShaderModule({ code: QUAD_WGSL });
    this.renderPipeline = gpu.device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vert_main' },
      fragment: { module, entryPoint: 'frag_main', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Replaces the chain on screen. The previous one's textures are freed immediately. */
  async build(preset: Preset, native: Size, target: Size): Promise<void> {
    const chain = await buildChain(this.gpu, preset, native, target);
    const renderPipeline = await this.renderPipeline;
    this.release();
    this.chain = chain;
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: chain.pipeline.getOutputTexture().createView() },
      ],
    });
  }

  get ready(): boolean {
    return this.chain !== null;
  }

  /** Renders one frame and resolves with the milliseconds until the GPU finished it. */
  async render(video: HTMLVideoElement): Promise<number> {
    const chain = this.chain;
    const bindGroup = this.bindGroup;
    if (!chain || !bindGroup) return 0;
    const started = performance.now();
    const encoder = await encodeChain(this.gpu, chain, video);
    if (chain !== this.chain) return 0; // rebuilt while recording
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(await this.renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    this.gpu.device.queue.submit([encoder.finish()]);
    await this.gpu.device.queue.onSubmittedWorkDone();
    return performance.now() - started;
  }

  release(): void {
    this.chain?.scope.destroy();
    this.chain = null;
    this.bindGroup = null;
  }

  destroy(): void {
    this.release();
    try {
      this.context.unconfigure();
    } catch {
      // Device already gone.
    }
  }
}

/**
 * Times a preset on the current video frame: a few warm-up frames (the first ones pay for shader
 * compilation), then the median of the rest. Nothing is drawn - only the chain runs, which is
 * where all of the cost is.
 */
export async function measurePreset(
  gpu: GpuContext,
  video: HTMLVideoElement,
  preset: Preset,
  native: Size,
  target: Size,
  { warmup = 3, frames = 7, timeoutMs = 2000 } = {},
): Promise<number[]> {
  const chain = await buildChain(gpu, preset, native, target);
  const times: number[] = [];
  try {
    const deadline = performance.now() + timeoutMs;
    for (let i = 0; i < warmup + frames; i++) {
      const started = performance.now();
      const encoder = await encodeChain(gpu, chain, video);
      gpu.device.queue.submit([encoder.finish()]);
      await gpu.device.queue.onSubmittedWorkDone();
      if (i >= warmup) times.push(performance.now() - started);
      if (performance.now() > deadline) break;
    }
  } finally {
    chain.scope.destroy();
  }
  return times;
}

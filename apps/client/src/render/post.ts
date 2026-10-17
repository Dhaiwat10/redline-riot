import * as THREE from "three";
import type { Quality } from "../quality.ts";
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";

export class Post {
  readonly composer: EffectComposer;
  private readonly ca: ChromaticAberrationEffect | null = null;
  private readonly vignette: VignetteEffect;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: Quality) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const sat = new HueSaturationEffect({ saturation: 0.12 });
    this.vignette = new VignetteEffect({ darkness: 0.35, offset: 0.3 });
    if (q.chromatic) {
      this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.25 });
      this.composer.addPass(new EffectPass(camera, bloom, tone, sat));
      this.composer.addPass(new EffectPass(camera, this.ca, this.vignette));
    } else {
      // Phones: one merged pass.
      this.composer.addPass(new EffectPass(camera, bloom, tone, sat, this.vignette));
    }
    if (q.smaa) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  /** speed01: 0 at rest, 1 at top speed. hit01: brief impact pulse. */
  setIntensity(speed01: number, hit01: number): void {
    const a = Math.max(0, speed01 - 0.55) * 0.004 + hit01 * 0.006;
    this.ca?.offset.set(a, a * 0.6);
    this.vignette.darkness = 0.35 + speed01 * 0.15 + hit01 * 0.25;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}

import {
  ACESFilmicToneMapping, AdditiveBlending, BufferAttribute, BufferGeometry, Color,
  Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, Points, Scene,
  ShaderMaterial, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createStarfield } from './starfield';
import { createProbe, createProbeFromPosition, FixedStepper, stepBody } from './physics';
import type { Body } from './physics';
import { qualityOptions } from './state';
import type { Settings } from './state';
import blackholeVertex from './shaders/blackhole.vert.glsl?raw';
import blackholeFragment from './shaders/blackhole.frag.glsl?raw';
import particleVertex from './shaders/particles.vert.glsl?raw';
import particleFragment from './shaders/particles.frag.glsl?raw';

interface ProbeVisual {
  body: Body;
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  trail: Line<BufferGeometry, LineBasicMaterial>;
  positions: Float32Array;
  samples: number;
  ticks: number;
  fade: number;
  reported: boolean;
}

export interface Telemetry {
  fps: number;
  elapsed: number;
  active: number;
  captured: number;
  escaped: number;
  distance: number;
  lastLaunch: { x: number; y: number } | null;
}

export interface Simulation {
  onTelemetry: (telemetry: Telemetry) => void;
  onProbeEvent: (message: string) => void;
  onError: (message: string) => void;
  applySettings(): void;
  start(): void;
  launch(): boolean;
  launchAt(x: number, y: number): boolean;
  clearProbes(): void;
  reset(): void;
  resetCamera(): void;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  snapshot(): Promise<Blob>;
  getHorizonPosition(): { x: number; y: number };
  setSuspended(suspended: boolean): void;
  dispose(): void;
}

export class Observatory {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(47, 1, 0.05, 250);
  readonly controls: OrbitControls;
  readonly settings: Settings;
  onTelemetry: (telemetry: Telemetry) => void = () => {};
  onProbeEvent: (message: string) => void = () => {};
  onError: (message: string) => void = () => {};

  private readonly scene = new Scene();
  private readonly skyScene = new Scene();
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly starfield = createStarfield();
  private readonly skyMaterial: ShaderMaterial;
  private readonly particleMaterial: ShaderMaterial;
  private readonly particles: Points<BufferGeometry, ShaderMaterial>;
  private readonly occluder: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly observer: ResizeObserver;
  private readonly stepper = new FixedStepper();
  private readonly probes: ProbeVisual[] = [];
  private readonly probeGeometry = new SphereGeometry(0.065, 12, 8);
  private readonly probeMaterial = new MeshBasicMaterial({ color: new Color(0.6, 3, 3.8), toneMapped: false });
  private readonly projected = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly host: HTMLElement;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private frames = 0;
  private fpsTime = 0;
  private captured = 0;
  private escaped = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private appliedQuality: Settings['quality'] | null = null;
  private lastLaunch: { x: number; y: number } | null = null;
  private suspended = false;
  private lastRenderTime = 0;
  private readonly maxFps: number;

  constructor(host: HTMLElement, settings: Settings, maxFps = 0) {
    this.host = host;
    this.settings = settings;
    this.maxFps = maxFps;
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x050709);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive black hole. Drag to orbit, scroll or pinch to zoom. Keyboard: arrow keys orbit, plus and minus zoom.');
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.renderer.domElement.addEventListener('keydown', this.handleCameraKey);

    this.camera.position.set(0, 6.5, 23);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.maxDistance = 65;
    this.controls.rotateSpeed = 0.48;
    this.controls.zoomSpeed = 0.65;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.minPolarAngle = 0.07;
    this.controls.maxPolarAngle = Math.PI - 0.07;
    this.controls.update();
    this.controls.saveState();

    this.skyMaterial = new ShaderMaterial({
      vertexShader: blackholeVertex,
      fragmentShader: blackholeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uResolution: { value: new Vector2() },
        uCameraPosition: { value: this.camera.position },
        uCameraWorld: { value: this.camera.matrixWorld },
        uProjectionInverse: { value: this.camera.projectionMatrixInverse },
        uStars: { value: this.starfield },
        uTime: { value: 0 },
        uGravity: { value: settings.gravity },
        uSpin: { value: settings.spin },
        uTemperature: { value: settings.temperature },
        uLensing: { value: settings.lensing },
        uSteps: { value: 96 },
      },
    });
    const screen = new Mesh(new PlaneGeometry(2, 2), this.skyMaterial);
    screen.frustumCulled = false;
    this.skyScene.add(screen);

    this.occluder = new Mesh(new SphereGeometry(1, 48, 32), new MeshBasicMaterial({ colorWrite: false }));
    this.scene.add(this.occluder);
    const count = 16000;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random();
      positions[i * 3 + 1] = Math.random() * Math.PI * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
      seeds[i] = Math.random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    this.particleMaterial = new ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uTime: { value: 0 }, uGravity: { value: 1 }, uSpin: { value: 0.68 }, uPixelRatio: { value: 1 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new Points(geometry, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.skyScene, this.screenCamera));
    const foreground = new RenderPass(this.scene, this.camera);
    foreground.clear = false;
    foreground.clearDepth = true;
    this.composer.addPass(foreground);
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.18, 0.3, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.applySettings();
    this.resize();
  }

  applySettings(): void {
    const settings = this.settings;
    const uniforms = this.skyMaterial.uniforms;
    uniforms.uGravity.value = settings.gravity;
    uniforms.uSpin.value = settings.spin;
    uniforms.uTemperature.value = settings.temperature;
    uniforms.uLensing.value = settings.lensing;
    uniforms.uSteps.value = qualityOptions[settings.quality].steps;
    this.particleMaterial.uniforms.uGravity.value = settings.gravity;
    this.particleMaterial.uniforms.uSpin.value = settings.spin;
    this.particles.geometry.setDrawRange(0, settings.particleCount);
    this.occluder.scale.setScalar(settings.gravity * (settings.lensing ? 2.25 : 1));
    this.controls.autoRotate = settings.autoOrbit && !settings.paused;
    this.updateCameraLimits();
    for (const probe of this.probes) probe.trail.visible = settings.showTrails;
    this.bloom.enabled = qualityOptions[settings.quality].bloom;
    if (this.appliedQuality !== settings.quality) {
      this.appliedQuality = settings.quality;
      this.resize();
    }
  }

  start(): void {
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.frame = requestAnimationFrame(this.animate);
  }

  launch(): boolean {
    const azimuth = Math.atan2(this.camera.position.z, this.camera.position.x) - 1.0;
    const body = createProbe(this.settings.gravity, this.settings.launchSpeed, this.settings.impact, azimuth);
    return this.addProbe(body);
  }

  launchAt(x: number, y: number): boolean {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      this.onProbeEvent('Choose a launch point inside the observation.');
      return false;
    }
    this.camera.updateMatrixWorld();
    const direction = new Vector3(x * 2 - 1, 1 - y * 2, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const normal = this.camera.getWorldDirection(new Vector3());
    const depth = -this.camera.position.dot(normal) / direction.dot(normal);
    const position = this.camera.position.clone().addScaledVector(direction, depth);
    if (position.length() < this.settings.gravity * 2.8) {
      this.onProbeEvent('Click outside the black hole shadow to launch a visible probe.');
      return false;
    }
    const body = createProbeFromPosition(
      [position.x, position.y, position.z], this.settings.gravity, this.settings.launchSpeed,
      this.settings.impact, [normal.x, normal.y, normal.z],
    );
    return this.addProbe(body);
  }

  private addProbe(body: Body): boolean {
    if (this.probes.length >= 16) {
      this.onProbeEvent('Probe limit reached. Clear trajectories before launching more.');
      return false;
    }
    const screen = new Vector3(...body.position).project(this.camera);
    this.lastLaunch = { x: (screen.x + 1) / 2, y: (1 - screen.y) / 2 };
    const mesh = new Mesh(this.probeGeometry, this.probeMaterial);
    mesh.position.fromArray(body.position);
    const positions = new Float32Array(720 * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const colors: number[] = [];
    for (let i = 0; i < 720; i++) {
      const brightness = 0.2 + i / 720 * 0.8;
      colors.push(brightness * 0.3, brightness * 1.6, brightness * 2.2);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const trail = new Line(geometry, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8, toneMapped: false,
    }));
    trail.frustumCulled = false;
    trail.visible = this.settings.showTrails;
    this.scene.add(mesh, trail);
    this.probes.push({ body, mesh, trail, positions, samples: 0, ticks: 0, fade: 1, reported: false });
    this.onProbeEvent(this.settings.paused ? 'Probe armed. Resume time to begin its trajectory.' : 'Probe launched. Tracking trajectory.');
    return true;
  }

  clearProbes(): void {
    for (const probe of this.probes) this.disposeProbe(probe);
    this.probes.length = 0;
  }

  reset(): void {
    this.clearProbes();
    this.elapsed = 0;
    this.captured = 0;
    this.escaped = 0;
    this.lastLaunch = null;
    this.stepper.reset();
    this.controls.reset();
    this.applySettings();
  }

  resetCamera(): void {
    this.controls.reset();
    this.applySettings();
  }

  orbit(dx: number, dy: number): void {
    const radius = this.camera.position.length();
    const theta = Math.atan2(this.camera.position.x, this.camera.position.z) - dx * Math.PI * 2;
    const phi = Math.max(0.07, Math.min(Math.PI - 0.07, Math.acos(this.camera.position.y / radius) - dy * Math.PI));
    this.camera.position.set(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
    this.controls.update();
  }

  zoom(factor: number): void {
    this.camera.position.setLength(Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, this.camera.position.length() * factor)));
    this.controls.update();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.frames = 0;
  }

  async snapshot(): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not export the observation.'));
      }, 'image/png');
    });
  }

  getHorizonPosition(): { x: number; y: number } {
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(this.settings.gravity * 2.6);
    this.projected.copy(this.cameraRight).project(this.camera);
    return { x: (this.projected.x * 0.5 + 0.5) * this.width, y: (-this.projected.y * 0.5 + 0.5) * this.height };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.renderer.domElement.removeEventListener('keydown', this.handleCameraKey);
    this.controls.dispose();
    this.clearProbes();
    this.probeGeometry.dispose();
    this.probeMaterial.dispose();
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
    this.occluder.geometry.dispose();
    this.occluder.material.dispose();
    this.skyScene.traverse(object => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.skyMaterial.dispose();
    this.starfield.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const { width, height } = this.host.getBoundingClientRect();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = Math.min(window.devicePixelRatio || 1, qualityOptions[this.settings.quality].pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.updateCameraLimits();
    this.skyMaterial.uniforms.uResolution.value.set(this.width * ratio, this.height * ratio);
    this.particleMaterial.uniforms.uPixelRatio.value = ratio;
  }

  private updateCameraLimits(): void {
    const shortHalfFov = Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * Math.min(1, this.camera.aspect));
    // Keep the shadow's rim in frame: closer, a center-facing camera sees only black.
    this.controls.minDistance = this.settings.gravity * 2.75 / Math.sin(shortHalfFov) * 1.12;
    this.controls.maxDistance = Math.max(65, this.controls.minDistance * 2);
    if (this.camera.position.length() < this.controls.minDistance) {
      this.camera.position.setLength(this.controls.minDistance);
    }
  }

  private render(): void {
    this.camera.updateMatrixWorld();
    this.skyMaterial.uniforms.uTime.value = this.elapsed;
    this.particleMaterial.uniforms.uTime.value = this.elapsed;
    this.composer.render();
  }

  private animate = (now: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (document.hidden || this.suspended) return;
    if (this.maxFps && now - this.lastRenderTime < 1000 / this.maxFps - 1) return;
    this.lastRenderTime = now;
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.controls.update(delta);
    if (!this.settings.paused) {
      this.stepper.advance(delta * this.settings.speed, dt => {
        this.elapsed += dt;
        this.updateProbes(dt);
      });
    }
    this.render();
    this.frames++;
    if (now - this.fpsTime >= 700) {
      this.onTelemetry({
        fps: Math.round(this.frames * 1000 / (now - this.fpsTime)),
        elapsed: this.elapsed,
        active: this.probes.filter(probe => probe.body.status === 'active').length,
        captured: this.captured,
        escaped: this.escaped,
        distance: this.camera.position.length() / this.settings.gravity,
        lastLaunch: this.lastLaunch,
      });
      this.frames = 0;
      this.fpsTime = now;
    }
  };

  private updateProbes(dt: number): void {
    for (let i = this.probes.length - 1; i >= 0; i--) {
      const probe = this.probes[i];
      stepBody(probe.body, dt, this.settings);
      probe.mesh.position.fromArray(probe.body.position);
      if (probe.body.status !== 'active') {
        if (!probe.reported) {
          probe.reported = true;
          if (probe.body.status === 'captured') this.captured++;
          else this.escaped++;
          this.onProbeEvent(probe.body.status === 'captured'
            ? 'Signal lost. Probe crossed the event horizon.'
            : 'Probe escaped the gravitational field.');
        }
        probe.mesh.visible = false;
        probe.fade -= dt * 0.22;
        probe.trail.material.opacity = Math.max(0, probe.fade) * 0.8;
        if (probe.fade <= 0) {
          this.disposeProbe(probe);
          this.probes.splice(i, 1);
        }
      } else if (++probe.ticks % 3 === 0) {
        if (probe.samples >= 720) probe.positions.copyWithin(0, 3);
        const index = Math.min(probe.samples, 719) * 3;
        probe.positions.set(probe.body.position, index);
        probe.samples = Math.min(720, probe.samples + 1);
        probe.trail.geometry.setDrawRange(0, probe.samples);
        probe.trail.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  private disposeProbe(probe: ProbeVisual): void {
    this.scene.remove(probe.mesh, probe.trail);
    probe.trail.geometry.dispose();
    probe.trail.material.dispose();
  }

  private handleVisibility = (): void => {
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.frames = 0;
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.onError('The graphics connection was interrupted. Reload the observatory to reconnect.');
  };

  private handleContextRestored = (): void => {
    this.onError('Graphics are available again. Reload the observatory to resume safely.');
  };

  private handleCameraKey = (event: KeyboardEvent): void => {
    const recognized = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'];
    if (!recognized.includes(event.key)) return;
    event.preventDefault();
    const radius = this.camera.position.length();
    let theta = Math.atan2(this.camera.position.x, this.camera.position.z);
    let phi = Math.acos(this.camera.position.y / radius);
    let zoom = radius;
    if (event.key === 'ArrowLeft') theta -= 0.08;
    if (event.key === 'ArrowRight') theta += 0.08;
    if (event.key === 'ArrowUp') phi -= 0.08;
    if (event.key === 'ArrowDown') phi += 0.08;
    if (event.key === '+' || event.key === '=') zoom *= 0.9;
    if (event.key === '-' || event.key === '_') zoom *= 1.1;
    phi = Math.max(0.07, Math.min(Math.PI - 0.07, phi));
    zoom = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, zoom));
    this.camera.position.set(zoom * Math.sin(phi) * Math.sin(theta), zoom * Math.cos(phi), zoom * Math.sin(phi) * Math.cos(theta));
    this.controls.update();
  };
}

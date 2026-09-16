import type { Simulation, Telemetry } from './observatory';
import { defaults } from './state';
import type { Settings } from './state';

export const viewMode = new URLSearchParams(location.search).get('view');
export const isWallpaper = viewMode === 'wallpaper';
export const isControlRoom = viewMode === 'controls';

interface WebViewHost {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewHost };
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSettings(value: unknown): Settings {
  if (!record(value)) throw new Error('Settings must be an object.');
  const result = { ...defaults };
  const ranges = {
    gravity: [0.5, 2], spin: [-0.95, 0.95], particleCount: [0, 16000], temperature: [2000, 15000],
    speed: [0.25, 2], launchSpeed: [0.4, 2.5], impact: [-0.9, 0.9],
  } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < ranges[key][0] || number > ranges[key][1]) {
      throw new Error(`Invalid ${key} setting.`);
    }
    result[key] = number;
  }
  if (!Number.isInteger(result.particleCount)) throw new Error('Particle count must be an integer.');
  for (const key of ['lensing', 'autoOrbit', 'showTrails', 'paused'] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} setting.`);
    result[key] = value[key];
  }
  if (value.quality !== 'performance' && value.quality !== 'balanced' && value.quality !== 'cinematic') throw new Error('Invalid quality setting.');
  result.quality = value.quality;
  return result;
}

type Command =
  | { type: 'settings'; settings: Settings }
  | { type: 'settings-patch'; patch: Partial<Settings> }
  | { type: 'reset'; settings: Settings }
  | { type: 'launch' | 'clear' | 'reset-camera' | 'state-request' }
  | { type: 'launch-at'; x: number; y: number }
  | { type: 'orbit'; dx: number; dy: number }
  | { type: 'zoom'; factor: number }
  | { type: 'snapshot'; id: string };

export class DesktopConnection {
  private readonly channel = new BroadcastChannel(`singularity-${new URLSearchParams(location.search).get('session') || 'desktop'}`);
  private readonly host = window.chrome?.webview;
  private handler: (message: Record<string, unknown>) => void = () => {};
  private readonly receive = (event: { data: unknown }): void => {
    if (record(event.data)) this.handler(event.data);
  };

  constructor() {
    this.channel.addEventListener('message', this.receive);
    this.host?.addEventListener('message', this.receive);
  }

  listen(handler: (message: Record<string, unknown>) => void): void { this.handler = handler; }
  send(message: unknown): void { this.channel.postMessage(message); }
  native(message: unknown): void { this.host?.postMessage(message); }

  authority(simulation: Simulation, settings: Settings, changed: () => void): void {
    const publish = (): void => {
      this.send({ type: 'state', settings });
      this.native({ type: 'state', settings });
    };
    const telemetry = simulation.onTelemetry;
    simulation.onTelemetry = value => {
      telemetry(value);
      this.send({ type: 'telemetry', value });
      publish();
      this.native({ type: 'state', settings, telemetry: value });
    };
    const probeEvent = simulation.onProbeEvent;
    simulation.onProbeEvent = message => {
      probeEvent(message);
      this.send({ type: 'event', message });
      this.native({ type: 'event', message });
    };
    const onError = simulation.onError;
    simulation.onError = message => {
      onError(message);
      this.send({ type: 'error', message });
      this.native({ type: 'error', message });
    };
    this.listen(message => {
      const number = (key: string, min: number, max: number): number => {
        const value = message[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key} in desktop command.`);
        return value;
      };
      try {
        switch (message.type) {
          case 'settings-patch':
            if (!record(message.patch) || Object.keys(message.patch).some(key => !(key in defaults))) throw new Error('Invalid settings patch.');
            Object.assign(settings, parseSettings({ ...settings, ...message.patch }));
            simulation.applySettings();
            changed();
            publish();
            break;
          case 'settings':
          case 'reset':
            Object.assign(settings, parseSettings(message.settings));
            if (message.type === 'reset') simulation.reset();
            else simulation.applySettings();
            changed();
            publish();
            break;
          case 'set-paused':
            if (typeof message.value !== 'boolean') throw new Error('Invalid pause command.');
            settings.paused = message.value;
            simulation.applySettings();
            changed();
            publish();
            break;
          case 'activity':
            if (typeof message.active !== 'boolean') throw new Error('Invalid activity command.');
            simulation.setSuspended(!message.active);
            break;
          case 'launch': simulation.launch(); break;
          case 'launch-at': simulation.launchAt(number('x', 0, 1), number('y', 0, 1)); break;
          case 'clear': simulation.clearProbes(); break;
          case 'reset-camera': simulation.resetCamera(); break;
          case 'orbit': simulation.orbit(number('dx', -1, 1), number('dy', -1, 1)); break;
          case 'zoom': simulation.zoom(number('factor', 0.1, 10)); break;
          case 'state-request': publish(); break;
          case 'snapshot':
            if (typeof message.id !== 'string') throw new Error('Invalid snapshot request.');
            void simulation.snapshot().then(blob => this.send({ type: 'snapshot-result', id: message.id, blob }))
              .catch(error => this.send({ type: 'snapshot-result', id: message.id, error: String(error) }));
            break;
          default: throw new Error(`Unknown desktop command: ${String(message.type)}`);
        }
      } catch (error) {
        simulation.onError(`Desktop command failed: ${String(error)}`);
      }
    });
    this.native({ type: 'ready', view: 'wallpaper' });
  }

  dispose(): void {
    this.host?.removeEventListener('message', this.receive);
    this.channel.close();
  }
}

export class RemoteObservatory implements Simulation {
  onTelemetry: (value: Telemetry) => void = () => {};
  onProbeEvent: (message: string) => void = () => {};
  onError: (message: string) => void = () => {};
  onSettings: () => void = () => {};
  private readonly connection: DesktopConnection;
  private readonly settings: Settings;
  private previousSettings: Settings;
  private readonly snapshots = new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

  constructor(connection: DesktopConnection, settings: Settings) {
    this.connection = connection;
    this.settings = settings;
    this.previousSettings = { ...settings };
    connection.listen(message => {
      try {
        switch (message.type) {
          case 'state':
            Object.assign(settings, parseSettings(message.settings));
            this.previousSettings = { ...settings };
            this.onSettings();
            break;
          case 'telemetry': {
            if (!record(message.value)) throw new Error('Invalid telemetry.');
            const value = message.value;
            const read = (key: string): number => {
              const number = value[key];
              if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error('Invalid telemetry values.');
              return number;
            };
            let lastLaunch: Telemetry['lastLaunch'] = null;
            if (value.lastLaunch !== null) {
              const launch = value.lastLaunch;
              if (!record(launch) || typeof launch.x !== 'number' || typeof launch.y !== 'number' ||
                  !Number.isFinite(launch.x) || !Number.isFinite(launch.y)) throw new Error('Invalid probe position.');
              lastLaunch = { x: launch.x, y: launch.y };
            }
            this.onTelemetry({
              fps: read('fps'), elapsed: read('elapsed'), active: read('active'), captured: read('captured'),
              escaped: read('escaped'), distance: read('distance'), lastLaunch,
            });
            break;
          }
          case 'event':
          case 'error':
            if (typeof message.message !== 'string') throw new Error('Invalid notification.');
            if (message.type === 'event') this.onProbeEvent(message.message);
            else this.onError(message.message);
            break;
          case 'snapshot-result': {
            if (typeof message.id !== 'string') throw new Error('Invalid snapshot response.');
            const pending = this.snapshots.get(message.id);
            if (!pending) break;
            clearTimeout(pending.timeout);
            this.snapshots.delete(message.id);
            if (message.blob instanceof Blob) pending.resolve(message.blob);
            else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Snapshot response was not an image.'));
            break;
          }
        }
      } catch (error) {
        this.onError(`Wallpaper connection failed: ${String(error)}`);
      }
    });
  }

  private send(command: Command): void { this.connection.send(command); }
  applySettings(): void {
    const patch = Object.fromEntries(Object.entries(this.settings).filter(([key, value]) =>
      this.previousSettings[key as keyof Settings] !== value,
    ));
    this.previousSettings = { ...this.settings };
    this.send({ type: 'settings-patch', patch });
  }
  start(): void { this.send({ type: 'state-request' }); this.connection.native({ type: 'ready', view: 'controls' }); }
  launch(): boolean { this.send({ type: 'launch' }); return true; }
  launchAt(x: number, y: number): boolean { this.send({ type: 'launch-at', x, y }); return true; }
  clearProbes(): void { this.send({ type: 'clear' }); }
  reset(): void { this.send({ type: 'reset', settings: this.settings }); }
  resetCamera(): void { this.send({ type: 'reset-camera' }); }
  orbit(dx: number, dy: number): void { this.send({ type: 'orbit', dx, dy }); }
  zoom(factor: number): void { this.send({ type: 'zoom', factor }); }
  getHorizonPosition(): { x: number; y: number } { return { x: 0, y: 0 }; }
  setSuspended(): void { /* The wallpaper host owns visibility and power suspension. */ }
  snapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.snapshots.delete(id);
        reject(new Error('The wallpaper did not respond to the snapshot request.'));
      }, 15000);
      this.snapshots.set(id, { resolve, reject, timeout });
      this.send({ type: 'snapshot', id });
    });
  }
  dispose(): void {
    for (const pending of this.snapshots.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('The control room was closed.'));
    }
    this.snapshots.clear();
  }
}

import './style.css';
import { Observatory } from './observatory';
import type { Simulation } from './observatory';
import { DesktopConnection, isControlRoom, isWallpaper, RemoteObservatory } from './desktop';
import { defaults, presets } from './state';
import type { PresetName, Settings } from './state';
import { icon, mountUI } from './ui';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.querySelector<T>(`#${id}`);
  if (!result) throw new Error(`Required interface element #${id} was not found.`);
  return result;
}

const app = element('app');
app.classList.toggle('wallpaper-mode', isWallpaper);
app.classList.toggle('controls-mode', isControlRoom);
mountUI(app);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const settings: Settings = { ...defaults, paused: reducedMotion };
const mobileQuery = window.matchMedia('(max-width: 760px)');
if (mobileQuery.matches) settings.quality = 'performance';
let toastTimer: ReturnType<typeof setTimeout>;

function toast(message: string): void {
  const target = element('toast');
  target.textContent = message;
  target.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => target.classList.remove('visible'), 4200);
}

function showGraphicsError(message: string): void {
  element('loading').hidden = true;
  element('graphics-error').hidden = false;
  element('graphics-error-message').textContent = message;
  element('simulation-status').textContent = 'OBSERVATION OFFLINE';
  element('app').classList.add('offline');
}

element('reload').addEventListener('click', () => location.reload());
const notes = element<HTMLDialogElement>('notes-dialog');
for (const id of ['field-notes', 'help', 'science-notes']) {
  element(id).addEventListener('click', () => notes.showModal());
}
for (const id of ['close-notes', 'begin-exploring']) {
  element(id).addEventListener('click', () => notes.close());
}
notes.addEventListener('click', event => {
  if (event.target === notes) {
    const bounds = notes.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) notes.close();
  }
});

function setMobileControls(open: boolean): void {
  app.classList.toggle('controls-open', open);
  element('mobile-controls').setAttribute('aria-expanded', String(open));
  if (open) element('close-controls').focus();
  else element('mobile-controls').focus();
}
element('mobile-controls').setAttribute('aria-expanded', 'false');
element('mobile-controls').setAttribute('aria-controls', 'control-panel');
element('mobile-controls').addEventListener('click', () => setMobileControls(true));
element('close-controls').addEventListener('click', () => setMobileControls(false));

function boot(): void {
  let observatory: Simulation;
  const desktop = isWallpaper || isControlRoom ? new DesktopConnection() : null;
  try {
    observatory = isControlRoom && desktop
      ? new RemoteObservatory(desktop, settings)
      : new Observatory(element('universe'), settings, isWallpaper ? 30 : 0);
  } catch (error) {
    console.error('Unable to initialize the observatory:', error);
    showGraphicsError('WebGL 2 could not start. Use a current version of Chrome, Edge, Firefox, or Safari with hardware acceleration enabled.');
    return;
  }
  observatory.onError = showGraphicsError;
  observatory.onProbeEvent = toast;

  const ranges = ['gravity', 'spin', 'temperature', 'particleCount', 'launchSpeed', 'impact'] as const;
  const toggles = ['lensing', 'autoOrbit', 'showTrails'] as const;
  const labels: Record<PresetName, string> = { gargantua: 'Gargantua', quiet: 'Quiet giant', chaos: 'Chaos' };
  let preset: PresetName | null = 'gargantua';

  function formatRange(key: typeof ranges[number], value: number): string {
    if (key === 'temperature') return `${value.toLocaleString('en-US')} K`;
    if (key === 'particleCount') return value.toLocaleString('en-US');
    if (key === 'gravity' || key === 'launchSpeed') return `${value.toFixed(2)} \u00d7`;
    return value.toFixed(2);
  }

  function syncUI(): void {
    for (const key of ranges) {
      const input = element<HTMLInputElement>(key);
      input.value = String(settings[key]);
      input.style.setProperty('--fill', `${(settings[key] - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
      const formatted = formatRange(key, settings[key]);
      element<HTMLOutputElement>(`${key}-value`).value = formatted;
      input.setAttribute('aria-valuetext', formatted);
    }
    for (const key of toggles) element<HTMLInputElement>(key).checked = settings[key];
    element<HTMLSelectElement>('quality').value = settings.quality;
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => {
      const active = button.dataset.preset === preset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(button => {
      const active = Number(button.dataset.speed) === settings.speed;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const pause = element<HTMLButtonElement>('pause');
    pause.innerHTML = icon(settings.paused ? 'play' : 'pause');
    pause.setAttribute('aria-label', settings.paused ? 'Resume simulation' : 'Pause simulation');
    pause.setAttribute('aria-pressed', String(settings.paused));
    element('simulation-status').textContent = settings.paused ? 'A MOMENT, SUSPENDED IN TIME' : 'THE UNIVERSE IS IN MOTION';
    app.classList.toggle('paused', settings.paused);
    element('object-name').textContent = preset ? labels[preset] : 'Your singularity';
    element('object-class').textContent = Math.abs(settings.spin) < 0.05 ? 'NON-ROTATING BLACK HOLE' : 'ROTATING BLACK HOLE';
  }

  const syncRemoteSettings = (): void => {
    preset = (['gargantua', 'quiet', 'chaos'] as const).find(name =>
      (['gravity', 'spin', 'temperature', 'particleCount'] as const).every(key => presets[name][key] === settings[key]),
    ) ?? null;
    syncUI();
  };
  if (observatory instanceof RemoteObservatory) observatory.onSettings = syncRemoteSettings;

  for (const key of ranges) {
    element<HTMLInputElement>(key).addEventListener('input', event => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;
      settings[key] = Number(event.currentTarget.value);
      if (key !== 'launchSpeed' && key !== 'impact') preset = null;
      observatory.applySettings();
      syncUI();
    });
  }
  for (const key of toggles) {
    element<HTMLInputElement>(key).addEventListener('change', event => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;
      settings[key] = event.currentTarget.checked;
      observatory.applySettings();
    });
  }
  element<HTMLSelectElement>('quality').addEventListener('change', event => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) return;
    const quality = event.currentTarget.value;
    if (quality !== 'performance' && quality !== 'balanced' && quality !== 'cinematic') {
      throw new Error(`Unknown render quality: ${quality}`);
    }
    settings.quality = quality;
    observatory.applySettings();
    toast(`${event.currentTarget.selectedOptions[0].text} rendering enabled.`);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.preset;
      if (key !== 'gargantua' && key !== 'quiet' && key !== 'chaos') return;
      preset = key;
      Object.assign(settings, presets[key]);
      observatory.clearProbes();
      observatory.applySettings();
      syncUI();
      toast(`Now observing ${labels[key]}.`);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(button => {
    button.addEventListener('click', () => {
      settings.speed = Number(button.dataset.speed);
      observatory.applySettings();
      syncUI();
    });
  });

  function pause(): void {
    settings.paused = !settings.paused;
    observatory.applySettings();
    syncUI();
  }
  function reset(): void {
    const quality = settings.quality;
    Object.assign(settings, defaults, { quality, paused: reducedMotion });
    preset = 'gargantua';
    observatory.reset();
    syncUI();
    toast('A fresh universe. All parameters and trajectories reset.');
  }
  async function fullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('Full screen is not available in this browser.');
    } catch (error) {
      console.error('Full screen request failed:', error);
      toast('Your browser could not enter full screen.');
    }
  }

  element('pause').addEventListener('click', pause);
  element('reset').addEventListener('click', reset);
  element('launch').addEventListener('click', () => observatory.launch());
  element('clear-probes').addEventListener('click', () => {
    observatory.clearProbes();
    element('active-probes').textContent = '0';
    toast('All probes and trajectories cleared.');
  });
  element('reset-camera').addEventListener('click', () => observatory.resetCamera());
  element('desktop-reset-camera').addEventListener('click', () => observatory.resetCamera());
  element('desktop-orbit-left').addEventListener('click', () => observatory.orbit(-0.04, 0));
  element('desktop-orbit-right').addEventListener('click', () => observatory.orbit(0.04, 0));
  element('desktop-orbit-up').addEventListener('click', () => observatory.orbit(0, 0.06));
  element('desktop-orbit-down').addEventListener('click', () => observatory.orbit(0, -0.06));
  element('desktop-zoom-in').addEventListener('click', () => observatory.zoom(0.85));
  element('desktop-zoom-out').addEventListener('click', () => observatory.zoom(1.15));
  element('fullscreen').addEventListener('click', () => { void fullscreen(); });
  document.addEventListener('fullscreenchange', () => {
    element('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Toggle full screen');
  });
  element<HTMLButtonElement>('snapshot').addEventListener('click', async () => {
    const button = element<HTMLButtonElement>('snapshot');
    button.disabled = true;
    try {
      const blob = await observatory.snapshot();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `singularity-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Observation captured. Your PNG is ready.');
    } catch (error) {
      console.error('Snapshot export failed:', error);
      toast('Capture failed. Please try again.');
    } finally {
      button.disabled = false;
    }
  });

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (notes.open) return;
    if (event.key === 'Escape' && app.classList.contains('controls-open')) setMobileControls(false);
    if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
    switch (event.key.toLowerCase()) {
      case ' ': event.preventDefault(); pause(); break;
      case 'l': observatory.launch(); break;
      case 'r': reset(); break;
      case 'f': void fullscreen(); break;
      case 'h': app.classList.toggle('hide-hud'); break;
    }
  };
  document.addEventListener('keydown', keyHandler);
  observatory.onTelemetry = telemetry => {
    element('fps').textContent = String(telemetry.fps);
    const seconds = Math.floor(telemetry.elapsed);
    element<HTMLOutputElement>('elapsed').value = [
      Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60,
    ].map(value => String(value).padStart(2, '0')).join(':');
    element('active-probes').textContent = String(telemetry.active);
    element('captured-probes').textContent = String(telemetry.captured);
    const horizon = observatory.getHorizonPosition();
    const label = element('horizon-label');
    label.style.left = `${horizon.x + 14}px`;
    label.style.top = `${horizon.y + 16}px`;
    label.style.opacity = telemetry.distance < 8 ? '0' : '';
  };

  const canvas = isWallpaper ? null : element('universe').querySelector('canvas');
  let pointerStart: { x: number; y: number; time: number; id: number; dragged: boolean } | null = null;
  const activePointers = new Set<number>();
  canvas?.addEventListener('pointerdown', event => {
    activePointers.add(event.pointerId);
    pointerStart = event.button === 0 && activePointers.size === 1
      ? { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId, dragged: false }
      : null;
  });
  canvas?.addEventListener('pointermove', event => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart.dragged = true;
  });
  canvas?.addEventListener('pointercancel', event => {
    activePointers.delete(event.pointerId);
    pointerStart = null;
  });
  canvas?.addEventListener('pointerup', event => {
    activePointers.delete(event.pointerId);
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.dragged || start.id !== event.pointerId || performance.now() - start.time > 600 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const bounds = canvas.getBoundingClientRect();
    observatory.launchAt((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  });
  if (isWallpaper && desktop) desktop.authority(observatory, settings, syncRemoteSettings);

  syncUI();
  observatory.start();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    element('loading').hidden = true;
    app.classList.add('ready');
    if (reducedMotion) toast('Reduced motion respected. Press play when you are ready to explore.');
  }));
  const cleanup = (): void => {
    observatory.dispose();
    desktop?.dispose();
    document.removeEventListener('keydown', keyHandler);
    clearTimeout(toastTimer);
  };
  window.addEventListener('pagehide', cleanup, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(cleanup);
}

boot();

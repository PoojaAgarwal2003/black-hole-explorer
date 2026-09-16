const icons = {
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  launch: '<path d="m3 10 18-7-7 18-3-8-8-3Zm8 3 5-5"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
} as const;

export function icon(name: keyof typeof icons, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function slider(id: string, label: string, min: number, max: number, step: number, value: number, output: string, start: string, end: string): string {
  return `<div class="parameter">
    <div class="parameter-label"><label for="${id}">${label}</label><output id="${id}-value" for="${id}">${output}</output></div>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    <div class="range-labels" aria-hidden="true"><span>${start}</span><span>${end}</span></div>
  </div>`;
}

function toggle(id: string, title: string, checked: boolean): string {
  return `<label class="toggle-row" for="${id}"><span>${title}</span><input id="${id}" type="checkbox" role="switch" ${checked ? 'checked' : ''}/><span class="switch" aria-hidden="true"></span></label>`;
}

export function mountUI(app: HTMLElement): void {
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="./" aria-label="Singularity observatory home"><span class="brand-mark">${icon('orbit')}</span><span>SINGULARITY<span class="brand-sub">AN INTERACTIVE OBSERVATORY</span></span></a>
      <nav class="navigation" aria-label="Main navigation">
        <span class="nav-link active">Observatory<span class="nav-dot"></span></span>
        <button id="field-notes" class="nav-link">Field notes ${icon('arrow')}</button>
      </nav>
      <div class="header-right"><span class="system-status"><span class="status-dot"></span>SYSTEM ONLINE</span><button id="help" class="icon-button" aria-label="Open help and keyboard shortcuts" title="Help & shortcuts">${icon('help')}</button></div>
    </header>

    <main class="workspace">
      <section class="viewport" aria-label="Black hole simulation">
        <div id="universe" class="universe"></div>
        <div class="viewport-grain" aria-hidden="true"></div>
        <div class="scene-heading hud">
          <div class="eyebrow"><span class="tiny-line"></span> EXPEDITION 001 / DEEP SPACE</div>
          <h1>The edge of<br><em>everything.</em></h1>
          <p>A place where light bends.<br>And the familiar falls away.</p>
        </div>
        <div class="coordinates hud"><span>RA 17h 45m 40s</span><span>DEC &minus;29&deg; 00&prime; 28&Prime;</span><span class="coordinates-note">ARTISTIC REFERENCE / SGR A*</span></div>
        <div id="horizon-label" class="horizon-label hud" aria-hidden="true"><span class="annotation-line"></span><span>EVENT HORIZON<small>THE POINT OF NO RETURN</small></span></div>
        <div class="object-info hud">
          <div class="object-index">BH<span>01</span><span class="object-divider"></span></div>
          <div><h2 id="object-name">Gargantua</h2><span id="object-class">ROTATING BLACK HOLE</span></div>
        </div>
        <div class="view-controls hud"><button id="reset-camera" class="small-button" title="Return to the initial camera angle">${icon('orbit')} Reset view</button><button id="fullscreen" class="icon-button" aria-label="Toggle full screen" title="Full screen (F)">${icon('expand')}</button></div>
        <div class="orbit-hint hud">${icon('mouse')} <span>DRAG TO ORBIT</span><span class="hint-dot"></span><span>SCROLL TO EXPLORE</span></div>
        <button id="mobile-controls" class="mobile-controls">${icon('sliders')} Control room</button>
        <div id="loading" class="loading"><div class="loading-orbit"></div><span>ESTABLISHING OBSERVATION</span><small>Tracing the paths of light...</small></div>
        <div id="graphics-error" class="graphics-error" role="alert" hidden><h2>Observation interrupted</h2><p id="graphics-error-message"></p><button id="reload" class="primary-button">Reload observatory ${icon('reset')}</button></div>
      </section>

      <aside id="control-panel" class="control-panel" aria-label="Simulation controls">
        <div class="panel-heading"><div><span class="eyebrow">YOUR UNIVERSE. YOUR RULES.</span><h2>Control room</h2></div><span class="panel-number">01 /</span><button id="close-controls" class="icon-button" aria-label="Close control room">${icon('close')}</button></div>
        <div class="panel-scroll">
          <section class="control-section preset-section">
            <div class="section-label">01 <span>SELECT A SYSTEM</span></div>
            <div class="presets" role="group" aria-label="Black hole presets">
              <button class="preset active" data-preset="gargantua" aria-pressed="true"><span class="preset-orb warm"></span><span>Gargantua</span></button>
              <button class="preset" data-preset="quiet" aria-pressed="false"><span class="preset-orb quiet"></span><span>Quiet giant</span></button>
              <button class="preset" data-preset="chaos" aria-pressed="false"><span class="preset-orb blue"></span><span>Chaos</span></button>
            </div>
          </section>
          <section class="control-section">
            <div class="section-label">02 <span>THE PHYSICS</span><span class="live-tag">LIVE</span></div>
            ${slider('gravity', 'Gravitational strength', 0.5, 2, 0.05, 1, '1.00 &times;', 'GENTLE', 'EXTREME')}
            ${slider('spin', 'Black hole spin', -0.95, 0.95, 0.01, 0.68, '0.68', 'RETROGRADE', 'PROGRADE')}
            ${slider('temperature', 'Disk temperature', 2000, 15000, 100, 6500, '6,500 K', 'AMBER', 'BLUE-WHITE')}
            ${slider('particleCount', 'Infalling particles', 0, 16000, 1000, 6000, '6,000', '0', '16K')}
          </section>
          <section class="control-section display-section">
            <div class="section-label">03 <span>OBSERVATION</span></div>
            ${toggle('lensing', 'Gravitational lensing', true)}
            ${toggle('autoOrbit', 'Auto-orbit camera', false)}
            ${toggle('showTrails', 'Probe trajectories', true)}
            <div class="quality-row"><label for="quality">Render quality</label><select id="quality"><option value="performance">Performance</option><option value="balanced" selected>Balanced</option><option value="cinematic">Cinematic</option></select></div>
          </section>
          <p class="science-note">Inspired by relativity. Made for exploration.<br><button id="science-notes">Understand the simulation ${icon('arrow')}</button></p>
        </div>
          <section class="control-section launch-section">
            <div class="launch-heading"><span class="launch-icon">${icon('launch')}</span><div><h3>Into the unknown</h3><p>Launch a probe. Let gravity decide.</p></div></div>
            ${slider('launchSpeed', 'Launch velocity', 0.4, 2.5, 0.05, 1, '1.00 &times;', 'SLOW', 'FAST')}
            ${slider('impact', 'Impact parameter', -0.9, 0.9, 0.02, 0.56, '0.56', 'RETROGRADE', 'PROGRADE')}
            <button id="launch" class="primary-button">Launch probe ${icon('arrow')}<kbd>L</kbd></button>
            <div class="probe-bottom"><span><span id="active-probes">0</span> ACTIVE <span class="probe-separator">/</span> <span id="captured-probes">0</span> CAPTURED</span><button id="clear-probes">Clear</button></div>
          </section>
      </aside>
    </main>

    <footer class="transport">
      <div class="time-controls"><button id="pause" class="play-button" aria-label="Pause simulation" aria-pressed="false" title="Pause / resume (Space)">${icon('pause')}</button><div class="time-readout"><span>SIMULATION TIME</span><output id="elapsed">00:00:00</output></div><span class="transport-divider"></span><div class="speed-controls" role="group" aria-label="Simulation speed"><button data-speed="0.25" aria-pressed="false">0.25&times;</button><button data-speed="1" class="active" aria-pressed="true">1&times;</button><button data-speed="2" aria-pressed="false">2&times;</button></div></div>
      <div class="transport-message"><span class="status-dot"></span><span id="simulation-status">THE UNIVERSE IS IN MOTION</span></div>
      <div class="utility-controls"><span class="fps-readout"><span id="fps">--</span> FPS</span><button id="snapshot" class="small-button" title="Save a PNG of the current observation">${icon('camera')}<span>Capture</span></button><button id="reset" class="icon-button" aria-label="Reset entire simulation" title="Reset simulation (R)">${icon('reset')}</button></div>
    </footer>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <dialog id="notes-dialog" class="notes-dialog" aria-labelledby="notes-title">
      <div class="dialog-top"><span class="eyebrow">OBSERVER'S HANDBOOK</span><button id="close-notes" class="icon-button" aria-label="Close field notes">${icon('close')}</button></div>
      <h2 id="notes-title">A little perspective<br>on <em>the infinite.</em></h2>
      <p class="dialog-intro">A black hole is not an empty space. It is a region where gravity curves spacetime so strongly that, beyond its event horizon, light cannot escape.</p>
      <div class="note-grid">
        <article><span>01 /</span><h3>Follow the light</h3><p>The glowing material forms an accretion disk. Gravity bends rays from its far side above and below the shadow, revealing a view you could never see in ordinary space. Orbit the camera to discover it.</p></article>
        <article><span>02 /</span><h3>The point of no return</h3><p>The event horizon has radius r<sub>s</sub> = 2GM/c&sup2;. The larger dark shape is its apparent shadow, magnified by lensing. The narrow luminous edge evokes the photon ring.</p></article>
        <article><span>03 /</span><h3>Make an experiment</h3><p>Launch velocity controls your probe's speed; the impact parameter controls how tangentially it approaches. Try zero impact for a plunge, or high speed with a large impact parameter for a flyby.</p></article>
        <article><span>04 /</span><h3>Art meets physics</h3><p>This is an illustrative model, not a scientific solver. GLSL rays use Schwarzschild-inspired bending with artistic spin. Probes use a pseudo-Newtonian potential, while disk particles follow procedural spirals. Temperature is a color control, and all simulation units are normalized.</p></article>
      </div>
      <div class="shortcut-list"><h3>Mission controls</h3><div><span>Orbit / zoom</span><span>Drag / scroll / pinch</span></div><div><span>Keyboard camera</span><span>Focus canvas: arrows / + / &minus;</span></div><div><span>Pause / resume</span><kbd>Space</kbd></div><div><span>Launch a probe</span><kbd>L</kbd></div><div><span>Reset simulation</span><kbd>R</kbd></div><div><span>Full screen</span><kbd>F</kbd></div><div><span>Hide / show annotations</span><kbd>H</kbd></div></div>
      <div class="dialog-foot"><span>BUILT WITH THREE.JS + CUSTOM GLSL</span><button id="begin-exploring" class="small-button">Back to the edge ${icon('arrow')}</button></div>
    </dialog>
  `;
}

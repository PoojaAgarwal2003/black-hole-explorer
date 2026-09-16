# Singularity

An interactive black hole observatory built with Three.js, TypeScript, Vite, and custom GLSL. No backend, account, API key, or external image assets.

## Run

Requires Node.js 22.12+ (or 24+).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. On this Windows machine, `.\start.ps1` also finds the portable Node.js installation created with the project.

```sh
npm run build
npm run preview
npm test
npm run test:browser
npm run test:graphics
```

The browser checks require the dev server to be running. They use installed Microsoft Edge on Windows, or Playwright Chromium elsewhere (`npx playwright install chromium`). Set `BASE_URL` to check a preview or another deployment. Set `SOFTWARE_RENDERING=1` to exercise the software graphics path instead of the default GPU. Screenshots are written to the ignored `artifacts` directory.

Deploy the generated `dist` directory to any static host. Asset URLs are relative, so subdirectory hosting is supported. Fonts and all runtime assets are bundled locally; no third-party network requests are required.

## Explore

- Drag to orbit, scroll or pinch to zoom. Focus the canvas to orbit with arrow keys and zoom with `+` / `-`.
- Click a point outside the shadow to launch a probe from that exact screen position. Clicks and drags are distinguished; orbiting does not accidentally launch probes.
- Adjust gravity, spin, disk color temperature, and up to 16,000 GPU-driven infalling particles.
- Switch gravitational lensing, camera auto-orbit, and probe trails independently.
- Launch up to 16 probes with configurable velocity and impact parameter. Zero impact favors infall; high velocity and a large impact parameter favor escape.
- Pause time, choose 0.25x / 1x / 2x speed, reset the view or entire simulation, and export the canvas as a PNG.
- Press `Space` to pause, `L` to launch, `R` to reset, `F` for full screen, or `H` to hide annotations. Shortcuts do not intercept form controls.
- On mobile, open the Control room drawer. Reduced-motion preferences start the simulation paused.

## Rendering

`src/shaders/blackhole.frag.glsl` traces rays with adaptive steps through a Schwarzschild-inspired gravitational field. Thin-disk intersection sampling reveals far-side disk images as rays bend around the hole. Procedural turbulence, radial bands, temperature-dependent color, Doppler-inspired beaming, a finite-height atmosphere, and bloom produce the accretion disk. The environment is a deterministic, locally generated 15,500-star texture. Infalling particles run in a separate vertex shader.

Three quality levels trade ray-march steps and resolution for performance:

| Quality | Ray steps | Maximum pixel ratio | Bloom |
| --- | ---: | ---: | --- |
| Performance | 64 | 0.8 | Off |
| Balanced | 96 | 1.15 | On |
| Cinematic | 144 | 1.65 | On |

Performance mode is the mobile default. WebGL 2 and hardware acceleration are recommended. Lower the quality if your FPS is low.

## Model boundaries

This is a portfolio visualization, **not a scientific general-relativity solver**:

- Rays use approximate Schwarzschild bending; spin adds an artistic frame-dragging term, not a Kerr metric.
- Probe trajectories use velocity Verlet at a fixed 120 Hz with a softened Paczynski-Wiita potential and an artistic spin term. Probes crossing the horizon are captured; outward-moving probes beyond the simulation boundary escape.
- Probe meshes and particle sprites are rendered in ordinary 3D, not ray-traced through the lensing shader.
- Infalling disk particles follow procedural spirals, not an N-body fluid simulation.
- Temperature controls the color palette rather than computing a calibrated blackbody spectrum.
- Units and time are normalized. Names, coordinates, and visual presets are artistic references, not measured models of real objects.
- The labeled apparent shadow is larger than the physical event horizon due to lensing.

## Structure

| File | Responsibility |
| --- | --- |
| `src/observatory.ts` | Three.js rendering, camera, postprocessing, particles, probe visualization |
| `src/shaders/` | Ray bending, accretion emission, particle motion |
| `src/physics.ts` | Framework-independent probe integrator and fixed timestep |
| `src/starfield.ts` | Deterministic procedural sky texture |
| `src/state.ts` | Parameters, presets, quality budgets |
| `src/ui.ts`, `src/style.css` | Responsive observatory interface |
| `src/main.ts` | Controls, accessibility, events, export, error handling |
| `tests/` | Physics invariants and end-to-end browser checks |

## Windows live wallpaper

The `feature/live-wallpaper` branch adds a native .NET 10 / WinForms / WebView2 host. The original web experience is preserved on `main`.

```powershell
.\wallpaper.ps1 -Action Build
.\wallpaper.ps1 -Action Start
```

Building requires Node.js, the .NET 10 SDK, and the WebView2 SDK package. The script restores the package on a first build, using the local NuGet cache when available. Running requires the **.NET 10 Windows Desktop Runtime** and **Microsoft Edge WebView2 Runtime**; both are already installed on the development machine.

The published application is `wallpaper\publish\Singularity.Wallpaper.exe`. It embeds the production assets through a local WebView2 virtual host, so **no Vite server, internet connection, or browser tab is required**.

### Desktop controls

| Action | How |
| --- | --- |
| Launch at a point | Click empty desktop outside the black hole shadow |
| Orbit / zoom | Alt + drag / Alt + mouse wheel on empty desktop, or use the control-room camera buttons |
| Show/hide settings | `Ctrl+Alt+B`, double-click the tray icon, or use its menu |
| Close the settings window | Hides it to the tray; does not stop the wallpaper |
| Stop the wallpaper | Tray menu: **Exit and restore static wallpaper** |
| Select a display | Tray menu: **Wallpaper display** |
| Disable desktop interaction | Uncheck **Desktop click-to-launch** in the tray menu |
| Pin settings over other apps | Enable **Keep control room on top** in the tray menu |

The right-hand control room drives the **same simulation**, not a second WebGL renderer. Gravity, spin, particles, time, presets, capture, and probe settings are synchronized. Launches retain the 16-probe cap; points inside the apparent shadow are rejected with a notice.

The wallpaper is placed in Explorer's background WorkerW layer, behind its icon view. The mouse observer **never consumes input**, ignores icons and other application windows, and does not record keyboard input or mouse activity. Normal icon activation, selection, dragging, and the desktop context menu remain Explorer's responsibility. Alt-drag can also show Explorer's normal selection rectangle because input is deliberately not blocked.

The settings panel is a normal, independently interactive window: it covers only its own rectangle and can be moved or hidden to expose icons underneath. Existing Windows desktop-icon visibility settings are respected.

The native renderer is capped at 30 FPS. Rendering suspends while the selected display is covered by a maximized/fullscreen foreground app or the session is locked. User pause state is separate from that automatic suspension. On Explorer/display changes, the host reconnects; a renderer restart resets probes but retains settings.

No administrator rights, Explorer process termination, startup registration, static-wallpaper replacement, or icon-window reparenting is used. The WorkerW convention is **undocumented and Windows-version-dependent**, so future Insider builds may require adaptation. Attachment failure is surfaced rather than placing a window over the icons.

### Management and diagnostics

```powershell
.\wallpaper.ps1 -Action Status
.\wallpaper.ps1 -Action Show
.\wallpaper.ps1 -Action Hide
.\wallpaper.ps1 -Action Pause
.\wallpaper.ps1 -Action Resume
.\wallpaper.ps1 -Action Launch -X 0.78 -Y 0.32
.\wallpaper.ps1 -Action Snapshot
.\wallpaper.ps1 -Action SelfTest
.\wallpaper.ps1 -Action Stop
```

Management uses a current-user-only named pipe, not a network service. `SelfTest` exercises the actual hosted renderer and companion controls, resets probes, and restores the prior settings. `Snapshot` saves only the simulation, not other desktop windows.

Settings, the isolated browser profile, logs, and optional captures live in `%LOCALAPPDATA%\Singularity`. Rebuild only after stopping the application, since Windows locks running executable files.

`npm run test:desktop` checks two-window synchronization, remote capture, point launching, the probe cap, and click-versus-drag behavior in a browser. The existing web and graphics checks remain available.

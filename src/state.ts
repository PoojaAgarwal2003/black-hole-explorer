export type Quality = 'performance' | 'balanced' | 'cinematic';
export type PresetName = 'gargantua' | 'quiet' | 'chaos';

export interface Settings {
  gravity: number;
  spin: number;
  particleCount: number;
  temperature: number;
  lensing: boolean;
  autoOrbit: boolean;
  showTrails: boolean;
  quality: Quality;
  speed: number;
  launchSpeed: number;
  impact: number;
  paused: boolean;
}

export const defaults: Settings = {
  gravity: 1,
  spin: 0.68,
  particleCount: 6000,
  temperature: 6500,
  lensing: true,
  autoOrbit: false,
  showTrails: true,
  quality: 'balanced',
  speed: 1,
  launchSpeed: 1,
  impact: 0.56,
  paused: false,
};

export const presets: Record<PresetName, Pick<Settings, 'gravity' | 'spin' | 'particleCount' | 'temperature'>> = {
  gargantua: { gravity: 1, spin: 0.68, particleCount: 6000, temperature: 6500 },
  quiet: { gravity: 0.7, spin: 0.12, particleCount: 3000, temperature: 4200 },
  chaos: { gravity: 1.65, spin: 0.95, particleCount: 12000, temperature: 11500 },
};

export const qualityOptions = {
  performance: { steps: 64, pixelRatio: 0.8, bloom: false },
  balanced: { steps: 96, pixelRatio: 1.15, bloom: true },
  cinematic: { steps: 144, pixelRatio: 1.65, bloom: true },
} as const;

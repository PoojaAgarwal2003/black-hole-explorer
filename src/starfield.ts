import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

function randomGenerator(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createStarfield(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas is required to generate the starfield.');
  const random = randomGenerator(4096);
  context.fillStyle = '#06090e';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 100; i++) {
    const x = random() * canvas.width;
    const y = 1024 + Math.sin(x / 640) * 350 + (random() - 0.5) * 430;
    const radius = 90 + random() * 330;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, i % 3 ? 'rgba(58, 72, 101, 0.035)' : 'rgba(87, 57, 41, 0.04)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  for (let i = 0; i < 15500; i++) {
    const x = random() * canvas.width;
    const y = Math.acos(2 * random() - 1) / Math.PI * canvas.height;
    const bright = random();
    const size = bright > 0.993 ? 1.7 : 0.35 + random() * 0.8;
    const alpha = 0.12 + bright * 0.73;
    const color = random() > 0.75 ? `rgba(168, 198, 239, ${alpha})` : `rgba(237, 229, 215, ${alpha})`;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
    if (bright > 0.993) {
      const glow = context.createRadialGradient(x, y, 0, x, y, size * 7);
      glow.addColorStop(0, 'rgba(196, 216, 249, 0.22)');
      glow.addColorStop(1, 'rgba(196, 216, 249, 0)');
      context.fillStyle = glow;
      context.fillRect(x - size * 7, y - size * 7, size * 14, size * 14);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  return texture;
}

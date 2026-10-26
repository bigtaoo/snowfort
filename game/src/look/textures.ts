import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

// Small painted textures, made on a canvas at start-up (no image files).

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Packed snow: white with soft cool lumps and a few sparkles, so a block reads as snow, not plaster. */
export function snowTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 6 + rnd() * 14;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(196,214,240,0.45)');
    grad.addColorStop(1, 'rgba(196,214,240,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(170,192,225,0.5)';
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  return texture(c);
}

/** Ice: cyan with a couple of pale crack lines and lighter streaks. */
export function iceTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#bff1ff');
  grad.addColorStop(1, '#8fdcf5');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(18, 10);
  g.lineTo(46, 52);
  g.lineTo(40, 80);
  g.moveTo(46, 52);
  g.lineTo(84, 64);
  g.lineTo(112, 116);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(80, 8);
  g.lineTo(120, 40);
  g.stroke();
  return texture(c);
}

/** Wood along u: warm planks with darker grain lines and a knot. */
export function woodTexture(): CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#d39352';
  g.fillRect(0, 0, 256, 64);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const y = 4 + rnd() * 56;
    g.strokeStyle = `rgba(140,82,38,${0.35 + rnd() * 0.35})`;
    g.lineWidth = 1.5 + rnd() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5);
    g.stroke();
  }
  g.fillStyle = 'rgba(120,70,30,0.8)';
  g.beginPath();
  g.ellipse(170, 30, 9, 5, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#7a4a22';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 61);
  return texture(c);
}

import { mkdir, writeFile } from "node:fs/promises";

const SIZE = 256;
const SCALE = 3;
const ORANGE = [255, 122, 26, 255];
const WHITE = [255, 255, 255, 255];

function insideRoundedRect(x, y, width, height, radius) {
  const cx = Math.max(radius, Math.min(width - radius, x));
  const cy = Math.max(radius, Math.min(height - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius;
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  if (!lengthSq) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function cubicPoint(p0, p1, p2, p3, t) {
  const one = 1 - t;
  return one ** 3 * p0 + 3 * one ** 2 * t * p1 + 3 * one * t ** 2 * p2 + t ** 3 * p3;
}

function strokeDistance(points, x, y) {
  let distance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    distance = Math.min(distance, pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return distance;
}

function cubicPoints(p0, p1, p2, p3, steps = 36) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return {
      x: cubicPoint(p0.x, p1.x, p2.x, p3.x, t),
      y: cubicPoint(p0.y, p1.y, p2.y, p3.y, t)
    };
  });
}

const innerArc = cubicPoints({ x: 66, y: 116 }, { x: 108, y: 116 }, { x: 141, y: 150 }, { x: 141, y: 191 });
const outerPath = [
  { x: 66, y: 60 },
  { x: 144, y: 60 },
  ...cubicPoints({ x: 144, y: 60 }, { x: 173, y: 60 }, { x: 196, y: 83 }, { x: 196, y: 112 }).slice(1),
  { x: 196, y: 190 }
];

function samplePixel(x, y) {
  if (!insideRoundedRect(x, y, SIZE, SIZE, 42)) return [0, 0, 0, 0];

  const inDot = Math.hypot(x - 75, y - 181) <= 24;
  const inInnerArc = strokeDistance(innerArc, x, y) <= 14;
  const inOuterPath = strokeDistance(outerPath, x, y) <= 14;
  return inDot || inInnerArc || inOuterPath ? WHITE : ORANGE;
}

function rgbaPixel(x, y) {
  const totals = [0, 0, 0, 0];
  for (let sy = 0; sy < SCALE; sy += 1) {
    for (let sx = 0; sx < SCALE; sx += 1) {
      const color = samplePixel(x + (sx + 0.5) / SCALE, y + (sy + 0.5) / SCALE);
      for (let channel = 0; channel < 4; channel += 1) totals[channel] += color[channel];
    }
  }
  return totals.map((value) => Math.round(value / (SCALE * SCALE)));
}

function createIcon() {
  const pixelBytes = SIZE * SIZE * 4;
  const maskStride = Math.ceil(SIZE / 32) * 4;
  const maskBytes = maskStride * SIZE;
  const bitmapHeaderBytes = 40;
  const imageBytes = bitmapHeaderBytes + pixelBytes + maskBytes;
  const icon = Buffer.alloc(6 + 16 + imageBytes);

  icon.writeUInt16LE(0, 0);
  icon.writeUInt16LE(1, 2);
  icon.writeUInt16LE(1, 4);

  const entryOffset = 6;
  icon.writeUInt8(0, entryOffset);
  icon.writeUInt8(0, entryOffset + 1);
  icon.writeUInt8(0, entryOffset + 2);
  icon.writeUInt8(0, entryOffset + 3);
  icon.writeUInt16LE(1, entryOffset + 4);
  icon.writeUInt16LE(32, entryOffset + 6);
  icon.writeUInt32LE(imageBytes, entryOffset + 8);
  icon.writeUInt32LE(22, entryOffset + 12);

  const dibOffset = 22;
  icon.writeUInt32LE(bitmapHeaderBytes, dibOffset);
  icon.writeInt32LE(SIZE, dibOffset + 4);
  icon.writeInt32LE(SIZE * 2, dibOffset + 8);
  icon.writeUInt16LE(1, dibOffset + 12);
  icon.writeUInt16LE(32, dibOffset + 14);
  icon.writeUInt32LE(0, dibOffset + 16);
  icon.writeUInt32LE(pixelBytes, dibOffset + 20);

  let offset = dibOffset + bitmapHeaderBytes;
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = rgbaPixel(x, y);
      icon[offset++] = b;
      icon[offset++] = g;
      icon[offset++] = r;
      icon[offset++] = a;
    }
  }

  return icon;
}

await mkdir("build", { recursive: true });
await writeFile("build/icon.ico", createIcon());

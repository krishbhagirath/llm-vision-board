// Generates simple PNG toolbar icons (indigo rounded square with a 3-node branch glyph). No deps.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const nodes = [[0.3, 0.5], [0.7, 0.3], [0.7, 0.7]].map(([x, y]) => [x * size, y * size]);
  const nr = size * 0.11, lw = Math.max(1, size * 0.06);
  const segDist = (px_, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px_ - ax - t * dx, py - ay - t * dy); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, cx = x + 0.5, cy = y + 0.5;
    const qx = Math.max(r - cx, 0, cx - (size - r)), qy = Math.max(r - cy, 0, cy - (size - r));
    if (Math.hypot(qx, qy) > r) continue;
    let [R, G, B] = [79, 70, 229];
    const onNode = nodes.some(([nx, ny]) => Math.hypot(cx - nx, cy - ny) <= nr);
    const onEdge = segDist(cx, cy, nodes[0], nodes[1]) <= lw / 2 || segDist(cx, cy, nodes[0], nodes[2]) <= lw / 2;
    if (onNode || onEdge) [R, G, B] = [255, 255, 255];
    px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 96, 128]) writeFileSync(`public/icon/${s}.png`, png(s));
console.log('icons written');

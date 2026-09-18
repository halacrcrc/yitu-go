// 生成 512x512 应用图标 PNG（纯 Node 实现，无第三方依赖）
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 512, H = 512;
const px = new Uint8Array(W * H * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  px[i] = Math.round(px[i] * (1 - sa) + r * sa);
  px[i + 1] = Math.round(px[i + 1] * (1 - sa) + g * sa);
  px[i + 2] = Math.round(px[i + 2] * (1 - sa) + b * sa);
  px[i + 3] = Math.max(px[i + 3], a);
}

function roundedRectAlpha(x, y, x0, y0, x1, y1, rad) {
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  const dx = x - cx, dy = y - cy;
  const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (!inside) return 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (rad === 0) return 255;
  if (x0 + rad <= x && x <= x1 - rad) return 255;
  if (y0 + rad <= y && y <= y1 - rad) return 255;
  return d <= rad ? 255 : Math.max(0, Math.round((rad - d) * 255 * 2));
}

function circleAlpha(x, y, cx, cy, r) {
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return d <= r ? 255 : Math.max(0, Math.round((r - d) * 255 * 1.5));
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // 背景：深墨绿渐变圆角矩形
    const bgA = roundedRectAlpha(x, y, 16, 16, 496, 496, 96);
    if (bgA === 0) continue;
    const t = y / H;
    let r = 14 + t * 10, g = 46 + t * 22, b = 36 + t * 14;
    // 微光晕
    const glow = Math.max(0, 1 - Math.hypot(x - 150, y - 130) / 420);
    r += glow * 14; g += glow * 26; b += glow * 18;
    setPx(x, y, clamp(r), clamp(g), clamp(b), bgA);

    // 木纹棋盘（带轻微投影）
    const shadow = circleAlpha(x, y, 268, 288, 190);
    if (shadow > 0) {
      const shA = Math.round(shadow * 0.35);
      setPx(x, y, 4, 10, 8, shA);
    }
    const boardA = roundedRectAlpha(x, y, 96, 92, 416, 412, 18);
    if (boardA > 0) {
      // 木色底 + 横向纹理
      const grain = Math.sin(y * 0.9) * 4 + Math.sin(y * 0.23 + 2) * 7;
      let br = 216 + grain, bg = 168 + grain * 0.8, bb = 102 + grain * 0.5;
      // 边框略深
      if (x < 104 || x > 408 || y < 100 || y > 404) { br -= 26; bg -= 22; bb -= 14; }
      setPx(x, y, clamp(br), clamp(bg), clamp(bb), boardA);
    }
  }
}

// 网格线：9 路示意（棋盘内部 320px，留 24px 边距 → 网格 272px，间距 34）
const gx0 = 122, gy0 = 118, step = 33.5, lines = 9;
const lineCol = [92, 62, 34];
for (let i = 0; i < lines; i++) {
  const gx = Math.round(gx0 + i * step), gy = Math.round(gy0 + i * step);
  for (let t = 0; t <= 8 * step; t++) {
    setPx(Math.round(gx0 + t), gy, ...lineCol, 220);
    setPx(gx, Math.round(gy0 + t), ...lineCol, 220);
    setPx(Math.round(gx0 + t), gy + 1, ...lineCol, 120);
    setPx(gx + 1, Math.round(gy0 + t), ...lineCol, 120);
  }
}
// 星位
const stars = [2, 4, 6];
for (const sx of stars) for (const sy of stars) {
  const cx = Math.round(gx0 + sx * step), cy = Math.round(gy0 + sy * step);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (dx * dx + dy * dy <= 5) setPx(cx + dx, cy + dy, ...lineCol, 255);
  }
}

// 棋子（带高光与描边）
function stone(cx, cy, r, black) {
  for (let y = -r - 2; y <= r + 2; y++) {
    for (let x = -r - 2; x <= r + 2; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r + 1) continue;
      const a = d <= r ? 255 : clamp((r + 1 - d) * 255);
      const nx = x / r, ny = y / r;
      const hl = Math.max(0, 1 - Math.hypot(nx + 0.35, ny + 0.45) / 1.15);
      let cr, cg, cb;
      if (black) {
        cr = 30 + hl * 150; cg = 34 + hl * 150; cb = 40 + hl * 155;
      } else {
        cr = 235 + hl * 20; cg = 233 + hl * 20; cb = 226 + hl * 22;
      }
      // 底部暗边
      const rim = Math.max(0, (ny - 0.55)) * 60;
      setPx(cx + x, cy + y, clamp(cr - rim), clamp(cg - rim), clamp(cb - rim), a);
    }
  }
}

stone(Math.round(gx0 + 2 * step), Math.round(gy0 + 5 * step), 24, true);   // 黑
stone(Math.round(gx0 + 5 * step), Math.round(gy0 + 2 * step), 24, false);  // 白
stone(Math.round(gx0 + 5 * step), Math.round(gy0 + 5 * step), 24, true);   // 黑

// PNG 编码
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// 每行前置 filter byte 0
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("written", out, png.length, "bytes");

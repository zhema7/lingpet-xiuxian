// 生成灵兽 Sprite Sheet + JSON Atlas（v3 精绘：描边/渐变/灵动造型）
// 运行: node scripts/generate-sprites.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'resources', 'sprites');

const FRAME_W = 64, FRAME_H = 64, COLS = 4, ROWS = 4, TOTAL = COLS * ROWS;

const ANIMATIONS = {
  idle:      { frames: [0, 1, 2, 3],     speed: 0.15, loop: true },
  breathe:   { frames: [0, 1, 2, 1],     speed: 0.20, loop: true },
  cultivate: { frames: [4, 5, 6, 7],     speed: 0.12, loop: true },
  eat:       { frames: [8, 9, 10, 9],    speed: 0.18, loop: false },
  happy:     { frames: [12, 13, 14, 15], speed: 0.14, loop: false },
  fight:     { frames: [0, 1, 2, 3],     speed: 0.06, loop: true },
  sleep:     { frames: [4, 5, 5, 4],     speed: 0.30, loop: true },
  evolve:    { frames: [12, 13, 14, 15], speed: 0.10, loop: false }
};

// 调色板: body/dark(暗部)/light(受光)/belly(腹)/eye(瞳)/accent(特征)
const PALETTES = {
  tihun:  { body: '#6cbf6e', dark: '#2f6b38', light: '#b8e6b0', belly: '#f0f7dc', eye: '#2b1a08', accent: '#e8913f' },
  mojiao: { body: '#3f8fd6', dark: '#164a7c', light: '#a8d8f8', belly: '#e2f2fc', eye: '#3a2a08', accent: '#f5c542' },
  liuyi:  { body: '#2fa8b5', dark: '#0e565e', light: '#a2e6ee', belly: '#ecfbfd', eye: '#42240a', accent: '#c4f542' }
};

const hexToRgb = h => { const x = h.replace('#',''); return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)]; };

// ============ PNG 编码（自研，filter 0） ============
function crc32(buf) {
  let c; const table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ============ 画布 ============
function makeCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return {
    buf, w, h,
    px(x, y, rgb, a = 255) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
    },
    rect(x, y, w2, h2, rgb, a = 255) { for (let yy = y; yy < y + h2; yy++) for (let xx = x; xx < x + w2; xx++) this.px(xx, yy, rgb, a); },
    ellipse(cx, cy, rx, ry, rgb, a = 255) {
      for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
        if ((x * x) / (rx * rx || 1) + (y * y) / (ry * ry || 1) <= 1) this.px(cx + x, cy + y, rgb, a);
    },
    // 自动描边: 对所有不透明像素的邻居补 outline 色
    stroke(outline) {
      const snap = Buffer.from(buf);
      const at = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return 0; return snap[(y * w + x) * 4 + 3]; };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (at(x, y) > 0) continue;
        if (at(x - 1, y) > 0 || at(x + 1, y) > 0 || at(x, y - 1) > 0 || at(x, y + 1) > 0) this.px(x, y, outline);
      }
    },
    // 顶部受光: 不透明像素按 y 位置提亮
    shade(topY, botY) {
      for (let y = topY; y <= botY; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (buf[i + 3] === 0 || buf[i + 3] === 255) continue;
      }
      for (let y = topY; y <= botY; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (buf[i + 3] === 255) {
          const k = 1 - 0.18 * (y - topY) / Math.max(1, botY - topY);
          buf[i] = Math.min(255, buf[i] * k + 12); buf[i + 1] = Math.min(255, buf[i + 1] * k + 12); buf[i + 2] = Math.min(255, buf[i + 2] * k + 10);
        }
      }
    }
  };
}

// 常用色
const OUT = [28, 26, 22];
const WHITE = [255, 255, 255];
const BLUSH = [240, 130, 120];
const GOLD = [255, 210, 80];

// 通用灵兽绘制（参数化物种特征）
// f: 帧 0-15 | 呼吸/眨眼/动作由 f 推导
function drawBeast(f, pal, traits) {
  const c = makeCanvas(FRAME_W, FRAME_H);
  const body = hexToRgb(pal.body), dark = hexToRgb(pal.dark), light = hexToRgb(pal.light),
        belly = hexToRgb(pal.belly), eyeC = hexToRgb(pal.eye), accent = hexToRgb(pal.accent);

  const row = Math.floor(f / 4);            // 0 idle 1 cultivate 2 eat 3 happy
  const ph = f % 4;
  const bob = row === 0 ? [0, -1, -2, -1][ph] : row === 3 ? [0, -3, -6, -3][ph] : [0, -1, 0, -1][ph];
  const blink = row === 0 && (ph === 2);
  const cx = 32, groundY = 52 + bob;

  // —— 尾巴/尾巴鳍（在身体后面）
  if (traits.tail === 'curl') {
    for (let i = 0; i < 9; i++) c.ellipse(cx + 13 + i * 0.6, groundY - 16 - Math.sin(i / 2.2) * 5 + i * 0.35, 2.2, 1.8, dark);
  } else if (traits.tail === 'fin') {
    c.ellipse(cx + 15, groundY - 14, 5, 7, accent);
    c.ellipse(cx + 18, groundY - 15, 3, 5, dark);
  } else if (traits.tail === 'segments') {
    for (let i = 0; i < 4; i++) c.ellipse(cx + 14 + i * 4, groundY - 10 - i * 1.5, 3 - i * 0.4, 2.4 - i * 0.3, i % 2 ? body : dark);
  }

  // —— 翅膀（六翼霜蜈，正弦扇动）
  if (traits.wings) {
    const wf = Math.sin(f * 0.9);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wx = cx + side * (8 + i * 5), wy = groundY - 26 + i * 2 + wf * (2 + i);
        c.ellipse(wx, wy, 6 - i, 2.4, [180, 235, 245], 200);
      }
    }
  }

  // —— 身体（头大身小的 Q 版）
  const headR = traits.wings ? 9 : 10;
  const bodyW = traits.wings ? 7 : 9;
  const headY = groundY - 18, bodyY = groundY - 7;
  c.ellipse(cx, bodyY, bodyW, 8, body);                       // 躯干
  c.ellipse(cx, bodyY + 3, bodyW - 3, 4, belly);              // 腹部
  if (traits.segments) {                                      // 蜈: 分节
    for (let i = 0; i < 5; i++) c.ellipse(cx - 12 + i * 6, groundY - 9 + Math.sin(i) * 1.2, 5.5, 5, i % 2 ? dark : body);
    for (let i = 0; i < 6; i++) {                             // 足
      c.px(cx - 14 + i * 5, groundY - 4, dark); c.px(cx - 14 + i * 5, groundY - 3, dark); c.px(cx - 13 + i * 5, groundY - 2, dark);
    }
  } else {                                                    // 猴/蛟: 四肢
    c.ellipse(cx - bodyW + 1, groundY - 2, 3, 3.4, dark);
    c.ellipse(cx + bodyW - 1, groundY - 2, 3, 3.4, dark);
  }

  // —— 头
  c.ellipse(cx, headY, headR, headR - 1, body);
  c.ellipse(cx - 3, headY + 3, headR - 5, 4, belly);          // 口鼻浅色

  // —— 耳/角/触须
  if (traits.ears) {
    c.ellipse(cx - headR + 1, headY - 6, 3, 3.5, body); c.ellipse(cx + headR - 1, headY - 6, 3, 3.5, body);
    c.ellipse(cx - headR + 1, headY - 6, 1.4, 1.8, belly); c.ellipse(cx + headR - 1, headY - 6, 1.4, 1.8, belly);
  }
  if (traits.horns) {
    c.rect(cx - 5, headY - headR - 3, 2, 4, accent); c.rect(cx + 3, headY - headR - 3, 2, 4, accent);
    c.px(cx - 5, headY - headR - 4, accent); c.px(cx + 4, headY - headR - 4, accent);
    // 龙须
    for (let i = 0; i < 4; i++) c.px(cx - 7 - i, headY + 1 + i, accent);
    for (let i = 0; i < 4; i++) c.px(cx + 7 + i, headY + 1 + i, accent);
  }
  if (traits.antennae) {
    const sway = Math.sin(f * 0.7) * 2;
    for (const side of [-1, 1]) {
      c.px(cx + side * 4, headY - 10, dark); c.px(cx + side * 5 + side * sway * 0.5, headY - 12, dark);
      c.px(cx + side * 6 + sway, headY - 14, GOLD);
    }
  }
  if (traits.backfin) { for (let i = 0; i < 4; i++) c.ellipse(cx - 6 + i * 4, bodyY - 9, 1.6, 2.6, accent); }

  // —— 脸（大眼 + 白高光 + 嘴 + 腮红）
  const eyeY = headY - 1;
  if (!blink) {
    c.ellipse(cx - 4, eyeY, 2.6, 3.2, WHITE); c.ellipse(cx + 4, eyeY, 2.6, 3.2, WHITE);
    c.ellipse(cx - 4, eyeY + 0.5, 1.5, 2.2, eyeC); c.ellipse(cx + 4, eyeY + 0.5, 1.5, 2.2, eyeC);
    c.px(cx - 5, eyeY - 1, WHITE); c.px(cx + 3, eyeY - 1, WHITE);
  } else {
    c.rect(cx - 6, eyeY, 4, 1, dark); c.rect(cx + 2, eyeY, 4, 1, dark);
  }
  c.px(cx, headY + 4, eyeC); c.px(cx - 1, headY + 4, eyeC);   // 嘴
  c.px(cx - 8, headY + 3, BLUSH); c.px(cx + 7, headY + 3, BLUSH);

  // —— 动作道具
  if (row === 2 && ph >= 1) {                                  // eat: 举灵果
    c.ellipse(cx + 11, headY + 2, 3, 3, [230, 80, 80]);
    c.px(cx + 11, headY - 1, [90, 140, 60]);
  }
  if (row === 1) {                                             // cultivate: 头顶丹火
    const g = 2 + ph % 2;
    c.ellipse(cx, headY - headR - 6, g, g, GOLD, 220);
    c.ellipse(cx, headY - headR - 6, g + 2, g + 2, GOLD, 90);
  }
  if (row === 3 && ph >= 1) {                                  // happy: 金星
    for (const [sx, sy] of [[-14, -14], [13, -16], [0, -22]]) {
      c.px(cx + sx, headY + sy, GOLD); c.px(cx + sx - 1, headY + sy, GOLD); c.px(cx + sx + 1, headY + sy, GOLD);
      c.px(cx + sx, headY + sy - 1, GOLD); c.px(cx + sx, headY + sy + 1, GOLD);
    }
  }

  c.shade(groundY - 40, groundY + 4);
  c.stroke(OUT);
  return c;
}

const TRAITS = {
  tihun:  { tail: 'curl', ears: true },
  mojiao: { tail: 'fin', horns: true, backfin: true },
  liuyi:  { tail: 'segments', wings: true, antennae: true, segments: true }
};

// ============ 主流程 ============
function generate() {
  mkdirSync(OUT_DIR, { recursive: true });
  const SHEET_W = FRAME_W * COLS, SHEET_H = FRAME_H * ROWS;

  for (const [petId, pal] of Object.entries(PALETTES)) {
    console.log(`[LingPet] 生成 ${petId} (v3 精绘)...`);
    const sheet = Buffer.alloc(SHEET_W * SHEET_H * 4);
    for (let f = 0; f < TOTAL; f++) {
      const c = drawBeast(f, pal, TRAITS[petId]);
      const col = f % COLS, row = Math.floor(f / COLS);
      for (let y = 0; y < FRAME_H; y++)
        c.buf.copy(sheet, ((row * FRAME_H + y) * SHEET_W + col * FRAME_W) * 4, y * FRAME_W * 4, (y + 1) * FRAME_W * 4);
    }
    const png = encodePNG(SHEET_W, SHEET_H, sheet);
    writeFileSync(join(OUT_DIR, `${petId}_sprite.png`), png);
    console.log(`  ✓ ${petId}_sprite.png (${png.length}B)`);

    const frames = {};
    for (let f = 0; f < TOTAL; f++)
      frames[`${petId}_${f}`] = { frame: { x: (f % COLS) * FRAME_W, y: Math.floor(f / COLS) * FRAME_H, w: FRAME_W, h: FRAME_H }, sourceSize: { w: FRAME_W, h: FRAME_H }, spriteSourceSize: { x: 0, y: 0, w: FRAME_W, h: FRAME_H } };
    const animations = {};
    for (const [name, a] of Object.entries(ANIMATIONS)) animations[name] = a.frames.map(i => `${petId}_${i}`);
    writeFileSync(join(OUT_DIR, `${petId}_sprite.json`), JSON.stringify({ meta: { image: `${petId}_sprite.png`, format: 'RGBA8888', size: { w: SHEET_W, h: SHEET_H }, scale: '1' }, frames, animations }, null, 2));
  }
  console.log('[LingPet] v3 精绘完成');
}
generate();

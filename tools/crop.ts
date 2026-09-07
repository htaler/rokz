/** Crop a region of an image and scale it up, for inspecting spritesheets. */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [src, out, sx, sy, w, h, zoom] = process.argv.slice(2);
const Z = Number(zoom ?? 4);
const png = PNG.sync.read(readFileSync(src!));
const X = Number(sx), Y = Number(sy), W = Number(w), H = Number(h);
const dst = new PNG({ width: W * Z, height: H * Z });
for (let y = 0; y < H * Z; y++)
  for (let x = 0; x < W * Z; x++) {
    const s = ((Y + Math.floor(y / Z)) * png.width + (X + Math.floor(x / Z))) * 4;
    const d = (y * dst.width + x) * 4;
    const a = png.data[s + 3]!;
    // checkerboard behind transparency so the sprite edges are visible
    const bg = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) ? 60 : 40;
    dst.data[d] = a ? png.data[s]! : bg;
    dst.data[d + 1] = a ? png.data[s + 1]! : bg;
    dst.data[d + 2] = a ? png.data[s + 2]! : bg;
    dst.data[d + 3] = 255;
  }
writeFileSync(out!, PNG.sync.write(dst));
console.log(`cropped ${W}x${H} at (${X},${Y}) from ${png.width}x${png.height}, scaled ${Z}x`);

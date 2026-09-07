/**
 * Scale a set of Crawl tiles up and lay them out side by side, so candidate
 * sprites can be compared before committing them to tiles.map.json.
 *
 *   node tools/contact-sheet.ts out.png dc-dngn/wall/slime0.png ...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
const ROOT = process.env.SHEET_ROOT ?? join(process.cwd(), '..', 'assets', 'crawl-tiles Oct-5-2010');
function readPng(file: string): PNG {
  const raw = readFileSync(file);
  let at = 8;
  while (at + 12 <= raw.length) {
    const len = raw.readUInt32BE(at);
    const type = raw.toString('ascii', at + 4, at + 8);
    at += 12 + len;
    if (type === 'IEND') break;
  }
  return PNG.sync.read(at < raw.length ? raw.subarray(0, at) : raw);
}
const [outPath, ...paths] = process.argv.slice(2);
const S = 32, Z = 3, PAD = 6;
const out = new PNG({ width: paths.length * (S * Z + PAD), height: S * Z });
for (let i = 0; i < out.data.length; i += 4) { out.data[i]=20; out.data[i+1]=20; out.data[i+2]=24; out.data[i+3]=255; }
paths.forEach((p, i) => {
  const src = readPng(join(ROOT, p));
  for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
    const sx = Math.floor(x / Z), sy = Math.floor(y / Z);
    if (sx >= src.width || sy >= src.height) continue;
    const s = (sy * src.width + sx) * 4;
    if (src.data[s+3] === 0) continue;
    const d = (y * out.width + i * (S * Z + PAD) + x) * 4;
    out.data[d]=src.data[s]!; out.data[d+1]=src.data[s+1]!; out.data[d+2]=src.data[s+2]!; out.data[d+3]=255;
  }
  console.log(`  ${i + 1}. ${p}`);
});
writeFileSync(outPath!, PNG.sync.write(out));

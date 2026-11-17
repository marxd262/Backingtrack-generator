// Downloads the model files the app uses into native/models (not in the repository), checked by SHA-256.
//   node native/tools/get-models.mjs
// Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024): code and weights MIT. The ONNX file is the conversion of the
// "final0" checkpoint published in mosynthkey/beat_this_cpp (MIT), pinned to a commit.
// shortcut: 83 MB; the small checkpoint converts to 10 MB and tracks our test tracks equally well. Host that one
// when the app ships.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const models = [{
  file: 'beat_this.onnx',
  url: 'https://raw.githubusercontent.com/mosynthkey/beat_this_cpp/07ab790a9ec2eda8093d52d249e3ec4f0510ee72/onnx/beat_this.onnx',
  sha256: 'c5c1466e08abdb03fdeb50668a06f244b787d564c212490482231a9cfbe9ccbd',
}];
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../models');
mkdirSync(dir, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const model of models) {
  const target = join(dir, model.file);
  if (existsSync(target) && sha(readFileSync(target)) === model.sha256) { console.log(`${model.file}: already there`); continue; }
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== model.sha256) throw new Error(`${model.file}: checksum ${sha(bytes)}, expected ${model.sha256}`);
  writeFileSync(target, bytes);
  console.log(`${model.file}: ${(bytes.length / 1e6).toFixed(1)} MB`);
}

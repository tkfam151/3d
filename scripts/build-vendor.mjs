// Bundles the two browser libraries into docs/vendor so GitHub Pages can serve
// them directly (no CDN needed). Run after changing versions: npm run vendor
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

mkdirSync('docs/vendor', { recursive: true });
const entries = {
  'supabase.js': "export { createClient } from '@supabase/supabase-js';",
  'three.js': `export * from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
export { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';`,
};
for (const [out, code] of Object.entries(entries)) {
  const tmp = `.vendor-${out}`;
  writeFileSync(tmp, code);
  await build({ entryPoints: [tmp], bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'es2020', outfile: `docs/vendor/${out}`, legalComments: 'eof', logLevel: 'warning' });
  rmSync(tmp);
}
console.log('Built docs/vendor/supabase.js and docs/vendor/three.js');

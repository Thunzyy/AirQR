import { existsSync } from 'fs';
import { resolve } from 'path';

const requiredWasmPaths = [
  resolve('./src/pkg/airqr_core_bg.wasm'),
  resolve('./src/pkg-threaded/airqr_core_bg.wasm'),
];

if (!requiredWasmPaths.every((wasmPath) => existsSync(wasmPath))) {
  console.error('\n❌ WASM package not found!');
  console.error('📦 Building WASM package...\n');
  console.error('Run: npm run build:wasm\n');
  process.exit(1);
}

console.log('✅ WASM packages found');

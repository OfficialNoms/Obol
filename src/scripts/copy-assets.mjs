// src/scripts/copy-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();

const DIRS = {
  viewsSrc: path.resolve(CWD, 'src/web/views'),
  viewsDest: path.resolve(CWD, 'dist/web/views'),
  vendorDest: path.resolve(CWD, 'public/vendor'),
  imagesDest: path.resolve(CWD, 'public/images'), // Added images directory
};

try {
  // 1. Ensure destination directories exist
  fs.mkdirSync(DIRS.viewsDest, { recursive: true });
  fs.mkdirSync(DIRS.vendorDest, { recursive: true });
  fs.mkdirSync(DIRS.imagesDest, { recursive: true }); // Create images directory

  // 2. Copy EJS templates from src to dist
  fs.cpSync(DIRS.viewsSrc, DIRS.viewsDest, { recursive: true });
  console.log('✓ Copied EJS views to dist.');

  // 3. Copy Alpine.js from node_modules to public
  fs.copyFileSync(
    path.resolve(CWD, 'node_modules/alpinejs/dist/cdn.min.js'),
    path.resolve(DIRS.vendorDest, 'alpine.min.js'),
  );
  console.log('✓ Copied Alpine.js to public.');
} catch (error) {
  console.error(`❌ Failed to copy assets: ${error.message}`);
  process.exit(1);
}
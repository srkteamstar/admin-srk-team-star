#!/usr/bin/env node
'use strict';

// Rebuild the small admin UI assets without replacing the retained originals.
// The sidebar displays a 60px square; 180px keeps the logo sharp at 3x density.
// Preserve the full canvas and alpha channel so this changes delivery, not layout.
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const logoDirectory = path.resolve(__dirname, '../frontend/assets/icons/SRK-Team-Star-Logos');

async function optimizeAdminImages() {
    const assets = [
        { source: 'primary-bgless.png', output: 'admin-logo.webp', size: 180, format: 'webp' },
        { source: 'primary.png', output: 'favicon-32.png', size: 32, format: 'png' },
    ];

    for (const asset of assets) {
        const source = path.join(logoDirectory, asset.source);
        const output = path.join(logoDirectory, asset.output);
        const resized = sharp(source).resize(asset.size, asset.size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: sharp.kernel.lanczos3,
        });
        const encoded = asset.format === 'webp'
            ? resized.webp({ lossless: true, effort: 6 })
            : resized.png({ compressionLevel: 9 });
        const info = await encoded.toFile(output);
        const original = await fs.stat(source);
        console.log(`${asset.output}: ${info.width}x${info.height}, ${info.size} bytes (source ${original.size} bytes)`);
    }
}

optimizeAdminImages().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, 'src');
const contentDir = path.resolve(__dirname, 'content');

const files = [
    path.join(srcDir, 'config', 'allowed_sites.js'),
    path.join(srcDir, 'engine', 'math_3d.js'),
    path.join(srcDir, 'engine', 'ortho_canvas.js'),
    path.join(srcDir, 'core', 'pcd_cache.js'),
    path.join(srcDir, 'core', 'track_reader.js'),
    path.join(srcDir, 'core', 'cvat_hook.js'),
    path.join(srcDir, 'core', 'size_clipboard.js'),
    path.join(srcDir, 'core', 'hotkeys.js'),
    path.join(srcDir, 'core', 'hotkeys_autostart.js'),
    path.join(srcDir, 'ui', 'frame_card.js'),
    path.join(srcDir, 'ui', 'macos_dock.js'),
    path.join(contentDir, 'injector.js')
];

let bundleCode = `/**
 * CVAT 3D Multi-Frame QA/QC Inspector - Standalone Main World Bundle
 * Self-contained bundle running natively in Chrome MV3 Main World.
 * Zero external requests, zero TrustedHTML violations, zero cross-origin script injection.
 */

(function() {
    'use strict';

    // Prevent double injection
    if (window.__CVAT_QAQC_INSPECTOR_LOADED__) return;
    window.__CVAT_QAQC_INSPECTOR_LOADED__ = true;

    console.log('[CVAT-QAQC] Initializing 3D Multi-Frame QA/QC Inspector v1.2.0 (4-Corner Only Resizing, Fast INP)...');
`;

for (const f of files) {
    // Normalize Windows checkouts before stripping modules so the bundle is reproducible.
    let content = fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

    // Strip ES module imports
    content = content.replace(/^\s*import\s+[^;]+;\s*$/gm, '');

    // Strip "export default " and "export "
    content = content.replace(/^\s*export\s+default\s+/gm, '');
    content = content.replace(/^\s*export\s+/gm, '');

    bundleCode += `\n    // ------------------------------------------\n`;
    bundleCode += `    // File: ${path.relative(__dirname, f).split(path.sep).join('/')}\n`;
    bundleCode += `    // ------------------------------------------\n\n`;
    bundleCode += content + '\n';
}

bundleCode += `\n})();\n`;

const outputPath = path.join(contentDir, 'bundle.js');
fs.writeFileSync(outputPath, bundleCode, 'utf8');
console.log(`[BUILD] Successfully built ${outputPath} (${bundleCode.length} bytes)`);

/**
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

    // ------------------------------------------
    // File: src/config/allowed_sites.js
    // ------------------------------------------

/**
 * Danh sách các trang web / địa chỉ CVAT được phép inject extension.
 * Thay cho việc dùng regex hoặc đoán DOM, extension sẽ chỉ chạy trên các trang thuộc danh sách này.
 *
 * CÁCH CẤU HÌNH:
 * 1. Địa chỉ chính xác (Khuyên dùng):
 *    'https://cvat-test.vantixapps.net'
 *    'http://localhost:8080'
 *
 * 2. Wildcard tiền tố (Khớp mọi trang bắt đầu bằng https://cvat...):
 *    'https://cvat*' (khớp https://cvat-test.vantixapps.net, https://cvat-prod.vantixapps.net, v.v.)
 *
 * 3. Wildcard domain (Khớp mọi subdomain của vantixapps.net):
 *    '*.vantixapps.net'
 */
const ALLOWED_SITES = [
    // Local CVAT Server instances (mặc định của CVAT là port 8080)
    'http://localhost:8080',
    'http://127.0.0.1:8080',

    // Local CVAT Web UI dev server (port 3000)
    'http://localhost:3000',
    'http://127.0.0.1:3000',

    // Local port 80 (nếu chạy CVAT qua reverse proxy port chuẩn)
    'http://localhost',
    'http://127.0.0.1',

    // Official CVAT Cloud instances
    'https://app.cvat.ai',
    'https://cvat.ai',

    // Custom CVAT Server instances
    'https://cvat-test.vantixapps.net',
    'https://cvat*'
];

/**
 * Kiểm tra xem URL hoặc location hiện tại có thuộc danh sách ALLOWED_SITES hay không.
 * Hoàn toàn dùng so sánh chuỗi (origin, prefix, domain suffix) - không dùng regex.
 * @param {Location|string} [target] - window.location hoặc chuỗi URL cần kiểm tra
 * @returns {boolean}
 */
function isAllowedSite(target) {
    let currentOrigin = '';
    let currentHref = '';
    let currentHost = '';
    let currentHostname = '';

    if (typeof target === 'string') {
        try {
            const parsed = new URL(target, 'http://localhost');
            currentOrigin = parsed.origin;
            currentHref = parsed.href;
            currentHost = parsed.host;
            currentHostname = parsed.hostname;
        } catch (_) {
            currentOrigin = target;
            currentHref = target;
        }
    } else if (target && typeof target === 'object') {
        currentOrigin = target.origin || '';
        currentHref = target.href || '';
        currentHost = target.host || '';
        currentHostname = target.hostname || '';
    } else if (typeof window !== 'undefined' && window.location) {
        currentOrigin = window.location.origin || '';
        currentHref = window.location.href || '';
        currentHost = window.location.host || '';
        currentHostname = window.location.hostname || '';
    }

    if (!currentOrigin && !currentHref) return false;

    const lowerOrigin = currentOrigin.toLowerCase();
    const lowerHref = currentHref.toLowerCase();
    const lowerHostname = currentHostname.toLowerCase();

    for (const rawSite of ALLOWED_SITES) {
        if (!rawSite || typeof rawSite !== 'string') continue;
        const site = rawSite.trim().toLowerCase().replace(/\/+$/, '');
        if (!site) continue;

        // 1. Wildcard dạng prefix (ví dụ: 'https://cvat*' hoặc 'http://cvat*')
        if (site.endsWith('*')) {
            const prefix = site.slice(0, -1);
            if (lowerOrigin.startsWith(prefix) || lowerHref.startsWith(prefix)) {
                return true;
            }
        }

        // 2. Wildcard dạng domain (ví dụ: '*.vantixapps.net')
        if (site.startsWith('*.')) {
            const domainSuffix = site.slice(1); // '.vantixapps.net'
            if (lowerHostname.endsWith(domainSuffix) || lowerHostname === site.slice(2)) {
                return true;
            }
        }

        // 3. Tiền tố linh hoạt nếu người dùng chỉ nhập 'https://cvat'
        if (site.startsWith('https://cvat') || site.startsWith('http://cvat')) {
            if (lowerOrigin.startsWith(site)) {
                return true;
            }
        }

        // 4. So khớp chính xác Origin (ví dụ: 'https://cvat-test.vantixapps.net', 'http://localhost:8080')
        if (lowerOrigin === site) {
            return true;
        }

        // 5. So khớp tiền tố URL đầy đủ
        if (lowerHref.startsWith(site + '/') || lowerHref === site) {
            return true;
        }

        // 6. So khớp hostname thuần
        if (lowerHostname === site || currentHost.toLowerCase() === site) {
            return true;
        }
    }

    return false;
}


    // ------------------------------------------
    // File: src/engine/math_3d.js
    // ------------------------------------------

/**
 * 3D Geometry and Orthographic Projection Math Engine
 * Supports transforming world points to cuboid-local coordinates,
 * ROI extraction, and parsing PCD (ASCII/Binary) without server calls or external libraries.
 */
class Math3D {
    /** Apply a local or world axis turn without depending on a CVAT Three.js mesh. */
    static rotateEulerXYZ(angles, axis, angle, local = true) {
        const [rx, ry, rz] = angles;
        const [cx, cy, cz] = angles.map((value) => Math.cos(value / 2));
        const [sx, sy, sz] = [rx, ry, rz].map((value) => Math.sin(value / 2));
        const original = [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
            cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
        const turn = [0, 0, 0, Math.cos(angle / 2)];
        turn[axis] = Math.sin(angle / 2);
        const [ax, ay, az, aw] = local ? original : turn;
        const [bx, by, bz, bw] = local ? turn : original;
        const x = aw * bx + ax * bw + ay * bz - az * by;
        const y = aw * by - ax * bz + ay * bw + az * bx;
        const z = aw * bz + ax * by - ay * bx + az * bw;
        const w = aw * bw - ax * bx - ay * by - az * bz;
        const m13 = 2 * (x * z + y * w);
        const pitch = Math.asin(Math.max(-1, Math.min(1, m13)));
        if (Math.abs(m13) >= 0.9999999) {
            return [Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z)), pitch, 0];
        }
        return [Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)), pitch,
            Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z))];
    }

    /**
     * Compute 3x3 rotation matrix from Euler angles (XYZ order - standard Three.js convention)
     * @param {number} rx - rotation around X in radians
     * @param {number} ry - rotation around Y in radians
     * @param {number} rz - rotation around Z in radians
     * @returns {Float32Array} 9-element array representing 3x3 matrix in row-major order
     */
    static eulerToRotationMatrix(rx, ry, rz) {
        const cx = Math.cos(rx);
        const sx = Math.sin(rx);
        const cy = Math.cos(ry);
        const sy = Math.sin(ry);
        const cz = Math.cos(rz);
        const sz = Math.sin(rz);

        // Three.js Euler XYZ rotation matrix:
        // R = R_x * R_y * R_z
        return new Float32Array([
            cy * cz, -cy * sz, sy,
            cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
            sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy
        ]);
    }

    /**
     * Rotate a cuboid around its LOCAL camera view axis (Top: Local Z, Side: Local Y, Front: Local X)
     * Matches Three.js Object3D.rotateX / rotateY / rotateZ
     * @param {Object} box - { x, y, z, rx, ry, rz, sx, sy, sz }
     * @param {'top'|'side'|'front'} viewType
     * @param {number} deltaRad
     * @returns {{ rx: number, ry: number, rz: number }}
     */
    static rotateLocal(box, viewType, deltaRad) {
        const rx = typeof box.rx === 'number' ? box.rx : 0;
        const ry = typeof box.ry === 'number' ? box.ry : 0;
        const rz = typeof box.rz === 'number' ? box.rz : 0;

        // Current orientation matrix R = Rx * Ry * Rz
        const R0 = this.eulerToRotationMatrix(rx, ry, rz);

        // Local incremental rotation matrix dR
        let dR;
        const c = Math.cos(deltaRad);
        const s = Math.sin(deltaRad);

        if (viewType === 'top') {
            // Local Z (Yaw)
            dR = new Float32Array([
                c, -s, 0,
                s,  c, 0,
                0,  0, 1
            ]);
        } else if (viewType === 'front') {
            // Local X (Roll around Front line of sight)
            dR = new Float32Array([
                1, 0,  0,
                0, c, -s,
                0, s,  c
            ]);
        } else if (viewType === 'side') {
            // Local Y (Pitch around Side line of sight)
            dR = new Float32Array([
                 c, 0, s,
                 0, 1, 0,
                -s, 0, c
            ]);
        } else {
            return { rx, ry, rz };
        }

        // R_new = R0 * dR
        const Rnew = new Float32Array(9);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                Rnew[i * 3 + j] = R0[i * 3 + 0] * dR[0 * 3 + j] +
                                  R0[i * 3 + 1] * dR[1 * 3 + j] +
                                  R0[i * 3 + 2] * dR[2 * 3 + j];
            }
        }

        // Extract Euler angles (XYZ order) from Rnew
        const syVal = Math.max(-1, Math.min(1, Rnew[2]));
        const nextRy = Math.asin(syVal);
        let nextRx, nextRz;

        if (Math.abs(Rnew[2]) < 0.99999) {
            nextRx = Math.atan2(-Rnew[5], Rnew[8]);
            nextRz = Math.atan2(-Rnew[1], Rnew[0]);
        } else {
            nextRx = Math.atan2(Rnew[7], Rnew[4]);
            nextRz = 0;
        }

        return {
            rx: parseFloat(nextRx.toFixed(4)),
            ry: parseFloat(nextRy.toFixed(4)),
            rz: parseFloat(nextRz.toFixed(4))
        };
    }

    /**
     * Compute local orientation angles in radians (Yaw for Top, Pitch for Side, Roll for Front)
     * Completely invariant to coordinate cross-coupling regardless of Yaw angle.
     * @param {Object} box - { rx, ry, rz }
     * @returns {{ yaw: number, pitch: number, roll: number }}
     */
    static getLocalAngles(box) {
        if (!box) return { yaw: 0, pitch: 0, roll: 0 };
        const rx = typeof box.rx === 'number' ? box.rx : 0;
        const ry = typeof box.ry === 'number' ? box.ry : 0;
        const rz = typeof box.rz === 'number' ? box.rz : 0;
        const R = this.eulerToRotationMatrix(rx, ry, rz);
        // Pitch (Side view: rotation around local Y)
        const pitch = -Math.asin(Math.max(-1, Math.min(1, R[6])));
        // Roll (Front view: rotation around local X)
        const roll = Math.asin(Math.max(-1, Math.min(1, R[7])));
        // Yaw (Top view: rotation around local Z)
        const yaw = rz;
        return { yaw, pitch, roll };
    }

    /**
     * Transform world points into cuboid local frame and crop to ROI
     * @param {Float32Array|Array<number>} points - world point cloud [x0, y0, z0, (intensity0), x1, y1, z1...]
     * @param {number} stride - 3 (x,y,z) or 4 (x,y,z,i)
     * @param {Object} box - { x, y, z, rx, ry, rz, sx, sy, sz }
     * @param {number} marginFactor - expansion factor around bounding box (default 1.4)
     * @returns {Float32Array} local points [lx0, ly0, lz0, (intensity0), ...]
     */
    static transformAndCropPoints(points, stride, box, marginFactor = 1.4) {
        if (!points || points.length === 0) return new Float32Array(0);

        const { x: cx, y: cy, z: cz, rx, ry, rz, sx, sy, sz } = box;
        const R = this.eulerToRotationMatrix(rx, ry, rz);

        // Inverse rotation matrix is Transpose of R
        const inv00 = R[0], inv01 = R[3], inv02 = R[6];
        const inv10 = R[1], inv11 = R[4], inv12 = R[7];
        const inv20 = R[2], inv21 = R[5], inv22 = R[8];

        const halfX = (sx / 2) * marginFactor;
        const halfY = (sy / 2) * marginFactor;
        const halfZ = (sz / 2) * marginFactor;

        const maxPoints = Math.floor(points.length / stride);
        const outBuffer = new Float32Array(maxPoints * 4); // [lx, ly, lz, intensity]
        let outCount = 0;

        for (let i = 0; i < points.length; i += stride) {
            const dx = points[i] - cx;
            const dy = points[i + 1] - cy;
            const dz = points[i + 2] - cz;

            // Apply R^T * [dx, dy, dz]
            const lx = inv00 * dx + inv01 * dy + inv02 * dz;
            const ly = inv10 * dx + inv11 * dy + inv12 * dz;
            const lz = inv20 * dx + inv21 * dy + inv22 * dz;

            if (Math.abs(lx) <= halfX && Math.abs(ly) <= halfY && Math.abs(lz) <= halfZ) {
                const outIdx = outCount * 4;
                outBuffer[outIdx] = lx;
                outBuffer[outIdx + 1] = ly;
                outBuffer[outIdx + 2] = lz;
                outBuffer[outIdx + 3] = stride >= 4 ? points[i + 3] : 1.0;
                outCount++;
            }
        }

        return outBuffer.subarray(0, outCount * 4);
    }

    /**
     * Fast parser for PCD format (ASCII and Binary)
     * @param {ArrayBuffer} buffer
     * @returns {{ positions: Float32Array, intensities: Float32Array | null }}
     */
    static parsePCD(buffer) {
        const textDecoder = new TextDecoder('ascii');
        // Read header (usually within first 1024 bytes)
        const headerChunk = textDecoder.decode(buffer.slice(0, Math.min(buffer.byteLength, 2048)));
        const lines = headerChunk.split('\n');

        let dataMode = 'ascii';
        let fields = [];
        let sizes = [];
        let types = [];
        let counts = [];
        let pointsCount = 0;
        let headerByteLength = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            headerByteLength += lines[i].length + 1; // including newline

            if (line.startsWith('FIELDS')) {
                fields = line.split(/\s+/).slice(1);
            } else if (line.startsWith('SIZE')) {
                sizes = line.split(/\s+/).slice(1).map(Number);
            } else if (line.startsWith('TYPE')) {
                types = line.split(/\s+/).slice(1);
            } else if (line.startsWith('COUNT')) {
                counts = line.split(/\s+/).slice(1).map(Number);
            } else if (line.startsWith('POINTS')) {
                pointsCount = parseInt(line.split(/\s+/)[1], 10);
            } else if (line.startsWith('DATA')) {
                dataMode = line.split(/\s+/)[1];
                break;
            }
        }

        const xIdx = fields.indexOf('x');
        const yIdx = fields.indexOf('y');
        const zIdx = fields.indexOf('z');
        const iIdx = fields.indexOf('intensity');

        if (xIdx === -1 || yIdx === -1 || zIdx === -1) {
            console.warn('[Math3D] PCD file missing x, y, or z fields');
            return null;
        }

        const positions = new Float32Array(pointsCount * 3);
        const intensities = iIdx !== -1 ? new Float32Array(pointsCount) : null;

        if (dataMode === 'binary') {
            const dataView = new DataView(buffer, headerByteLength);
            let pointRecordSize = 0;
            for (let i = 0; i < fields.length; i++) {
                pointRecordSize += (sizes[i] || 4) * (counts[i] || 1);
            }

            let fieldOffsets = [];
            let currentOffset = 0;
            for (let i = 0; i < fields.length; i++) {
                fieldOffsets.push(currentOffset);
                currentOffset += (sizes[i] || 4) * (counts[i] || 1);
            }

            for (let p = 0; p < pointsCount; p++) {
                const byteOffset = p * pointRecordSize;
                if (byteOffset + pointRecordSize > dataView.byteLength) break;

                const x = dataView.getFloat32(byteOffset + fieldOffsets[xIdx], true);
                const y = dataView.getFloat32(byteOffset + fieldOffsets[yIdx], true);
                const z = dataView.getFloat32(byteOffset + fieldOffsets[zIdx], true);

                const p3 = p * 3;
                positions[p3] = x;
                positions[p3 + 1] = y;
                positions[p3 + 2] = z;

                if (intensities && iIdx !== -1) {
                    const iOffset = byteOffset + fieldOffsets[iIdx];
                    const iType = types[iIdx];
                    const iSize = sizes[iIdx];
                    if (iType === 'F' && iSize === 4) {
                        intensities[p] = dataView.getFloat32(iOffset, true);
                    } else if (iType === 'U' && iSize === 1) {
                        intensities[p] = dataView.getUint8(iOffset) / 255.0;
                    } else {
                        intensities[p] = dataView.getFloat32(iOffset, true);
                    }
                }
            }
        } else {
            // ASCII Mode
            const fullText = textDecoder.decode(buffer);
            const dataStart = fullText.indexOf('DATA ' + dataMode) + ('DATA ' + dataMode).length;
            const dataLines = fullText.slice(dataStart).trim().split('\n');

            for (let p = 0; p < Math.min(pointsCount, dataLines.length); p++) {
                const tokens = dataLines[p].trim().split(/\s+/);
                const p3 = p * 3;
                positions[p3] = parseFloat(tokens[xIdx]);
                positions[p3 + 1] = parseFloat(tokens[yIdx]);
                positions[p3 + 2] = parseFloat(tokens[zIdx]);
                if (intensities && iIdx !== -1 && tokens[iIdx]) {
                    intensities[p] = parseFloat(tokens[iIdx]);
                }
            }
        }

        return { positions, intensities };
    }
}


    // ------------------------------------------
    // File: src/engine/ortho_canvas.js
    // ------------------------------------------

/**
 * High-performance 2D Orthographic Canvas Renderer for 3D Bounding Boxes & Point Clouds.
 * Follows CVAT 3D Canvas conventions:
 * 1. Top View: Footprint viewed from above (Length horizontal, Width vertical).
 * 2. Side View: Side profile (Length horizontal, Height vertical, ground at bottom).
 * 3. Front View: Front/Rear profile (Width horizontal, Height vertical, ground at bottom).
 * Sized compactly with clean, unobtrusive CVAT-style heading cues (green rotation helper dot).
 */

// 32-level precomputed depth color palette to eliminate string allocation on every frame
const PALETTE_SIZE = 32;
const DEPTH_PALETTE = new Array(PALETTE_SIZE);
for (let i = 0; i < PALETTE_SIZE; i++) {
    const t = i / (PALETTE_SIZE - 1);
    const r = Math.round(40 + 215 * t);
    const g = Math.round(200 + 55 * (1 - t));
    const b = Math.round(255 * (1 - t));
    DEPTH_PALETTE[i] = `rgb(${r},${g},${b})`;
}
class OrthoCanvasRenderer {
    /**
     * Compute projection metrics, scale, and layout coordinates for rendering & hit testing
     * @param {HTMLCanvasElement} canvas
     * @param {Object} box
     * @param {'top'|'side'|'front'} viewType
     * @param {Object} options
     */
    static getMetrics(canvas, box, viewType, options = {}) {
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const width = canvas.clientWidth || canvas.width || 200;
        const height = canvas.clientHeight || canvas.height || 120;

        const { sx = 2, sy = 4, sz = 1.5 } = box || {};
        const zoom = options.zoom || 1.0;

        // Authentic CVAT projection conventions:
        // Top: Local X horizontal (sx), Local Y vertical (sy). Forward (+Y) points UP. Lateral (+X) points RIGHT.
        // Front: Looks from Red arrow (+X) towards -X. Green arrow (+Y) is on the RIGHT. Horizontal is sy, Vertical is sz.
        // Side: Looks from Green arrow (+Y) towards -Y. Red arrow (+X) is on the LEFT. Horizontal is sx, Vertical is sz.
        let dimH = 2;
        let dimV = 4;

        if (viewType === 'top') {
            dimH = sx;
            dimV = sy;
        } else if (viewType === 'front') {
            dimH = sy;
            dimV = sz;
        } else if (viewType === 'side') {
            dimH = sx;
            dimV = sz;
        }

        // Reference box for stable metric scale (pixels per meter).
        // Prevents box pixels from cancelling out dimensions, ensuring box expands/contracts in realtime.
        const refBox = options.referenceBox || box || {};
        const refSx = typeof refBox.sx === 'number' ? refBox.sx : sx;
        const refSy = typeof refBox.sy === 'number' ? refBox.sy : sy;
        const refSz = typeof refBox.sz === 'number' ? refBox.sz : sz;

        let refDimH = dimH;
        let refDimV = dimV;
        if (viewType === 'top') {
            refDimH = refSx;
            refDimV = refSy;
        } else if (viewType === 'front') {
            refDimH = refSy;
            refDimV = refSz;
        } else if (viewType === 'side') {
            refDimH = refSx;
            refDimV = refSz;
        }

        const marginFactor = options.marginFactor || 1.35;
        const padding = 14;
        const availW = Math.max(10, width - padding * 2);
        const availH = Math.max(10, height - padding * 2);
        const maxExtentH = Math.max(0.2, refDimH) * marginFactor;
        const maxExtentV = Math.max(0.2, refDimV) * marginFactor;

        const scale = (typeof options.scale === 'number' && options.scale > 0)
            ? options.scale
            : Math.min(availW / maxExtentH, availH / maxExtentV) * zoom;
        const centerX = width / 2;
        const centerY = height / 2;

        const boxPxW = dimH * scale;
        const boxPxH = dimV * scale;
        const boxLeft = centerX - boxPxW / 2;
        const boxTop = centerY - boxPxH / 2;
        const boxRight = boxLeft + boxPxW;
        const boxBottom = boxTop + boxPxH;

        // 4 Corner coordinates (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
        const corners = {
            tl: { x: boxLeft, y: boxTop },
            tr: { x: boxRight, y: boxTop },
            bl: { x: boxLeft, y: boxBottom },
            br: { x: boxRight, y: boxBottom }
        };

        // Heading helper dot in Top view (placed on the forward +Y stem)
        const rotDotX = centerX;
        const rotDotY = boxTop - 20;

        return {
            dpr,
            width,
            height,
            sx,
            sy,
            sz,
            dimH,
            dimV,
            scale,
            centerX,
            centerY,
            boxPxW,
            boxPxH,
            boxLeft,
            boxTop,
            boxRight,
            boxBottom,
            corners,
            rotDotX,
            rotDotY,
            dotX: rotDotX,
            dotY: rotDotY
        };
    }

    /**
     * Render an orthogonal projection on a canvas
     * @param {HTMLCanvasElement} canvas
     * @param {Float32Array} localPoints - [lx, ly, lz, intensity, ...]
     * @param {Object} box - { x, y, z, rx, ry, rz, sx, sy, sz }
     * @param {'top'|'side'|'front'} viewType
     * @param {Object} options - display preferences & interaction state
     */
    static render(canvas, localPoints, box, viewType, options = {}) {
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const metrics = this.getMetrics(canvas, box, viewType, options);
        let {
            dpr, width, height, sx, sy, sz,
            dimH, dimV, scale, centerX, centerY,
            boxPxW, boxPxH, boxLeft, boxTop, boxRight, boxBottom,
            corners, rotDotX, rotDotY
        } = metrics;

        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Interaction inspection
        const interaction = options.interaction || {};
        const isInteractingThisView = interaction.activeAction && interaction.viewType === viewType;
        const isHoveringThisView = interaction.hoverViewType === viewType;
        const isHoverRotation = (isHoveringThisView && interaction.hoverTarget === 'rotate') ||
                                (isInteractingThisView && interaction.activeAction === 'rotate');
        const isActivelyRotating = isInteractingThisView && interaction.activeAction === 'rotate';
        const isActivelyTranslating = isInteractingThisView && interaction.activeAction === 'translate';
        const activeResizeAction = isInteractingThisView && interaction.activeAction?.startsWith('resize')
            ? interaction.activeAction : null;

        // If this view is actively undergoing 4-corner resize, lock visual box directly to the mouse-driven bounds
        if (isInteractingThisView && interaction.activeAction === 'resize-corner' && interaction.resizeBoxPx) {
            const rbp = interaction.resizeBoxPx;
            boxLeft = rbp.left;
            boxTop = rbp.top;
            boxRight = rbp.right;
            boxBottom = rbp.bottom;
            boxPxW = rbp.width;
            boxPxH = rbp.height;
            corners = {
                tl: { x: boxLeft, y: boxTop },
                tr: { x: boxRight, y: boxTop },
                bl: { x: boxLeft, y: boxBottom },
                br: { x: boxRight, y: boxBottom }
            };
            rotDotX = boxLeft + boxPxW / 2;
            rotDotY = boxTop - 20;
        } else if (isInteractingThisView && interaction.activeAction === 'translate' && interaction.translateOffsetPx) {
            // Live 120 FPS visual box translation matching cursor movement with zero blur and zero stutter
            const offX = interaction.translateOffsetPx.dx || 0;
            const offY = interaction.translateOffsetPx.dy || 0;
            boxLeft += offX;
            boxRight += offX;
            boxTop += offY;
            boxBottom += offY;
            corners = {
                tl: { x: boxLeft, y: boxTop },
                tr: { x: boxRight, y: boxTop },
                bl: { x: boxLeft, y: boxBottom },
                br: { x: boxRight, y: boxBottom }
            };
            rotDotX += offX;
            rotDotY += offY;
        }

        // 1 & 2 & 3. Background, Grid, and Point Cloud Points
        let renderedPointsCount = 0;
        const isDraggingThisCard = isInteractingThisView && interaction.activeAction;

        if (isDraggingThisCard && canvas.__qaqc_bg_cache) {
            // High-speed 120+ FPS blit during dragging at exact 1:1 hardware device pixel resolution (0 blur, 0 lag)
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(canvas.__qaqc_bg_cache, 0, 0);
            ctx.restore();
            renderedPointsCount = canvas.__qaqc_bg_pts_count || 0;
        } else {
            // Full render: Background
            ctx.fillStyle = '#141416';
            ctx.fillRect(0, 0, width, height);

            // Subtle CVAT-style grid
            this.drawSubtleGrid(ctx, width, height);

            // Center crosshair lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(centerX, 0);
            ctx.lineTo(centerX, height);
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();
            ctx.setLineDash([]);

            const pointSize = typeof options.pointSize === 'number' ? options.pointSize : 1.0;

            if (localPoints && localPoints.length > 0) {
                renderedPointsCount = Math.floor(localPoints.length / 4);

                // Collect points into 32 pre-quantized depth buckets to eliminate per-point fill() overhead
                const buckets = new Array(PALETTE_SIZE);
                for (let b = 0; b < PALETTE_SIZE; b++) buckets[b] = [];

                for (let i = 0; i < localPoints.length; i += 4) {
                    const lx = localPoints[i];
                    const ly = localPoints[i + 1];
                    const lz = localPoints[i + 2];

                    let px = 0, py = 0, depth = 0;

                    if (viewType === 'top') {
                        px = centerX + lx * scale;
                        py = centerY - ly * scale;
                        depth = (lz + sz / 2) / Math.max(0.01, sz);
                    } else if (viewType === 'front') {
                        px = centerX + ly * scale;
                        py = centerY - lz * scale;
                        depth = (sx / 2 - lx) / Math.max(0.01, sx);
                    } else if (viewType === 'side') {
                        px = centerX - lx * scale;
                        py = centerY - lz * scale;
                        depth = (sy / 2 - ly) / Math.max(0.01, sy);
                    }

                    if (px < 0 || px > width || py < 0 || py > height) continue;

                    const bin = Math.min(PALETTE_SIZE - 1, Math.max(0, (depth * PALETTE_SIZE) | 0));
                    buckets[bin].push(px, py);
                }

                // Batch draw each bucket in a single path (max 32 draw calls instead of 20,000)
                const ptSize = Math.max(1.0, pointSize);
                const half = ptSize / 2;
                for (let b = 0; b < PALETTE_SIZE; b++) {
                    const pts = buckets[b];
                    const len = pts.length;
                    if (len === 0) continue;
                    ctx.fillStyle = DEPTH_PALETTE[b];
                    ctx.beginPath();
                    for (let j = 0; j < len; j += 2) {
                        ctx.rect(pts[j] - half, pts[j + 1] - half, ptSize, ptSize);
                    }
                    ctx.fill();
                }
            }

            // Snapshot background layer for instant 120 FPS dragging at 100% native device resolution (zero blur)
            if (typeof document !== 'undefined') {
                try {
                    if (!canvas.__qaqc_bg_cache) {
                        canvas.__qaqc_bg_cache = document.createElement('canvas');
                    }
                    const bg = canvas.__qaqc_bg_cache;
                    const bgW = Math.round(width * dpr);
                    const bgH = Math.round(height * dpr);
                    if (bg.width !== bgW || bg.height !== bgH) {
                        bg.width = bgW;
                        bg.height = bgH;
                    }
                    const bgCtx = bg.getContext('2d');
                    if (bgCtx) {
                        bgCtx.clearRect(0, 0, bgW, bgH);
                        bgCtx.drawImage(canvas, 0, 0);
                    }
                    canvas.__qaqc_bg_pts_count = renderedPointsCount;
                } catch (_) {}
            }
        }

        const isOutside = !!options.outside;

        // 4. Render Bounding Box Fill & Border
        if (isOutside) {
            // Outside Box Styling:
            // Box position remains fully visible, styled with a dashed red border,
            // subtle red tint, and an OUTSIDE indicator watermark.
            ctx.fillStyle = isActivelyTranslating ? 'rgba(255, 69, 58, 0.18)' : 'rgba(255, 69, 58, 0.08)';
            ctx.fillRect(boxLeft, boxTop, boxPxW, boxPxH);

            ctx.save();
            ctx.strokeStyle = isActivelyTranslating ? '#FF453A' : 'rgba(255, 69, 58, 0.85)';
            ctx.lineWidth = isActivelyTranslating ? 2.0 : 1.6;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(boxLeft, boxTop, boxPxW, boxPxH);
            ctx.restore();

            // Centered OUTSIDE watermark badge inside the box
            ctx.save();
            ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
            ctx.fillStyle = 'rgba(255, 69, 58, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('OUTSIDE', centerX, centerY);
            ctx.restore();
        } else {
            // Normal Inside Box Styling
            ctx.fillStyle = isActivelyTranslating ? 'rgba(10, 132, 255, 0.16)' : 'rgba(24, 75, 140, 0.16)';
            ctx.fillRect(boxLeft, boxTop, boxPxW, boxPxH);

            ctx.strokeStyle = isActivelyTranslating ? '#0A84FF' : '#FFFFFF';
            ctx.lineWidth = isActivelyTranslating ? 2.0 : 1.5;
            ctx.strokeRect(boxLeft, boxTop, boxPxW, boxPxH);
        }

        // Ground reference line for Side and Front views
        if (viewType === 'side' || viewType === 'front') {
            const groundY = boxBottom;
            ctx.strokeStyle = isOutside ? 'rgba(255, 69, 58, 0.35)' : 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(boxLeft - 10, groundY);
            ctx.lineTo(boxRight + 10, groundY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 5. CVAT-style Heading & Rotation Helper
        if (isOutside) {
            ctx.save();
            ctx.globalAlpha = 0.55;
        }
        if (viewType === 'top') {
            this.drawCVATHeadingHelper(
                ctx,
                centerX,
                centerY,
                boxLeft,
                boxTop,
                boxPxW,
                boxPxH,
                isHoverRotation,
                isActivelyRotating
            );
        } else if (viewType === 'front') {
            // Front view looks from red arrow (+X). Green arrow (+Y) is on the right.
            ctx.strokeStyle = '#30D158';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(boxRight, boxTop);
            ctx.lineTo(boxRight, boxBottom);
            ctx.stroke();
            this.drawArrow(ctx, boxRight, centerY, boxRight + 18, centerY, '#30D158', 6, 1.8);
        } else if (viewType === 'side') {
            // Side view looks from green arrow (+Y). Red arrow (+X) is on the left.
            ctx.strokeStyle = '#FF3B30';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(boxLeft, boxTop);
            ctx.lineTo(boxLeft, boxBottom);
            ctx.stroke();
            this.drawArrow(ctx, boxLeft, centerY, boxLeft - 18, centerY, '#FF3B30', 6, 1.8);
        }
        if (isOutside) {
            ctx.restore();
        }

        // 6. CVAT 4 Red Corner Handles (All views)
        if (isOutside) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            this.drawCornerHandles(ctx, corners, interaction);
            ctx.restore();
        } else {
            this.drawCornerHandles(ctx, corners, interaction);
        }

        // 7. Interactive HUD Badges
        if (isActivelyRotating) {
            const rz = box?.rz ?? 0;
            const deg = ((rz * 180 / Math.PI) % 360).toFixed(1);
            this.drawBadge(ctx, rotDotX, rotDotY, `⟳ Yaw: ${deg}°`, '#30D158');
        } else if (isActivelyTranslating) {
            const { x = 0, y = 0, z = 0 } = box || {};
            const posText = viewType === 'top'
                ? `X: ${x.toFixed(2)}m  Y: ${y.toFixed(2)}m`
                : `Z: ${z.toFixed(2)}m`;
            this.drawBadge(ctx, centerX, boxTop, posText, '#0A84FF');
        } else if (activeResizeAction) {
            const dimText = `${(box.sx || sx).toFixed(2)} × ${(box.sy || sy).toFixed(2)} × ${(box.sz || sz).toFixed(2)}m`;
            this.drawBadge(ctx, centerX, boxTop, dimText, '#FF3B30');
        }

        // 8. Dimension Caption (Bottom Left)
        ctx.font = '500 9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
        let dimLabel = `${dimH.toFixed(2)}m × ${dimV.toFixed(2)}m`;
        if (viewType === 'top') {
            dimLabel = `W:${sx.toFixed(2)}  L:${sy.toFixed(2)}m`;
        } else if (viewType === 'front') {
            dimLabel = `L:${sy.toFixed(2)}  H:${sz.toFixed(2)}m`;
        } else if (viewType === 'side') {
            dimLabel = `W:${sx.toFixed(2)}  H:${sz.toFixed(2)}m`;
        }
        if (isOutside) {
            ctx.fillStyle = 'rgba(255, 69, 58, 0.9)';
            ctx.fillText(`${dimLabel} • [OUTSIDE]`, 6, height - 5);
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.fillText(dimLabel, 6, height - 5);
        }

        // Points Count (Bottom Right)
        const ptsText = renderedPointsCount > 0 ? `${renderedPointsCount} pts` : '0 pts';
        ctx.fillStyle = renderedPointsCount > 0 ? 'rgba(48, 209, 88, 0.85)' : 'rgba(255, 159, 10, 0.7)';
        const ptsMetrics = ctx.measureText(ptsText);
        ctx.fillText(ptsText, width - ptsMetrics.width - 6, height - 5);

        ctx.restore();
    }

    /**
     * Draw subtle grid dots or lines matching CVAT dark mode
     */
    static drawSubtleGrid(ctx, w, h) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        const gridSize = 20;
        ctx.beginPath();
        for (let x = 0; x < w; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = 0; y < h; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();
    }

    /**
     * Draw directional 2D arrow helper
     */
    static drawArrow(ctx, fromX, fromY, toX, toY, color, headLen = 8, lineWidth = 1.8) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLen * Math.cos(angle - Math.PI / 6),
            toY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            toX - headLen * Math.cos(angle + Math.PI / 6),
            toY - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Draw CVAT-style Orientation & Rotation Helper in Top view
     * Includes:
     * - Forward Green Arrow (+Y heading) protruding from front edge with green circle rotation helper dot
     * - Lateral Red Arrow (+X) protruding from right edge
     * - Center Pivot Dot (Blue)
     * - Circular guide orbit when rotating
     */
    static drawCVATHeadingHelper(ctx, cx, cy, boxL, boxT, boxW, boxH, isHovered = false, isInteracting = false) {
        const boxR = boxL + boxW;
        const boxB = boxT + boxH;

        const rotDotX = cx;
        const rotDotY = boxT - 20;
        const arrowTipY = boxT - 36;
        const latTipX = boxR + 28;

        // Circular guide orbit and radial ray when rotating
        if (isInteracting) {
            const rotRadius = Math.hypot(rotDotX - cx, rotDotY - cy);
            ctx.strokeStyle = 'rgba(48, 209, 88, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(cx, cy, rotRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = '#30D158';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(rotDotX, rotDotY);
            ctx.stroke();
        }

        // Front edge highlight (green line along the forward top edge)
        ctx.strokeStyle = '#30D158';
        ctx.lineWidth = isHovered || isInteracting ? 3.0 : 2.0;
        ctx.beginPath();
        ctx.moveTo(boxL, boxT);
        ctx.lineTo(boxR, boxT);
        ctx.stroke();

        // Lateral Arrow (Red, +X)
        this.drawArrow(ctx, boxR, cy, latTipX, cy, '#FF3B30', 7, 1.8);

        // Forward Heading Arrow (Green, +Y)
        this.drawArrow(ctx, cx, boxT, cx, arrowTipY, '#30D158', 8, 2.0);

        // Rotation helper halo ring if hovered or interacting
        if (isHovered || isInteracting) {
            ctx.strokeStyle = 'rgba(48, 209, 88, 0.45)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(rotDotX, rotDotY, 9, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Rotation Helper Green Dot
        const dotRadius = isHovered || isInteracting ? 6.5 : 4.5;
        ctx.fillStyle = '#30D158';
        ctx.beginPath();
        ctx.arc(rotDotX, rotDotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Center Pivot Dot (Blue)
        ctx.fillStyle = '#0A84FF';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    /**
     * Draw CVAT 4 Red Corner Handles for 4-corner resizing
     * Highlights active dragging corner and renders anchor indicator on fixed opposite corner
     */
    static drawCornerHandles(ctx, corners, interaction = {}) {
        if (!corners) return;

        const { activeCornerKey, oppositeCornerKey, hoverTarget } = interaction;

        for (const [key, pt] of Object.entries(corners)) {
            const isHovered = hoverTarget === `corner-${key}`;
            const isActive = activeCornerKey === key;
            const isOppositeAnchor = oppositeCornerKey === key;

            // If this is the opposite anchor during resize, draw cyan anchor indicator
            if (isOppositeAnchor) {
                ctx.save();
                ctx.strokeStyle = '#0A84FF';
                ctx.lineWidth = 2;
                ctx.fillStyle = 'rgba(10, 132, 255, 0.35)';
                const sz = 12;
                ctx.strokeRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
                ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
                ctx.restore();
            }

            // Glow halo ring on hover or active
            if (isHovered || isActive) {
                ctx.strokeStyle = 'rgba(255, 59, 48, 0.45)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Red corner circle
            const radius = (isHovered || isActive) ? 6.5 : 4.5;
            ctx.fillStyle = '#FF3B30';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Outline
            ctx.strokeStyle = (isHovered || isActive) ? '#FFFFFF' : '#000000';
            ctx.lineWidth = (isHovered || isActive) ? 1.5 : 1.2;
            ctx.stroke();
        }
    }

    /**
     * Draw interactive HUD badge overlay on canvas
     */
    static drawBadge(ctx, x, y, text, borderColor = '#30D158') {
        ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
        const textW = ctx.measureText(text).width;
        const padX = 7;
        const badgeW = textW + padX * 2;
        const badgeH = 18;
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const bx = Math.max(5, Math.min(ctx.canvas.width / dpr - badgeW - 5, x - badgeW / 2));
        const by = Math.max(5, y - badgeH - 6);

        ctx.fillStyle = 'rgba(20, 20, 24, 0.92)';
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(bx, by, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(bx, by, badgeW, badgeH);
            ctx.strokeRect(bx, by, badgeW, badgeH);
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, bx + padX, by + 13);
    }

    static hexToRgba(hex, alpha) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }
}


    // ------------------------------------------
    // File: src/core/pcd_cache.js
    // ------------------------------------------

/**
 * In-Memory Point Cloud Cache (Strict Zero-Request Guarantee)
 * Safely captures point cloud data from CVAT Three.js scenes and in-memory frame decoders.
 * NEVER makes network requests to the server.
 */
class PCDCache {
    constructor() {
        /** @type {Map<number, { positions: Float32Array, stride: number }>} */
        this.cache = new Map();
        this.maxFrames = 120; // Cache up to 120 frames in memory
    }

    /**
     * Check if a frame's point cloud is already in client memory
     * @param {number} frameNumber
     * @returns {boolean}
     */
    has(frameNumber) {
        return this.cache.has(frameNumber);
    }

    /**
     * Get points for a frame if cached
     * @param {number} frameNumber
     * @returns {{ positions: Float32Array, stride: number } | null}
     */
    get(frameNumber) {
        return this.cache.get(frameNumber) || null;
    }

    /**
     * Store points directly
     * @param {number} frameNumber
     * @param {Float32Array} positions
     * @param {number} stride
     */
    set(frameNumber, positions, stride = 3) {
        if (!positions || positions.length === 0) return;
        if (this.cache.size >= this.maxFrames) {
            // Drop oldest key
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(frameNumber, { positions, stride });
    }

    /**
     * Capture points from active Three.js canvas in CVAT
     * @param {number} frameNumber
     * @param {any} canvasInstance - CVAT Canvas3d instance
     * @returns {boolean} true if captured successfully
     */
    captureFromThreeScene(frameNumber, canvasInstance) {
        if (!canvasInstance || !canvasInstance.view || !canvasInstance.view.views) {
            return false;
        }

        try {
            const views = canvasInstance.view.views;
            // The top or perspective scene contains the Points object
            const scene = views.top?.scene || views.perspective?.scene;
            if (!scene) return false;

            let pointsObj = null;
            scene.traverse((child) => {
                if (child.isPoints && child.geometry && child.geometry.attributes.position) {
                    pointsObj = child;
                }
            });

            if (pointsObj && pointsObj.geometry) {
                const posAttr = pointsObj.geometry.attributes.position;
                if (posAttr && posAttr.array) {
                    // Clone or copy array to ensure persistence
                    const cloned = new Float32Array(posAttr.array);
                    this.set(frameNumber, cloned, 3);
                    return true;
                }
            }
        } catch (err) {
            console.warn('[PCDCache] Could not capture points from Three scene:', err);
        }
        return false;
    }

    /**
     * Try reading from CVAT's in-memory frame decoded chunks without server request
     * @param {number} frameNumber
     * @param {any} jobInstance
     * @returns {Promise<boolean>}
     */
    async captureFromDecodedChunks(frameNumber, jobInstance) {
        if (this.has(frameNumber)) return true;
        if (!jobInstance || !jobInstance.frames) return false;

        try {
            if (typeof jobInstance.frames.get === 'function') {
                const frameData = await jobInstance.frames.get(frameNumber);
                if (frameData && typeof frameData.data === 'function') {
                    const data = await frameData.data();
                    const imageData = data?.imageData;
                    if (imageData && imageData instanceof Blob) {
                        const buffer = await imageData.arrayBuffer();
                        const parsed = Math3D.parsePCD(buffer);
                        if (parsed && parsed.positions) {
                            this.set(frameNumber, parsed.positions, 3);
                            return true;
                        }
                    }
                }
            }
        } catch (e) {
            // Unbuffered frame or decoding error - gracefully ignore
        }
        return false;
    }

    /**
     * Preload and decode point cloud data across all frames of the active track
     * @param {number[]} frameNumbers
     * @param {any} jobInstance
     * @param {Function} onFrameDecoded - (frame, pointCloudData) => void
     */
    async preloadTrackFrames(frameNumbers, jobInstance, onFrameDecoded) {
        if (!jobInstance || !Array.isArray(frameNumbers)) return;

        for (const frameNum of frameNumbers) {
            if (this.has(frameNum)) {
                if (typeof onFrameDecoded === 'function') {
                    onFrameDecoded(frameNum, this.get(frameNum));
                }
                continue;
            }

            try {
                const success = await this.captureFromDecodedChunks(frameNum, jobInstance);
                if (success && typeof onFrameDecoded === 'function') {
                    onFrameDecoded(frameNum, this.get(frameNum));
                }
            } catch (_) {}
        }
    }

    clear() {
        this.cache.clear();
    }
}


    // ------------------------------------------
    // File: src/core/track_reader.js
    // ------------------------------------------

/**
 * Track Reader for CVAT 3D Annotations
 * Extracts multi-frame 3D bounding box states for any selected track or object.
 * Pure in-memory: 0 server requests.
 * Uses CVAT's authentic 3D cuboid shortest-arc interpolation for realtime multi-frame rendering.
 */
class TrackReader {
    /**
     * In-memory cache of currently inspected track keyframes
     * @type {{ clientID: number|null, shapes: Array<Object>, label: Object, startFrame: number, stopFrame: number }}
     */
    static currentTrackData = {
        clientID: null,
        shapes: [],
        label: { name: 'Object', color: '#30D158' },
        startFrame: 0,
        stopFrame: 0
    };

    /**
     * Compute difference between two angles in degrees across the shortest arc
     * Matches CVAT core object-utils findAngleDiff
     * @param {number} rightAngle - Target angle in degrees
     * @param {number} leftAngle - Starting angle in degrees
     * @returns {number} Angle difference in [-180, 180]
     */
    static findAngleDiff(rightAngle, leftAngle) {
        let angleDiff = rightAngle - leftAngle;
        angleDiff = ((angleDiff + 180) % 360) - 180;
        if (Math.abs(angleDiff) >= 180) {
            angleDiff = 360 - Math.abs(angleDiff) * Math.sign(angleDiff) * -1;
        }
        return angleDiff;
    }

    /**
     * Interpolate 3D cuboid points between two keyframe positions using CVAT's authentic algorithm
     * Interpolates position (x,y,z), dimensions (sx,sy,sz), and 3-axis Euler angles (Roll, Pitch, Yaw)
     * using shortest-arc angular interpolation.
     * @param {number[]} leftPoints - Array of 16 floats from left keyframe
     * @param {number[]} rightPoints - Array of 16 floats from right keyframe
     * @param {number} offset - Normalized time offset in [0, 1]
     * @returns {number[]} Interpolated points array
     */
    static interpolateCuboidPoints(leftPoints, rightPoints, offset) {
        if (!leftPoints || !rightPoints) return leftPoints || rightPoints || [];
        const positionOffset = leftPoints.map((point, index) => (rightPoints[index] ?? point) - point);
        const result = leftPoints.map((point, index) => point + positionOffset[index] * offset);

        // For 3D cuboids, angles at indices 3, 4, 5 (rx, ry, rz in radians)
        // must be interpolated across the shortest arc on the circle
        if (leftPoints.length >= 6 && rightPoints.length >= 6) {
            const leftRad = leftPoints.slice(3, 6);
            const rightRad = rightPoints.slice(3, 6);

            const [angleX, angleY, angleZ] = leftRad.concat(rightRad)
                .map((ang) => (ang < 0 ? ang + Math.PI * 2 : ang))
                .map((ang) => ang * (180 / Math.PI))
                .reduce((acc, angleBefore, index, arr) => {
                    if (index < 3) {
                        const angleAfter = arr[index + 3];
                        let angle = (angleBefore + TrackReader.findAngleDiff(angleAfter, angleBefore) * offset) * (Math.PI / 180);
                        if (angle > Math.PI) {
                            angle -= Math.PI * 2;
                        }
                        acc.push(angle);
                    }
                    return acc;
                }, []);

            result[3] = angleX;
            result[4] = angleY;
            result[5] = angleZ;
        }

        return result;
    }

    /**
     * Synthesize full-lifespan frame data from a list of keyframe shapes via instant in-memory interpolation.
     * Runs in < 1ms for hundreds of frames.
     * @param {Array<{ frame: number, points: number[], outside?: boolean }>} shapes - Exact keyframes
     * @param {number} startFrame
     * @param {number} stopFrame
     * @param {Object} label
     * @returns {Array<{ frame: number, points: number[], box: Object, keyframe: boolean, outside: boolean, label: Object }>}
     */
    static interpolateTrack(shapes, startFrame, stopFrame, label) {
        if (!Array.isArray(shapes) || shapes.length === 0) return [];
        const sorted = [...shapes].sort((a, b) => a.frame - b.frame);

        const keyframeMap = new Map();
        for (const s of sorted) {
            keyframeMap.set(s.frame, s);
        }

        const firstKf = sorted[0];
        const lastKf = sorted[sorted.length - 1];
        const trackStart = firstKf.frame;
        const trackEnd = lastKf.outside ? lastKf.frame : (typeof stopFrame === 'number' ? stopFrame : lastKf.frame);

        const results = [];
        const keyframeNums = sorted.map(s => s.frame);

        for (let f = trackStart; f <= trackEnd; f++) {
            if (keyframeMap.has(f)) {
                const kf = keyframeMap.get(f);
                const points = [...kf.points];
                results.push({
                    frame: f,
                    points,
                    box: TrackReader.parsePointsToBox(points),
                    keyframe: true,
                    outside: !!kf.outside,
                    label
                });
            } else {
                // Find nearest previous and next keyframes
                let leftF = null;
                let rightF = null;
                for (let i = 0; i < keyframeNums.length; i++) {
                    if (keyframeNums[i] < f) leftF = keyframeNums[i];
                    if (keyframeNums[i] > f && rightF === null) {
                        rightF = keyframeNums[i];
                        break;
                    }
                }

                if (leftF !== null && rightF !== null) {
                    const leftShape = keyframeMap.get(leftF);
                    const rightShape = keyframeMap.get(rightF);
                    if (leftShape.outside) {
                        const points = [...leftShape.points];
                        results.push({
                            frame: f,
                            points,
                            box: TrackReader.parsePointsToBox(points),
                            keyframe: false,
                            outside: true,
                            label
                        });
                    } else {
                        const offset = (f - leftF) / (rightF - leftF);
                        const interpPoints = TrackReader.interpolateCuboidPoints(leftShape.points, rightShape.points, offset);
                        results.push({
                            frame: f,
                            points: interpPoints,
                            box: TrackReader.parsePointsToBox(interpPoints),
                            keyframe: false,
                            outside: false,
                            label
                        });
                    }
                } else if (leftF !== null && !lastKf.outside) {
                    // Beyond last keyframe, track remains active holding last known box
                    const leftShape = keyframeMap.get(leftF);
                    const points = [...leftShape.points];
                    results.push({
                        frame: f,
                        points,
                        box: TrackReader.parsePointsToBox(points),
                        keyframe: false,
                        outside: false,
                        label
                    });
                }
            }
        }

        return results;
    }

    /**
     * Read cuboid states across all frames for a given object/track.
     * Uses CVAT's in-memory annotations.export() to retrieve exact keyframes in < 1ms,
     * then calculates continuous 3D interpolation in realtime.
     * @param {number} clientID - Selected object ID
     * @param {any} jobInstance - CVAT Job instance from Redux store
     * @returns {Promise<Array<{ frame: number, points: number[], box: Object, keyframe: boolean, outside: boolean, label: Object }>>}
     */
    static async getTrackFrames(clientID, jobInstance) {
        if (!jobInstance || clientID === null || typeof clientID === 'undefined') {
            return [];
        }

        const startFrame = jobInstance.startFrame || 0;
        const stopFrame = jobInstance.stopFrame || (jobInstance.size ? jobInstance.size - 1 : 0);

        // 1. Primary path: CVAT in-memory annotations.export() (Fastest & 100% accurate keyframe detection)
        if (jobInstance.annotations && typeof jobInstance.annotations.export === 'function') {
            try {
                const exported = await jobInstance.annotations.export();
                if (exported) {
                    // Check if object is a Track
                    const track = (exported.tracks || []).find(t => t.clientID === clientID || t.id === clientID);
                    if (track && Array.isArray(track.shapes) && track.shapes.length > 0) {
                        const label = jobInstance.labels?.find(l => l.id === track.label_id) ||
                                     track.label || { name: 'Object', color: '#30D158' };

                        // Cache active track keyframes for live reactive editing
                        TrackReader.currentTrackData = {
                            clientID,
                            shapes: track.shapes.map(s => ({
                                frame: s.frame,
                                points: [...(s.points || [])],
                                outside: !!s.outside,
                                rotation: s.rotation || 0
                            })),
                            label,
                            startFrame,
                            stopFrame
                        };

                        const framesData = TrackReader.interpolateTrack(
                            TrackReader.currentTrackData.shapes,
                            startFrame,
                            stopFrame,
                            label
                        );

                        if (framesData.length > 0) {
                            return framesData;
                        }
                    }

                    // Check if object is a standalone single-frame Shape
                    const shape = (exported.shapes || []).find(s => s.clientID === clientID || s.id === clientID);
                    if (shape && shape.points && shape.points.length >= 9) {
                        const label = jobInstance.labels?.find(l => l.id === shape.label_id) ||
                                     shape.label || { name: 'Object', color: '#30D158' };
                        return [{
                            frame: shape.frame,
                            points: [...shape.points],
                            box: TrackReader.parsePointsToBox(shape.points),
                            keyframe: true,
                            outside: !!shape.outside,
                            label
                        }];
                    }
                }
            } catch (err) {
                console.warn('[CVAT-QAQC] annotations.export failed, falling back to filtered get:', err);
            }
        }

        // 2. Fallback path: query job.annotations.get with isolated objectID filter
        const filter = [{ and: [{ '==': [{ var: 'objectID' }, clientID] }] }, {}];
        const results = [];
        const framePromises = [];

        for (let f = startFrame; f <= stopFrame; f++) {
            framePromises.push((async (frameNum) => {
                try {
                    const states = await jobInstance.annotations.get(frameNum, true, filter);
                    if (!Array.isArray(states)) return null;
                    const state = states.find(s => s.clientID === clientID);
                    if (state && state.points && state.points.length >= 9) {
                        const first = state.keyframes?.first;
                        const last = state.keyframes?.last;
                        if (typeof first === 'number' && frameNum < first) return null;
                        if (typeof last === 'number' && frameNum > last && state.outside) return null;

                        return {
                            frame: frameNum,
                            points: [...state.points],
                            box: TrackReader.parsePointsToBox(state.points),
                            keyframe: !!state.keyframe,
                            outside: !!state.outside,
                            label: {
                                id: state.label?.id,
                                name: state.label?.name || 'Object',
                                color: state.label?.color || '#30D158'
                            }
                        };
                    }
                } catch (_) {
                    return null;
                }
                return null;
            })(f));
        }

        const settled = await Promise.all(framePromises);
        for (const item of settled) {
            if (item) results.push(item);
        }

        results.sort((a, b) => a.frame - b.frame);
        return results;
    }

    /**
     * Realtime keyframe update and instant re-interpolation for live dock view synchronization.
     * When the user modifies any cuboid or outside status on a card, this updates the keyframe
     * and re-interpolates the entire track in < 0.1ms without touching network or reloading.
     * @param {number} clientID
     * @param {number} frame
     * @param {number[]|null} [newPoints]
     * @param {boolean|null} [outside]
     * @returns {Array<Object>|null} Updated frames data list for immediate dock refresh
     */
    static updateTrackKeyframe(clientID, frame, newPoints = null, outside = null) {
        if (!TrackReader.currentTrackData || TrackReader.currentTrackData.clientID !== clientID) {
            return null;
        }

        const shapes = TrackReader.currentTrackData.shapes;
        const existingIdx = shapes.findIndex(s => s.frame === frame);

        if (existingIdx !== -1) {
            // Update existing keyframe
            if (newPoints) shapes[existingIdx].points = [...newPoints];
            if (outside !== null) shapes[existingIdx].outside = !!outside;
        } else {
            // Promote interpolated frame to a new keyframe
            const basePoints = newPoints || (shapes.length > 0 ? shapes[0].points : new Array(16).fill(0));
            shapes.push({
                frame,
                points: [...basePoints],
                outside: outside !== null ? !!outside : false,
                rotation: 0
            });
            shapes.sort((a, b) => a.frame - b.frame);
        }

        // Re-interpolate all frames in < 0.1ms
        return TrackReader.interpolateTrack(
            shapes,
            TrackReader.currentTrackData.startFrame,
            TrackReader.currentTrackData.stopFrame,
            TrackReader.currentTrackData.label
        );
    }

    /**
     * Apply new dimensions across all keyframes and re-interpolate entire track in < 1ms
     * @param {number} clientID
     * @param {Object} sizeObj - { sx, sy, sz } or { w, l, h }
     * @returns {Array<Object>|null} Updated frames data list
     */
    static applySizeToTrack(clientID, sizeObj) {
        if (!TrackReader.currentTrackData || TrackReader.currentTrackData.clientID !== clientID) {
            return null;
        }

        const sx = parseFloat(Number(sizeObj?.sx ?? sizeObj?.w).toFixed(3));
        const sy = parseFloat(Number(sizeObj?.sy ?? sizeObj?.l).toFixed(3));
        const sz = parseFloat(Number(sizeObj?.sz ?? sizeObj?.h).toFixed(3));

        if (isNaN(sx) || isNaN(sy) || isNaN(sz) || sx <= 0 || sy <= 0 || sz <= 0) {
            return null;
        }

        const shapes = TrackReader.currentTrackData.shapes;
        for (const s of shapes) {
            if (Array.isArray(s.points) && s.points.length >= 9) {
                s.points[6] = sx;
                s.points[7] = sy;
                s.points[8] = sz;
            }
        }

        // Re-interpolate all frames in < 0.1ms
        return TrackReader.interpolateTrack(
            shapes,
            TrackReader.currentTrackData.startFrame,
            TrackReader.currentTrackData.stopFrame,
            TrackReader.currentTrackData.label
        );
    }

    /**
     * Parse CVAT 3D cuboid points array [x, y, z, rx, ry, rz, sx, sy, sz, ...]
     * @param {number[]} points
     * @returns {{ x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number }}
     */
    static parsePointsToBox(points) {
        return {
            x: points[0] || 0,
            y: points[1] || 0,
            z: points[2] || 0,
            rx: points[3] || 0,
            ry: points[4] || 0,
            rz: points[5] || 0,
            sx: points[6] || 1, // width
            sy: points[7] || 1, // length
            sz: points[8] || 1  // height
        };
    }

    /**
     * Convert box parameters back to CVAT 3D points array [x, y, z, rx, ry, rz, sx, sy, sz, ...]
     * @param {Object} box - { x, y, z, rx, ry, rz, sx, sy, sz }
     * @param {number[]} [originalPoints] - optional existing points array to preserve extra attributes
     * @returns {number[]}
     */
    static boxToPoints(box, originalPoints) {
        const pts = originalPoints ? [...originalPoints] : new Array(16).fill(0);
        pts[0] = typeof box.x === 'number' ? box.x : 0;
        pts[1] = typeof box.y === 'number' ? box.y : 0;
        pts[2] = typeof box.z === 'number' ? box.z : 0;
        pts[3] = typeof box.rx === 'number' ? box.rx : 0;
        pts[4] = typeof box.ry === 'number' ? box.ry : 0;
        pts[5] = typeof box.rz === 'number' ? box.rz : 0;
        pts[6] = Math.max(0.01, typeof box.sx === 'number' ? box.sx : 1);
        pts[7] = Math.max(0.01, typeof box.sy === 'number' ? box.sy : 1);
        pts[8] = Math.max(0.01, typeof box.sz === 'number' ? box.sz : 1);
        return pts;
    }
}


    // ------------------------------------------
    // File: src/core/cvat_hook.js
    // ------------------------------------------

/**
 * CVAT Client Hook
 * Connects directly to CVAT's React Fiber, Redux store, and Canvas3d instance.
 * Completely client-side and reactive.
 */
class CVATHook {
    constructor() {
        this.store = null;
        this.jobInstance = null;
        this.canvasInstance = null;
        this.activeClientID = null;
        this.activeFilterID = null;
        this.currentFrame = 0;
        this.listeners = {
            objectChange: [],
            frameChange: [],
            canvasReady: [],
            objectUpdated: [],
            historyChange: [],
            filterChange: []
        };
        this.isHooked = false;
        this._undoRedoLock = false;
    }

    /**
     * Initialize connection to CVAT client
     * @returns {Promise<boolean>}
     */
    async init() {
        return new Promise((resolve) => {
            // First check if this page is in the allowed sites list (zero regex)
            if (typeof window !== 'undefined' && !isAllowedSite()) {
                resolve(false);
                return;
            }

            const checkInterval = setInterval(() => {
                const store = this.findReduxStore();
                if (store) {
                    clearInterval(checkInterval);
                    this.store = store;
                    this.setupStoreListener();
                    this.isHooked = true;
                    console.log('[CVAT-QAQC] Successfully hooked into CVAT Redux store');
                    resolve(true);
                }
            }, 500);

            // Timeout after 15s if not found (info log rather than warn so Chrome won't flag as extension error)
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!this.isHooked) {
                    console.info('[CVAT-QAQC] CVAT store hook standby (waiting for job session)');
                    resolve(false);
                }
            }, 15000);
        });
    }

    /**
     * Find Redux Store from React Fiber root or window
     */
    findReduxStore() {
        // Direct global check
        if (window.__REDUX_STORE__) {
            return window.__REDUX_STORE__;
        }

        const rootEl = document.getElementById('root');
        if (!rootEl) return null;

        const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;

        let rootFiber = rootEl[fiberKey];
        const queue = [rootFiber];
        let maxDepth = 250;

        while (queue.length > 0 && maxDepth-- > 0) {
            const node = queue.shift();
            if (!node) continue;

            const props = node.memoizedProps;
            if (props) {
                if (props.store && typeof props.store.getState === 'function') {
                    return props.store;
                }
                if (props.value && props.value.store && typeof props.value.store.getState === 'function') {
                    return props.value.store;
                }
            }

            if (node.child) queue.push(node.child);
            if (node.sibling) queue.push(node.sibling);
        }

        return null;
    }

    /**
     * Resolve currently active or selected 3D object clientID from Redux state & Canvas
     * @param {any} state
     * @returns {number|null}
     */
    findActiveClientID(state) {
        if (!state || !state.annotation) return null;
        const ann = state.annotation.annotations;
        if (!ann) return null;

        // 1. Check activatedStateID (currently focused / edited object)
        if (typeof ann.activatedStateID === 'number') {
            return ann.activatedStateID;
        }

        // 2. Check selectedStatesID (selected in objects sidebar or via box selection)
        if (Array.isArray(ann.selectedStatesID) && ann.selectedStatesID.length > 0) {
            const firstSelected = ann.selectedStatesID[0];
            if (typeof firstSelected === 'number') {
                return firstSelected;
            }
        }

        // 3. Check Canvas3d activatedElementID
        const canvas = state.annotation.canvas?.instance;
        if (canvas && typeof canvas.activatedElementID === 'number') {
            return canvas.activatedElementID;
        }

        // 3.5 Check active or selected item in DOM objects sidebar
        if (typeof document !== 'undefined') {
            try {
                const activeItem = document.querySelector(
                    '[class*="objects-sidebar-state-item"][class*="active"], ' +
                    '.cvat-objects-sidebar-state-item-active, ' +
                    '[id^="cvat-objects-sidebar-state-item-"].active, ' +
                    '[id^="cvat-objects-sidebar-state-item-"]:focus-within'
                );
                if (activeItem) {
                    const idMatch = (activeItem.id || '').match(/cvat-objects-sidebar-state-item-(\d+)/);
                    if (idMatch) return parseInt(idMatch[1], 10);
                    const numText = activeItem.querySelector('[class*="number"]')?.textContent?.trim() ||
                                   activeItem.querySelector('span')?.textContent?.match(/#(\d+)/)?.[1];
                    if (numText && !isNaN(parseInt(numText, 10))) return parseInt(numText, 10);
                }
            } catch (_) {}
        }

        // 4. Auto-detect: if on current frame there is a 3D cuboid, auto-select it!
        const states = ann.states || [];
        const cuboidState = states.find(s => s.shapeType === 'cuboid' || (s.points && s.points.length >= 9));
        if (cuboidState && typeof cuboidState.clientID === 'number') {
            return cuboidState.clientID;
        }

        return null;
    }

    /**
     * Re-inspect Redux state and force refresh of current active 3D object
     */
    refreshActiveObject() {
        if (!this.store) return;
        const state = this.store.getState();
        if (!state || !state.annotation) return;

        const job = state.annotation.job?.instance || null;
        const canvas = state.annotation.canvas?.instance || null;
        const clientID = this.findActiveClientID(state);
        const frame = state.annotation.player?.frame?.number ?? 0;

        this.jobInstance = job;
        this.canvasInstance = canvas;
        this.currentFrame = frame;
        this.activeClientID = clientID;

        this.emit('objectChange', { clientID, job, canvas, frame });
    }

    /**
     * Subscribe to Redux store updates
     */
    setupStoreListener() {
        if (!this.store) return;

        let prevClientID = null;
        let prevFrame = null;
        let prevCanvas = null;
        let prevUndoLength = 0;
        let prevRedoLength = 0;

        this.store.subscribe(() => {
            try {
                const state = this.store.getState();
                if (!state || !state.annotation) return;

                const job = state.annotation.job?.instance || null;
                const canvas = state.annotation.canvas?.instance || null;
                const clientID = this.findActiveClientID(state);
                const frame = state.annotation.player?.frame?.number ?? 0;

                this.jobInstance = job;
                this.canvasInstance = canvas;
                this.currentFrame = frame;

                if (canvas !== prevCanvas && canvas) {
                    prevCanvas = canvas;
                    this.emit('canvasReady', canvas);
                }

                if (clientID !== prevClientID) {
                    prevClientID = clientID;
                    this.activeClientID = clientID;
                    this.emit('objectChange', { clientID, job, canvas, frame });
                }

                if (frame !== prevFrame) {
                    prevFrame = frame;
                    this.emit('frameChange', { frame, clientID, job, canvas });
                }

                // Check CVAT Undo / Redo history changes
                const annHistory = state.annotation.annotations?.history;
                const undoLen = annHistory?.undo?.length ?? 0;
                const redoLen = annHistory?.redo?.length ?? 0;

                if (undoLen !== prevUndoLength || redoLen !== prevRedoLength) {
                    prevUndoLength = undoLen;
                    prevRedoLength = redoLen;
                    this.emit('historyChange', { undoLen, redoLen, history: annHistory, clientID: this.activeClientID, frame });
                }
            } catch (err) {
                console.error('[CVAT-QAQC] Error in store subscriber:', err);
            }
        });

        // Trigger initial state
        const initialState = this.store.getState();
        if (initialState?.annotation) {
            this.jobInstance = initialState.annotation.job?.instance;
            this.canvasInstance = initialState.annotation.canvas?.instance;
            this.activeClientID = this.findActiveClientID(initialState);
            this.currentFrame = initialState.annotation.player?.frame?.number ?? 0;
            if (this.activeClientID !== null) {
                this.emit('objectChange', {
                    clientID: this.activeClientID,
                    job: this.jobInstance,
                    canvas: this.canvasInstance,
                    frame: this.currentFrame
                });
            }
        }
    }

    /**
     * Jump CVAT main viewport to requested frame
     * @param {number} frameNumber
     */
    jumpToFrame(frameNumber) {
        const target = parseInt(frameNumber, 10);
        if (isNaN(target)) return;

        console.log(`[CVAT-QAQC] Requesting frame jump to #${target}`);

        // Method 1: Ant Design Slider React props
        try {
            const slider = document.querySelector('.cvat-player-slider');
            if (slider) {
                const propsKey = Object.keys(slider).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                if (propsKey && slider[propsKey] && typeof slider[propsKey].onChange === 'function') {
                    slider[propsKey].onChange(target);
                    return;
                }
            }
        } catch (e) {
            console.warn('[CVAT-QAQC] slider jump error:', e);
        }

        // Method 2: InputNumber inside .cvat-player-frame-selector
        try {
            const inputEl = document.querySelector('.cvat-player-frame-selector input') || document.querySelector('.cvat-player-frame-selector');
            if (inputEl) {
                inputEl.focus();
                const propsKey = Object.keys(inputEl).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                const protoSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (protoSetter) {
                    protoSetter.call(inputEl, String(target));
                } else {
                    inputEl.value = String(target);
                }

                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                if (propsKey && inputEl[propsKey]) {
                    if (typeof inputEl[propsKey].onPressEnter === 'function') {
                        inputEl[propsKey].onPressEnter({ target: { value: target } });
                    }
                    if (typeof inputEl[propsKey].onBlur === 'function') {
                        inputEl[propsKey].onBlur({ target: { value: target } });
                    }
                }

                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                return;
            }
        } catch (e) {
            console.warn('[CVAT-QAQC] input selector jump error:', e);
        }

        // Method 3: Redux store dispatch if available
        try {
            if (this.store) {
                this.store.dispatch({
                    type: 'CHANGE_FRAME',
                    payload: { frame: target }
                });
            }
        } catch (_) {}
    }

    /**
     * Update 3D cuboid points for an object at a specific frame (Pure client-side, 0 server requests)
     * @param {number} frameNumber
     * @param {number} clientID
     * @param {number[]} newPoints
     * @returns {Promise<boolean>}
     */
    async updateObjectCuboid(frameNumber, clientID, newPoints) {
        if (!this.jobInstance || clientID === null || typeof clientID === 'undefined') {
            console.warn('[CVAT-QAQC] Cannot update cuboid: Job instance or clientID missing');
            return false;
        }

        try {
            // 1. Fetch in-memory ObjectStates for this frame
            const states = await this.jobInstance.annotations.get(frameNumber, true, []);
            if (!Array.isArray(states)) return false;

            const targetState = states.find(s => s.clientID === clientID);
            if (!targetState) {
                console.warn(`[CVAT-QAQC] Object #${clientID} not found on frame #${frameNumber}`);
                return false;
            }

            // 2. Update points in-place and mark keyframe
            targetState.points = [...newPoints];
            targetState.keyframe = true;

            // 3. Save to CVAT client-side AnnotationsCollection (0 HTTP requests)
            await targetState.save();
            console.log(`[CVAT-QAQC] In-memory cuboid updated for Object #${clientID} at frame #${frameNumber}`);

            // 4. If this is the active frame in CVAT's main viewport, trigger lightweight Three.js update (0 disk I/O, < 5ms)
            if (frameNumber === this.currentFrame && this.canvasInstance) {
                const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                const perspective = canvasDOM?.perspective;
                if (perspective) {
                    perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                        bubbles: false,
                        cancelable: true,
                        detail: {
                            state: targetState,
                            points: [...newPoints]
                        }
                    }));
                }
                if (typeof this.canvasInstance.render === 'function') {
                    try {
                        this.canvasInstance.render();
                    } catch (_) {}
                }
            }

            // 5. Defer Redux history sync to the next animation frame tick (zero blocking on user interaction, INP < 16ms)
            if (this.store && this.jobInstance?.actions) {
                setTimeout(async () => {
                    try {
                        const history = await this.jobInstance.actions.get();
                        const filter = this.activeFilterID !== null ? [{ and: [{ '==': [{ 'var': 'objectID' }, this.activeFilterID] }] }, {}] : [];
                        const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, filter);
                        const statesToPush = this.activeFilterID !== null ? freshStates.filter(s => s.clientID === this.activeFilterID) : freshStates;
                        this.store.dispatch({
                            type: 'UPDATE_ANNOTATIONS_SUCCESS',
                            payload: {
                                states: statesToPush,
                                history
                            }
                        });
                    } catch (e) {
                        console.warn('[CVAT-QAQC] Could not sync history to Redux:', e);
                    }
                }, 16);
            }

            this.emit('objectUpdated', {
                clientID,
                frame: frameNumber,
                points: [...newPoints]
            });

            return true;
        } catch (err) {
            console.error('[CVAT-QAQC] Failed to update in-memory cuboid:', err);
            return false;
        }
    }

    /**
     * Update in-memory outside flag for a cuboid/track at a specific frame
     * @param {number} frameNumber
     * @param {number} clientID
     * @param {boolean} outside
     * @returns {Promise<boolean>}
     */
    async updateObjectOutside(frameNumber, clientID, outside) {
        if (!this.jobInstance || clientID === null || typeof clientID === 'undefined') {
            console.warn('[CVAT-QAQC] Cannot update outside: Job instance or clientID missing');
            return false;
        }

        try {
            // 1. Fetch in-memory ObjectStates for this frame
            const states = await this.jobInstance.annotations.get(frameNumber, true, []);
            if (!Array.isArray(states)) return false;

            const targetState = states.find(s => s.clientID === clientID);
            if (!targetState) {
                console.warn(`[CVAT-QAQC] Object #${clientID} not found on frame #${frameNumber}`);
                return false;
            }

            // 2. Set outside flag and save (registers CHANGED_OUTSIDE into CVAT history)
            targetState.outside = !!outside;
            await targetState.save();
            console.log(`[CVAT-QAQC] In-memory outside set to ${outside} for Object #${clientID} at frame #${frameNumber}`);

            // 3. Sync to CVAT Redux store so CVAT top-bar, timeline and history stack register the change
            if (this.store && this.jobInstance?.actions) {
                try {
                    const history = await this.jobInstance.actions.get();
                    const filter = this.activeFilterID !== null ? [{ and: [{ '==': [{ 'var': 'objectID' }, this.activeFilterID] }] }, {}] : [];
                    const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, filter);
                    const statesToPush = this.activeFilterID !== null ? freshStates.filter(s => s.clientID === this.activeFilterID) : freshStates;
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: {
                            states: statesToPush,
                            history
                        }
                    });
                } catch (e) {
                    console.warn('[CVAT-QAQC] Could not sync history to Redux:', e);
                }
            }

            // 4. If this is the active frame in CVAT's main viewport, notify canvas
            if (frameNumber === this.currentFrame && this.canvasInstance) {
                const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                const perspective = canvasDOM?.perspective;
                if (perspective) {
                    perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                        bubbles: false,
                        cancelable: true,
                        detail: {
                            state: targetState
                        }
                    }));
                }
            }

            this.emit('objectOutsideChanged', {
                clientID,
                frame: frameNumber,
                outside: !!outside
            });

            return true;
        } catch (err) {
            console.error('[CVAT-QAQC] Failed to update in-memory outside:', err);
            return false;
        }
    }

    /**
     * Apply new dimensions across all keyframes of a track in CVAT in-memory AnnotationsCollection
     * Synchronizes Redux and triggers realtime redraw of CVAT Canvas3D.
     * @param {number} clientID
     * @param {Object} sizeObj - { sx, sy, sz }
     * @param {Array<number>} [keyframeNumbers] - list of keyframe frame numbers
     * @returns {Promise<boolean>}
     */
    async applySizeToTrack(clientID, sizeObj, keyframeNumbers = []) {
        if (!this.jobInstance || clientID === null || typeof clientID === 'undefined') {
            return false;
        }

        const sx = parseFloat(Number(sizeObj?.sx ?? sizeObj?.w).toFixed(3));
        const sy = parseFloat(Number(sizeObj?.sy ?? sizeObj?.l).toFixed(3));
        const sz = parseFloat(Number(sizeObj?.sz ?? sizeObj?.h).toFixed(3));

        if (isNaN(sx) || isNaN(sy) || isNaN(sz) || sx <= 0 || sy <= 0 || sz <= 0) {
            return false;
        }

        try {
            // 1. Gather all frames to update: keyframeNumbers + currentFrame
            const framesToUpdate = new Set(keyframeNumbers);
            if (this.currentFrame !== null && typeof this.currentFrame !== 'undefined') {
                framesToUpdate.add(this.currentFrame);
            }

            for (const f of framesToUpdate) {
                try {
                    const states = await this.jobInstance.annotations.get(f, true, []);
                    if (!Array.isArray(states)) continue;
                    const state = states.find(s => s.clientID === clientID);
                    if (state && Array.isArray(state.points) && state.points.length >= 9) {
                        state.points[6] = sx;
                        state.points[7] = sy;
                        state.points[8] = sz;
                        state.keyframe = true;
                        await state.save();
                    }
                } catch (e) {
                    console.warn(`[CVAT-QAQC] Failed to save size on frame #${f}:`, e);
                }
            }

            // 2. Refresh CVAT Canvas3D for the current frame in realtime (0 disk I/O, < 5ms)
            if (this.canvasInstance && this.jobInstance) {
                const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                const perspective = canvasDOM?.perspective;
                if (perspective) {
                    perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                        bubbles: false,
                        cancelable: true
                    }));
                }
                if (typeof this.canvasInstance.render === 'function') {
                    try {
                        this.canvasInstance.render();
                    } catch (_) {}
                }
            }

            // 3. Defer Redux update for history and sidebar inputs to avoid blocking paint
            if (this.store && this.jobInstance?.actions) {
                setTimeout(async () => {
                    try {
                        const history = await this.jobInstance.actions.get();
                        const filter = this.activeFilterID !== null ? [{ and: [{ '==': [{ 'var': 'objectID' }, this.activeFilterID] }] }, {}] : [];
                        const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, filter);
                        const statesToPush = this.activeFilterID !== null ? freshStates.filter(s => s.clientID === this.activeFilterID) : freshStates;
                        this.store.dispatch({
                            type: 'UPDATE_ANNOTATIONS_SUCCESS',
                            payload: { states: statesToPush, history }
                        });
                    } catch (e) {}
                }, 16);
            }

            console.log(`[CVAT-QAQC] Applied size (${sx} × ${sy} × ${sz}m) to Track #${clientID} across ${framesToUpdate.size} frames in-memory`);
            return true;
        } catch (err) {
            console.error('[CVAT-QAQC] applySizeToTrack error:', err);
            return false;
        }
    }

    /**
     * Ensure CVAT's native FiltersModal dialog is closed/hidden so it never pops up in front of user
     */
    closeFilterModalIfOpen() {
        if (this.store) {
            try {
                this.store.dispatch({
                    type: 'SWITCH_SHOWING_FILTERS',
                    payload: { visible: false }
                });
            } catch (_) {}
        }
        if (typeof document !== 'undefined') {
            try {
                const cancelBtn = document.querySelector('.cvat-filters-modal-cancel-button');
                if (cancelBtn) cancelBtn.click();
                const silencer = document.getElementById('cvat-qaqc-filter-silencer');
                if (silencer) silencer.remove();
            } catch (_) {}
        }

        // Sanitize broken/corrupt entries from localStorage history (e.g. broken "Not" -> "Select field")
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const historyStr = window.localStorage.getItem('annotationFiltersHistory')?.trim() || '[]';
                let historyList = JSON.parse(historyStr);
                if (Array.isArray(historyList)) {
                    const cleaned = historyList.filter(entry => {
                        if (!entry || !entry.logic || typeof entry.logic !== 'object') return false;
                        const s = JSON.stringify(entry.logic);
                        if (s === '{}' || s.includes('null') || s.includes('Select field')) return false;
                        return true;
                    });
                    window.localStorage.setItem('annotationFiltersHistory', JSON.stringify(cleaned));
                }
            }
        } catch (_) {}
    }

    /**
     * Filter CVAT workspace to only show the target object clientID.
     * Uses CVAT's native JsonLogic query format: { "and": [{ "==": [{ "var": "objectID" }, targetID] }] }
     * Dispatches CHANGE_ANNOTATIONS_FILTERS & FETCH_ANNOTATIONS_SUCCESS directly to Redux.
     * This isolates the track in CVAT:
     * - The Objects sidebar drops to "Items: 1"
     * - Three.js Canvas3D removes all other tracks from the scene (zero lag)
     * - Top-bar Filters button becomes active (filters-armed class)
     * - Opening the native Filters modal cleanly renders "ObjectID == targetID" via react-awesome-query-builder
     * - NO modal table pops up in front of user
     * @param {number} clientID
     * @returns {Promise<boolean>}
     */
    async filterByObjectID(clientID) {
        if (clientID === null || typeof clientID === 'undefined') {
            return this.clearFilter();
        }

        const targetID = Number(clientID);
        if (isNaN(targetID)) return false;

        console.log(`[CVAT-QAQC] Filtering workspace to Object ID #${targetID} (isolating track)...`);
        this.activeFilterID = targetID;

        // 1. Ensure CVAT filter modal is closed
        this.closeFilterModalIfOpen();

        // 2. Build CVAT native JsonLogic filter for objectID wrapped in root 'and' group
        // react-awesome-query-builder and CVAT annotationsFilter require the root 'and' group structure
        const filterLogic = {
            and: [
                { '==': [{ var: 'objectID' }, targetID] }
            ]
        };
        const filters = [filterLogic, {}];

        // 3. Dispatch CHANGE_ANNOTATIONS_FILTERS to CVAT Redux store
        if (this.store) {
            try {
                this.store.dispatch({
                    type: 'CHANGE_ANNOTATIONS_FILTERS',
                    payload: {
                        filters
                    }
                });
            } catch (e) {
                console.warn('[CVAT-QAQC] Error dispatching CHANGE_ANNOTATIONS_FILTERS:', e);
            }
        }

        // 4. Query filtered states from CVAT job annotations using native JsonLogic filter
        let filteredStates = [];
        let history = null;
        if (this.jobInstance) {
            try {
                history = this.jobInstance.actions ? await this.jobInstance.actions.get() : null;
                try {
                    filteredStates = await this.jobInstance.annotations.get(this.currentFrame, true, filters);
                } catch (e) {
                    console.warn('[CVAT-QAQC] annotations.get with filters error, fallback to client-side filter:', e);
                    const allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                    filteredStates = allStates.filter(s => s.clientID === targetID);
                }

                if (!Array.isArray(filteredStates) || filteredStates.length === 0) {
                    const allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                    filteredStates = allStates.filter(s => s.clientID === targetID);
                }

                // Hide all other states in-memory so Three.js drops draw calls immediately
                try {
                    const allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                    for (const s of allStates) {
                        if (typeof s.hidden !== 'undefined') {
                            s.hidden = (s.clientID !== targetID);
                        }
                    }
                } catch (_) {}
            } catch (err) {
                console.warn('[CVAT-QAQC] Error in job annotations filter:', err);
            }
        }

        // 5. Dispatch FETCH_ANNOTATIONS_SUCCESS to update Redux & Objects sidebar (Items: 1)
        // Note: Do NOT dispatch UPDATE_ANNOTATIONS_SUCCESS here because it merges into prevStates,
        // which would retain all 80 other objects. FETCH_ANNOTATIONS_SUCCESS replaces states completely!
        if (this.store) {
            try {
                this.store.dispatch({
                    type: 'FETCH_ANNOTATIONS_SUCCESS',
                    payload: {
                        states: filteredStates,
                        intervals: [],
                        history
                    }
                });
            } catch (e) {
                console.warn('[CVAT-QAQC] Error dispatching FETCH_ANNOTATIONS_SUCCESS:', e);
            }
        }

        // 6. Update Canvas3D to immediately remove other objects from Three.js scene
        if (this.canvasInstance && typeof this.canvasInstance.setup === 'function' && this.jobInstance) {
            try {
                const frameData = await this.jobInstance.frames.get(this.currentFrame);
                this.canvasInstance.setup(frameData, filteredStates);
            } catch (e) {
                console.warn('[CVAT-QAQC] Canvas3D setup error:', e);
            }
        }

        // 7. Update localStorage filters history so CVAT native modal shows it under Recently Used
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const historyStr = window.localStorage.getItem('annotationFiltersHistory')?.trim() || '[]';
                let historyList = JSON.parse(historyStr);
                if (!Array.isArray(historyList)) historyList = [];
                const newEntry = {
                    id: `qaqc-filter-${targetID}`,
                    logic: filterLogic,
                    keypointLogic: {}
                };
                historyList = [newEntry, ...historyList.filter(f => JSON.stringify(f?.logic) !== JSON.stringify(filterLogic))].slice(0, 10);
                window.localStorage.setItem('annotationFiltersHistory', JSON.stringify(historyList));
            }
        } catch (_) {}

        this.emit('filterChange', { clientID: targetID });
        return true;
    }

    /**
     * Clear object filter and restore all objects on the workspace
     * @returns {Promise<boolean>}
     */
    async clearFilter() {
        console.log('[CVAT-QAQC] Clearing object filter, restoring all objects...');
        this.activeFilterID = null;

        // 1. Ensure modal is closed
        this.closeFilterModalIfOpen();

        // 2. Dispatch CHANGE_ANNOTATIONS_FILTERS with empty array
        if (this.store) {
            try {
                this.store.dispatch({
                    type: 'CHANGE_ANNOTATIONS_FILTERS',
                    payload: {
                        filters: []
                    }
                });
            } catch (e) {
                console.warn('[CVAT-QAQC] Error clearing CHANGE_ANNOTATIONS_FILTERS:', e);
            }
        }

        // 3. Fetch all states and restore
        let allStates = [];
        let history = null;
        if (this.jobInstance) {
            try {
                allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                history = this.jobInstance.actions ? await this.jobInstance.actions.get() : null;
                for (const s of allStates) {
                    if (typeof s.hidden !== 'undefined') {
                        s.hidden = false;
                    }
                }
            } catch (err) {
                console.warn('[CVAT-QAQC] Error restoring all object annotations:', err);
            }
        }

        // 4. Dispatch FETCH_ANNOTATIONS_SUCCESS to restore Redux states & objects sidebar
        if (this.store) {
            try {
                this.store.dispatch({
                    type: 'FETCH_ANNOTATIONS_SUCCESS',
                    payload: {
                        states: allStates,
                        intervals: [],
                        history
                    }
                });
            } catch (e) {
                console.warn('[CVAT-QAQC] Error restoring Redux annotations on clear:', e);
            }
        }

        // 5. Update Canvas3D to restore all objects in Three.js scene
        if (this.canvasInstance && typeof this.canvasInstance.setup === 'function' && this.jobInstance) {
            try {
                const frameData = await this.jobInstance.frames.get(this.currentFrame);
                this.canvasInstance.setup(frameData, allStates);
            } catch (e) {
                console.warn('[CVAT-QAQC] Canvas3D restore setup error:', e);
            }
        }

        this.emit('filterChange', { clientID: null });
        return true;
    }

    /**
     * Perform Undo directly on CVAT client-side history stack
     * @returns {Promise<boolean>}
     */
    async undo() {
        if (this._undoRedoLock) return false;
        this._undoRedoLock = true;
        setTimeout(() => { this._undoRedoLock = false; }, 200);

        console.log('[CVAT-QAQC] Executing Undo on CVAT...');

        // Method 1: Click CVAT's native Undo button in top-bar if active
        if (typeof document !== 'undefined') {
            try {
                const nativeUndoBtn = document.querySelector('.cvat-annotation-header-undo-button');
                if (nativeUndoBtn && !nativeUndoBtn.disabled && nativeUndoBtn.style.pointerEvents !== 'none' && nativeUndoBtn.style.opacity !== '0.5') {
                    nativeUndoBtn.click();
                    return true;
                }
            } catch (e) {
                console.warn('[CVAT-QAQC] Native undo button click error:', e);
            }
        }

        // Method 2: Direct jobInstance.actions.undo() + Redux sync + Canvas update
        if (this.jobInstance?.actions?.undo) {
            try {
                const affectedIDs = await this.jobInstance.actions.undo();
                const history = await this.jobInstance.actions.get();
                const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);

                if (this.store) {
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: { states: freshStates, history }
                    });
                }

                if (this.canvasInstance) {
                    const targetState = freshStates.find(s => s.clientID === this.activeClientID);
                    if (targetState) {
                        const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                        const perspective = canvasDOM?.perspective;
                        if (perspective) {
                            perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                                bubbles: false,
                                cancelable: true,
                                detail: {
                                    state: targetState,
                                    points: [...targetState.points]
                                }
                            }));
                        }
                    }
                }

                this.emit('historyChange', { history, clientID: this.activeClientID, frame: this.currentFrame });
                return true;
            } catch (err) {
                console.error('[CVAT-QAQC] Direct job actions undo error:', err);
                return false;
            }
        }

        return false;
    }

    /**
     * Perform Redo directly on CVAT client-side history stack
     * @returns {Promise<boolean>}
     */
    async redo() {
        if (this._undoRedoLock) return false;
        this._undoRedoLock = true;
        setTimeout(() => { this._undoRedoLock = false; }, 200);

        console.log('[CVAT-QAQC] Executing Redo on CVAT...');

        // Method 1: Click CVAT's native Redo button in top-bar if active
        if (typeof document !== 'undefined') {
            try {
                const nativeRedoBtn = document.querySelector('.cvat-annotation-header-redo-button');
                if (nativeRedoBtn && !nativeRedoBtn.disabled && nativeRedoBtn.style.pointerEvents !== 'none' && nativeRedoBtn.style.opacity !== '0.5') {
                    nativeRedoBtn.click();
                    return true;
                }
            } catch (e) {
                console.warn('[CVAT-QAQC] Native redo button click error:', e);
            }
        }

        // Method 2: Direct jobInstance.actions.redo() + Redux sync + Canvas update
        if (this.jobInstance?.actions?.redo) {
            try {
                const affectedIDs = await this.jobInstance.actions.redo();
                const history = await this.jobInstance.actions.get();
                const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);

                if (this.store) {
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: { states: freshStates, history }
                    });
                }

                if (this.canvasInstance) {
                    const targetState = freshStates.find(s => s.clientID === this.activeClientID);
                    if (targetState) {
                        const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                        const perspective = canvasDOM?.perspective;
                        if (perspective) {
                            perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                                bubbles: false,
                                cancelable: true,
                                detail: {
                                    state: targetState,
                                    points: [...targetState.points]
                                }
                            }));
                        }
                    }
                }

                this.emit('historyChange', { history, clientID: this.activeClientID, frame: this.currentFrame });
                return true;
            } catch (err) {
                console.error('[CVAT-QAQC] Direct job actions redo error:', err);
                return false;
            }
        }

        return false;
    }

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            for (const cb of this.listeners[event]) {
                try {
                    cb(data);
                } catch (e) {
                    console.error('[CVAT-QAQC] Listener error:', e);
                }
            }
        }
    }
}


    // ------------------------------------------
    // File: src/core/size_clipboard.js
    // ------------------------------------------

/**
 * Size Clipboard Module for CVAT 3D QA/QC Inspector
 * Copies and Pastes bounding box dimensions (W: sx, L: sy, H: sz) across frames.
 * Follows the mechanism of CVAT-prelabel-analysis:
 * 1. In-memory clipboard
 * 2. Persistent sessionStorage ('cvat_coof_dims' and 'cvat_qaqc_size_clipboard')
 * 3. System Clipboard integration (formatted text and JSON)
 * 4. Pure UI operation in CVAT-QAQC: 0 HTTP requests, 0 buttons added to CVAT web page.
 */
class SizeClipboard {
    static _memory = null;

    /**
     * Restore clipboard from sessionStorage on init
     */
    static init() {
        try {
            const saved = sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims');
            if (saved) {
                const parsed = JSON.parse(saved);
                this._memory = this.normalize(parsed);
            }
        } catch (_) {}
    }

    /**
     * Normalize any size object into { sx, sy, sz, w, l, h }
     * @param {Object} obj - { sx, sy, sz } or { w, l, h }
     */
    static normalize(obj) {
        if (!obj || typeof obj !== 'object') return null;

        const w = Number(obj.sx ?? obj.w ?? 0);
        const l = Number(obj.sy ?? obj.l ?? 0);
        const h = Number(obj.sz ?? obj.h ?? 0);

        if (isNaN(w) || isNaN(l) || isNaN(h) || w <= 0 || l <= 0 || h <= 0) {
            return null;
        }

        const sx = parseFloat(w.toFixed(3));
        const sy = parseFloat(l.toFixed(3));
        const sz = parseFloat(h.toFixed(3));

        return {
            sx,
            sy,
            sz,
            w: sx,
            l: sy,
            h: sz,
            copiedAt: Date.now()
        };
    }

    /**
     * Copy dimensions of a box to clipboard
     * @param {Object} box - { sx, sy, sz }
     * @returns {Object|null}
     */
    static copy(box) {
        const normalized = this.normalize(box);
        if (!normalized) return null;

        this._memory = normalized;

        // 1. Save to sessionStorage (supports cvat_coof_dims interoperability)
        try {
            sessionStorage.setItem('cvat_qaqc_size_clipboard', JSON.stringify(normalized));
            sessionStorage.setItem('cvat_coof_dims', JSON.stringify({
                l: normalized.sy,
                w: normalized.sx,
                h: normalized.sz
            }));
        } catch (_) {}

        // 2. Write to system clipboard if permitted
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                const text = `${normalized.sx} x ${normalized.sy} x ${normalized.sz}`;
                navigator.clipboard.writeText(text).catch(() => {});
            }
        } catch (_) {}

        // 3. Dispatch custom event for UI updates
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('cvat_qaqc_size_copied', {
                    detail: normalized
                }));
            }
        } catch (_) {}

        return normalized;
    }

    /**
     * Retrieve dimensions from memory, sessionStorage, or system clipboard
     * @returns {Promise<Object|null>}
     */
    static async get() {
        if (this._memory) return { ...this._memory };

        try {
            const raw = sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims');
            if (raw) {
                const parsed = JSON.parse(raw);
                const norm = this.normalize(parsed);
                if (norm) {
                    this._memory = norm;
                    return { ...norm };
                }
            }
        } catch (_) {}

        // Try reading from system clipboard as fallback
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                const text = await navigator.clipboard.readText();
                if (text && typeof text === 'string') {
                    // Try JSON parse
                    try {
                        const json = JSON.parse(text);
                        const norm = this.normalize(json);
                        if (norm) {
                            this._memory = norm;
                            return { ...norm };
                        }
                    } catch (_) {}

                    // Try regex parse "1.85 x 4.52 x 1.55" or "1.85, 4.52, 1.55"
                    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*[\*x×,; ]\s*([0-9]+(?:\.[0-9]+)?)\s*[\*x×,; ]\s*([0-9]+(?:\.[0-9]+)?)/i);
                    if (match) {
                        const v1 = parseFloat(match[1]);
                        const v2 = parseFloat(match[2]);
                        const v3 = parseFloat(match[3]);
                        const norm = this.normalize({ sx: v1, sy: v2, sz: v3 });
                        if (norm) {
                            this._memory = norm;
                            return { ...norm };
                        }
                    }
                }
            }
        } catch (_) {}

        return null;
    }

    /**
     * Check synchronously if clipboard has data
     */
    static hasData() {
        if (this._memory) return true;
        try {
            return Boolean(sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims'));
        } catch (_) {
            return false;
        }
    }

    /**
     * Extract active cuboid dimensions from CVAT HTML DOM (pure read-only inspection)
     * Does NOT create or inject any buttons into CVAT.
     */
    static extractFromCvatDom() {
        try {
            const sizeRow = document.querySelector('.cvat-objects-sidebar-state-active .cvat-objects-sidebar-size-params') ||
                            document.querySelector('.cvat-canvas-3d-cuboid-popover .cvat-objects-sidebar-size-params') ||
                            document.querySelector('.cvat-objects-sidebar-size-params');

            let l = null, w = null, h = null;

            if (sizeRow) {
                const cols = sizeRow.querySelectorAll('.ant-col');
                for (const col of cols) {
                    const text = (col.textContent || '').trim().toUpperCase();
                    const input = col.querySelector('input');
                    if (!input) continue;
                    const val = parseFloat(input.value);
                    if (isNaN(val) || val <= 0) continue;

                    if (text.startsWith('L') || text.includes('L:')) l = val;
                    else if (text.startsWith('W') || text.includes('W:')) w = val;
                    else if (text.startsWith('H') || text.includes('H:')) h = val;
                }
            }

            if (w !== null && l !== null && h !== null) {
                return this.normalize({ sx: w, sy: l, sz: h });
            }
        } catch (_) {}

        return null;
    }
}

SizeClipboard.init();


    // ------------------------------------------
    // File: src/core/hotkeys.js
    // ------------------------------------------

/* Z: xoay cả box trái 90° quanh tâm, trục Z của point cloud.
 * Q/W: xoay cả box trái/phải 2° quanh tâm, trục Z của point cloud.
 * E/R: xoay trái/phải 2° trong mặt Side, quanh trục Y cục bộ của box.
 * ←/→: tiến/lùi 4 cm theo hướng box trên mặt ngang. ↑/↓: nâng/hạ 4 cm.
 * Numpad 1/2: qua phải/trái 4 cm. Numpad 4/5: nghiêng ngang phải/trái 3°.
 * Shift+←/→, ↑/↓, Numpad 1/2: nới/thu đúng một mặt 6 cm, giữ mặt đối diện.
 * X: đổi hướng trái 90° quanh trục Z cục bộ + đổi Dài/Rộng,
 *    giữ nguyên vùng không gian mà box chiếm.
 * 1/2/3/4: kích thước sedan / SUV / xe máy / người đi bộ.
 * G: đồng bộ kích thước cho các keyframe cùng track trong job.
 * Shift+G: khôi phục kích thước trước lần đồng bộ gần nhất.
 * P: bật/tắt Outside toàn track trong job, chọn box hoặc ID trên bảng.
 * Shift+P: khôi phục trạng thái Outside trước lần P gần nhất.
 * Alt+T: bố cục 3D trái, Top phải trên, Side/Front phải dưới; thu gọn bảng ID.
 */
function install3DHotkeys({ getInspectorTarget } = {}) {
    const config = {
        // Dài (X), Rộng (Y), Cao (Z); cùng đơn vị với point cloud.
        presets: {
            '1': { name: 'Sedan', size: [4.5, 1.85, 1.5] },
            '2': { name: 'SUV', size: [4.7, 1.95, 1.65] },
            '3': { name: 'Xe máy', size: [1.85, 0.8, 1.5] },
            '4': { name: 'Người đi bộ', size: [0.6, 0.6, 1.7] },
        },
        leftSign: 1, // Chiều trái nhìn từ +Z xuống XY. Đổi thành -1 nếu cần đảo chiều.
        moveStep: 0.04, // Cùng đơn vị point cloud: 0.04 m = 4 cm.
        resizeStep: 0.06, // Mặt được chỉnh dịch 6 cm, mặt đối diện đứng yên.
    };

    const resizeAxes = {
        forward: { index: 6, face: 1, sign: 1, label: 'Shift+←: nới mặt phía ←' },
        backward: { index: 6, face: -1, sign: -1, label: 'Shift+→: thu mặt phía →' },
        up: { index: 8, face: 1, sign: 1, label: 'Shift+↑: nới mặt trên' },
        down: { index: 8, face: -1, sign: -1, label: 'Shift+↓: thu mặt dưới' },
        right: { index: 7, face: -1, sign: 1, label: 'Shift+Numpad 1: nới mặt phải' },
        left: { index: 7, face: 1, sign: -1, label: 'Shift+Numpad 2: thu mặt trái' },
    };

    const findCanvas = () => [...document.querySelectorAll('canvas')].find(
        (canvas) => typeof canvas.getDrawnObjects === 'function' &&
            typeof canvas.updatePosition === 'function',
    );
    if (!findCanvas() && typeof getInspectorTarget !== 'function') {
        console.error('[CVAT 3D] Hãy mở job 3D và đợi point cloud tải xong. ' +
            'Nếu vẫn lỗi, bản CVAT này không cung cấp getDrawnObjects/updatePosition.');
        return;
    }
    window.CVAT3DHotkeys?.dispose?.();

    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    const queue = [];
    const pointers = new Set();
    let running = false;
    let stopped = false;
    let timer;
    let notice;
    let lastSync = null;
    let lastOutside = null;

    function report(message, error = false) {
        if (stopped) return;
        (error ? console.warn : console.info)(`[CVAT 3D] ${message}`);
        if (!notice) {
            notice = document.createElement('div');
            notice.style.cssText = 'position:fixed;bottom:22px;left:22px;z-index:2147483647;' +
                'padding:10px 14px;border-radius:6px;color:white;font:14px sans-serif;' +
                'pointer-events:none;max-width:520px;white-space:pre-wrap';
            document.body.appendChild(notice);
        }
        notice.textContent = message;
        notice.style.background = error ? '#982c27' : '#203b50';
        notice.style.display = 'block';
        clearTimeout(timer);
        timer = setTimeout(() => { notice.style.display = 'none'; }, 3000);
    }

    function selectedObjects(canvas) {
        return canvas.getDrawnObjects().filter(({ cuboid, state }) =>
            state && cuboid?.top?.visible === true && cuboid?.perspective?.visible === true);
    }

    function selected(canvas) {
        const objects = selectedObjects(canvas);
        if (objects.length !== 1) throw new Error('Hãy chọn đúng một box 3D trước.');
        const object = objects[0];
        const { state } = object;
        assertEditableState(state);
        return object;
    }

    function assertEditableState(state) {
        if (!state) throw new Error('Không đọc được box của frame này trong CVAT.');
        if (state.lock || state.isGroundTruth || state.hidden || state.outside) {
            throw new Error('Box đang khóa, bị ẩn hoặc không thể chỉnh sửa.');
        }
        if (state.shapeType !== 'cuboid' || !Array.isArray(state.points) ||
            state.points.length < 9 || !state.points.slice(0, 9).every(Number.isFinite) ||
            !state.points.slice(6, 9).every((value) => value > 0)) {
            throw new Error('Dữ liệu box không đúng định dạng cuboid 3D.');
        }
    }

    function samePoints(actual, expected) {
        return actual?.length === expected.length && expected.every(
            (value, index) => Math.abs(actual[index] - value) < 1e-7,
        );
    }

    function validPoints(points) {
        return Array.isArray(points) && points.length >= 9 &&
            points.slice(0, 9).every(Number.isFinite) && points.slice(6, 9).every((value) => value > 0);
    }

    function findStore(canvas, state) {
        const visited = new Set();
        for (let node = canvas; node; node = node.parentElement) {
            const keys = Object.getOwnPropertyNames(node).filter((key) =>
                key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
            for (const key of keys) {
                const pending = [node[key]];
                while (pending.length && visited.size < 4000) {
                    const fiber = pending.pop();
                    if (!fiber || visited.has(fiber)) continue;
                    visited.add(fiber);
                    for (const candidate of [fiber.memoizedProps?.value?.store, fiber.memoizedProps?.store]) {
                        if (typeof candidate?.getState !== 'function' || typeof candidate?.dispatch !== 'function') continue;
                        const annotation = candidate.getState()?.annotation;
                        if (annotation?.job?.instance && Number.isInteger(annotation.player?.frame?.number) &&
                            Array.isArray(annotation.annotations?.states) && (!state ||
                                (annotation.player.frame.number === state.frame &&
                                    annotation.annotations.states.some((entry) => entry.clientID === state.clientID &&
                                        entry.frame === state.frame && entry.objectType === 'track')))) return candidate;
                    }
                    pending.push(fiber.return, fiber.alternate);
                }
            }
        }
        throw new Error('Không đọc được job CVAT từ trang này; các phím chỉnh box vẫn dùng được.');
    }

    function syncContext(item, state) {
        if (state.objectType !== 'track') {
            throw new Error(`${item.key.toUpperCase()} cần box thuộc Track. Các box Shape riêng lẻ chưa có liên kết giữa frame.`);
        }
        return jobContext(item, item.inspector ? item.inspector.store : findStore(item.canvas, state));
    }

    function jobContext(item, store) {
        if (typeof store?.getState !== 'function') throw new Error('Chưa kết nối được dữ liệu job CVAT.');
        const annotation = store.getState().annotation;
        const job = annotation.job.instance;
        if (annotation.workspace === 'review' || typeof job.annotations?.get !== 'function' ||
            typeof job.actions?.get !== 'function' || !Number.isInteger(job.startFrame) ||
            !Number.isInteger(job.stopFrame)) throw new Error('Job này không hỗ trợ thao tác toàn track.');
        return { store, job, item };
    }

    function gridLayout(root) {
        const visited = new Set();
        const pending = Object.getOwnPropertyNames(root)
            .filter((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
            .map((key) => root[key]);
        while (pending.length && visited.size < 4000) {
            const fiber = pending.pop();
            if (!fiber || visited.has(fiber)) continue;
            visited.add(fiber);
            // ReactGridLayout là class: stateNode.props là props hiện tại ngay cả khi DOM fiber cũ.
            const props = fiber.stateNode?.props || fiber.memoizedProps;
            if (typeof props?.onLayoutChange === 'function' && Array.isArray(props.layout) &&
                String(props.className || '').split(/\s+/).includes('cvat-canvas-grid-root')) return props;
            pending.push(fiber.alternate, fiber.return);
        }
        throw new Error('Không đọc được bộ bố cục CVAT; Alt+T chưa hỗ trợ phiên bản này.');
    }

    async function arrangeLayout(item) {
        const roots = [...document.querySelectorAll('.cvat-canvas-grid-root')];
        if (roots.length !== 1 || !roots[0].isConnected) {
            throw new Error('Hãy mở giao diện Standard 3D trước khi nhấn Alt+T.');
        }
        const root = roots[0];
        const props = gridLayout(root);
        const viewIDs = ['canvas3D', 'canvas3DTop', 'canvas3DSide', 'canvas3DFront'];
        if (props.layout.length !== 4 || viewIDs.some((id) =>
            props.layout.filter((entry) => entry.i === id).length !== 1)) {
            throw new Error('Alt+T cần đủ 4 khung 3D, Top, Side, Front; hãy đóng ảnh context nếu đang mở.');
        }
        const { cols, maxRows: rows } = props;
        if (!Number.isInteger(cols) || cols < 6 || !Number.isInteger(rows) || rows < 4) {
            throw new Error('Kích thước lưới CVAT chưa hỗ trợ bố cục Alt+T.');
        }
        const store = findStore(item.canvas);
        const job = store.getState().annotation.job.instance;
        const frame = store.getState().annotation.player.frame.number;
        if (typeof store.getState().annotation.sidebarCollapsed !== 'boolean') {
            throw new Error('Không đọc được trạng thái bảng ID để chuyển bố cục Alt+T.');
        }
        const fullscreen = [...root.querySelectorAll(
            '.cvat-canvas-grid-fullscreen-item .cvat-grid-item-fullscreen-handler',
        )];
        if (fullscreen.length > 1 || fullscreen.some((handler) => typeof handler.click !== 'function')) {
            throw new Error('Không thoát được khung phóng to; hãy thu nhỏ khung trước khi nhấn Alt+T.');
        }
        const left = Math.round(cols * 5 / 12);
        const right = cols - left;
        const top = Math.round(rows * 5 / 12);
        const side = Math.round(right * 4 / 7);
        const positions = {
            canvas3D: { x: 0, y: 0, w: left, h: rows },
            canvas3DTop: { x: left, y: 0, w: right, h: top },
            canvas3DSide: { x: left, y: top, w: side, h: rows - top },
            canvas3DFront: { x: left + side, y: top, w: right - side, h: rows - top },
        };
        const layout = props.layout.map((entry) => ({ ...entry, ...positions[entry.i] }));
        // Gọi đúng callback CVAT dùng khi kéo/resize khung, giữ thứ tự và metadata của từng view.
        props.onLayoutChange(layout);
        fullscreen[0]?.click();
        const deadline = Date.now() + 2000;
        while (!stopped) {
            const annotation = store.getState()?.annotation;
            if (!root.isConnected || !item.canvas.isConnected || location.href !== item.url ||
                annotation?.job?.instance !== job || annotation.player?.frame?.number !== frame || pointers.size) {
                throw new Error('Đã đổi job/frame hoặc đang kéo chuột; đã dừng chuyển bố cục.');
            }
            const current = gridLayout(root).layout;
            if (current.length === layout.length && layout.every((expected) => {
                const actual = current.find((entry) => entry.i === expected.i);
                return actual && ['x', 'y', 'w', 'h'].every((key) => actual[key] === expected[key]);
            }) && !root.querySelectorAll('.cvat-canvas-grid-fullscreen-item').length) {
                // Chỉ thu gọn nếu đang mở; Alt+T lần nữa vẫn giữ đúng bố cục trong ảnh.
                if (annotation.sidebarCollapsed === false) {
                    store.dispatch({ type: 'COLLAPSE_SIDEBAR', payload: {} });
                }
                if (store.getState().annotation.sidebarCollapsed !== true) {
                    throw new Error('Đã sắp xếp khung nhưng chưa thu gọn được bảng ID.');
                }
                window.dispatchEvent(new Event('resize'));
                report('Alt+T: 3D bên trái; Top trên phải; Side/Front dưới phải; đã thu gọn bảng ID.');
                return;
            }
            if (Date.now() > deadline) throw new Error('Chưa xác nhận được bố cục Alt+T; kiểm tra các khung CVAT.');
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    function assertSyncContext(context) {
        const { store, job, item } = context;
        const annotation = store.getState()?.annotation;
        const connected = item.inspector ? item.inspector.isCurrent() : item.canvas?.isConnected;
        if (stopped || !connected || location.href !== item.url ||
            annotation?.job?.instance !== job || annotation.player?.frame?.number !== (item.playerFrame ?? item.frame) ||
            pointers.size || annotation.workspace === 'review') {
            throw new Error('Đã đổi job/frame, tắt script hoặc đang kéo chuột; đã dừng đồng bộ.');
        }
        // The panel's frame/track is the selection, even when CVAT's main box is deselected.
        if (item.inspector) return;
        // Outside làm box biến mất và CVAT có thể bỏ chọn nó ngay sau save.
        if (context.allowNoSelection) {
            if (!item.restore) {
                const selection = annotation.annotations;
                const ids = selection.selectedStatesID || [];
                const activeID = ids.length === 1 ? ids[0] : selection.activatedStateID;
                if (ids.length > 1 || (Number.isInteger(activeID) && activeID !== item.id)) {
                    throw new Error('Đã đổi ID đang chọn; đã dừng Outside.');
                }
            }
            return;
        }
        const current = selected(item.canvas).state;
        if (current.clientID !== item.id || current.frame !== item.frame) {
            throw new Error('Đã đổi box; đã dừng đồng bộ.');
        }
    }

    async function trackAt(context, frame) {
        assertSyncContext(context);
        const states = await context.job.annotations.get(frame, true, []);
        assertSyncContext(context);
        const matches = states.filter((entry) => entry.clientID === context.item.id && entry.objectType === 'track');
        const state = matches[0];
        if (matches.length !== 1 || state.frame !== frame || state.shapeType !== 'cuboid' ||
            state.keyframe !== true || state.lock || state.isGroundTruth || !validPoints(state.points) ||
            typeof state.save !== 'function') {
            throw new Error(`Không thể đọc/chỉnh keyframe ${frame}; chưa thể đồng bộ toàn track.`);
        }
        return state;
    }

    async function refreshTrack(context) {
        assertSyncContext(context);
        const frame = context.item.playerFrame ?? context.item.frame;
        const fresh = (await context.job.annotations.get(frame, true, [])).find(
            (entry) => entry.clientID === context.item.id && entry.objectType === 'track',
        );
        const history = await context.job.actions.get();
        assertSyncContext(context);
        if ((!fresh && !context.item.inspector) || (fresh && fresh.frame !== frame)) {
            throw new Error('Không đọc lại được box hiện tại.');
        }
        // Chỉ gửi trạng thái ở frame đang mở: reducer ghép theo clientID, không theo frame.
        context.store.dispatch({ type: 'UPDATE_ANNOTATIONS_SUCCESS', payload: { states: fresh ? [fresh] : [], history } });
        await context.item.inspector?.refresh?.();
    }

    async function trackFrames(context, state) {
        if (typeof state.export !== 'function') throw new Error('Bản CVAT này chưa hỗ trợ đọc keyframe của track.');
        const exported = await state.export();
        assertSyncContext(context);
        if (!Array.isArray(exported?.shapes)) throw new Error('Không đọc được danh sách keyframe của track.');
        const frameNumbers = context.store.getState().annotation.job.frameNumbers;
        const included = Array.isArray(frameNumbers) && frameNumbers.length ? new Set(frameNumbers) : null;
        const frames = [...new Set(exported.shapes.map((shape) => shape.frame))]
            .filter((frame) => Number.isInteger(frame) && frame >= context.job.startFrame &&
                frame <= context.job.stopFrame && (!included || included.has(frame)))
            .sort((a, b) => a - b);
        if (!frames.length) throw new Error('Track không có keyframe trong job hiện tại.');
        return frames;
    }

    async function syncSize(item, state) {
        const context = syncContext(item, state);
        const restoring = item.restore;
        const sourceSize = [...state.points.slice(6, 9)];
        let records;
        if (restoring) {
            if (!lastSync || lastSync.job !== context.job || lastSync.id !== item.id) {
                throw new Error('Chưa có bản đồng bộ để khôi phục cho track này trong phiên hiện tại.');
            }
            records = lastSync.records;
        } else {
            const frames = await trackFrames(context, state);
            records = frames.map((frame) => ({ frame, after: [...sourceSize] }));
        }

        report(restoring ? 'Đang kiểm tra bản khôi phục…' : 'Đang kiểm tra keyframe trước khi đồng bộ…');
        const plan = [];
        let checked = 0;
        for (const record of records) {
            const target = await trackAt(context, record.frame);
            const size = target.points.slice(6, 9);
            if (restoring && !samePoints(size, record.after) && !samePoints(size, record.before)) {
                throw new Error(`Kích thước ở frame ${record.frame} đã đổi sau đồng bộ; dừng khôi phục để giữ thay đổi đó.`);
            }
            const desired = restoring ? record.before : record.after;
            if (!samePoints(size, desired)) plan.push({ frame: record.frame, before: [...size], after: [...desired] });
            checked += 1;
            if (checked % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!plan.length) return report(restoring ? 'Kích thước đã được khôi phục.' : 'Các keyframe đã cùng kích thước.');
        const backup = restoring ? lastSync : { job: context.job, id: item.id, records: [] };
        if (!restoring) lastSync = backup;
        let saved = 0;
        try {
            for (const record of plan) {
                const target = await trackAt(context, record.frame);
                if (!samePoints(target.points.slice(6, 9), record.before)) {
                    throw new Error(`Kích thước frame ${record.frame} vừa thay đổi; dừng để tránh ghi đè.`);
                }
                const points = [...target.points];
                points.splice(6, 3, ...record.after);
                if (!restoring) backup.records.push(record); // Kể cả save có lỗi sau khi đã đổi dữ liệu.
                target.points = points;
                await target.save();
                assertSyncContext(context);
                const verified = await trackAt(context, record.frame);
                if (!samePoints(verified.points.slice(6, 9), record.after)) {
                    throw new Error(`CVAT chưa áp dụng kích thước ở frame ${record.frame}.`);
                }
                saved += 1;
                if (saved % 25 === 0) {
                    report(`${restoring ? 'Khôi phục' : 'Đồng bộ'}: ${saved}/${plan.length} keyframe…`);
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            await refreshTrack(context);
            if (restoring) lastSync = null;
            report(restoring ? `Đã khôi phục ${saved} keyframe.` :
                `G: đã đồng bộ ${saved} keyframe cùng track. Shift+G để khôi phục; Save để lưu.`);
        } catch (error) {
            try { await refreshTrack(context); } catch (_) { /* Trang có thể đã đổi job/frame. */ }
            throw new Error(`${error.message} Đã cập nhật ${saved}/${plan.length} keyframe. ` +
                'Bản kích thước trước đồng bộ vẫn được giữ cho Shift+G.');
        }
    }

    function outsideRestoreItem(canvas) {
        if (!lastOutside) throw new Error('Chưa có thao tác P để khôi phục trong phiên hiện tại.');
        const annotation = lastOutside.store.getState()?.annotation;
        if (annotation?.job?.instance !== lastOutside.job) {
            throw new Error('Hãy quay lại job của lần P gần nhất để khôi phục.');
        }
        return { key: 'p', restore: true, canvas, id: lastOutside.id,
            store: lastOutside.store, job: lastOutside.job,
            frame: annotation.player.frame.number, url: location.href };
    }

    function outsideItem(canvas) {
        const store = findStore(canvas);
        const annotation = store.getState().annotation;
        const selection = annotation.annotations;
        const ids = selection.selectedStatesID || [];
        if (ids.length > 1) throw new Error('Hãy chọn đúng một ID trên bảng để dùng P.');
        const activeID = ids.length === 1 ? ids[0] : selection.activatedStateID;
        let state;
        let id;
        if (Number.isInteger(activeID)) {
            // Đọc ID đang chọn từ Redux: vẫn dùng được khi Outside không còn mesh, kể cả sau F5.
            id = activeID;
            state = selection.states.find((entry) => entry.clientID === id);
            if (!state) throw new Error('Không đọc được ID đang chọn; hãy chọn lại ID trên bảng.');
        } else if (selectedObjects(canvas).length) {
            state = selected(canvas).state;
            id = state.clientID;
        } else if (lastOutside?.job === annotation.job.instance && lastOutside.store === store) {
            id = lastOutside.id;
        } else {
            throw new Error('Hãy chọn một box hoặc một ID trên bảng để dùng P.');
        }
        if (state && (state.objectType !== 'track' || state.shapeType !== 'cuboid' ||
            state.lock || state.isGroundTruth || state.hidden)) {
            throw new Error('P cần ID của Track cuboid 3D không bị khóa hoặc ẩn.');
        }
        const item = { key: 'p', restore: false, canvas, id,
            frame: annotation.player.frame.number, url: location.href };
        const context = jobContext(item, store);
        return { ...item, store, job: context.job };
    }

    async function outsideTrack(item) {
        const restoring = item.restore;
        if (restoring && (!lastOutside || lastOutside.id !== item.id || lastOutside.job !== item.job)) {
            throw new Error('Không tìm thấy bản khôi phục Outside cho track này.');
        }
        const context = { store: item.store, job: item.job, item, allowNoSelection: true };
        assertSyncContext(context);
        let records;
        if (!restoring) {
            const matches = (await context.job.annotations.get(item.frame, true, [])).filter(
                (entry) => entry.clientID === item.id && entry.objectType === 'track',
            );
            assertSyncContext(context);
            const state = matches[0];
            if (matches.length !== 1 || state.frame !== item.frame || state.shapeType !== 'cuboid' ||
                state.lock || state.isGroundTruth || state.hidden || !validPoints(state.points)) {
                throw new Error('Không thể đọc/chỉnh ID đang chọn trong frame hiện tại.');
            }
            records = (await trackFrames(context, state)).map((frame) => ({ frame }));
        } else records = lastOutside.records;
        report(restoring ? 'Đang kiểm tra bản khôi phục Outside…' : 'Đang kiểm tra Outside của track…');
        const checkedRecords = [];
        for (const record of records) {
            const target = await trackAt(context, record.frame);
            if (typeof target.outside !== 'boolean') throw new Error(`Outside không hợp lệ ở frame ${record.frame}.`);
            checkedRecords.push({ ...record, current: target.outside, serverID: target.serverID });
            if (checkedRecords.length % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        // Quyết định từ dữ liệu hiện tại, không dựa vào bộ nhớ của lần P trước.
        const outside = !checkedRecords.every((record) => record.current);
        if (!restoring) {
            const frameNumbers = context.store.getState().annotation.job.frameNumbers;
            const included = Array.isArray(frameNumbers) ? frameNumbers.filter((frame) =>
                Number.isInteger(frame) && frame >= context.job.startFrame && frame <= context.job.stopFrame) : [];
            const firstFrame = included.length ? Math.min(...included) : context.job.startFrame;
            const firstState = (await context.job.annotations.get(firstFrame, true, [])).find(
                (entry) => entry.clientID === item.id && entry.objectType === 'track',
            );
            assertSyncContext(context);
            if (firstState && firstState.outside !== outside && !firstState.keyframe) {
                throw new Error(`Cần tạo keyframe ở đầu job (frame ${firstFrame}) trước khi P để bật/tắt đủ mọi frame.`);
            }
        }
        const plan = [];
        for (const record of checkedRecords) {
            const desired = restoring ? record.before : outside;
            if (record.current !== desired) plan.push({ frame: record.frame, before: record.current,
                after: desired, serverID: record.serverID });
        }
        if (!plan.length) {
            if (restoring) lastOutside = null;
            return report(restoring ? 'Outside đã được khôi phục.' : 'Track đã có trạng thái Outside yêu cầu.');
        }
        const backup = restoring ? lastOutside : { store: context.store, job: context.job, id: item.id, records: [] };
        if (!restoring) lastOutside = backup;
        let saved = 0;
        try {
            for (const record of plan) {
                const target = await trackAt(context, record.frame);
                if (target.outside !== record.before || target.serverID !== record.serverID) {
                    throw new Error(`Track ở frame ${record.frame} vừa thay đổi; đã dừng Outside.`);
                }
                if (!restoring) backup.records.push(record);
                // Chỉ thay cờ Outside; không delete, import hoặc tạo lại track/ID.
                target.outside = record.after;
                await target.save();
                const verified = await trackAt(context, record.frame);
                if (verified.outside !== record.after || verified.serverID !== record.serverID) {
                    throw new Error(`Chưa xác nhận được Outside/ID ở frame ${record.frame}.`);
                }
                saved += 1;
                if (saved % 25 === 0) {
                    report(`${restoring ? 'Khôi phục Outside' : outside ? 'Outside' : 'Hiện lại'}: ${saved}/${plan.length} keyframe…`);
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            await refreshTrack(context);
            if (restoring) lastOutside = null;
            report(restoring ? `Đã khôi phục Outside của track ID ${item.id}.` :
                `P: ${outside ? 'Outside' : 'Hiện lại'} ${records.length} keyframe; giữ ID ${item.id}. ` +
                'Nhấn P để đảo trạng thái; Save để lưu.');
        } catch (error) {
            try { await refreshTrack(context); } catch (_) { /* Trang có thể đã đổi job/frame. */ }
            throw new Error(`${error.message} Đã cập nhật ${saved}/${plan.length} keyframe. ` +
                'Bản Outside trước thao tác vẫn được giữ cho Shift+P.');
        }
    }

    async function apply(item) {
        if (stopped || location.href !== item.url || pointers.size) {
            throw new Error('Đã đổi trang hoặc đang kéo chuột; bỏ thao tác đang chờ.');
        }
        let state;
        let inspector;
        if (item.inspector) {
            const assertTarget = () => {
                const current = item.inspector.isCurrent?.() ? item.inspector : null;
                if (stopped || pointers.size || location.href !== item.url || !current ||
                    current.card !== item.inspector.card || current.job !== item.inspector.job ||
                    current.clientID !== item.id || current.frame !== item.frame || current.card.dragState) {
                    throw new Error('Đã đổi thẻ frame/track hoặc đang kéo box; bỏ phím đang chờ.');
                }
                return current;
            };
            inspector = assertTarget();
            if (item.key === 'p') return outsideTrack(item);
            state = await inspector.read();
            assertTarget();
            assertEditableState(state);
        } else {
            if (!item.canvas.isConnected || findCanvas() !== item.canvas) {
                throw new Error('Đã đổi canvas CVAT; bỏ thao tác đang chờ.');
            }
            if (item.key === 'layout') return arrangeLayout(item);
            if (item.key === 'p') return outsideTrack(item);
            state = selected(item.canvas).state;
        }
        if (state.clientID !== item.id || state.frame !== item.frame) {
            throw new Error('Đã đổi box hoặc frame; bỏ thao tác đang chờ.');
        }
        if (item.key === 'g') return syncSize(item, state);
        const points = [...state.points]; // Giữ cả các phần tử dự phòng sau index 8.
        const moves = {
            forward: '←: tiến', backward: '→: lùi', up: '↑: nâng', down: '↓: hạ',
            right: 'Numpad 1: qua phải', left: 'Numpad 2: qua trái',
        };
        let description;
        if (item.resize) {
            const axis = resizeAxes[item.key];
            const step = config.resizeStep;
            if (!Number.isFinite(step) || step <= 0) throw new Error('Bước đổi kích thước phải là số dương.');
            const size = points[axis.index] + axis.sign * step;
            if (!Number.isFinite(size) || size <= 1e-9) {
                throw new Error('Không thể giảm: kích thước box phải lớn hơn 0.');
            }
            // Dời tâm nửa bước theo trục cục bộ để chỉ mặt được chọn thay đổi.
            // Mặt đối diện giữ nguyên vị trí; không tịnh tiến cả box.
            const rotation = Math3D.eulerToRotationMatrix(...points.slice(3, 6));
            const column = axis.index - 6;
            const offset = axis.face * axis.sign * step / 2;
            for (let row = 0; row < 3; row++) points[row] += rotation[row * 3 + column] * offset;
            points[axis.index] = size;
            description = `${axis.label} ${Number((step * 100).toFixed(6))} cm; giữ mặt đối diện`;
        } else if (moves[item.key]) {
            const step = config.moveStep;
            if (!Number.isFinite(step) || step <= 0) throw new Error('Bước dịch box phải là số dương.');
            if (item.key === 'up' || item.key === 'down') {
                points[2] += item.key === 'up' ? step : -step;
            } else {
                // Cột X của ma trận Euler XYZ: đầu box (+X cục bộ), chiếu xuống mặt XY.
                const [rx, ry, rz] = points.slice(3, 6);
                const headingX = Math.cos(ry) * Math.cos(rz);
                const headingY = Math.cos(rx) * Math.sin(rz) + Math.sin(rx) * Math.sin(ry) * Math.cos(rz);
                const length = Math.hypot(headingX, headingY);
                if (length < 1e-6) throw new Error('Đầu box gần thẳng đứng; không xác định được hướng dịch trên mặt ngang.');
                const x = headingX / length;
                const y = headingY / length;
                const delta = { forward: [x, y], backward: [-x, -y], right: [y, -x], left: [-y, x] }[item.key];
                points[0] += delta[0] * step;
                points[1] += delta[1] * step;
            }
            description = `${moves[item.key]} ${Number((step * 100).toFixed(6))} cm`;
        } else if (config.presets[item.key]) {
            const preset = config.presets[item.key];
            if (!Array.isArray(preset.size) || preset.size.length !== 3 ||
                !preset.size.every((value) => Number.isFinite(value) && value > 0)) {
                throw new Error('Kích thước mẫu phải là ba số dương: Dài, Rộng, Cao.');
            }
            points.splice(6, 3, ...preset.size);
            description = `${preset.name}: ${preset.size.join(' × ')} (Dài × Rộng × Cao)`;
        } else {
            const sideRotation = item.key === 'e' || item.key === 'r';
            const rollRotation = item.key === 'roll_right' || item.key === 'roll_left';
            const degrees = ({ q: 2, w: -2, e: 2, r: -2, roll_right: 3, roll_left: -3 })[item.key] ?? 90;
            const angle = degrees * Math.PI / 180 * (config.leftSign < 0 ? -1 : 1);
            const rotation = Math3D.rotateEulerXYZ(points.slice(3, 6), rollRotation ? 0 : sideRotation ? 1 : 2,
                angle, item.key === 'x' || sideRotation || rollRotation);
            if (item.key === 'x') {
                [points[6], points[7]] = [points[7], points[6]];
                description = 'X: đổi hướng trái 90°; giữ nguyên vùng box';
            } else if (sideRotation) {
                const direction = item.key === 'e' ? 'trái' : 'phải';
                description = `${item.key.toUpperCase()}: xoay Side sang ${direction} 2°`;
            } else if (rollRotation) {
                description = item.key === 'roll_right' ? 'Numpad 4: nghiêng ngang sang phải 3°' :
                    'Numpad 5: nghiêng ngang sang trái 3°';
            } else {
                const direction = degrees < 0 ? 'phải' : 'trái';
                description = `${item.key.toUpperCase()}: xoay cả box ${direction} ${Math.abs(degrees)}°`;
            }
            points.splice(3, 3, ...rotation);
        }
        if (samePoints(state.points, points)) return report('Box đã có kích thước này.');

        if (inspector) {
            await inspector.update(points);
            return report(`Frame ${item.frame}: ${description}`);
        }

        // Đi qua canvas.edited của CVAT để cập nhật annotation và lịch sử Undo.
        // Không sửa trực tiếp mesh hoặc gọi REST API.
        item.canvas.updatePosition(state, points);
        const deadline = Date.now() + 5000;
        while (!stopped) {
            const current = item.canvas.getDrawnObjects().find(
                (entry) => entry.state?.clientID === item.id && entry.state.frame === item.frame,
            );
            if (samePoints(current?.data?.points, points) && samePoints(current?.state?.points, points)) {
                report(description);
                return;
            }
            if (!item.canvas.isConnected || location.href !== item.url || Date.now() > deadline) {
                throw new Error('Chưa xác nhận được cập nhật. Kiểm tra box và thông báo lỗi của CVAT.');
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    async function drain() {
        if (running) return;
        running = true;
        try {
            while (queue.length && !stopped) await apply(queue.shift());
        } catch (error) {
            queue.length = 0;
            report(error.message, true);
        } finally {
            running = false;
        }
    }

    function onKey(event) {
        const layoutShortcut = event.altKey && !event.shiftKey &&
            (event.code ? event.code === 'KeyT' : event.key?.toLowerCase() === 't');
        if (event.ctrlKey || event.metaKey || event.isComposing || (event.altKey && !layoutShortcut)) return;
        const target = event.composedPath()[0];
        if (target?.isContentEditable || target?.closest?.(
            'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"]',
        )) return;
        if ([...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.ant-modal,.ant-dropdown')]
            .some((element) => element.getClientRects().length)) return;
        const key = layoutShortcut ? 'layout' : ({ KeyZ: 'z', KeyX: 'x', KeyQ: 'q', KeyE: 'e', KeyW: 'w', KeyR: 'r',
            KeyG: 'g', KeyP: 'p',
            Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
            ArrowLeft: 'forward', ArrowRight: 'backward', ArrowUp: 'up', ArrowDown: 'down',
            Numpad1: 'right', Numpad2: 'left', Numpad3: '3', Numpad4: 'roll_right', Numpad5: 'roll_left',
        })[event.code || event.key] ||
            event.key?.toLowerCase();
        if (!['layout', 'z', 'x', 'q', 'e', 'w', 'r', 'g', 'p', '1', '2', '3', '4',
            'forward', 'backward', 'up', 'down', 'right', 'left', 'roll_right', 'roll_left'].includes(key) ||
            (event.shiftKey && !['g', 'p'].includes(key) && !resizeAxes[key])) return;
        const inspector = key !== 'layout' ? getInspectorTarget?.(event) : null;
        // Never fall through to CVAT's selection check for a key originating inside the panel.
        if (key !== 'layout' && !inspector && target?.closest?.('.cvat-qaqc-dock')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return report('Chưa có thẻ frame để chỉnh trong panel. Hãy nạp track vào Inspector.', true);
        }
        const canvas = inspector ? null : findCanvas();
        if (!canvas && !inspector) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat || pointers.size || stopped) return;
        try {
            if (queue.length >= 12) throw new Error('Đang xử lý nhiều phím; đợi box cập nhật.');
            if (inspector) {
                queue.push({ key, inspector, id: inspector.clientID, frame: inspector.frame,
                    job: inspector.job, store: inspector.store, restore: Boolean(event.shiftKey),
                    playerFrame: inspector.store?.getState()?.annotation?.player?.frame?.number,
                    resize: Boolean(event.shiftKey && resizeAxes[key]), url: location.href });
            } else if (key === 'layout') queue.push({ key, canvas, url: location.href });
            else if (key === 'p') queue.push(event.shiftKey ? outsideRestoreItem(canvas) : outsideItem(canvas));
            else {
                const { state } = selected(canvas);
                queue.push({ key, restore: Boolean(event.shiftKey), resize: Boolean(event.shiftKey && resizeAxes[key]), canvas,
                    id: state.clientID, frame: state.frame, url: location.href });
            }
            void drain();
        } catch (error) {
            report(error.message, true);
        }
    }

    window.addEventListener('keydown', onKey, options);
    window.addEventListener('pointerdown', (event) => pointers.add(event.pointerId), options);
    window.addEventListener('pointerup', (event) => pointers.delete(event.pointerId), options);
    window.addEventListener('pointercancel', (event) => pointers.delete(event.pointerId), options);
    window.addEventListener('blur', () => { pointers.clear(); queue.length = 0; }, options);

    window.CVAT3DHotkeys = {
        config,
        get active() { return !stopped; },
        dispose() {
            stopped = true;
            queue.length = 0;
            controller.abort();
            clearTimeout(timer);
            notice?.remove();
            console.info('[CVAT 3D] Đã tắt phím tắt.');
        },
    };
    report('Đã bật: Alt+T bố cục | Mũi tên/Num1/2 dịch 4 cm; +Shift nới/thu một mặt 6 cm | Q/W xoay ngang; E/R xoay Side | Num4/5 nghiêng 3° | Z/X xoay 90° | G/P cả track; Shift+G/P khôi phục | 1–4 mẫu');
}


    // ------------------------------------------
    // File: src/core/hotkeys_autostart.js
    // ------------------------------------------

function start3DHotkeysAutostart({ getInspectorTarget } = {}) {
    const install = () => install3DHotkeys({ getInspectorTarget });
    window.CVAT3DHotkeysInstall = install;

    window.CVAT3DHotkeysAutostart?.dispose?.();
    const controller = new AbortController();
    let active = true;
    let installedCanvas = null;
    let installedController = null;
    let debounce;

    function readyCanvas() {
        return [...document.querySelectorAll('canvas')].find((canvas) =>
            typeof canvas.getDrawnObjects === 'function' && typeof canvas.updatePosition === 'function');
    }

    function check() {
        if (!active) return;
        const canvas = readyCanvas();
        if (window.CVAT3DHotkeys?.active && window.CVAT3DHotkeys === installedController) {
            // Inspector targets resolve dynamically and do not require CVAT's patched canvases.
            if (typeof getInspectorTarget === 'function') return;
            if (!installedCanvas && canvas) installedCanvas = canvas;
            if (canvas === installedCanvas && canvas?.isConnected) return;
            window.CVAT3DHotkeys.dispose();
            installedCanvas = null;
            installedController = null;
        }
        if (!canvas && typeof getInspectorTarget !== 'function') return;
        try {
            install();
            if (window.CVAT3DHotkeys?.active) {
                installedCanvas = canvas;
                installedController = window.CVAT3DHotkeys;
            }
        } catch (error) {
            console.warn('[CVAT 3D extension] Chưa khởi động được phím tắt:', error);
        }
    }

    function schedule() {
        clearTimeout(debounce);
        debounce = setTimeout(check, 120);
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // CVAT may attach JavaScript properties after a canvas is inserted without
    // causing another DOM mutation. This inexpensive fallback also covers SPA history.
    const poll = setInterval(check, 1500);
    window.addEventListener('popstate', schedule, { signal: controller.signal });
    window.addEventListener('hashchange', schedule, { signal: controller.signal });
    window.addEventListener('pageshow', schedule, { signal: controller.signal });
    window.CVAT3DHotkeysAutostart = {
        get active() { return active; },
        dispose() {
            if (!active) return;
            active = false;
            observer.disconnect();
            controller.abort();
            clearTimeout(debounce);
            clearInterval(poll);
        },
    };
    check();
}


    // ------------------------------------------
    // File: src/ui/frame_card.js
    // ------------------------------------------

/**
 * Frame Card Component for Multi-frame QA/QC
 * Renders Top, Side, Front views in the exact convention and order of CVAT.
 * Compact display allowing multiple frames to be visible simultaneously.
 */
class FrameCard {
    /**
     * @param {Object} data - { frame, points, box, keyframe, outside, label }
     * @param {Function} onSelectFrame - callback when clicked to jump
     * @param {Function} [onUpdateCuboid] - callback when user edits cuboid (frame, newPoints, newBox)
     * @param {Function} [onPasteSizeToAll] - callback when user chooses to paste size to all frames
     * @param {Function} [onToggleOutside] - callback when outside is toggled (frame, outside)
     * @param {Function} [onHover] - callback when mouse enters/leaves card (frame, isHovered)
     * @param {Object} [options] - additional configuration options (e.g. viewOrder)
     */
    constructor(data, onSelectFrame, onUpdateCuboid, onPasteSizeToAll, onToggleOutside, onHover, options = {}) {
        this.data = data;
        this.frame = data.frame;
        this.onSelectFrame = onSelectFrame;
        this.onUpdateCuboid = onUpdateCuboid;
        this.onPasteSizeToAll = onPasteSizeToAll;
        this.onToggleOutside = onToggleOutside;
        this.onHover = onHover;
        this.options = options || {};

        // Camera order: fixed default 'top,side,front'
        this.viewOrder = Array.isArray(this.options.viewOrder) && this.options.viewOrder.length === 3
            ? [...this.options.viewOrder]
            : ['top', 'side', 'front'];

        // Keep deep copy of original state for reset capability
        this.originalBox = { ...(data.box || {}) };
        this.originalPoints = Array.isArray(data.points) ? [...data.points] : [];

        this.canvases = {};
        this.cells = {};
        this.lastPointCloudData = null;
        this.lastRenderOptions = null;
        this.isCurrent = false;

        this.valDisplays = {};
        this.angleDisplays = {};
        this.dragState = null;
        this.hoverState = null;
        this.rafPending = false;

        // Per-frame localized Undo / Redo history stack
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 30;
        this.undoBtn = null;
        this.redoBtn = null;

        this.dom = this.createDOM();
    }

    createDOM() {
        const card = document.createElement('div');
        card.className = 'cvat-qaqc-card';
        card.dataset.frame = String(this.frame);
        card.tabIndex = 0;
        const activate = () => this.options.onActivate?.(this.frame);
        card.addEventListener('pointerdown', (event) => {
            activate();
            if (!event.target.closest('button,input,textarea,select,canvas,[contenteditable="true"]')) {
                card.focus({ preventScroll: true });
            }
        }, true);
        card.addEventListener('focusin', activate);

        card.addEventListener('mouseenter', () => {
            if (typeof this.onHover === 'function') {
                this.onHover(this.frame, true);
            }
        });
        card.addEventListener('mouseleave', () => {
            if (typeof this.onHover === 'function') {
                this.onHover(this.frame, false);
            }
        });

        // 1. Header Bar (Compact 24px)
        const header = document.createElement('div');
        header.className = 'cvat-qaqc-card-header';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'cvat-qaqc-card-left-group';

        const title = document.createElement('div');
        title.className = 'cvat-qaqc-card-title';
        const frameSpan = document.createElement('span');
        frameSpan.textContent = `Frame ${this.frame}`;
        title.appendChild(frameSpan);

        const kfBadge = document.createElement('span');
        kfBadge.className = 'cvat-qaqc-keyframe-badge';
        kfBadge.textContent = 'Keyframe';
        kfBadge.style.display = this.data.keyframe ? 'inline-block' : 'none';
        this.kfBadge = kfBadge;
        title.appendChild(kfBadge);

        const currentBadge = document.createElement('span');
        currentBadge.className = 'cvat-qaqc-current-badge';
        currentBadge.style.display = 'none';
        currentBadge.textContent = 'Active';
        this.currentBadge = currentBadge;

        // Outside Indicator Badge
        const outsideBadge = document.createElement('span');
        outsideBadge.className = 'cvat-qaqc-outside-badge';
        outsideBadge.textContent = 'Outside';
        outsideBadge.title = 'Box trên frame này đang bị Outside (không hiển thị box). Bấm để chuyển về Inside (Phím tắt: O)';
        outsideBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleOutside();
        });
        this.outsideBadge = outsideBadge;

        // Angle & Dimension Badges
        const yawBadge = document.createElement('span');
        yawBadge.className = 'cvat-qaqc-yaw-badge';
        this.yawBadge = yawBadge;

        const dimBadge = document.createElement('span');
        dimBadge.className = 'cvat-qaqc-dim-badge';
        this.dimBadge = dimBadge;

        this.updateHeaderBadges();

        leftGroup.appendChild(title);
        leftGroup.appendChild(currentBadge);
        leftGroup.appendChild(outsideBadge);
        leftGroup.appendChild(yawBadge);
        leftGroup.appendChild(dimBadge);

        // Header Actions (Right Group)
        const rightGroup = document.createElement('div');
        rightGroup.className = 'cvat-qaqc-card-right-group';

        // Local Per-Frame Undo / Redo Group
        const historyGroup = document.createElement('div');
        historyGroup.className = 'cvat-qaqc-history-group';

        const undoBtn = document.createElement('button');
        undoBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-undo-btn';
        undoBtn.textContent = '↶';
        undoBtn.title = `Hoàn tác (Undo) frame ${this.frame} (Ctrl+Z)`;
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.undo();
        });
        this.undoBtn = undoBtn;

        const redoBtn = document.createElement('button');
        redoBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-redo-btn';
        redoBtn.textContent = '↷';
        redoBtn.title = `Làm lại (Redo) frame ${this.frame} (Ctrl+Y)`;
        redoBtn.disabled = true;
        redoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.redo();
        });
        this.redoBtn = redoBtn;

        historyGroup.appendChild(undoBtn);
        historyGroup.appendChild(redoBtn);

        // Outside Toggle Button
        const outsideBtn = document.createElement('button');
        outsideBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-outside-toggle-btn';
        outsideBtn.textContent = this.data.outside ? '⚡ Đặt Inside' : '🚫 Outside';
        outsideBtn.title = 'Bật/tắt trạng thái Outside cho box trên frame này (Phím tắt: O)';
        outsideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleOutside();
        });
        this.outsideBtn = outsideBtn;

        // Copy Size Button (Compact)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-copy-size-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.title = `Sao chép kích thước (${this.data.box?.sx} × ${this.data.box?.sy} × ${this.data.box?.sz}m) vào clipboard`;
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleCopySize(copyBtn);
        });

        // Paste Size Button (Compact)
        const pasteBtn = document.createElement('button');
        pasteBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-paste-size-btn';
        pasteBtn.textContent = '📄 Dán';
        pasteBtn.title = 'Dán kích thước từ clipboard vào cuboid trên frame này (Realtime)';
        pasteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handlePasteSize(pasteBtn);
        });

        // Fix / Apply to All Frames Button (Compact)
        const fixAllBtn = document.createElement('button');
        fixAllBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-apply-all-btn';
        fixAllBtn.textContent = '⚡ Cố định All';
        fixAllBtn.title = 'Cố định kích thước của frame này cho TẤT CẢ các frame của track (Realtime)';
        fixAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handlePasteSizeToAll(fixAllBtn);
        });

        // Jump Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-jump-btn';
        jumpBtn.textContent = '↗ Nhảy / Jump';
        jumpBtn.title = `Chuyển vùng nhìn CVAT đến Frame ${this.frame}`;
        jumpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.triggerJump();
        });

        rightGroup.appendChild(historyGroup);
        rightGroup.appendChild(outsideBtn);
        rightGroup.appendChild(copyBtn);
        rightGroup.appendChild(pasteBtn);
        rightGroup.appendChild(fixAllBtn);
        rightGroup.appendChild(jumpBtn);

        header.appendChild(leftGroup);
        header.appendChild(rightGroup);

        header.addEventListener('click', () => {
            this.triggerJump();
        });

        // 2. Views Grid: Configurable order (default: Top, Front, Side)
        const grid = document.createElement('div');
        grid.className = 'cvat-qaqc-views-grid';
        this.grid = grid;

        const viewDefinitions = {
            top: { id: 'top', label: 'Top' },
            front: { id: 'front', label: 'Front' },
            side: { id: 'side', label: 'Side' }
        };

        const activeOrder = Array.isArray(this.viewOrder) && this.viewOrder.length === 3
            ? this.viewOrder
            : ['top', 'side', 'front'];

        for (const viewType of activeOrder) {
            const def = viewDefinitions[viewType] || { id: viewType, label: viewType.toUpperCase() };
            const label = def.label;
            const cell = document.createElement('div');
            cell.className = `cvat-qaqc-view-cell cell-${viewType}`;
            this.cells[viewType] = cell;

            // CVAT-style Header Strip for each view with integrated rotation buttons
            const cellHeader = document.createElement('div');
            cellHeader.className = 'cvat-qaqc-cell-header';

            const cellTitle = document.createElement('div');
            cellTitle.className = 'cvat-qaqc-cell-title';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'cvat-qaqc-cell-name';
            nameSpan.textContent = label;

            const angleSpan = document.createElement('span');
            angleSpan.className = 'cvat-qaqc-cell-angle';
            this.angleDisplays[viewType] = angleSpan;

            cellTitle.appendChild(nameSpan);
            cellTitle.appendChild(angleSpan);

            // Rotate buttons for this specific view (Top: Yaw, Side: Pitch, Front: Roll)
            const rotGroup = this.createRotateGroup(viewType, (delta) => this.rotateView(viewType, delta));

            cellHeader.appendChild(cellTitle);
            cellHeader.appendChild(rotGroup);

            const canvas = document.createElement('canvas');
            canvas.tabIndex = 0;
            canvas.setAttribute('aria-label', `${viewType} — Frame ${this.frame}. Phím tắt chỉnh box đang trỏ hoặc focus.`);
            canvas.width = 220;
            canvas.height = 110;
            this.canvases[viewType] = canvas;

            this.setupCanvasInteractions(canvas, viewType);

            cell.appendChild(cellHeader);
            cell.appendChild(canvas);
            grid.appendChild(cell);
        }

        card.appendChild(header);
        card.appendChild(grid);

        return card;
    }

    /**
     * Reorder view cells without destroying DOM or canvases
     * @param {Array<string>} orderArray
     */
    setViewOrder(orderArray) {
        if (!this.grid || !this.cells || !Array.isArray(orderArray)) return;
        this.viewOrder = [...orderArray];
        for (const viewType of orderArray) {
            const cell = this.cells[viewType];
            if (cell) {
                this.grid.appendChild(cell);
            }
        }
    }

    /**
     * Rotate cuboid around its camera's local view axis
     * Top: Local Z (Yaw)
     * Front: Local X (Roll)
     * Side: Local Y (Pitch)
     * @param {'top'|'side'|'front'} viewType
     * @param {number} deltaRad - angle increment in radians
     */
    rotateView(viewType, deltaRad) {
        if (!this.data.box) return;

        this.pushUndoSnapshot(this.takeSnapshot());

        // Perform authentic 3D local-axis rotation matching Three.js / CVAT canvas3d
        const newAngles = Math3D.rotateLocal(this.data.box, viewType, deltaRad);
        this.data.box.rx = newAngles.rx;
        this.data.box.ry = newAngles.ry;
        this.data.box.rz = newAngles.rz;

        this.applyBoxChanges();
    }

    /**
     * Convenience method for rotating Yaw (around Z)
     * @param {number} deltaRad
     */
    rotateBy(deltaRad) {
        this.rotateView('top', deltaRad);
    }

    createRotateGroup(viewType = 'top', onRotate) {
        const group = document.createElement('div');
        group.className = 'cvat-qaqc-rot-group';
        const axisName = viewType === 'top' ? 'Yaw' : (viewType === 'front' ? 'Roll' : 'Pitch');
        group.title = `Xoay góc ${axisName}`;

        const isTop = viewType === 'top';
        const stepDeg = isTop ? 5 : 1;
        const stepRad = stepDeg * Math.PI / 180;

        const buttons = [
            { label: '↺ 90°', delta: -Math.PI / 2, title: `Xoay -90° (${axisName})` },
            { label: `↺ ${stepDeg}°`, delta: -stepRad, title: `Xoay -${stepDeg}° (${axisName})` },
            { label: `↻ ${stepDeg}°`, delta: stepRad,  title: `Xoay +${stepDeg}° (${axisName})` },
            { label: '↻ 90°', delta: Math.PI / 2,  title: `Xoay +90° (${axisName})` }
        ];

        buttons.forEach(({ label, delta, title }) => {
            const btn = document.createElement('button');
            btn.className = 'cvat-qaqc-rot-btn';
            btn.textContent = label;
            btn.title = title;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onRotate(delta);
            });
            group.appendChild(btn);
        });

        return group;
    }

    /**
     * Capture immutable snapshot of current state for localized undo/redo
     */
    takeSnapshot() {
        return {
            box: { ...(this.data.box || {}) },
            points: Array.isArray(this.data.points) ? [...this.data.points] : [],
            outside: !!this.data.outside,
            keyframe: !!this.data.keyframe
        };
    }

    /**
     * Push snapshot into card's local undo stack and clear redo stack
     * @param {Object} snap
     */
    pushUndoSnapshot(snap) {
        if (!snap) return;
        this.undoStack.push(snap);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = []; // New user edit invalidates redo stack
        this.updateUndoRedoButtons();
    }

    /**
     * Update state and tooltip text of Undo / Redo buttons
     */
    updateUndoRedoButtons() {
        if (this.undoBtn) {
            this.undoBtn.disabled = this.undoStack.length === 0;
            this.undoBtn.title = this.undoStack.length > 0
                ? `Hoàn tác (Undo) frame ${this.frame} (${this.undoStack.length} bước - Ctrl+Z)`
                : `Không có thao tác nào để hoàn tác trên frame ${this.frame}`;
        }
        if (this.redoBtn) {
            this.redoBtn.disabled = this.redoStack.length === 0;
            this.redoBtn.title = this.redoStack.length > 0
                ? `Làm lại (Redo) frame ${this.frame} (${this.redoStack.length} bước - Ctrl+Y)`
                : `Không có thao tác nào để làm lại trên frame ${this.frame}`;
        }
    }

    /**
     * Restore previous state on this specific frame
     * @returns {boolean}
     */
    undo() {
        if (this.undoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const prevSnap = this.undoStack.pop();
        this.redoStack.push(currentSnap);
        if (this.redoStack.length > this.maxHistory) {
            this.redoStack.shift();
        }

        this.restoreSnapshot(prevSnap);
        this.updateUndoRedoButtons();
        return true;
    }

    /**
     * Re-apply undone state on this specific frame
     * @returns {boolean}
     */
    redo() {
        if (this.redoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const nextSnap = this.redoStack.pop();
        this.undoStack.push(currentSnap);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }

        this.restoreSnapshot(nextSnap);
        this.updateUndoRedoButtons();
        return true;
    }

    /**
     * Apply snapshot back into this card and sync in-place to CVAT
     * @param {Object} snap
     */
    restoreSnapshot(snap) {
        if (!snap) return;
        this.data.box = { ...(snap.box || {}) };
        this.data.points = Array.isArray(snap.points) ? [...snap.points] : [];
        this.data.outside = !!snap.outside;
        this.data.keyframe = !!snap.keyframe;

        this.applyBoxChanges();

        if (typeof this.onToggleOutside === 'function') {
            this.onToggleOutside(this.frame, this.data.outside);
        }
    }

    applyBoxChanges() {
        this.data.points = TrackReader.boxToPoints(this.data.box, this.data.points);
        this.data.keyframe = true; // Editing an interpolated frame promotes it to a keyframe

        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        }

        this.updateHeaderBadges();

        if (typeof this.onUpdateCuboid === 'function') {
            this.onUpdateCuboid(this.frame, this.data.points, this.data.box);
        }
    }

    resetToOriginal() {
        this.pushUndoSnapshot(this.takeSnapshot());
        this.data.box = { ...this.originalBox };
        this.data.points = [...this.originalPoints];
        this.applyBoxChanges();
    }

    /**
     * Seamlessly update card data and views without rebuilding DOM
     * Used when an Undo, Redo, or external CVAT edit occurs
     * @param {Object} newData - { frame, points, box, keyframe, outside, label }
     */
    updateData(newData) {
        if (!newData) return;
        this.data = newData;
        this.frame = newData.frame;

        this.updateHeaderBadges();

        // Re-render views with existing point cloud data & options
        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        } else {
            this.renderViews(null, this.isCurrent, this.lastRenderOptions || {
                viewMode: 'all',
                zoom: 1.0,
                pointSize: 1.0
            });
        }
    }

    /**
     * Copy dimensions of this frame's cuboid into clipboard
     */
    handleCopySize(btn) {
        if (!this.data.box) return;
        const res = SizeClipboard.copy(this.data.box);
        if (!res) return;

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = `✓ ${res.sx}×${res.sy}×${res.sz}m`;
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1500);
        }
    }

    /**
     * Paste dimensions from clipboard into this frame's cuboid
     */
    async handlePasteSize(btn) {
        const size = await SizeClipboard.get();
        if (!size) {
            if (btn) {
                const origHTML = btn.innerHTML;
                btn.innerHTML = '⚠️ Chưa có size!';
                setTimeout(() => {
                    btn.innerHTML = origHTML;
                }, 1200);
            }
            return;
        }

        const success = this.pasteSize(size);
        if (success && btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = '✓ Đã Dán!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1200);
        }
    }

    /**
     * Apply dimensions to this frame's box in-memory (0 server requests)
     * @param {Object} sizeObj - { sx, sy, sz } or { w, l, h }
     */
    pasteSize(sizeObj) {
        if (!sizeObj) return false;
        const sx = Number(sizeObj.sx ?? sizeObj.w);
        const sy = Number(sizeObj.sy ?? sizeObj.l);
        const sz = Number(sizeObj.sz ?? sizeObj.h);

        if (isNaN(sx) || isNaN(sy) || isNaN(sz) || sx <= 0 || sy <= 0 || sz <= 0) {
            return false;
        }

        this.pushUndoSnapshot(this.takeSnapshot());

        if (!this.data.box) this.data.box = {};
        this.data.box.sx = parseFloat(sx.toFixed(3));
        this.data.box.sy = parseFloat(sy.toFixed(3));
        this.data.box.sz = parseFloat(sz.toFixed(3));

        this.applyBoxChanges();
        return true;
    }

    /**
     * Paste current frame dimensions to ALL loaded frames of this track
     */
    async handlePasteSizeToAll(btn) {
        if (!this.data.box) return;
        let size = SizeClipboard.copy(this.data.box);
        if (!size) size = await SizeClipboard.get();
        if (!size) return;

        if (typeof this.onPasteSizeToAll === 'function') {
            await this.onPasteSizeToAll(size);
        } else {
            this.pasteSize(size);
        }

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = '✓ Đã cố định All!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1500);
        }
    }

    /**
     * Toggle outside flag for this frame card
     */
    toggleOutside() {
        this.pushUndoSnapshot(this.takeSnapshot());
        this.data.outside = !this.data.outside;
        this.updateHeaderBadges();

        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        } else {
            this.renderViews(null, this.isCurrent, this.lastRenderOptions || {
                viewMode: 'all',
                zoom: 1.0,
                pointSize: 1.0
            });
        }

        if (typeof this.onToggleOutside === 'function') {
            this.onToggleOutside(this.frame, this.data.outside);
        }
    }

    updateHeaderBadges() {
        const { box } = this.data;
        if (!box) return;

        const isOutside = !!this.data.outside;

        if (this.kfBadge) {
            this.kfBadge.style.display = this.data.keyframe ? 'inline-block' : 'none';
        }

        if (this.outsideBadge) {
            this.outsideBadge.style.display = isOutside ? 'inline-block' : 'none';
        }

        if (this.outsideBtn) {
            this.outsideBtn.textContent = isOutside ? '⚡ Đặt Inside' : '🚫 Outside';
            if (isOutside) {
                this.outsideBtn.classList.add('active-outside');
            } else {
                this.outsideBtn.classList.remove('active-outside');
            }
        }

        if (this.dom) {
            if (isOutside) {
                this.dom.classList.add('is-outside');
            } else {
                this.dom.classList.remove('is-outside');
            }
        }

        const toDegStr = (rad) => {
            const deg = ((rad * 180 / Math.PI) % 360).toFixed(1);
            return `${deg >= 0 ? '+' : ''}${deg}°`;
        };

        if (this.yawBadge) {
            const rz = box.rz ?? 0;
            this.yawBadge.textContent = isOutside ? `Yaw: ${toDegStr(rz)} (Outside)` : `Yaw: ${toDegStr(rz)}`;
        }

        if (this.angleDisplays) {
            const localAngles = Math3D.getLocalAngles(box);
            if (this.angleDisplays.top) {
                this.angleDisplays.top.textContent = toDegStr(localAngles.yaw);
            }
            if (this.angleDisplays.side) {
                this.angleDisplays.side.textContent = toDegStr(localAngles.pitch);
            }
            if (this.angleDisplays.front) {
                this.angleDisplays.front.textContent = toDegStr(localAngles.roll);
            }
        }

        if (this.dimBadge) {
            const { sx = 2, sy = 4, sz = 1.5 } = box;
            this.dimBadge.textContent = isOutside
                ? `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}m [Outside]`
                : `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}m`;
        }
    }

    triggerJump() {
        this.dom.classList.add('jumping');
        setTimeout(() => this.dom.classList.remove('jumping'), 300);

        if (typeof this.onSelectFrame === 'function') {
            this.onSelectFrame(this.frame);
        }
    }

    /**
     * Set up smooth direct manipulation (rotate like CVAT, translate, 4-corner resize) on canvas
     * @param {HTMLCanvasElement} canvas
     * @param {'top'|'side'|'front'} viewType
     */
    setupCanvasInteractions(canvas, viewType) {
        canvas.style.touchAction = 'none';

        const OPPOSITE_CORNER = {
            tl: 'br',
            tr: 'bl',
            bl: 'tr',
            br: 'tl'
        };

        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        const detectActionAtPos = (pos, metrics) => {
            if (!this.data.box) return null;

            // 1. Heading rotation helper (Top view only - green circle dot on forward stem)
            if (viewType === 'top') {
                const distToDot = Math.hypot(pos.x - metrics.rotDotX, pos.y - metrics.rotDotY);
                if (distToDot <= 14) {
                    return { action: 'rotate', target: 'rotate' };
                }
            }

            // 2. CVAT 4 Red Corner Handles (strictly used for resizing, opposite vertex remains anchored)
            if (metrics.corners) {
                for (const [key, pt] of Object.entries(metrics.corners)) {
                    const dist = Math.hypot(pos.x - pt.x, pos.y - pt.y);
                    if (dist <= 14) {
                        return { action: 'resize-corner', cornerKey: key, target: `corner-${key}` };
                    }
                }
            }

            // 3. Inside box for translation (drag) - edges do NOT resize
            if (pos.x >= metrics.boxLeft && pos.x <= metrics.boxRight &&
                pos.y >= metrics.boxTop && pos.y <= metrics.boxBottom) {
                return { action: 'translate', target: 'box' };
            }

            return null;
        };

        canvas.addEventListener('pointerenter', () => {
            this.hoverState = { viewType, target: null };
        });

        canvas.addEventListener('pointerleave', () => {
            if (!this.dragState) {
                this.hoverState = null;
                canvas.style.cursor = 'default';
                this.requestRender();
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            const pos = getCanvasPos(e);
            const metrics = OrthoCanvasRenderer.getMetrics(canvas, this.data.box, viewType, this.lastRenderOptions);

            if (!this.dragState) {
                const hit = detectActionAtPos(pos, metrics);
                const target = hit?.target || null;
                const prevTarget = this.hoverState?.target;
                this.hoverState = { viewType, target, cornerKey: hit?.cornerKey || null };

                if (target === 'rotate') {
                    canvas.style.cursor = 'crosshair';
                } else if (target === 'corner-tl' || target === 'corner-br') {
                    canvas.style.cursor = 'nwse-resize';
                } else if (target === 'corner-tr' || target === 'corner-bl') {
                    canvas.style.cursor = 'nesw-resize';
                } else if (target === 'box') {
                    canvas.style.cursor = 'grab';
                } else {
                    canvas.style.cursor = 'default';
                }

                if (target !== prevTarget) {
                    this.requestRender();
                }
                return;
            }

            if (this.dragState.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            this.dragState.hasMoved = true;
            const { action } = this.dragState;

            if (action === 'rotate') {
                const currAngle = Math.atan2(this.dragState.initialMetrics.centerY - pos.y, pos.x - this.dragState.initialMetrics.centerX);
                let dAngle = currAngle - this.dragState.lastAngle;
                while (dAngle > Math.PI) dAngle -= Math.PI * 2;
                while (dAngle < -Math.PI) dAngle += Math.PI * 2;

                this.dragState.lastAngle = currAngle;
                let nextRz = (this.data.box.rz || 0) + dAngle;
                while (nextRz > Math.PI) nextRz -= Math.PI * 2;
                while (nextRz < -Math.PI) nextRz += Math.PI * 2;
                this.data.box.rz = parseFloat(nextRz.toFixed(4));
            } else if (action === 'translate') {
                const totalDxPx = pos.x - this.dragState.startX;
                const totalDyPx = pos.y - this.dragState.startY;
                this.dragState.translateOffsetPx = { dx: totalDxPx, dy: totalDyPx };
                this.dragState.lastX = pos.x;
                this.dragState.lastY = pos.y;

                const { initialBox, initialMetrics } = this.dragState;
                const scale = initialMetrics.scale;
                const d_h = totalDxPx / scale;
                const d_v = -totalDyPx / scale;
                const rz = initialBox.rz || 0;

                let d_lx = 0, d_ly = 0, d_lz = 0;
                if (viewType === 'top') {
                    d_lx = d_h;
                    d_ly = d_v;
                } else if (viewType === 'front') {
                    d_ly = d_h;
                    d_lz = d_v;
                } else if (viewType === 'side') {
                    d_lx = -d_h;
                    d_lz = d_v;
                }

                const d_wx = d_lx * Math.cos(rz) - d_ly * Math.sin(rz);
                const d_wy = d_lx * Math.sin(rz) + d_ly * Math.cos(rz);
                const d_wz = d_lz;

                this.data.box.x = parseFloat(((initialBox.x || 0) + d_wx).toFixed(3));
                this.data.box.y = parseFloat(((initialBox.y || 0) + d_wy).toFixed(3));
                this.data.box.z = parseFloat(((initialBox.z || 0) + d_wz).toFixed(3));
            } else if (action === 'resize-corner') {
                // Authentic CVAT 4-corner resizing with fixed opposite corner anchor
                const {
                    signU, signV, oppPxX, oppPxY,
                    initialBox, initialMetrics
                } = this.dragState;

                const scale = initialMetrics.scale;
                const minDimPx = 0.15 * scale; // Minimum 0.15m in pixels

                // In canvas pixel coordinates: clamp dragged corner so box never collapses
                let dragPxX = pos.x;
                let dragPxY = pos.y;

                if (signU > 0) {
                    dragPxX = Math.max(oppPxX + minDimPx, dragPxX);
                } else {
                    dragPxX = Math.min(oppPxX - minDimPx, dragPxX);
                }

                if (signV > 0) {
                    dragPxY = Math.min(oppPxY - minDimPx, dragPxY);
                } else {
                    dragPxY = Math.max(oppPxY + minDimPx, dragPxY);
                }

                const boxPxLeft = Math.min(oppPxX, dragPxX);
                const boxPxRight = Math.max(oppPxX, dragPxX);
                const boxPxTop = Math.min(oppPxY, dragPxY);
                const boxPxBottom = Math.max(oppPxY, dragPxY);
                const boxPxW = boxPxRight - boxPxLeft;
                const boxPxH = boxPxBottom - boxPxTop;

                // Pass screen pixel bounds to renderer so opposite anchor stays rock solid
                this.dragState.resizeBoxPx = {
                    left: boxPxLeft,
                    right: boxPxRight,
                    top: boxPxTop,
                    bottom: boxPxBottom,
                    width: boxPxW,
                    height: boxPxH
                };

                const newDimH = boxPxW / scale;
                const newDimV = boxPxH / scale;

                // Center displacement in local view frame
                const newPxCenterX = (boxPxLeft + boxPxRight) / 2;
                const newPxCenterY = (boxPxTop + boxPxBottom) / 2;
                const dxPx = newPxCenterX - initialMetrics.centerX;
                const dyPx = newPxCenterY - initialMetrics.centerY;
                const u_mid = dxPx / scale;
                const v_mid = -dyPx / scale;

                const rz0 = initialBox.rz || 0;
                let d_lx = 0, d_ly = 0, d_lz = 0;
                let nextSx = initialBox.sx || 2;
                let nextSy = initialBox.sy || 4;
                let nextSz = initialBox.sz || 1.5;

                if (viewType === 'top') {
                    d_lx = u_mid;
                    d_ly = v_mid;
                    nextSx = newDimH;
                    nextSy = newDimV;
                } else if (viewType === 'front') {
                    d_ly = u_mid;
                    d_lz = v_mid;
                    nextSy = newDimH;
                    nextSz = newDimV;
                } else if (viewType === 'side') {
                    d_lx = -u_mid;
                    d_lz = v_mid;
                    nextSx = newDimH;
                    nextSz = newDimV;
                }

                const d_wx = d_lx * Math.cos(rz0) - d_ly * Math.sin(rz0);
                const d_wy = d_lx * Math.sin(rz0) + d_ly * Math.cos(rz0);
                const d_wz = d_lz;

                this.data.box.x = parseFloat(((initialBox.x || 0) + d_wx).toFixed(3));
                this.data.box.y = parseFloat(((initialBox.y || 0) + d_wy).toFixed(3));
                this.data.box.z = parseFloat(((initialBox.z || 0) + d_wz).toFixed(3));
                this.data.box.sx = parseFloat(nextSx.toFixed(3));
                this.data.box.sy = parseFloat(nextSy.toFixed(3));
                this.data.box.sz = parseFloat(nextSz.toFixed(3));
            }

            this.requestRender();
        });

        canvas.addEventListener('pointerdown', (e) => {
            canvas.focus({ preventScroll: true });
            if (e.button !== 0 || this.data.outside) return; // Only primary mouse button and not outside

            const pos = getCanvasPos(e);
            const metrics = OrthoCanvasRenderer.getMetrics(canvas, this.data.box, viewType, this.lastRenderOptions);
            const hit = detectActionAtPos(pos, metrics);

            if (!hit) return;

            e.preventDefault();
            e.stopPropagation();

            try {
                canvas.setPointerCapture(e.pointerId);
            } catch (_) {}

            const action = hit.action;
            const cornerKey = hit.cornerKey || null;
            const oppKey = cornerKey ? OPPOSITE_CORNER[cornerKey] : null;

            if (action === 'translate') {
                canvas.style.cursor = 'grabbing';
            } else if (action === 'rotate') {
                canvas.style.cursor = 'crosshair';
            } else if (action === 'resize-corner') {
                canvas.style.cursor = (cornerKey === 'tl' || cornerKey === 'br') ? 'nwse-resize' : 'nesw-resize';
            }

            const initialBox = { ...(this.data.box || {}) };
            const initialMetrics = { ...metrics };

            let oppLocalU = 0;
            let oppLocalV = 0;
            let oppPxX = 0;
            let oppPxY = 0;
            let signU = 0;
            let signV = 0;

            if (action === 'resize-corner' && cornerKey && oppKey) {
                signU = (cornerKey === 'tr' || cornerKey === 'br') ? 1 : -1;
                signV = (cornerKey === 'tl' || cornerKey === 'tr') ? 1 : -1;
                oppLocalU = -signU * (metrics.dimH / 2);
                oppLocalV = -signV * (metrics.dimV / 2);
                oppPxX = metrics.corners[oppKey].x;
                oppPxY = metrics.corners[oppKey].y;
            }

            this.dragState = {
                pointerId: e.pointerId,
                viewType,
                action,
                cornerKey,
                oppositeCornerKey: oppKey,
                signU,
                signV,
                oppLocalU,
                oppLocalV,
                oppPxX,
                oppPxY,
                initialBox,
                initialMetrics,
                initialLocalPoints: this.lastRenderLocalPoints || null,
                snapshotBeforeDrag: this.takeSnapshot(),
                startX: pos.x,
                startY: pos.y,
                lastX: pos.x,
                lastY: pos.y,
                lastAngle: Math.atan2(metrics.centerY - pos.y, pos.x - metrics.centerX),
                hasMoved: false,
                resizeBoxPx: null,
                translateOffsetPx: { dx: 0, dy: 0 }
            };

            this.requestRender();
        });

        const handlePointerUp = (e) => {
            if (!this.dragState || this.dragState.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const hadMoved = this.dragState.hasMoved;
            const snap = this.dragState.snapshotBeforeDrag;
            this.dragState = null;
            canvas.style.cursor = 'default';

            if (hadMoved) {
                this.pushUndoSnapshot(snap);
                this.applyBoxChanges();
            } else {
                this.requestRender();
            }
        };

        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointercancel', handlePointerUp);
    }

    requestRender() {
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
            this.rafPending = false;
            const opts = {
                ...(this.lastRenderOptions || {}),
                interaction: {
                    activeAction: this.dragState?.action || null,
                    activeCornerKey: this.dragState?.cornerKey || null,
                    oppositeCornerKey: this.dragState?.oppositeCornerKey || null,
                    viewType: this.dragState?.viewType || null,
                    hoverViewType: this.hoverState?.viewType || null,
                    hoverTarget: this.hoverState?.target || null,
                    resizeBoxPx: this.dragState?.resizeBoxPx || null,
                    translateOffsetPx: this.dragState?.translateOffsetPx || null
                }
            };
            this.renderViews(this.lastPointCloudData, this.isCurrent, opts);
            this.updateHeaderBadges();
        });
    }

    /**
     * Fast toggle of active frame border and badge without expensive canvas re-render
     * @param {boolean} isCurrentFrame
     */
    setActive(isCurrentFrame) {
        this.isCurrent = !!isCurrentFrame;
        if (isCurrentFrame) {
            this.dom.classList.add('active-frame');
            if (this.currentBadge) this.currentBadge.style.display = 'inline-block';
        } else {
            this.dom.classList.remove('active-frame');
            if (this.currentBadge) this.currentBadge.style.display = 'none';
        }
    }

    /**
     * Render or refresh canvas projections in CVAT order (Top, Side, Front)
     * @param {{ positions: Float32Array, stride: number } | null} pointCloudData
     * @param {boolean} isCurrentFrame
     * @param {Object} options - { viewMode, zoom, pointSize, interaction }
     */
    renderViews(pointCloudData, isCurrentFrame, options = {}) {
        this.lastPointCloudData = pointCloudData;
        this.lastRenderOptions = options;
        this.isCurrent = isCurrentFrame;

        const { box, label } = this.data;
        const color = label?.color || '#30D158';
        const viewMode = options.viewMode || 'all'; // 'all', 'top', 'side', 'front'
        const zoom = options.zoom || 1.0;
        const pointSize = typeof options.pointSize === 'number' ? options.pointSize : 1.0;

        // Active frame highlight
        if (isCurrentFrame) {
            this.dom.classList.add('active-frame');
            this.currentBadge.style.display = 'inline-block';
        } else {
            this.dom.classList.remove('active-frame');
            this.currentBadge.style.display = 'none';
        }

        // View Mode Class
        this.grid.className = `cvat-qaqc-views-grid mode-${viewMode}`;

        // Transform points to local box coordinate frame (cached during any active drag to eliminate GC stutter)
        let localPoints = null;
        if (options.interaction?.activeAction && this.dragState?.initialLocalPoints) {
            localPoints = this.dragState.initialLocalPoints;
        } else if (pointCloudData && pointCloudData.positions) {
            localPoints = Math3D.transformAndCropPoints(
                pointCloudData.positions,
                pointCloudData.stride || 3,
                box,
                1.35
            );
            this.lastRenderLocalPoints = localPoints;
        }

        const renderOptions = {
            zoom,
            pointSize,
            color,
            marginFactor: 1.35,
            referenceBox: this.originalBox || box,
            outside: !!this.data.outside,
            interaction: options.interaction || null
        };

        const activeViews = viewMode === 'all' ? ['top', 'side', 'front'] : [viewMode];

        for (const viewType of ['top', 'side', 'front']) {
            const canvas = this.canvases[viewType];
            const cell = canvas?.parentElement;
            if (activeViews.includes(viewType)) {
                if (cell) cell.style.display = 'flex';
                OrthoCanvasRenderer.render(canvas, localPoints, box, viewType, renderOptions);
            } else {
                if (cell) cell.style.display = 'none';
            }
        }
    }
}


    // ------------------------------------------
    // File: src/ui/macos_dock.js
    // ------------------------------------------

/**
 * macOS Docked QA/QC Drawer Component
 * Strictly adheres to Apple Human Interface Guidelines: No fake titlebars or window traffic lights.
 * Features a minimal floating trigger button when closed so it never interferes with the workspace.
 */
class MacOSDock {
    /**
     * @param {Object} callbacks - { onJumpToFrame, onReload }
     */
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.isOpen = false;
        this.state = {
            height: 480,
            viewMode: 'all', // 'all', 'top', 'side', 'front'
            viewOrder: ['top', 'side', 'front'],
            zoom: 1.0,
            pointSize: 1.0,
            cardSize: 'medium',
            activeClientID: null,
            filteredClientID: null,
            currentFrame: 0,
            framesData: []
        };
        this.cards = new Map(); // frame -> FrameCard
        this.hoveredFrame = null; // Track frame currently hovered by user mouse
        this.hotkeyFrame = null;
        this.dom = null;
        this.triggerEl = null;
        this.triggerDot = null;
        this.triggerBadge = null;
        this.filmstrip = null;
        this.trackBadge = null;
        this.framesBadge = null;
        this.filterBadge = null;
        this.filterInput = null;
        this.quickFilterBtn = null;
        this.quickClearBtn = null;
        this.orderSelect = null;
        this.emptyState = null;
        this.emptyState = null;

        this.initDOM();
        this.setupResizer();
        this.setupKeyboardShortcuts();
    }

    initDOM() {
        // 1. Floating Pill Button (Minimal, unobtrusive launcher)
        const trigger = document.createElement('div');
        trigger.className = 'cvat-qaqc-trigger';
        trigger.title = 'Click to open QA/QC Inspector (Shortcut: Alt + Q)';

        const dot = document.createElement('span');
        dot.className = 'cvat-qaqc-trigger-dot empty';
        const label = document.createElement('span');
        label.textContent = '3D';
        const badge = document.createElement('span');
        badge.className = 'cvat-qaqc-trigger-badge';

        trigger.appendChild(dot);
        trigger.appendChild(label);
        trigger.appendChild(badge);
        trigger.addEventListener('click', () => this.toggleOpen());
        document.body.appendChild(trigger);

        this.triggerEl = trigger;
        this.triggerDot = dot;
        this.triggerBadge = badge;

        // 2. Docked Drawer (Hidden by default)
        const dock = document.createElement('div');
        dock.className = 'cvat-qaqc-dock';
        dock.style.height = `${this.state.height}px`;

        // Resizer Knob
        const resizer = document.createElement('div');
        resizer.className = 'cvat-qaqc-resizer';
        const knob = document.createElement('div');
        knob.className = 'cvat-qaqc-resizer-knob';
        resizer.appendChild(knob);
        this.resizerEl = resizer;
        dock.appendChild(resizer);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'cvat-qaqc-toolbar';

        // Left Controls
        const leftGroup = document.createElement('div');
        leftGroup.className = 'cvat-qaqc-left-group';

        const title = document.createElement('div');
        title.className = 'cvat-qaqc-title';

        // Clean SVG 3D Cube Icon (Trusted Types compliant DOM creation)
        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('width', '15');
        iconSvg.setAttribute('height', '15');
        iconSvg.setAttribute('fill', 'none');
        iconSvg.setAttribute('stroke', '#0A84FF');
        iconSvg.setAttribute('stroke-width', '2');
        iconSvg.setAttribute('stroke-linecap', 'round');
        iconSvg.setAttribute('stroke-linejoin', 'round');

        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '3.27 6.96 12 12.01 20.73 6.96');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '12');
        line.setAttribute('y1', '22.08');
        line.setAttribute('x2', '12');
        line.setAttribute('y2', '12');

        iconSvg.appendChild(path1);
        iconSvg.appendChild(polyline);
        iconSvg.appendChild(line);

        const titleSpan = document.createElement('span');
        titleSpan.textContent = '3D QA/QC';

        const versionBadge = document.createElement('span');
        versionBadge.className = 'cvat-qaqc-version-pill';
        versionBadge.textContent = 'v1.2.0';
        versionBadge.title = 'v1.2.0: 4-Corner Resizing Only (Edge resizing disabled)';
        versionBadge.style.cssText = 'font-size: 9.5px; background: rgba(10, 132, 255, 0.2); color: #0A84FF; padding: 1px 5px; border-radius: 4px; margin-left: 5px; font-weight: 600; border: 1px solid rgba(10, 132, 255, 0.4); letter-spacing: 0.3px;';

        title.appendChild(iconSvg);
        title.appendChild(titleSpan);
        title.appendChild(versionBadge);

        const trackBadge = document.createElement('span');
        trackBadge.className = 'cvat-qaqc-track-badge';
        trackBadge.textContent = 'No Object Selected';
        this.trackBadge = trackBadge;

        const framesBadge = document.createElement('span');
        framesBadge.className = 'cvat-qaqc-frames-badge';
        framesBadge.textContent = '0 frames';
        this.framesBadge = framesBadge;

        // Quick ID Filter Bar (Allows user to quickly filter by Object ID directly inside the dock)
        const filterBar = document.createElement('div');
        filterBar.className = 'cvat-qaqc-quick-filter-bar';
        this.filterBar = filterBar;

        const filterIcon = document.createElement('span');
        filterIcon.className = 'cvat-qaqc-filter-icon';
        filterIcon.textContent = '#';

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'cvat-qaqc-quick-filter-input';
        filterInput.placeholder = 'ID...';
        filterInput.title = 'Nhập Object ID cần lọc và ấn Enter';
        this.filterInput = filterInput;

        const filterBtn = document.createElement('button');
        filterBtn.className = 'cvat-qaqc-quick-filter-btn';
        filterBtn.textContent = 'Lọc';
        filterBtn.title = 'Lọc chỉ hiển thị Object ID này (Enter)';
        this.quickFilterBtn = filterBtn;

        const clearFilterBtn = document.createElement('button');
        clearFilterBtn.className = 'cvat-qaqc-quick-clear-btn';
        clearFilterBtn.textContent = '✕';
        clearFilterBtn.title = 'Bỏ lọc, hiện lại toàn bộ đối tượng';
        clearFilterBtn.style.display = 'none';
        this.quickClearBtn = clearFilterBtn;

        const executeFilter = async () => {
            const rawVal = filterInput.value.trim().replace(/^#/, '');
            if (!rawVal) return;
            const targetID = parseInt(rawVal, 10);
            if (isNaN(targetID)) {
                filterBar.classList.add('error-shake');
                setTimeout(() => filterBar.classList.remove('error-shake'), 600);
                return;
            }
            filterBtn.disabled = true;
            filterBtn.textContent = '...';
            try {
                if (typeof this.callbacks.onFilterObject === 'function') {
                    const success = await this.callbacks.onFilterObject(targetID);
                    if (success !== false) {
                        this.setFilteredObjectID(targetID);
                    } else {
                        filterBar.classList.add('error-shake');
                        filterInput.title = `Không tìm thấy Object ID #${targetID}`;
                        setTimeout(() => filterBar.classList.remove('error-shake'), 600);
                    }
                }
            } finally {
                filterBtn.disabled = false;
                filterBtn.textContent = 'Lọc';
            }
        };

        filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeFilter();
            }
        });
        filterBtn.addEventListener('click', () => executeFilter());

        clearFilterBtn.addEventListener('click', async () => {
            if (typeof this.callbacks.onClearFilter === 'function') {
                await this.callbacks.onClearFilter();
            }
            this.setFilteredObjectID(null);
            filterInput.value = '';
        });

        filterBar.appendChild(filterIcon);
        filterBar.appendChild(filterInput);
        filterBar.appendChild(filterBtn);
        filterBar.appendChild(clearFilterBtn);

        leftGroup.appendChild(title);
        leftGroup.appendChild(trackBadge);
        leftGroup.appendChild(framesBadge);
        leftGroup.appendChild(filterBar);

        // Right Controls
        const rightGroup = document.createElement('div');
        rightGroup.className = 'cvat-qaqc-right-group';

        // Segmented Control: Views (Top -> Side -> Front)
        const segmented = document.createElement('div');
        segmented.className = 'cvat-qaqc-segmented';
        const viewModes = [
            { id: 'all', label: 'All 3' },
            { id: 'top', label: 'Top' },
            { id: 'side', label: 'Side' },
            { id: 'front', label: 'Front' }
        ];

        this.segButtons = {};
        for (const vm of viewModes) {
            const btn = document.createElement('button');
            btn.className = `cvat-qaqc-seg-item ${vm.id === this.state.viewMode ? 'active' : ''}`;
            btn.textContent = vm.label;
            btn.addEventListener('click', () => this.setViewMode(vm.id));
            this.segButtons[vm.id] = btn;
            segmented.appendChild(btn);
        }

        // Card Display Size Selector (Compact / Medium / Large)
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'cvat-qaqc-select';
        sizeSelect.style.colorScheme = 'dark';
        sizeSelect.title = 'Kích thước hiển thị các góc chiếu';
        [
            { val: 'compact', label: 'Size: Nhỏ' },
            { val: 'medium', label: 'Size: Vừa', selected: true },
            { val: 'large', label: 'Size: Lớn' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            sizeSelect.appendChild(opt);
        });
        sizeSelect.addEventListener('change', (e) => {
            this.setCardSize(e.target.value);
        });

        // Zoom Selector (supports zoom < 100%)
        const zoomSelect = document.createElement('select');
        zoomSelect.className = 'cvat-qaqc-select';
        zoomSelect.style.colorScheme = 'dark';
        [
            { val: '0.4', label: '40%' },
            { val: '0.6', label: '60%' },
            { val: '0.8', label: '80%' },
            { val: '1.0', label: '100%', selected: true },
            { val: '1.25', label: '125%' },
            { val: '1.5', label: '150%' },
            { val: '2.0', label: '200%' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            zoomSelect.appendChild(opt);
        });
        zoomSelect.addEventListener('change', (e) => {
            this.state.zoom = parseFloat(e.target.value);
            this.refreshAllCards();
        });

        // Point Size Selector
        const ptSelect = document.createElement('select');
        ptSelect.className = 'cvat-qaqc-select';
        ptSelect.style.colorScheme = 'dark';
        [
            { val: '0.5', label: 'Pt: 0.5px' },
            { val: '1.0', label: 'Pt: 1px', selected: true },
            { val: '1.5', label: 'Pt: 1.5px' },
            { val: '2.0', label: 'Pt: 2px' },
            { val: '3.0', label: 'Pt: 3px' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            ptSelect.appendChild(opt);
        });
        ptSelect.addEventListener('change', (e) => {
            this.state.pointSize = parseFloat(e.target.value);
            this.refreshAllCards();
        });

        // Copy Size Button (Active Frame / Cuboid)
        const copySizeBtn = document.createElement('button');
        copySizeBtn.className = 'cvat-qaqc-btn cvat-qaqc-copy-size-btn';
        copySizeBtn.textContent = '📋 Copy';
        copySizeBtn.title = 'Sao chép kích thước WxLxH của frame đang chọn (Alt+Shift+C)';
        copySizeBtn.addEventListener('click', () => {
            const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
            if (activeCard) {
                activeCard.handleCopySize(copySizeBtn);
            } else {
                const domSize = SizeClipboard.extractFromCvatDom();
                if (domSize) {
                    SizeClipboard.copy(domSize);
                    copySizeBtn.classList.add('success-flash');
                    copySizeBtn.textContent = `✓ ${domSize.sx}×${domSize.sy}×${domSize.sz}m`;
                    setTimeout(() => {
                        copySizeBtn.classList.remove('success-flash');
                        copySizeBtn.textContent = '📋 Copy';
                    }, 1500);
                }
            }
        });

        // Apply / Fix Size to All Frames Button
        const fixAllBtn = document.createElement('button');
        fixAllBtn.className = 'cvat-qaqc-btn cvat-qaqc-fix-all-btn';
        fixAllBtn.textContent = '⚡ Cố định size (All)';
        fixAllBtn.title = 'Cố định kích thước từ clipboard cho TẤT CẢ các frame của track này (Realtime)';
        fixAllBtn.addEventListener('click', async () => {
            await this.applySizeToAllFrames(fixAllBtn);
        });

        // Jump to Active Frame Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-btn';
        jumpBtn.textContent = '🎯 Active';
        jumpBtn.title = 'Cuộn đến frame đang chọn trong CVAT';
        jumpBtn.addEventListener('click', () => this.scrollToActiveFrame());

        // Close / Hide Button (Collapses back to floating button)
        const hideBtn = document.createElement('button');
        hideBtn.className = 'cvat-qaqc-btn';
        hideBtn.textContent = '✕ Ẩn';
        hideBtn.title = 'Hide inspector (Alt + Q)';
        hideBtn.addEventListener('click', () => this.close());

        rightGroup.appendChild(segmented);
        rightGroup.appendChild(sizeSelect);
        rightGroup.appendChild(zoomSelect);
        rightGroup.appendChild(ptSelect);
        rightGroup.appendChild(copySizeBtn);
        rightGroup.appendChild(fixAllBtn);
        rightGroup.appendChild(jumpBtn);
        rightGroup.appendChild(hideBtn);

        toolbar.appendChild(leftGroup);
        toolbar.appendChild(rightGroup);
        dock.appendChild(toolbar);

        // Filmstrip Container (Medium by default)
        const filmstrip = document.createElement('div');
        filmstrip.className = 'cvat-qaqc-filmstrip size-medium';
        this.filmstrip = filmstrip;
        this.setupFilmstripScrollObserver();

        // Empty State
        const empty = document.createElement('div');
        empty.className = 'cvat-qaqc-empty-state';
        const emptyTitle = document.createElement('div');
        emptyTitle.className = 'cvat-qaqc-empty-title';
        emptyTitle.textContent = 'No 3D Object Selected';
        const emptySub = document.createElement('div');
        emptySub.className = 'cvat-qaqc-empty-sub';
        emptySub.textContent = 'Select any cuboid or track in CVAT to inspect its orthogonal projections across all frames.';
        empty.appendChild(emptyTitle);
        empty.appendChild(emptySub);
        this.emptyState = empty;
        filmstrip.appendChild(empty);

        dock.appendChild(filmstrip);

        this.dom = dock;
        document.body.appendChild(dock);
    }

    updateToolbarRotateButtons() {
        // Toolbar rotate buttons removed per user preference; each card retains its own rotation controls
    }

    /** Resolve a hovered or keyboard-focused inspector card independently of CVAT's main canvas. */
    getHotkeyTarget(event) {
        if (!this.isOpen) return null;
        const target = event?.composedPath?.()[0] || event?.target;

        // 1. Hovered card has highest priority (user mouse is pointing directly at this card)
        const hoveredCard = this.dom?.querySelector?.('.cvat-qaqc-card:hover');
        const hoveredFrame = hoveredCard ? Number(hoveredCard.dataset.frame) :
            (this.hoveredFrame !== null && this.hoveredFrame !== undefined ? Number(this.hoveredFrame) : null);

        // 2. Focused card (user focused card or input/canvas inside card via keyboard)
        const focusedCard = document.activeElement?.closest?.('.cvat-qaqc-card');

        // 3. Direct event card (composedPath or target originates from a card)
        const eventCard = target?.closest?.('.cvat-qaqc-card');

        // 4. Panel check
        const inPanel = target?.closest?.('.cvat-qaqc-dock') ||
            document.activeElement?.closest?.('.cvat-qaqc-dock') || this.dom?.matches?.(':hover');

        let frame = null;
        if (hoveredFrame !== null && !isNaN(hoveredFrame) && this.cards.has(hoveredFrame)) {
            frame = hoveredFrame;
        } else if (focusedCard && !isNaN(Number(focusedCard.dataset.frame)) && this.cards.has(Number(focusedCard.dataset.frame))) {
            frame = Number(focusedCard.dataset.frame);
        } else if (eventCard && !isNaN(Number(eventCard.dataset.frame)) && this.cards.has(Number(eventCard.dataset.frame))) {
            frame = Number(eventCard.dataset.frame);
        } else if (inPanel) {
            frame = (this.hotkeyFrame !== null && this.cards.has(this.hotkeyFrame)) ? this.hotkeyFrame :
                (this.cards.has(this.state.currentFrame) ? this.state.currentFrame : null);
        }

        if (frame === null || !this.cards.has(frame)) return null;
        const card = this.cards.get(frame);
        const clientID = this.state.activeClientID;
        if (!card?.dom?.isConnected || clientID === null || clientID === undefined) return null;
        const job = this.callbacks.getJob?.();
        return {
            card, job, clientID, frame,
            store: this.callbacks.getStore?.(),
            isCurrent: () => this.isOpen && card.dom.isConnected && this.cards.get(frame) === card &&
                this.state.activeClientID === clientID && this.callbacks.getJob?.() === job,
            refresh: () => this.callbacks.onRefreshTrack?.(clientID),
            read: () => this.callbacks.onReadCuboid(frame, clientID),
            update: async (points) => {
                if (this.state.activeClientID !== clientID || this.callbacks.getJob?.() !== job) {
                    throw new Error('Đã đổi track/job; bỏ phím đang chờ.');
                }
                const box = TrackReader.parsePointsToBox(points);
                const saved = await this.callbacks.onUpdateCuboid(frame, clientID, points, box);
                if (saved === false) throw new Error('CVAT chưa lưu được thay đổi của frame này.');
                if (this.cards.get(frame) === card) {
                    card.updateData({ ...card.data, points: [...points], box, keyframe: true });
                }
            },
        };
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
                return;
            }

            const isCtrlOrCmd = e.ctrlKey || e.metaKey;

            if ((e.altKey || e.metaKey) && (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q')) {
                e.preventDefault();
                this.toggleOpen();
                return;
            } else if (e.altKey && e.shiftKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
                if (activeCard) activeCard.handleCopySize();
                return;
            } else if (e.altKey && e.shiftKey && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
                if (activeCard) activeCard.handlePasteSize();
                return;
            }

            // Hotkey O to toggle outside directly on the box at hovered or active frame
            if (!isCtrlOrCmd && !e.altKey && !e.shiftKey) {
                if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') {
                    const targetFrame = this.hoveredFrame !== null ? this.hoveredFrame : this.state.currentFrame;
                    const targetCard = this.cards.get(targetFrame);
                    if (targetCard) {
                        e.preventDefault();
                        targetCard.toggleOutside();
                        return;
                    }
                }
            }

            // Undo / Redo shortcuts (Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y)
            if (isCtrlOrCmd && !e.altKey) {
                const targetFrame = this.hoveredFrame !== null ? this.hoveredFrame : this.state.currentFrame;
                const targetCard = this.cards.get(targetFrame);

                if ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                    // Local Frame Undo has top priority when hovering or focused on a card
                    if (targetCard && targetCard.undo()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    // Global fallback undo on CVAT & UI
                    if (typeof this.callbacks.onUndo === 'function') {
                        e.preventDefault();
                        this.callbacks.onUndo();
                    }
                } else if (
                    ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && e.shiftKey) ||
                    (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y')
                ) {
                    // Local Frame Redo has top priority when hovering or focused on a card
                    if (targetCard && targetCard.redo()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    // Global fallback redo on CVAT & UI
                    if (typeof this.callbacks.onRedo === 'function') {
                        e.preventDefault();
                        this.callbacks.onRedo();
                    }
                }
            }
        });
    }

    /**
     * Apply dimensions across ALL frames of the current track in realtime
     * @param {HTMLElement|null} btn
     * @param {Object|null} customSize
     */
    async applySizeToAllFrames(btn = null, customSize = null) {
        let size = customSize || await SizeClipboard.get();
        if (!size) {
            const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
            if (activeCard?.data?.box) {
                size = SizeClipboard.copy(activeCard.data.box);
            }
        }
        if (!size) {
            console.warn('[CVAT-QAQC] No size available to apply');
            if (btn) {
                const origText = btn.textContent;
                btn.textContent = '⚠️ Chưa có size!';
                setTimeout(() => { btn.textContent = origText; }, 1200);
            }
            return;
        }

        const clientID = this.state.activeClientID;
        if (clientID === null || typeof clientID === 'undefined') return;

        if (typeof this.callbacks.onApplySizeToTrack === 'function') {
            await this.callbacks.onApplySizeToTrack(clientID, size);
        } else {
            // Local fallback
            for (const card of this.cards.values()) {
                if (card && typeof card.pasteSize === 'function') {
                    card.pasteSize(size);
                }
            }
        }

        if (btn) {
            const origText = btn.textContent;
            btn.classList.add('success-flash');
            btn.textContent = `✓ Đã cố định ${size.sx}×${size.sy}×${size.sz}m!`;
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.textContent = origText;
            }, 1500);
        }
        console.log(`[CVAT-QAQC] Fixed size (${size.sx} × ${size.sy} × ${size.sz}m) to track #${clientID} realtime`);
    }

    /**
     * Paste dimensions from clipboard to ALL loaded cards of the current track
     */
    async pasteSizeToAllCards(btn = null) {
        return this.applySizeToAllFrames(btn);
    }

    /**
     * Update active filter state and controls in the header
     * @param {number|null} clientID
     */
    setFilteredObjectID(clientID) {
        this.state.filteredClientID = clientID;
        if (this.filterInput) {
            if (clientID !== null && typeof clientID !== 'undefined') {
                this.filterInput.value = String(clientID);
                if (this.quickClearBtn) this.quickClearBtn.style.display = 'inline-flex';
                if (this.filterBar) this.filterBar.classList.add('is-filtered');
            } else {
                this.filterInput.value = '';
                if (this.quickClearBtn) this.quickClearBtn.style.display = 'none';
                if (this.filterBar) this.filterBar.classList.remove('is-filtered');
            }
        }
    }

    /**
     * Set camera view order across all cards
     * @param {Array<string>} orderArray
     */
    setViewOrder(orderArray) {
        if (!Array.isArray(orderArray) || orderArray.length === 0) return;
        this.state.viewOrder = [...orderArray];
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('cvat_qaqc_view_order', orderArray.join(','));
            }
        } catch (_) {}

        if (this.orderSelect && this.orderSelect.value !== orderArray.join(',')) {
            this.orderSelect.value = orderArray.join(',');
        }

        for (const card of this.cards.values()) {
            card.setViewOrder(orderArray);
        }
    }

    async open() {
        this.isOpen = true;
        this.dom.classList.add('open');
        this.triggerEl.style.display = 'none'; // Hide trigger when drawer is active

        // Filter CVAT workspace to target object ID before performing other operations
        if (typeof this.callbacks.onBeforeOpen === 'function') {
            await this.callbacks.onBeforeOpen();
        } else if (typeof this.callbacks.onOpen === 'function') {
            this.callbacks.onOpen();
        }

        this.refreshAllCards();
        this.scrollToActiveFrame();
    }

    close() {
        this.isOpen = false;
        this.dom.classList.remove('open');
        this.triggerEl.style.display = 'flex'; // Restore trigger button
    }

    async toggleOpen() {
        if (this.isOpen) {
            this.close();
        } else {
            await this.open();
        }
    }

    setupResizer() {
        let isDragging = false;
        let startY = 0;
        let startH = 0;

        this.resizerEl.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startH = this.dom.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaY = startY - e.clientY;
            const newH = Math.max(180, Math.min(window.innerHeight * 0.85, startH + deltaY));
            this.state.height = newH;
            this.dom.style.height = `${newH}px`;
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
            }
        });
    }

    setViewMode(mode) {
        this.state.viewMode = mode;
        for (const [id, btn] of Object.entries(this.segButtons)) {
            if (id === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        this.updateToolbarRotateButtons();
        this.refreshAllCards();
    }

    setCardSize(size) {
        if (!this.filmstrip) return;
        this.filmstrip.classList.remove('size-compact', 'size-medium', 'size-large');
        this.filmstrip.classList.add(`size-${size}`);
        requestAnimationFrame(() => {
            this.refreshAllCards();
        });
    }

    /**
     * Update active object track data
     * @param {number|null} clientID
     * @param {Array} framesData
     * @param {number} currentFrame
     * @param {any} pcdCache
     */
    updateTrack(clientID, framesData, currentFrame, pcdCache) {
        this.state.activeClientID = clientID;
        if (this.hotkeyFrame !== null && (this.hotkeyFrame < 0 || !framesData.some((data) => data.frame === this.hotkeyFrame))) {
            this.hotkeyFrame = null;
        }
        this.state.framesData = framesData || [];
        this.state.currentFrame = currentFrame;
        this.pcdCache = pcdCache;

        if (!clientID || framesData.length === 0) {
            this.trackBadge.textContent = 'No Object Selected';
            this.framesBadge.textContent = '0 frames';
            this.triggerDot.className = 'cvat-qaqc-trigger-dot empty';
            this.triggerBadge.textContent = '';
            this.triggerEl.classList.remove('has-object');
            this.filmstrip.replaceChildren(this.emptyState);
            this.cards.clear();
            return;
        }

        const labelName = framesData[0]?.label?.name || 'Object';
        this.trackBadge.textContent = `Track #${clientID} [${labelName}]`;
        this.framesBadge.textContent = `${framesData.length} frames`;

        // Update floating pill badge without intruding on the user
        this.triggerDot.className = 'cvat-qaqc-trigger-dot';
        this.triggerBadge.textContent = `#${clientID} (${framesData.length}f)`;
        this.triggerEl.classList.add('has-object');

        // Clear filmstrip and build cards
        this.filmstrip.replaceChildren();
        this.cards.clear();

        for (const fData of framesData) {
            const card = new FrameCard(
                fData,
                (frame) => {
                    if (typeof this.callbacks.onJumpToFrame === 'function') {
                        this.callbacks.onJumpToFrame(frame);
                    }
                },
                (frame, newPoints, newBox) => {
                    if (typeof this.callbacks.onUpdateCuboid === 'function') {
                        this.callbacks.onUpdateCuboid(frame, this.state.activeClientID, newPoints, newBox);
                    }
                },
                async (sizeObj) => {
                    await this.applySizeToAllFrames(null, sizeObj);
                },
                (frame, outside) => {
                    if (typeof this.callbacks.onUpdateOutside === 'function') {
                        this.callbacks.onUpdateOutside(frame, this.state.activeClientID, outside);
                    }
                },
                (frame, isHovered) => {
                    this.hoveredFrame = isHovered ? frame : (this.hoveredFrame === frame ? null : this.hoveredFrame);
                    if (isHovered) this.hotkeyFrame = frame;
                },
                { viewOrder: this.state.viewOrder, onActivate: (frame) => { this.hotkeyFrame = frame; } }
            );

            this.cards.set(fData.frame, card);
            this.filmstrip.appendChild(card.dom);

            // Render view
            const pts = pcdCache?.get(fData.frame);
            card.renderViews(pts, fData.frame === currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }

        if (this.isOpen) {
            this.scrollToActiveFrame();
        }
    }

    /**
     * Check if a frame card is currently visible inside the scrollable filmstrip viewport
     * @param {Object} card
     * @returns {boolean}
     */
    isCardVisible(card) {
        if (!card || !card.dom || !this.filmstrip) return true;
        if (typeof window === 'undefined') return true;
        try {
            const stripRect = this.filmstrip.getBoundingClientRect();
            const cardRect = card.dom.getBoundingClientRect();
            // Visible if it intersects the filmstrip viewport with a 350px buffer on each side
            return cardRect.right >= stripRect.left - 350 && cardRect.left <= stripRect.right + 350;
        } catch (_) {
            return true;
        }
    }

    /**
     * Passive scroll observer that renders off-screen dirty cards on-demand as they scroll into view
     */
    setupFilmstripScrollObserver() {
        if (!this.filmstrip) return;
        let scrollRaf = false;
        this.filmstrip.addEventListener('scroll', () => {
            if (scrollRaf) return;
            scrollRaf = true;
            requestAnimationFrame(() => {
                scrollRaf = false;
                for (const [, card] of this.cards.entries()) {
                    if (card.isDirty && this.isCardVisible(card)) {
                        card.isDirty = false;
                        if (typeof card.renderViews === 'function') {
                            const pts = this.pcdCache?.get(card.frame) || card.lastPointCloudData;
                            card.renderViews(pts, card.frame === this.state.currentFrame, card.lastRenderOptions);
                        }
                    }
                }
            });
        }, { passive: true });
    }

    /**
     * In-place data update across all frame cards on Undo/Redo or history changes
     * Zero DOM recreation, preserving scroll and focus
     * Only re-renders visible cards immediately, marking offscreen cards dirty for on-demand scroll rendering (< 10ms INP)
     * @param {Array} framesData
     */
    refreshTrackData(framesData) {
        if (!Array.isArray(framesData) || framesData.length === 0) return;
        this.state.framesData = framesData;

        // If card count matches frame count, update cards in-place
        if (this.cards.size === framesData.length) {
            for (const fData of framesData) {
                const card = this.cards.get(fData.frame);
                if (!card) continue;
                if (this.isCardVisible(card)) {
                    card.isDirty = false;
                    if (typeof card.updateData === 'function') {
                        card.updateData(fData);
                    }
                } else {
                    // Fast in-memory data update without triggering expensive canvas rendering
                    card.data = fData;
                    card.frame = fData.frame;
                    card.isDirty = true;
                    if (typeof card.updateHeaderBadges === 'function') {
                        card.updateHeaderBadges();
                    }
                }
            }
        } else {
            // If frames were added/removed, do a clean rebuild
            this.updateTrack(this.state.activeClientID, framesData, this.state.currentFrame, this.pcdCache);
        }
    }

    /**
     * Update frames data across cards (alias for refreshTrackData for backward compatibility)
     * @param {Array} framesData
     */
    updateFramesData(framesData) {
        this.refreshTrackData(framesData);
    }

    /**
     * Update active frame highlight
     * @param {number} frameNumber
     * @param {any} pcdCache
     */
    updateActiveFrame(frameNumber, pcdCache) {
        const prevFrame = this.state.currentFrame;
        this.state.currentFrame = frameNumber;
        this.pcdCache = pcdCache;

        // Fast toggle of active classes on previous and current cards
        if (prevFrame !== null && prevFrame !== frameNumber) {
            const prevCard = this.cards.get(prevFrame);
            if (prevCard && typeof prevCard.setActive === 'function') {
                prevCard.setActive(false);
            }
        }

        const currentCard = this.cards.get(frameNumber);
        if (currentCard) {
            if (typeof currentCard.setActive === 'function') {
                currentCard.setActive(true);
            }
            const pts = pcdCache?.get(frameNumber);
            if (pts) {
                currentCard.renderViews(pts, true, {
                    viewMode: this.state.viewMode,
                    zoom: this.state.zoom,
                    pointSize: this.state.pointSize
                });
            }
        }

        if (this.isOpen) {
            this.scrollToActiveFrame();
        }
    }

    /**
     * Update point cloud on an individual frame card as soon as it decodes in memory
     * @param {number} frame
     * @param {{ positions: Float32Array, stride: number } | null} pts
     */
    updateCardPointCloud(frame, pts) {
        const card = this.cards.get(frame);
        if (card) {
            card.renderViews(pts, frame === this.state.currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }
    }

    refreshAllCards() {
        for (const [f, card] of this.cards.entries()) {
            const pts = this.pcdCache?.get(f);
            card.renderViews(pts, f === this.state.currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }
    }

    scrollToActiveFrame() {
        const activeCard = this.cards.get(this.state.currentFrame);
        if (activeCard && activeCard.dom) {
            activeCard.dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}


    // ------------------------------------------
    // File: content/injector.js
    // ------------------------------------------

/**
 * CVAT 3D QA/QC Inspector - Main Injector
 * Connects the zero-request hooks, in-memory point cache, and macOS Dock UI.
 */






(async function initQAQCInspector() {
    // Chỉ kích hoạt extension trên các trang web thuộc danh sách cho phép (ALLOWED_SITES)
    if (!isAllowedSite()) {
        return;
    }

    if (window.__CVAT_QAQC_INJECTED__) {
        console.log('[CVAT-QAQC] Already initialized, skipping duplicate injection.');
        return;
    }
    window.__CVAT_QAQC_INJECTED__ = true;

    console.log('[CVAT-QAQC] Allowed CVAT site detected. Initializing 3D QA/QC Inspector...');

    const pcdCache = new PCDCache();
    const hook = new CVATHook();

    let currentTrackFrames = [];
    let currentClientID = null;

    const dock = new MacOSDock({
        onBeforeOpen: async () => {
            // Khi nhấn bật UI extension, thực hiện filter object ID đúng ID đó TRƯỚC KHI xử lý các tác vụ khác
            let clientID = hook.activeClientID || currentClientID || (hook.store ? hook.findActiveClientID(hook.store.getState()) : null);

            // Fallback auto-detection: Nếu chưa chọn track nào, tự động lấy track 3D cuboid đầu tiên trên frame hiện tại
            if ((clientID === null || typeof clientID === 'undefined') && hook.jobInstance) {
                try {
                    const states = await hook.jobInstance.annotations.get(hook.currentFrame, true, []);
                    const cuboid = states.find(s => s.shapeType === 'cuboid' || (s.points && s.points.length >= 9));
                    if (cuboid && typeof cuboid.clientID === 'number') {
                        clientID = cuboid.clientID;
                        hook.activeClientID = clientID;
                        currentClientID = clientID;
                    }
                } catch (_) {}
            }

            if (clientID !== null && typeof clientID !== 'undefined') {
                console.log(`[CVAT-QAQC] UI Extension opened. Filtering workspace to Object ID #${clientID} FIRST...`);
                await hook.filterByObjectID(clientID);
                dock.setFilteredObjectID(clientID);

                // Nạp frames cho track này nếu chưa nạp
                if (hook.jobInstance && (currentClientID !== clientID || currentTrackFrames.length === 0)) {
                    try {
                        currentClientID = clientID;
                        currentTrackFrames = await TrackReader.getTrackFrames(clientID, hook.jobInstance);
                        dock.updateTrack(clientID, currentTrackFrames, hook.currentFrame, pcdCache);
                        const frameNumbers = currentTrackFrames.map(f => f.frame);
                        pcdCache.preloadTrackFrames(frameNumbers, hook.jobInstance, (loadedFrame, pts) => {
                            dock.updateCardPointCloud(loadedFrame, pts);
                        });
                    } catch (err) {
                        console.warn('[CVAT-QAQC] Error loading track frames in onBeforeOpen:', err);
                    }
                }
            }
        },
        onOpen: () => hook.refreshActiveObject(),
        onFilterObject: async (id) => {
            if (!hook.jobInstance) return false;
            const targetID = Number(id);
            if (isNaN(targetID)) return false;

            console.log(`[CVAT-QAQC] User requested quick filter for Object ID #${targetID}...`);

            // 1. Isolate in CVAT (Three.js and Redux)
            await hook.filterByObjectID(targetID);
            dock.setFilteredObjectID(targetID);

            // 2. Load track frames for this ID
            try {
                const trackFrames = await TrackReader.getTrackFrames(targetID, hook.jobInstance);
                if (trackFrames && trackFrames.length > 0) {
                    currentClientID = targetID;
                    currentTrackFrames = trackFrames;

                    // If current frame is outside the track, jump to the track's first frame
                    const hasCurrent = trackFrames.some(f => f.frame === hook.currentFrame);
                    const targetFrame = hasCurrent ? hook.currentFrame : trackFrames[0].frame;
                    if (!hasCurrent) {
                        hook.jumpToFrame(targetFrame);
                    }

                    dock.updateTrack(targetID, trackFrames, targetFrame, pcdCache);
                    const frameNumbers = trackFrames.map(f => f.frame);
                    pcdCache.preloadTrackFrames(frameNumbers, hook.jobInstance, (loadedFrame, pts) => {
                        dock.updateCardPointCloud(loadedFrame, pts);
                    });
                    return true;
                } else {
                    console.warn(`[CVAT-QAQC] Track #${targetID} has no frames or does not exist`);
                    return false;
                }
            } catch (err) {
                console.warn(`[CVAT-QAQC] Error loading track #${targetID}:`, err);
                return false;
            }
        },
        onClearFilter: async () => {
            await hook.clearFilter();
            dock.setFilteredObjectID(null);
        },
        onJumpToFrame: (f) => hook.jumpToFrame(f),
        onUndo: () => hook.undo(),
        onRedo: () => hook.redo(),
        getJob: () => hook.jobInstance,
        getStore: () => hook.store,
        onRefreshTrack: async (clientID) => {
            if (!hook.jobInstance || dock.state.activeClientID !== clientID) return;
            currentTrackFrames = await TrackReader.getTrackFrames(clientID, hook.jobInstance);
            dock.refreshTrackData(currentTrackFrames);
        },
        onReadCuboid: async (frame, clientID) => {
            const job = hook.jobInstance;
            if (!job || hook.store?.getState()?.annotation?.workspace === 'review') {
                throw new Error('Chưa kết nối được job CVAT có quyền chỉnh sửa.');
            }
            const states = await job.annotations.get(frame, true, []);
            if (hook.jobInstance !== job) throw new Error('Đã đổi job; bỏ phím đang chờ.');
            return states.find((state) => state.clientID === clientID);
        },
        onUpdateCuboid: async (frame, clientID, newPoints, newBox) => {
            // Persist to CVAT in-memory AnnotationsCollection and sync Redux for this specific frame only
            const saved = await hook.updateObjectCuboid(frame, clientID, newPoints);
            if (!saved) return false;

            // Keep internal track keyframe cache updated without overwriting sibling cards in the filmstrip
            if (TrackReader.currentTrackData && TrackReader.currentTrackData.clientID === clientID) {
                const shapes = TrackReader.currentTrackData.shapes;
                const existing = shapes?.find(s => s.frame === frame);
                if (existing) {
                    existing.points = [...newPoints];
                } else if (shapes) {
                    shapes.push({ frame, points: [...newPoints], outside: false, rotation: 0 });
                    shapes.sort((a, b) => a.frame - b.frame);
                }
            }

            return true;
        },
        onUpdateOutside: async (frame, clientID, outside) => {
            // Keep internal track keyframe cache updated for this specific frame only
            if (TrackReader.currentTrackData && TrackReader.currentTrackData.clientID === clientID) {
                const shapes = TrackReader.currentTrackData.shapes;
                const existing = shapes?.find(s => s.frame === frame);
                if (existing) {
                    existing.outside = !!outside;
                }
            }

            // Persist to CVAT in-memory AnnotationsCollection and sync Redux
            await hook.updateObjectOutside(frame, clientID, outside);
        },
        onApplySizeToTrack: async (clientID, sizeObj) => {
            // 1. Instant re-interpolation across dock filmstrip in < 1ms
            const updatedFrames = TrackReader.applySizeToTrack(clientID, sizeObj);
            if (updatedFrames && updatedFrames.length > 0) {
                currentTrackFrames = updatedFrames;
                if (typeof dock.refreshTrackData === 'function') {
                    dock.refreshTrackData(updatedFrames);
                } else if (typeof dock.updateFramesData === 'function') {
                    dock.updateFramesData(updatedFrames);
                }
            }

            // 2. Persist to CVAT in-memory AnnotationsCollection and sync Canvas3D/Redux in realtime
            const kfNumbers = (TrackReader.currentTrackData?.shapes || []).map(s => s.frame);
            await hook.applySizeToTrack(clientID, sizeObj, kfNumbers);
        }
    });

    start3DHotkeysAutostart({ getInspectorTarget: (event) => dock.getHotkeyTarget(event) });

    // Listen for object selection change (track or shape)
    hook.on('objectChange', async ({ clientID, job, canvas, frame }) => {
        currentClientID = clientID;

        if (canvas) {
            pcdCache.captureFromThreeScene(frame, canvas);
        }

        if (clientID === null) {
            currentTrackFrames = [];
            dock.updateTrack(null, [], frame, pcdCache);
            dock.setFilteredObjectID(null);
            return;
        }

        // Nếu Dock đang mở và người dùng click vào track mới, tự động lọc ngay sang track ID mới này
        if (dock.isOpen) {
            console.log(`[CVAT-QAQC] Dock is active. Auto-filtering workspace to newly clicked Track #${clientID}...`);
            await hook.filterByObjectID(clientID);
            dock.setFilteredObjectID(clientID);
        }

        console.log(`[CVAT-QAQC] Selected Object / Track #${clientID}. Extracting all frames in-memory...`);
        try {
            currentTrackFrames = await TrackReader.getTrackFrames(clientID, job);
            console.log(`[CVAT-QAQC] Found ${currentTrackFrames.length} frames for Track #${clientID}`);
            dock.updateTrack(clientID, currentTrackFrames, frame, pcdCache);

            // Immediately preload and decode point clouds across all frames of the track upfront!
            const frameNumbers = currentTrackFrames.map(f => f.frame);
            pcdCache.preloadTrackFrames(frameNumbers, job, (loadedFrame, pts) => {
                dock.updateCardPointCloud(loadedFrame, pts);
            });
        } catch (err) {
            console.error('[CVAT-QAQC] Error extracting track frames:', err);
        }
    });

    // Listen for frame navigation in CVAT
    hook.on('frameChange', async ({ frame, clientID, job, canvas }) => {
        // Try capturing point cloud from the newly rendered Three.js scene
        setTimeout(() => {
            if (canvas) {
                pcdCache.captureFromThreeScene(frame, canvas);
            }
            dock.updateActiveFrame(frame, pcdCache);
        }, 150);
    });

    // Listen for canvas instance readiness
    hook.on('canvasReady', (canvas) => {
        if (canvas && hook.currentFrame !== null) {
            pcdCache.captureFromThreeScene(hook.currentFrame, canvas);
        }
    });

    // Listen for CVAT undo/redo or annotation history changes
    hook.on('historyChange', async ({ clientID, frame }) => {
        const targetID = clientID || currentClientID;
        if (targetID !== null && hook.jobInstance) {
            try {
                currentTrackFrames = await TrackReader.getTrackFrames(targetID, hook.jobInstance);
                dock.refreshTrackData(currentTrackFrames);
            } catch (err) {
                console.warn('[CVAT-QAQC] Error refreshing track after history change:', err);
            }
        }
    });

    // Start hooking into CVAT React Fiber / Redux
    await hook.init();
})();


})();

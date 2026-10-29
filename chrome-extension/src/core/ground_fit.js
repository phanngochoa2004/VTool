/* Local ground estimation. This module never requests data from a server. */
(function registerGroundFit(global) {
    'use strict';

    function createEngine() {
        const defaults = Object.freeze({
            margin: 1, minRadius: 3, maxRadius: 5, cellSize: 0.3,
            tolerance: 0.06, maxRms: 0.055, maxTiltDegrees: 25,
            maxHeightShift: 0.75, minCells: 16, minOuterCells: 6,
            supportRadius: 1.25, minFootprintCoverage: 0.55, minLocalCoherence: 0.55,
            minLocalSupport: 0.2, connectionRadius: 0.9,
            iterations: 360, maxPoints: 5000000, maxBytes: 256 * 1024 * 1024,
        });
        const fail = (message) => { throw new Error(message); };
        const quantile = (values, fraction) => {
            if (!values.length) return NaN;
            const sorted = values.slice().sort((a, b) => a - b);
            return sorted[Math.floor((sorted.length - 1) * fraction)];
        };
        function options(value = {}) {
            const result = { ...defaults, ...value };
            for (const key of Object.keys(defaults)) {
                if (!Number.isFinite(result[key]) || result[key] <= 0) fail('Thông số căn nền không hợp lệ: ' + key);
            }
            if (result.maxRadius < result.minRadius || result.maxTiltDegrees > 40 ||
                result.minFootprintCoverage > 1 || result.minLocalCoherence > 1 || result.minLocalSupport > 1 ||
                result.tolerance > 0.2) fail('Thông số căn nền vượt phạm vi hỗ trợ.');
            return result;
        }

        function decompressLZF(input, size) {
            const output = new Uint8Array(size);
            let i = 0;
            let j = 0;
            while (i < input.length) {
                const control = input[i++];
                if (control < 32) {
                    const length = control + 1;
                    if (i + length > input.length || j + length > size) fail('Khối LZF bị cắt ngắn.');
                    output.set(input.subarray(i, i + length), j);
                    i += length;
                    j += length;
                } else {
                    let length = control >> 5;
                    let reference = j - ((control & 31) << 8) - 1;
                    if (length === 7) {
                        if (i >= input.length) fail('Khối LZF không hợp lệ.');
                        length += input[i++];
                    }
                    if (i >= input.length) fail('Khối LZF không hợp lệ.');
                    reference -= input[i++];
                    length += 2;
                    if (reference < 0 || j + length > size) fail('Tham chiếu LZF không hợp lệ.');
                    for (let n = 0; n < length; n++) output[j++] = output[reference++];
                }
            }
            if (j !== size) fail('Kích thước LZF sau giải nén không khớp.');
            return output;
        }

        function parsePCD(buffer, settings) {
            const config = options(settings);
            if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > config.maxBytes) fail('PCD quá lớn hoặc chưa có dữ liệu trong bộ nhớ.');
            const bytes = new Uint8Array(buffer);
            const header = {};
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let start = 0;
            let end = -1;
            for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
                if (bytes[i] !== 10) continue;
                const line = decoder.decode(bytes.subarray(start, i)).replace(/^\uFEFF/, '').trim();
                start = i + 1;
                if (!line || line.startsWith('#')) continue;
                const words = line.split(/\s+/);
                const key = words.shift();
                header[key] = words;
                if (key === 'DATA') { end = start; break; }
            }
            if (end < 0) fail('Không tìm thấy header PCD hợp lệ.');
            const fields = header.FIELDS;
            const sizes = (header.SIZE || []).map(Number);
            const types = header.TYPE || [];
            const counts = (header.COUNT || fields?.map(() => '1') || []).map(Number);
            if (!fields?.length || new Set(fields).size !== fields.length ||
                sizes.length !== fields.length || types.length !== fields.length || counts.length !== fields.length) {
                fail('Các trường của header PCD không khớp.');
            }
            const width = Number(header.WIDTH?.[0]);
            const height = Number(header.HEIGHT?.[0]);
            const count = Number(header.POINTS?.[0] ?? width * height);
            if (!Number.isSafeInteger(count) || count <= 0 || count > config.maxPoints ||
                !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height !== count) fail('Số điểm PCD không hợp lệ.');
            const offsets = [];
            const tokenOffsets = [];
            let step = 0;
            let tokens = 0;
            fields.forEach((field, i) => {
                if (![1, 2, 4, 8].includes(sizes[i]) || !['F', 'U', 'I'].includes(types[i]) ||
                    (types[i] === 'F' && ![4, 8].includes(sizes[i])) ||
                    !Number.isSafeInteger(counts[i]) || counts[i] < 1 || counts[i] > 4096) fail('Kiểu trường PCD không hỗ trợ.');
                offsets.push(step);
                tokenOffsets.push(tokens);
                step += sizes[i] * counts[i];
                tokens += counts[i];
            });
            const axes = ['x', 'y', 'z'].map((name) => fields.indexOf(name));
            if (axes.some((i) => i < 0 || counts[i] !== 1) || count * step > config.maxBytes) fail('PCD cần đủ ba trường x/y/z đơn trị.');
            const positions = new Float32Array(count * 3);
            const dataType = header.DATA[0];
            if (dataType === 'ascii') {
                const text = decoder.decode(bytes.subarray(end));
                let cursor = 0;
                const axisTokens = axes.map((i) => tokenOffsets[i]);
                for (let i = 0; i < count; i++) {
                    for (let k = 0; k < tokens; k++) {
                        while (cursor < text.length && text.charCodeAt(cursor) <= 32) cursor++;
                        const from = cursor;
                        while (cursor < text.length && text.charCodeAt(cursor) > 32) cursor++;
                        if (from === cursor) fail('PCD ASCII thiếu dữ liệu điểm.');
                        const axis = axisTokens.indexOf(k);
                        if (axis >= 0) {
                            const token = text.slice(from, cursor);
                            const value = /^[-+]?nan$/i.test(token) ? NaN :
                                /^[-+]?inf(?:inity)?$/i.test(token) ? (token[0] === '-' ? -Infinity : Infinity) : Number(token);
                            if (Number.isNaN(value) && !/^[-+]?nan$/i.test(token)) fail('Giá trị XYZ trong PCD ASCII không hợp lệ.');
                            positions[i * 3 + axis] = value;
                        }
                    }
                }
                if (text.slice(cursor).trim()) fail('PCD ASCII có nhiều điểm hơn POINTS.');
            } else {
                let body;
                if (dataType === 'binary') {
                    if (bytes.length - end !== count * step) fail('Kích thước PCD binary không khớp header.');
                    body = bytes.subarray(end);
                } else if (dataType === 'binary_compressed') {
                    if (fields.includes('_')) fail('Chưa hỗ trợ PCD nén có trường đệm _.');
                    if (bytes.length < end + 8) fail('PCD nén thiếu kích thước.');
                    const sizesView = new DataView(buffer, end, 8);
                    const compressed = sizesView.getUint32(0, true);
                    const uncompressed = sizesView.getUint32(4, true);
                    if (uncompressed !== count * step || compressed !== bytes.length - end - 8) fail('Kích thước PCD nén không khớp header.');
                    body = decompressLZF(bytes.subarray(end + 8), uncompressed);
                } else fail('Kiểu DATA của PCD chưa được hỗ trợ.');
                const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
                const read = (offset, field) => {
                    const size = sizes[field];
                    if (types[field] === 'F') return size === 4 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
                    if (types[field] === 'U') {
                        if (size === 1) return view.getUint8(offset);
                        if (size === 2) return view.getUint16(offset, true);
                        if (size === 4) return view.getUint32(offset, true);
                        return Number(view.getBigUint64(offset, true));
                    }
                    if (size === 1) return view.getInt8(offset);
                    if (size === 2) return view.getInt16(offset, true);
                    if (size === 4) return view.getInt32(offset, true);
                    return Number(view.getBigInt64(offset, true));
                };
                for (let i = 0; i < count; i++) {
                    axes.forEach((field, axis) => {
                        const offset = dataType === 'binary' ? i * step + offsets[field] :
                            count * offsets[field] + i * sizes[field];
                        positions[i * 3 + axis] = read(offset, field);
                    });
                }
            }
            return { positions, count, fields, dataType };
        }

        // Matrix columns for Three.js intrinsic Euler XYZ, not a yaw/pitch/roll substitution.
        function rotation(points) {
            const [x, y, z] = points.slice(3, 6);
            const a = Math.cos(x); const b = Math.sin(x);
            const c = Math.cos(y); const d = Math.sin(y);
            const e = Math.cos(z); const f = Math.sin(z);
            return [
                [c * e, -c * f, d],
                [a * f + b * e * d, a * e - b * f * d, -b * c],
                [b * f - a * e * d, b * e + a * f * d, a * c],
            ];
        }
        function validateBox(points) {
            if (!Array.isArray(points) || points.length < 9 || !points.slice(0, 9).every(Number.isFinite) ||
                !points.slice(6, 9).every((v) => v > 0)) fail('Box 3D không hợp lệ.');
        }
        function heading(points) {
            const matrix = rotation(points);
            const length = Math.hypot(matrix[0][0], matrix[1][0]);
            if (length < 0.5 || matrix[2][2] < 0.5) fail('Box đang nghiêng quá nhiều để tự căn nền.');
            return [matrix[0][0] / length, matrix[1][0] / length];
        }
        function fitPlane(points) {
            // Centre coordinates before solving to avoid loss of precision far from the origin.
            const mean = [0, 0, 0];
            for (const point of points) for (let k = 0; k < 3; k++) mean[k] += point[k] / points.length;
            let xx = 0; let xy = 0; let yy = 0; let xz = 0; let yz = 0;
            for (const [x, y, z] of points) {
                const u = x - mean[0]; const v = y - mean[1]; const w = z - mean[2];
                xx += u * u; xy += u * v; yy += v * v; xz += u * w; yz += v * w;
            }
            const determinant = xx * yy - xy * xy;
            if (determinant <= 1e-8 || determinant / Math.max(1e-12, xx * yy) < 0.08) return null;
            const a = (xz * yy - yz * xy) / determinant;
            const b = (yz * xx - xz * xy) / determinant;
            return [a, b, mean[2] - a * mean[0] - b * mean[1]];
        }

        function convexHull(points) {
            const ordered = points.map((point) => point.slice(0, 2)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
            const lower = [];
            const upper = [];
            for (const point of ordered) {
                while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
                lower.push(point);
            }
            for (const point of ordered.slice().reverse()) {
                while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
                upper.push(point);
            }
            lower.pop(); upper.pop();
            return lower.concat(upper);
        }
        function inHull(point, hull) {
            if (hull.length < 3) return false;
            for (let i = 0; i < hull.length; i++) {
                const a = hull[i]; const b = hull[(i + 1) % hull.length];
                if ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) < -1e-8) return false;
            }
            return true;
        }
        function distanceToHull(point, hull) {
            if (inHull(point, hull)) return 0;
            let minimum = Infinity;
            for (let i = 0; i < hull.length; i++) {
                const a = hull[i]; const b = hull[(i + 1) % hull.length];
                const dx = b[0] - a[0]; const dy = b[1] - a[1];
                const length = dx * dx + dy * dy;
                const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
                minimum = Math.min(minimum, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
            }
            return minimum;
        }

        function estimate(positions, box, settings) {
            validateBox(box);
            const config = options(settings);
            if (!positions || positions.length % 3 || positions.length / 3 > config.maxPoints) fail('Mảng điểm PCD không hợp lệ.');
            // Yaw locates the horizontal vehicle footprint. Neither roll nor
            // pitch nor the prelabel's bottom plane participates in discovery.
            const [hx, hy] = [Math.cos(box[5]), Math.sin(box[5])];
            const halfX = box[6] / 2; const halfY = box[7] / 2;
            const radius = config.maxRadius;
            const focusRadius = Math.min(radius, Math.max(config.minRadius,
                Math.hypot(halfX + config.margin, halfY + config.margin, box[8] / 2)));
            const cells = new Map();
            // Discover ground from the PCD in the sphere. Annotation geometry
            // is never used as a body mask. The current centre defines the ROI;
            // roll/pitch and the box bottom are only consulted later by align().
            // This coarse plane is a PCD-derived clutter filter, not the final
            // choice between a sidewalk and road or between different grades.
            const coarseCells = new Map();
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i] - box[0]; const y = positions[i + 1] - box[1];
                const z = positions[i + 2];
                if (!Number.isFinite(x + y + z) || x * x + y * y + (z - box[2]) ** 2 > radius ** 2) continue;
                const u = x * hx + y * hy; const v = -x * hy + y * hx;
                const key = Math.floor(u / config.cellSize) + ',' + Math.floor(v / config.cellSize);
                if (!coarseCells.has(key)) coarseCells.set(key, []);
                coarseCells.get(key).push([u, v, z]);
            }
            const coarseSamples = [...coarseCells.values()].map((cell) => {
                cell.sort((a, b) => a[2] - b[2]);
                return cell[Math.floor((cell.length - 1) * 0.2)];
            });
            let coarse = null;
            let coarseScore = -Infinity;
            const coarseProposals = [];
            let coarseSeed = 0x765b123;
            const coarseRandom = () => {
                coarseSeed = (Math.imul(coarseSeed, 1664525) + 1013904223) >>> 0;
                return coarseSeed / 4294967296;
            };
            const slopeLimit = Math.tan(config.maxTiltDegrees * Math.PI / 180);
            for (let k = 0; k < config.iterations; k++) {
                if (coarseSamples.length < config.minCells) break;
                const plane = fitPlane([0, 1, 2].map(() => coarseSamples[Math.floor(coarseRandom() * coarseSamples.length)]));
                if (!plane || Math.hypot(plane[0], plane[1]) > slopeLimit) continue;
                const inliers = coarseSamples.filter(([u, v, z]) => Math.abs(z - plane[0] * u - plane[1] * v - plane[2]) <= config.tolerance);
                const refined = fitPlane(inliers);
                if (!refined || inliers.length < config.minCells || Math.hypot(refined[0], refined[1]) > slopeLimit) continue;
                const rms = Math.sqrt(inliers.reduce((sum, [u, v, z]) =>
                    sum + (z - refined[0] * u - refined[1] * v - refined[2]) ** 2, 0) / inliers.length);
                const score = inliers.length - rms / config.tolerance * 8;
                if (score > coarseScore) { coarse = refined; coarseScore = score; }
                if (inliers.length >= coarseSamples.length * 0.2 && rms <= config.maxRms &&
                    !coarseProposals.some((entry) => Math.abs(entry.plane[2] - refined[2]) < config.tolerance &&
                        Math.hypot(entry.plane[0] - refined[0], entry.plane[1] - refined[1]) < 0.04)) {
                    coarseProposals.push({ plane: refined, count: inliers.length });
                }
            }
            if (!coarse) fail('Chưa tìm được nền độc lập quanh box; giữ nguyên box.');
            const coarseHeight = coarse[2];
            const coarseLayers = coarseProposals.sort((a, b) => b.count - a.count).filter(({ plane }) =>
                Math.abs(plane[2] - coarse[2]) + Math.abs(plane[0] - coarse[0]) * (halfX + config.margin) +
                    Math.abs(plane[1] - coarse[1]) * (halfY + config.margin) <= config.maxHeightShift)
                .slice(0, 12).map(({ plane }) => plane);
            let candidates = 0;
            let bodyPointsExcluded = 0;
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i] - box[0]; const y = positions[i + 1] - box[1];
                const z = positions[i + 2];
                if (!Number.isFinite(x + y + z) || x * x + y * y + (z - box[2]) ** 2 > radius ** 2) continue;
                const u = x * hx + y * hy; const v = -x * hy + y * hx;
                const predicted = coarse[0] * u + coarse[1] * v + coarse[2];
                const allowance = Math.hypot(x, y) * Math.tan(config.maxTiltDegrees * Math.PI / 180);
                if (z < predicted - config.maxHeightShift - allowance ||
                    z > predicted + Math.min(0.5, box[8] * 0.35) + allowance) continue;
                // Keep every plausible ground level, including a raised sidewalk.
                // The coarse layer with most observations is not necessarily the
                // one supporting most of the vehicle's footprint.
                const bodyFloor = coarseLayers.reduce((height, plane) =>
                    Math.max(height, plane[0] * u + plane[1] * v + plane[2]), predicted);
                if (z > bodyFloor + 0.12) { bodyPointsExcluded++; continue; }
                const key = Math.floor(u / config.cellSize) + ',' + Math.floor(v / config.cellSize);
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push([u, v, z]);
                candidates++;
            }
            const samples = [];
            for (const cell of cells.values()) {
                cell.sort((a, b) => a[2] - b[2]);
                const point = cell[Math.floor((cell.length - 1) * 0.2)];
                const [u, v] = point;
                const side = Math.abs(u) / Math.max(halfX, 0.1) >= Math.abs(v) / Math.max(halfY, 0.1) ?
                    (u < 0 ? 0 : 1) : (v < 0 ? 2 : 3);
                samples.push({ point, side, index: samples.length, ring: Math.abs(u) > halfX || Math.abs(v) > halfY });
            }
            const diagnostics = { radius, focusRadius, searchShape: 'sphere', annotationMasksUsed: false,
                independentGroundFilter: true, coarsePlane: coarse, coarseLayers, coarseCells: coarseSamples.length,
                candidatePoints: candidates, bodyPointsExcluded, spatialCells: samples.length };
            const reject = (message, details = {}) => {
                const error = new Error(message);
                error.diagnostics = { ...diagnostics, ...details };
                throw error;
            };
            if (samples.length < config.minCells) reject('Chưa đủ điểm nền quanh box: ' + samples.length + ' ô; giữ nguyên box.');
            const totalSides = [0, 0, 0, 0];
            for (const sample of samples) if (sample.ring) totalSides[sample.side]++;
            function evaluate(plane) {
                if (!plane || Math.hypot(plane[0], plane[1]) > slopeLimit ||
                    Math.abs(plane[2] - coarseHeight) > config.maxHeightShift) return null;
                const inliers = [];
                const indices = [];
                const sides = [0, 0, 0, 0];
                let sumSquares = 0;
                let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
                for (const sample of samples) {
                    const [u, v, z] = sample.point;
                    const error = z - plane[0] * u - plane[1] * v - plane[2];
                    if (Math.abs(error) > config.tolerance) continue;
                    inliers.push(sample.point);
                    indices.push(sample.index);
                    sumSquares += error * error;
                    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
                    if (sample.ring) sides[sample.side]++;
                }
                const sideSupport = sides.filter((n, i) => n >= 3 && n >= totalSides[i] * 0.55).length;
                const outerCells = sides.reduce((sum, value) => sum + value, 0);
                if (inliers.length < config.minCells || outerCells < config.minOuterCells ||
                    maxU - minU < Math.max(0.8, box[6] * 0.4) ||
                    maxV - minV < Math.max(0.5, box[7] * 0.4)) return null;
                const rms = Math.sqrt(sumSquares / inliers.length);
                const score = Math.min(inliers.length, 80) + sideSupport * 3 - rms / config.tolerance * 12;
                return { plane, inliers, indices, sides, sideSupport, rms, score, outerCells };
            }
            function largestPatch(candidate) {
                const size = config.connectionRadius;
                const bins = new Map();
                candidate.inliers.forEach((point, index) => {
                    const key = Math.floor(point[0] / size) + ',' + Math.floor(point[1] / size);
                    if (!bins.has(key)) bins.set(key, []);
                    bins.get(key).push(index);
                });
                const visited = new Uint8Array(candidate.inliers.length);
                let largest = [];
                for (let start = 0; start < candidate.inliers.length; start++) {
                    if (visited[start]) continue;
                    const component = [start];
                    visited[start] = 1;
                    for (let head = 0; head < component.length; head++) {
                        const point = candidate.inliers[component[head]];
                        const x = Math.floor(point[0] / size); const y = Math.floor(point[1] / size);
                        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                            for (const next of bins.get((x + dx) + ',' + (y + dy)) || []) {
                                const other = candidate.inliers[next];
                                if (!visited[next] && (point[0] - other[0]) ** 2 +
                                    (point[1] - other[1]) ** 2 <= size * size) {
                                    visited[next] = 1;
                                    component.push(next);
                                }
                            }
                        }
                    }
                    if (component.length > largest.length) largest = component;
                }
                if (largest.length < config.minCells) return null;
                const allowed = new Set(largest.map((index) => candidate.indices[index]));
                const points = largest.map((index) => candidate.inliers[index]);
                const plane = fitPlane(points);
                if (!plane) return null;
                const fitted = evaluate(plane);
                if (!fitted) return null;
                // Refit/expand only the same connected patch. A new fit must not
                // restore distant islands that caused a misleading convex hull.
                const connected = { ...fitted, inliers: [], indices: [], sides: [0, 0, 0, 0] };
                let sumSquares = 0;
                let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
                for (const index of fitted.indices) {
                    if (!allowed.has(index)) continue;
                    const sample = samples[index]; const [u, v, z] = sample.point;
                    connected.inliers.push(sample.point); connected.indices.push(index);
                    if (sample.ring) connected.sides[sample.side]++;
                    sumSquares += (z - plane[0] * u - plane[1] * v - plane[2]) ** 2;
                    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
                }
                connected.outerCells = connected.sides.reduce((sum, value) => sum + value, 0);
                connected.sideSupport = connected.sides.filter((count, side) => count >= 3 && count >= totalSides[side] * 0.55).length;
                if (connected.inliers.length < config.minCells || connected.outerCells < config.minOuterCells ||
                    maxU - minU < Math.max(0.8, box[6] * 0.4) ||
                    maxV - minV < Math.max(0.5, box[7] * 0.4)) return null;
                connected.rms = Math.sqrt(sumSquares / connected.inliers.length);
                return connected;
            }
            let seed = 0x91e10da5;
            const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
            const proposals = [];
            const localSamples = samples.filter((sample) => Math.abs(sample.point[0]) < halfX + config.margin &&
                Math.abs(sample.point[1]) < halfY + config.margin);
            for (let k = 0; k < config.iterations; k++) {
                const pool = k % 3 !== 2 && localSamples.length >= config.minCells ? localSamples : samples;
                const triangle = [0, 1, 2].map(() => pool[Math.floor(random() * pool.length)].point);
                const [p, q, r] = triangle;
                if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) < 0.2) continue;
                const candidate = evaluate(fitPlane(triangle));
                if (candidate) proposals.push(candidate);
            }
            proposals.sort((a, b) => b.score - a.score);
            const models = [];
            for (const proposal of proposals) {
                if (models.some((model) => Math.abs(proposal.plane[2] - model.plane[2]) < config.tolerance * 0.7 &&
                    Math.hypot(proposal.plane[0] - model.plane[0], proposal.plane[1] - model.plane[1]) < 0.035)) continue;
                let candidate = proposal;
                for (let i = 0; i < 3; i++) {
                    const refined = largestPatch(candidate);
                    if (!refined) break;
                    candidate = refined;
                }
                candidate = largestPatch(candidate);
                if (!candidate) continue;
                if (candidate.rms > config.maxRms) continue;
                const hull = convexHull(candidate.inliers);
                let localCells = 0; let consistentCells = 0;
                const indices = new Set(candidate.indices);
                const nearbyInliers = localSamples.filter((sample) => indices.has(sample.index)).length;
                candidate.localSupport = nearbyInliers / localSamples.length;
                if (candidate.localSupport < config.minLocalSupport) continue;
                for (const sample of samples) {
                    if (Math.abs(sample.point[0]) > halfX + config.margin ||
                        Math.abs(sample.point[1]) > halfY + config.margin || !inHull(sample.point, hull)) continue;
                    localCells++;
                    if (indices.has(sample.index)) consistentCells++;
                }
                candidate.coherence = localCells ? consistentCells / localCells : 0;
                if (candidate.coherence < config.minLocalCoherence) continue;
                const duplicate = models.find((model) => {
                    const angular = Math.hypot(candidate.plane[0] - model.plane[0], candidate.plane[1] - model.plane[1]);
                    if (Math.abs(candidate.plane[2] - model.plane[2]) < config.tolerance &&
                        angular < 0.06) return true;
                    const overlap = model.indices.filter((index) => indices.has(index)).length;
                    return overlap > Math.min(candidate.indices.length, model.indices.length) * 0.8 &&
                        Math.abs(candidate.plane[2] - model.plane[2]) < config.tolerance * 2;
                });
                if (duplicate) continue;
                models.push(candidate);
            }
            // Refine before limiting the candidate set. An early cap can fill
            // up with mixed grades and omit a clean minority patch.
            models.sort((a, b) => (b.coherence * 20 + b.localSupport * 20 +
                Math.min(b.inliers.length, 160) * 0.3 - b.rms / config.tolerance * 15) -
                (a.coherence * 20 + a.localSupport * 20 +
                Math.min(a.inliers.length, 160) * 0.3 - a.rms / config.tolerance * 15));
            models.splice(30);
            // Keep steps and changes of grade as separate patches. A plane
            // averaging two slopes is not the dominant supporting road surface.
            const bridgeModels = new Set();
            for (const candidate of models) {
                // A noisy tilted fit on an edge must not outrank a wider,
                // cleaner patch explaining nearly the same observations.
                for (const patch of models) {
                    if (patch === candidate || candidate.rms < 0.012 ||
                        patch.inliers.length < candidate.inliers.length * 1.25 ||
                        patch.rms > candidate.rms * 0.65) continue;
                    const supported = new Set(patch.indices);
                    const overlap = candidate.indices.filter((index) => supported.has(index)).length;
                    if (overlap >= candidate.indices.length * 0.7) bridgeModels.add(candidate);
                }
                for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
                    const low = models[i]; const high = models[j];
                    const separation = Math.abs(low.plane[2] - high.plane[2]) +
                        Math.abs(low.plane[0] - high.plane[0]) * halfX +
                        Math.abs(low.plane[1] - high.plane[1]) * halfY;
                    if (candidate === low || candidate === high || low.coherence < 0.65 || high.coherence < 0.65 ||
                        separation < config.tolerance * 2 ||
                        candidate.rms < Math.max(0.012, low.rms * 1.6, high.rms * 1.6)) continue;
                    const lowIndices = new Set(low.indices); const highIndices = new Set(high.indices);
                    let explained = 0; let lowCount = 0; let highCount = 0;
                    for (const index of candidate.indices) {
                        if (lowIndices.has(index)) lowCount++;
                        if (highIndices.has(index)) highCount++;
                        if (lowIndices.has(index) || highIndices.has(index)) explained++;
                    }
                    if (explained >= candidate.indices.length * 0.85 &&
                        lowCount >= candidate.indices.length * 0.15 && highCount >= candidate.indices.length * 0.15) {
                        bridgeModels.add(candidate);
                    }
                }
            }
            for (let i = models.length - 1; i >= 0; i--) if (bridgeModels.has(models[i])) models.splice(i, 1);
            diagnostics.rejectedBridgeModels = bridgeModels.size;
            diagnostics.modelCount = models.length;
            if (!models.length) reject('Các điểm nền chưa đủ trải rộng và nhất quán để ước lượng độ dốc; giữ nguyên box.');
            // Equal-area probes represent the actual vehicle footprint, not the number of lidar returns.
            const probes = [];
            const cols = Math.min(24, Math.max(4, Math.ceil(box[6] / 0.35)));
            const rows = Math.min(16, Math.max(4, Math.ceil(box[7] / 0.35)));
            for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
                probes.push([-halfX + (i + 0.5) * box[6] / cols, -halfY + (j + 0.5) * box[7] / rows]);
            }
            for (const model of models) {
                // Infer support across the occluded footprint from surrounding
                // ground, retaining distinct road/sidewalk/grade patches.
                const outerPoints = model.inliers.filter(([u, v]) => Math.abs(u) > halfX || Math.abs(v) > halfY);
                const supportHull = convexHull(outerPoints);
                model.distances = probes.map(([u, v]) => {
                    return distanceToHull([u, v], supportHull);
                });
            }
            for (const model of models) {
                let covered = 0;
                probes.forEach(([u, v], index) => {
                    const distance = model.distances[index];
                    if (distance > config.supportRadius) return;
                    const height = model.plane[0] * u + model.plane[1] * v + model.plane[2];
                    const competing = models.some((other) => other !== model &&
                        other.distances[index] + config.cellSize * 0.5 < distance &&
                        Math.abs(other.plane[0] * u + other.plane[1] * v + other.plane[2] - height) > config.tolerance * 1.5);
                    if (!competing) covered++;
                });
                model.footprintCoverage = covered / probes.length;
                model.score = model.footprintCoverage * 100 + model.coherence * 12 +
                    model.localSupport * 12 + Math.min(model.inliers.length, 80) * 0.08 - model.rms / config.tolerance * 6;
            }
            models.sort((a, b) => b.score - a.score);
            const best = models[0];
            diagnostics.models = models.map((model) => ({ plane: model.plane, rms: model.rms,
                footprintCoverage: model.footprintCoverage, coherence: model.coherence, localSupport: model.localSupport,
                connectedCells: model.inliers.length, inlierCells: model.inliers.length }));
            if (best.footprintCoverage < config.minFootprintCoverage) {
                reject('Nền chỉ đủ hỗ trợ khoảng ' + Math.round(best.footprintCoverage * 100) +
                    '% đáy box; chưa đủ để căn chắc chắn.');
            }
            const alternative = models.find((entry) => entry !== best &&
                entry.footprintCoverage >= best.footprintCoverage - 0.08 &&
                (Math.abs(entry.plane[2] - best.plane[2]) +
                    Math.abs(entry.plane[0] - best.plane[0]) * halfX +
                    Math.abs(entry.plane[1] - best.plane[1]) * halfY > config.tolerance * 2.5));
            if (alternative) reject('Xe nằm giữa nhiều cao độ hoặc độ dốc, chưa xác định được nền chiếm phần lớn đáy box; cần kiểm tra.');
            let fittingPlane = best.plane;
            let fittingPoints = best.inliers;
            let fittingRms = best.rms;
            const underBox = best.inliers.filter(([u, v]) => Math.abs(u) <= halfX && Math.abs(v) <= halfY);
            const contactHull = convexHull(underBox);
            const contactArea = Math.abs(contactHull.reduce((sum, point, index) => {
                const next = contactHull[(index + 1) % contactHull.length];
                return sum + point[0] * next[1] - point[1] * next[0];
            }, 0)) / 2;
            // Select the dominant surface using the wider neighbourhood first.
            // Where both axes are observed under the car, fit that same patch
            // locally so distant road camber does not decide its contact plane.
            if (underBox.length >= config.minCells && contactArea >= box[6] * box[7] * config.minFootprintCoverage) {
                const local = fitPlane(underBox);
                if (local && Math.hypot(local[0], local[1]) <= slopeLimit) {
                    const deviation = Math.abs(local[2] - best.plane[2]) +
                        Math.abs(local[0] - best.plane[0]) * halfX + Math.abs(local[1] - best.plane[1]) * halfY;
                    const rms = Math.sqrt(underBox.reduce((sum, [u, v, z]) =>
                        sum + (z - local[0] * u - local[1] * v - local[2]) ** 2, 0) / underBox.length);
                    if (deviation <= config.tolerance * 2 && rms <= best.rms * 1.1) {
                        fittingPlane = local; fittingPoints = underBox; fittingRms = rms;
                    }
                }
            }
            diagnostics.fitRegion = fittingPoints === underBox ? 'footprint' : 'support-patch';
            diagnostics.fitCells = fittingPoints.length;
            diagnostics.supportCells = best.inliers.length;
            diagnostics.contactArea = contactArea;
            diagnostics.fittingPlane = fittingPlane;
            const [a, b, c] = fittingPlane;
            const residuals = fittingPoints.map(([u, v, z]) => z - a * u - b * v - c);
            const clearance = Math.max(0, Math.min(0.03, quantile(residuals, 0.75)));
            const predictedCenter = c + clearance + box[8] * Math.hypot(a, b, 1) / 2;
            if (Math.abs(predictedCenter - box[2]) > config.maxHeightShift) {
                reject('Mặt nền tìm được đòi hỏi đổi cao độ box quá ' + Math.round(config.maxHeightShift * 100) +
                    ' cm; giữ nguyên box để kiểm tra.', { predictedCenter });
            }
            // Convert the local horizontal coefficients back to point-cloud X/Y.
            return {
                plane: [a * hx - b * hy, a * hy + b * hx, c + clearance],
                rms: fittingRms, sideSupport: best.sideSupport, inlierCells: fittingPoints.length,
                supportCells: best.inliers.length, fitRegion: diagnostics.fitRegion,
                footprintCoverage: best.footprintCoverage, localCoherence: best.coherence, localSupport: best.localSupport,
                totalCells: samples.length, candidatePoints: candidates, radius, clearance, diagnostics,
            };
        }

        function align(box, estimateResult, settings) {
            validateBox(box);
            const config = options(settings);
            const [a, b, ground] = estimateResult.plane;
            if (![a, b, ground].every(Number.isFinite)) fail('Mặt nền không hợp lệ.');
            const slope = Math.hypot(a, b);
            if (Math.atan(slope) * 180 / Math.PI > config.maxTiltDegrees) fail('Độ dốc vượt giới hạn tự căn.');
            const [hx, hy] = heading(box);
            const normalLength = Math.hypot(a, b, 1);
            const normal = [-a / normalLength, -b / normalLength, 1 / normalLength];
            const forwardLength = Math.hypot(hx, hy, a * hx + b * hy);
            const forward = [hx / forwardLength, hy / forwardLength, (a * hx + b * hy) / forwardLength];
            const left = [
                normal[1] * forward[2] - normal[2] * forward[1],
                normal[2] * forward[0] - normal[0] * forward[2],
                normal[0] * forward[1] - normal[1] * forward[0],
            ];
            const result = box.slice();
            result[2] = ground + box[8] * normalLength / 2;
            if (Math.abs(result[2] - box[2]) > config.maxHeightShift) fail('Box cần đổi cao độ quá nhiều; cần kiểm tra lại nền.');
            result[3] = Math.atan2(-normal[1], normal[2]);
            result[4] = Math.asin(Math.max(-1, Math.min(1, normal[0])));
            result[5] = Math.atan2(-left[0], forward[0]);
            // Slopes in the horizontal vehicle-heading frame, distinct from
            // the XYZ Euler values stored by CVAT.
            const longitudinalDegrees = Math.atan(a * hx + b * hy) * 180 / Math.PI;
            const lateralDegrees = Math.atan(-a * hy + b * hx) * 180 / Math.PI;
            return { ...estimateResult, points: result, tiltDegrees: Math.atan(slope) * 180 / Math.PI,
                longitudinalDegrees, lateralDegrees,
                heightChange: result[2] - box[2] };
        }
        return { version: '1.7.4', defaults, parsePCD, estimate, align, rotation, decompressLZF };
    }

    const engine = createEngine();
    global.CVATQAQC.GroundFit?.dispose?.();
    const config = { ...engine.defaults };
    const storageKey = 'cvat3d-ground-fit-automatic-v1';
    let automatic = false;
    try { automatic = global.sessionStorage?.getItem(storageKey) === 'true'; } catch (_) { /* Disabled storage. */ }
    let attachment = null;
    let cached = null;
    let latest = null;
    let lastAttempt = null;

    function loadedSource(context) {
        const annotation = context.store.getState().annotation;
        const instance = annotation.canvas?.instance;
        const model = instance?.model || instance?.view?.model;
        const data = model?.data;
        if (!data || data.imageID !== context.frame || data.isFrameUpdating || data.imageIsDeleted) {
            throw new Error('Chưa đọc được point cloud đã tải của frame này; không tải thêm qua API.');
        }
        const image = data.image?.imageData;
        // Only native in-memory Blob/ArrayBuffer values. Never call FrameData.data(), frames.get(), or fetch().
        if (typeof Blob === 'function' && image instanceof Blob) return { source: image, model, kind: 'blob' };
        if (image instanceof ArrayBuffer) return { source: image, model, kind: 'buffer' };
        throw new Error('Bản CVAT này chưa cung cấp PCD đã tải trong bộ nhớ; không gọi API để lấy thêm.');
    }

    async function compute(context) {
        context.guard();
        const source = loadedSource(context);
        const valid = () => {
            context.guard();
            const current = loadedSource(context);
            if (current.source !== source.source || current.model !== source.model) throw new Error('Point cloud đã thay đổi; hủy căn box.');
        };
        let positions;
        if (cached?.source === source.source) positions = cached.positions;
        else {
            const buffer = source.kind === 'blob' ? await source.source.arrayBuffer() : source.source;
            valid();
            await new Promise((resolve) => setTimeout(resolve, 0));
            valid();
            positions = engine.parsePCD(buffer, config).positions;
            cached = { source: source.source, positions };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        valid();
        let result;
        try {
            result = engine.align(context.points, engine.estimate(positions, context.points, config), config);
        } catch (error) {
            lastAttempt = { version: engine.version, ok: false, id: context.id, frame: context.frame,
                pointsBefore: [...context.points],
                message: error.message, diagnostics: error.diagnostics || null };
            throw error;
        }
        valid();
        latest = { frame: context.frame, id: context.id, rms: result.rms, tiltDegrees: result.tiltDegrees,
            heightChange: result.heightChange, inlierCells: result.inlierCells,
            supportCells: result.supportCells, fitRegion: result.fitRegion,
            footprintCoverage: result.footprintCoverage, sideSupport: result.sideSupport,
            longitudinalDegrees: result.longitudinalDegrees, lateralDegrees: result.lateralDegrees };
        lastAttempt = { version: engine.version, ok: true, ...latest, pointsBefore: [...context.points],
            pointsAfter: [...result.points], diagnostics: result.diagnostics };
        return result;
    }

    function attach(api) {
        attachment?.dispose();
        let timer;
        let start = null;
        let lastSelection = null;
        let pending = false;
        const controller = new AbortController();
        const listenerOptions = { capture: true, signal: controller.signal };
        const run = async () => {
            if (!automatic || !api.active()) return;
            if (pending) { timer = setTimeout(run, 80); return; }
            try {
                const selected = api.context();
                if (lastSelection?.job === selected.job && lastSelection.frame === selected.frame &&
                    lastSelection.id === selected.id) return;
                lastSelection = { job: selected.job, frame: selected.frame, id: selected.id };
                pending = true;
                await api.request();
            } catch (error) {
                if (error.message === 'Hãy chọn đúng một box 3D trước.') lastSelection = null;
                else api.report(error.message, true);
            } finally { pending = false; }
        };
        global.addEventListener('pointerdown', (event) => {
            start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        }, listenerOptions);
        global.addEventListener('click', (event) => {
            if (!automatic || event.button > 0 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
            const target = event.composedPath?.()[0] || event.target;
            if (target?.isContentEditable || target?.closest?.(
                'input,textarea,select,button,[contenteditable="true"],[role="button"],[role="textbox"],[role="combobox"]',
            )) return;
            if (!target?.closest?.('canvas,.cvat-objects-sidebar,.cvat-objects-sidebar-state-item')) return;
            if ([...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.ant-modal,.ant-dropdown')]
                .some((element) => element.getClientRects().length)) return;
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
            clearTimeout(timer);
            timer = setTimeout(run, 180);
        }, listenerOptions);
        attachment = {
            dispose() { clearTimeout(timer); controller.abort(); cached = null; latest = null; lastAttempt = null; },
        };
        return attachment;
    }

    global.CVATQAQC.GroundFit = {
        config, engine, compute, attach,
        status: () => ({ version: engine.version, automatic, latest, lastAttempt, loadedOnly: true }),
        setAutomatic(value) {
            if (typeof value !== 'boolean') throw new Error('Trạng thái tự căn không hợp lệ.');
            automatic = value;
            try { global.sessionStorage?.setItem(storageKey, String(value)); } catch (_) { /* Session only without storage. */ }
            return { automatic, loadedOnly: true };
        },
        dispose() { attachment?.dispose(); attachment = null; cached = null; latest = null; lastAttempt = null; },
    };
})(window);



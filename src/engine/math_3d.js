/**
 * 3D Geometry and Orthographic Projection Math Engine
 * Supports transforming world points to cuboid-local coordinates,
 * ROI extraction, and parsing PCD (ASCII/Binary) without server calls or external libraries.
 */

export class Math3D {
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

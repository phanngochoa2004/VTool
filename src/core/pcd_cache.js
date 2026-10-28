/**
 * In-Memory Point Cloud Cache (Strict Zero-Request Guarantee)
 * Safely captures point cloud data from CVAT Three.js scenes and in-memory frame decoders.
 * NEVER makes network requests to the server.
 */

(function registerPCDCache(global) {
    'use strict';

const { Math3D } = global.CVATQAQC;

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

global.CVATQAQC.PCDCache = PCDCache;
})(window);

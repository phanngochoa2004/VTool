/**
 * Track Reader for CVAT 3D Annotations
 * Extracts multi-frame 3D bounding box states for any selected track or object.
 * Pure in-memory: 0 server requests.
 */

export class TrackReader {
    /**
     * Read cuboid states across all frames for a given object/track
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
        const results = [];

        // Check in-memory AnnotationsCollection directly if available
        let directTrack = null;
        try {
            // Some CVAT builds attach collection to session or job
            const cache = window.cvat?._annotationsCache;
            if (cache && cache.collection && cache.collection.has(jobInstance)) {
                const { collection } = cache.collection.get(jobInstance);
                if (collection && collection.objects && collection.objects[clientID]) {
                    directTrack = collection.objects[clientID];
                }
            }
        } catch (_) {}

        if (directTrack && typeof directTrack.get === 'function') {
            // Determine track lifetime bounds from keyframes
            const keyframeNums = Object.keys(directTrack.shapes || {}).map(Number).sort((a, b) => a - b);
            const trackStart = keyframeNums.length > 0 ? keyframeNums[0] : startFrame;
            const lastKey = keyframeNums.length > 0 ? keyframeNums[keyframeNums.length - 1] : stopFrame;
            const isLastOutside = !!directTrack.shapes?.[lastKey]?.outside;
            const trackEnd = isLastOutside ? lastKey : stopFrame;

            // Query the Track object directly across its active frame range
            for (let f = trackStart; f <= trackEnd; f++) {
                try {
                    const data = directTrack.get(f);
                    // Include both inside AND outside frames (outside frames will not draw box on canvas)
                    if (data && data.points && data.points.length >= 9) {
                        results.push({
                            frame: f,
                            points: [...data.points],
                            box: this.parsePointsToBox(data.points),
                            keyframe: !!data.keyframe,
                            outside: !!data.outside,
                            label: directTrack.label || { name: 'Object', color: '#30D158' }
                        });
                    }
                } catch (e) {
                    // Frame might not be interpolatable
                }
            }
            return results;
        }

        // Standard path: query job.annotations.get(f, true, []) which evaluates in-memory from collection
        const framePromises = [];
        for (let f = startFrame; f <= stopFrame; f++) {
            framePromises.push((async (frameNum) => {
                try {
                    const states = await jobInstance.annotations.get(frameNum, true, []);
                    if (!Array.isArray(states)) return null;
                    const state = states.find(s => s.clientID === clientID);
                    if (state && state.points && state.points.length >= 9) {
                        const first = state.keyframes?.first;
                        const last = state.keyframes?.last;
                        // Exclude frames before track was created
                        if (typeof first === 'number' && frameNum < first) return null;
                        // Exclude frames after track ended with an outside keyframe
                        if (typeof last === 'number' && frameNum > last && state.outside) return null;

                        return {
                            frame: frameNum,
                            points: [...state.points],
                            box: this.parsePointsToBox(state.points),
                            keyframe: !!state.keyframe,
                            outside: !!state.outside,
                            label: {
                                id: state.label?.id,
                                name: state.label?.name || 'Object',
                                color: state.label?.color || '#30D158'
                            }
                        };
                    }
                } catch (err) {
                    return null;
                }
                return null;
            })(f));
        }

        const settled = await Promise.all(framePromises);
        for (const item of settled) {
            if (item) results.push(item);
        }

        // Sort by frame ascending
        results.sort((a, b) => a.frame - b.frame);
        return results;
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

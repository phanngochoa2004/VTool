/**
 * CVAT 3D QA/QC Inspector - Main Injector
 * Connects the zero-request hooks, in-memory point cache, and macOS Dock UI.
 */

import { CVATHook } from '../src/core/cvat_hook.js';
import { PCDCache } from '../src/core/pcd_cache.js';
import { TrackReader } from '../src/core/track_reader.js';
import { MacOSDock } from '../src/ui/macos_dock.js';

(async function initQAQCInspector() {
    console.log('[CVAT-QAQC] Initializing 3D QA/QC Inspector...');

    const pcdCache = new PCDCache();
    const hook = new CVATHook();

    const dock = new MacOSDock({
        onOpen: () => hook.refreshActiveObject(),
        onJumpToFrame: (f) => hook.jumpToFrame(f),
        onUndo: () => hook.undo(),
        onRedo: () => hook.redo(),
        onUpdateCuboid: async (frame, clientID, newPoints, newBox) => {
            await hook.updateObjectCuboid(frame, clientID, newPoints);
        }
    });

    let currentTrackFrames = [];
    let currentClientID = null;

    // Listen for object selection change (track or shape)
    hook.on('objectChange', async ({ clientID, job, canvas, frame }) => {
        currentClientID = clientID;

        if (canvas) {
            pcdCache.captureFromThreeScene(frame, canvas);
        }

        if (clientID === null) {
            currentTrackFrames = [];
            dock.updateTrack(null, [], frame, pcdCache);
            return;
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

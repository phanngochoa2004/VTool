/**
 * CVAT 3D QA/QC Inspector - Main Injector
 * Connects the zero-request hooks, in-memory point cache, and macOS Dock UI.
 */

import { CVATHook } from '../src/core/cvat_hook.js';
import { PCDCache } from '../src/core/pcd_cache.js';
import { TrackReader } from '../src/core/track_reader.js';
import { MacOSDock } from '../src/ui/macos_dock.js';

/**
 * Detect if the current page is genuine CVAT before attaching UI or polling
 */
function isCVATPage() {
    if (typeof window !== 'undefined' && typeof window.cvat !== 'undefined') return true;

    if (typeof document === 'undefined') return false;

    const title = document.title || '';
    if (title.includes('Computer Vision Annotation Tool') || title.includes('CVAT')) {
        return true;
    }

    const meta = document.querySelector('meta[name="description"]');
    if (meta && meta.content && meta.content.includes('Computer Vision Annotation Tool')) {
        return true;
    }

    if (document.getElementById('layout-grid') && document.getElementById('root')) {
        return true;
    }

    if (document.querySelector('.cvat-app, [class*="cvat-"]')) {
        return true;
    }

    const path = (typeof window !== 'undefined' && window.location.pathname) || '';
    if (/\/(tasks|jobs|projects|cloudstorages|organization)(\/|$)/.test(path)) {
        return true;
    }

    return false;
}

function ensureCVATPage(timeoutMs = 1500) {
    if (isCVATPage()) return Promise.resolve(true);

    return new Promise((resolve) => {
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (isCVATPage()) {
                clearInterval(interval);
                resolve(true);
            } else if (Date.now() - startTime >= timeoutMs) {
                clearInterval(interval);
                resolve(false);
            }
        }, 150);
    });
}

(async function initQAQCInspector() {
    // Check if this tab is genuinely a CVAT page before creating any UI or hooks
    const isCVAT = await ensureCVATPage(1500);
    if (!isCVAT) {
        // Not a CVAT web app (e.g. other local web servers on port 5173, 3000, 8000).
        // Exit silently without polluting DOM, setting timers, or logging warnings.
        return;
    }

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
        },
        onUpdateOutside: async (frame, clientID, outside) => {
            await hook.updateObjectOutside(frame, clientID, outside);
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

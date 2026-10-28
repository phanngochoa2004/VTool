/**
 * CVAT 3D QA/QC Inspector - Main Injector
 * Connects the zero-request hooks, in-memory point cache, and macOS Dock UI.
 */

import { CVATHook } from '../src/core/cvat_hook.js';
import { PCDCache } from '../src/core/pcd_cache.js';
import { TrackReader } from '../src/core/track_reader.js';
import { MacOSDock } from '../src/ui/macos_dock.js';
import { isAllowedSite } from '../src/config/allowed_sites.js';
import { start3DHotkeysAutostart } from '../src/core/hotkeys_autostart.js';

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

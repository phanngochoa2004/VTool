/**
 * CVAT 3D QA/QC Inspector - Main Injector
 * Connects the zero-request hooks, in-memory point cache, and macOS Dock UI.
 */

(function startInspector(global) {
    'use strict';

const {
    CVATHook,
    PCDCache,
    TrackReader,
    MacOSDock,
    isAllowedSite,
    start3DHotkeysAutostart
} = global.CVATQAQC;

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
    let inspectorJob = null;
    let searchEpoch = 0;
    let bulkTrackMutationDepth = 0;
    let editEpoch = 0;
    let historyRefreshEpoch = 0;

    const dock = new MacOSDock({
        onFilterObject: async (id, selectedIDs = [id]) => {
            if (!hook.jobInstance) return false;
            const job = hook.jobInstance;
            const operation = ++searchEpoch;
            historyRefreshEpoch++;
            const targetID = Number(id);
            if (isNaN(targetID)) return false;

            console.log(`[CVAT-QAQC] User requested quick filter for Object ID #${targetID}...`);

            // Validate the focused track before changing the workspace filter.
            try {
                const trackFrames = await TrackReader.getTrackFrames(targetID, job);
                if (operation !== searchEpoch || hook.jobInstance !== job) return false;
                if (trackFrames && trackFrames.length > 0) {
                    await hook.filterByObjectIDs(selectedIDs);
                    if (operation !== searchEpoch || hook.jobInstance !== job) return false;
                    inspectorJob = job;
                    currentClientID = targetID;
                    currentTrackFrames = trackFrames;

                    // If current frame is outside the track, jump to the track's first frame
                    const hasCurrent = trackFrames.some(f => f.frame === hook.currentFrame);
                    const targetFrame = hasCurrent ? hook.currentFrame : trackFrames[0].frame;
                    if (!hasCurrent) {
                        hook.jumpToFrame(targetFrame);
                    }

                    dock.updateTrack(targetID, trackFrames, targetFrame, pcdCache);
                    dock.setFilteredObjectID(targetID);
                    const frameNumbers = trackFrames.map(f => f.frame);
                    pcdCache.preloadTrackFrames(frameNumbers, job, (loadedFrame, pts) => {
                        if (operation !== searchEpoch || inspectorJob !== job || currentClientID !== targetID) return;
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
            searchEpoch++;
            historyRefreshEpoch++;
            currentClientID = null;
            currentTrackFrames = [];
            dock.updateTrack(null, [], hook.currentFrame, pcdCache);
            dock.setFilteredObjectID(null);
            return hook.clearFilter();
        },
        onJumpToFrame: (f) => hook.jumpToFrame(f),
        onUndo: () => hook.undo(),
        onRedo: () => hook.redo(),
        getJob: () => hook.jobInstance,
        getStore: () => hook.store,
        onAttributeBatchBegin: () => { bulkTrackMutationDepth++; historyRefreshEpoch++; },
        onAttributeBatchEnd: async (job, id) => {
            bulkTrackMutationDepth--;
            historyRefreshEpoch++;
            if (hook.jobInstance !== job || currentClientID !== id) return;
            // Refresh only current Redux entries/history; keep player, filter and card layout intact.
            const annotation = hook.store?.getState()?.annotation;
            const frame = annotation?.player?.frame?.number;
            if (!Number.isInteger(frame)) return;
            const visibleIDs = new Set((annotation.annotations?.states || []).map((state) => state.clientID));
            const states = await job.annotations.get(frame, true, []);
            const history = await job.actions.get();
            if (hook.jobInstance !== job || hook.currentFrame !== frame || currentClientID !== id) return;
            hook.store.dispatch({ type: 'UPDATE_ANNOTATIONS_SUCCESS',
                payload: { states: states.filter((state) => visibleIDs.has(state.clientID)), history } });
        },
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
            const operation = ++editEpoch;
            historyRefreshEpoch++;
            const previousTrackData = TrackReader.currentTrackData?.clientID === clientID ? {
                ...TrackReader.currentTrackData,
                shapes: TrackReader.currentTrackData.shapes.map((shape) => ({
                    ...shape,
                    points: [...shape.points],
                })),
            } : null;
            const previousFrames = currentTrackFrames;

            // Optimistic source-of-truth update: promote this frame to a keyframe,
            // re-interpolate immediately, and keep every card on the same revision.
            const updatedFrames = TrackReader.updateTrackKeyframe(clientID, frame, newPoints);
            if (updatedFrames?.length) {
                currentTrackFrames = updatedFrames;
                dock.refreshTrackData(updatedFrames);
            }

            const saved = await hook.updateObjectCuboid(frame, clientID, newPoints);
            if (saved) return true;

            // Roll back only if no newer edit has superseded this operation.
            if (operation === editEpoch) {
                if (previousTrackData) TrackReader.currentTrackData = previousTrackData;
                currentTrackFrames = previousFrames;
                dock.refreshTrackData(previousFrames);
            }
            global.CVATQAQC.Notifications?.showError('CVAT chưa xác nhận được thay đổi của box. Hãy kiểm tra lại trước khi thử tiếp.',
                { title: 'Không thể cập nhật box', context: `Object #${clientID}, frame ${frame}` });
            return false;
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
            const saved = await hook.updateObjectOutside(frame, clientID, outside);
            if (saved === false) global.CVATQAQC.Notifications?.showError('CVAT chưa cập nhật được trạng thái Outside.',
                { title: 'Không thể đổi Outside', context: `Object #${clientID}, frame ${frame}` });
        },
        onApplySizeToTrack: async (clientID, sizeObj) => {
            bulkTrackMutationDepth++;
            historyRefreshEpoch++;
            try {
                // 1. Instant re-interpolation across dock filmstrip in < 1ms
                const updatedFrames = TrackReader.applySizeToTrack(clientID, sizeObj);
                if (updatedFrames?.length) {
                    currentTrackFrames = updatedFrames;
                    dock.refreshTrackData(updatedFrames);
                }

                // 2. Persist all keyframes while history refresh is suspended, so a
                // partially-saved track cannot overwrite the optimistic UI revision.
                const kfNumbers = (TrackReader.currentTrackData?.shapes || []).map(s => s.frame);
                const saved = await hook.applySizeToTrack(clientID, sizeObj, kfNumbers);
                if (!saved) throw new Error('CVAT chưa lưu được kích thước đồng bộ.');

                // 3. Confirm once after the entire batch, then publish one coherent revision.
                const confirmedFrames = await TrackReader.getTrackFrames(clientID, hook.jobInstance);
                if (confirmedFrames.length) {
                    currentTrackFrames = confirmedFrames;
                    dock.refreshTrackData(confirmedFrames);
                }
                return true;
            } finally {
                bulkTrackMutationDepth--;
            }
        }
    });

    start3DHotkeysAutostart({ getInspectorTarget: (event) => dock.getHotkeyTarget(event) });

    // CVAT selection does not select an Inspector track. Only explicit ID search does.
    // Clear the old Inspector only when its owning job has actually changed.
    hook.on('objectChange', ({ job }) => {
        if (dock.isOpen && dock.catalogJob !== job) dock.refreshObjectCatalog();
        if (inspectorJob && job !== inspectorJob) {
            searchEpoch++;
            historyRefreshEpoch++;
            inspectorJob = null;
            currentClientID = null;
            currentTrackFrames = [];
            pcdCache.clear();
            dock.updateTrack(null, [], hook.currentFrame, pcdCache);
            dock.setFilteredObjectID(null);
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

    // CVAT -> Inspector synchronization. This path is independent of Undo/Redo
    // history because native Outside actions may update Redux without changing
    // the history lengths observed by the extension.
    hook.on('objectOutsideChanged', ({ clientID, frame, outside }) => {
        if (clientID !== currentClientID || clientID !== dock.state.activeClientID) return;

        const updatedFrames = TrackReader.updateTrackKeyframe(clientID, frame, null, outside);
        if (updatedFrames?.length) {
            currentTrackFrames = updatedFrames;
            dock.refreshTrackData(updatedFrames);
            return;
        }

        // Standalone shapes do not populate TrackReader.currentTrackData.
        const currentFrameData = currentTrackFrames.find((item) => item.frame === frame);
        if (currentFrameData) {
            currentFrameData.outside = !!outside;
            dock.refreshTrackData(currentTrackFrames);
        }
    });

    // Listen for CVAT undo/redo or annotation history changes
    hook.on('historyChange', async () => {
        if (bulkTrackMutationDepth > 0) return;
        const refreshOperation = ++historyRefreshEpoch;
        const targetID = currentClientID;
        const job = inspectorJob;
        if (targetID !== null && job && hook.jobInstance === job) {
            try {
                const refreshedFrames = await TrackReader.getTrackFrames(targetID, job);
                if (refreshOperation !== historyRefreshEpoch || bulkTrackMutationDepth > 0 ||
                    currentClientID !== targetID || hook.jobInstance !== job || inspectorJob !== job) return;
                currentTrackFrames = refreshedFrames;
                dock.refreshTrackData(refreshedFrames);
            } catch (err) {
                console.warn('[CVAT-QAQC] Error refreshing track after history change:', err);
            }
        }
    });

    // Start hooking into CVAT React Fiber / Redux
    await hook.init();
})();

})(window);

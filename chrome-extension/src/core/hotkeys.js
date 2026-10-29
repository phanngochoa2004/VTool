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
(function registerHotkeys(global) {
    'use strict';

const { Math3D, HotkeyPreferences, WorkspaceLayout, GroundFit } = global.CVATQAQC;

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
    let lastSync = null;
    let lastOutside = null;
    let groundAttachment = null;
    let groundEpoch = 0;

    class StaleHotkeyError extends Error {
        constructor(message) {
            super(message);
            this.name = 'StaleHotkeyError';
        }
    }

    function report(message, error = false) {
        if (stopped) return;
        (error ? console.warn : console.info)(`[CVAT 3D] ${message}`);
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
                                        entry.frame === state.frame)))) return candidate;
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

    async function arrangeLayout(item) {
        if (!item.canvas?.isConnected) throw new Error('Hãy mở giao diện Standard 3D trước khi bật Split View.');
        const enabled = WorkspaceLayout.toggle();
        report(enabled ? 'Alt+T: đã bật Split View 3D.' : 'Alt+T: đã khôi phục bố cục CVAT.');
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

    function groundContext(item) {
        const canvas = item?.canvas || findCanvas();
        if (!canvas || stopped || pointers.size) {
            throw new Error('Đợi thả chuột và chọn một box trên canvas CVAT trước khi căn nền.');
        }
        const { state } = selected(canvas);
        const store = findStore(canvas, state);
        const annotation = store.getState().annotation;
        const job = annotation.job.instance;
        const frame = state.frame;
        const id = state.clientID;
        const url = location.href;
        const points = [...state.points];
        const epoch = groundEpoch;
        if (item && (item.id !== id || item.frame !== frame || item.url !== url)) {
            throw new Error('Đã đổi box hoặc frame; hủy căn nền.');
        }
        const context = { canvas, store, job, frame, id, points, automatic: item?.automatic === true };
        context.guard = () => {
            const current = store.getState()?.annotation;
            if (stopped || epoch !== groundEpoch || pointers.size || !canvas.isConnected ||
                location.href !== url || current?.job?.instance !== job ||
                current.player?.frame?.number !== frame || current.workspace === 'review' ||
                current.canvas?.ready === false ||
                (context.automatic && GroundFit?.status().automatic !== true)) {
                throw new Error('Trạng thái trang đã đổi; hủy căn nền.');
            }
            const instance = current.canvas?.instance;
            if (typeof instance?.mode === 'function' && instance.mode() !== 'idle') {
                throw new Error('Ra khỏi chế độ vẽ/kéo trước khi căn nền.');
            }
            const active = selected(canvas).state;
            if (active.clientID !== id || active.frame !== frame || !samePoints(active.points, points)) {
                throw new Error('Box đã thay đổi trong lúc tính nền; giữ thay đổi hiện tại.');
            }
        };
        context.guard();
        return context;
    }

    function requestGroundFit(settings = {}) {
        return new Promise((resolve, reject) => {
            try {
                if (!GroundFit) throw new Error('Chưa nạp chức năng căn box theo mặt đường.');
                if (queue.length >= 12) throw new Error('Đang xử lý nhiều thao tác; đợi box cập nhật.');
                const context = groundContext();
                queue.push({ key: 'ground', canvas: context.canvas, id: context.id, frame: context.frame,
                    url: location.href, automatic: settings.automatic === true, resolve, reject });
                void drain();
            } catch (error) { reject(error); }
        });
    }

    function cancelQueue(message) {
        for (const item of queue) item.reject?.(new Error(message));
        queue.length = 0;
    }

    async function apply(item) {
        if (stopped || location.href !== item.url || pointers.size) {
            throw new StaleHotkeyError('Đã đổi trang hoặc đang kéo chuột; bỏ thao tác đang chờ.');
        }
        let state;
        let inspector;
        if (item.inspector) {
            const assertTarget = () => {
                const current = item.inspector.isCurrent?.() ? item.inspector : null;
                if (stopped || pointers.size || location.href !== item.url || !current ||
                    current.card !== item.inspector.card || current.job !== item.inspector.job ||
                    current.clientID !== item.id || current.frame !== item.frame || current.card.dragState) {
                    throw new StaleHotkeyError('Đã đổi thẻ frame/track hoặc đang kéo box; bỏ phím đang chờ.');
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
                throw new StaleHotkeyError('Đã đổi canvas CVAT; bỏ thao tác đang chờ.');
            }
            if (item.key === 'layout') return arrangeLayout(item);
            if (item.key === 'p') return outsideTrack(item);
            state = selected(item.canvas).state;
        }
        if (state.clientID !== item.id || state.frame !== item.frame) {
            throw new StaleHotkeyError('Đã đổi box hoặc frame; bỏ thao tác đang chờ.');
        }
        if (item.key === 'ground' && inspector) {
            const result = await inspector.fitGround(state.points);
            return report('Frame ' + item.frame + ': đã căn nền — dọc ' +
                result.longitudinalDegrees.toFixed(1) + '°, ngang ' +
                result.lateralDegrees.toFixed(1) + '°, sai số ' +
                (result.rms * 100).toFixed(1) + ' cm, cao độ ' +
                (result.heightChange >= 0 ? '+' : '') + (result.heightChange * 100).toFixed(1) + ' cm.');
        }
        if (item.key === 'g') return syncSize(item, state);
        const points = [...state.points]; // Giữ cả các phần tử dự phòng sau index 8.
        const moves = {
            forward: '←: tiến', backward: '→: lùi', up: '↑: nâng', down: '↓: hạ',
            right: 'Numpad 1: qua phải', left: 'Numpad 2: qua trái',
        };
        let description;
        let groundResult = null;
        if (item.key === 'ground') {
            const context = groundContext(item);
            groundResult = await GroundFit.compute(context);
            context.guard();
            points.splice(0, points.length, ...groundResult.points);
            description = 'Đã căn nền: dọc ' + groundResult.longitudinalDegrees.toFixed(1) +
                '°, ngang ' + groundResult.lateralDegrees.toFixed(1) + '°, sai số ' +
                (groundResult.rms * 100).toFixed(1) + ' cm, phủ đáy ' +
                Math.round(groundResult.footprintCoverage * 100) + '%, cao độ ' +
                (groundResult.heightChange >= 0 ? '+' : '') + (groundResult.heightChange * 100).toFixed(1) +
                ' cm. Ctrl+Z để hoàn tác; Save để lưu.';
        } else if (item.resize) {
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
                return groundResult;
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
            while (queue.length && !stopped) {
                const item = queue.shift();
                try {
                    const result = await apply(item);
                    item.resolve?.(result);
                } catch (error) {
                    item.reject?.(error);
                    throw error;
                }
            }
        } catch (error) {
            cancelQueue('Một thao tác trước đó thất bại; đã hủy hàng đợi còn lại.');
            if (error instanceof StaleHotkeyError) {
                console.debug(`[CVAT 3D] ${error.message}`);
                return;
            }
            report(error.message, true);
        } finally {
            running = false;
        }
    }

    function onKey(event) {
        if (event.isComposing) return;
        const target = event.composedPath()[0];
        if (target?.isContentEditable || target?.closest?.(
            'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"]',
        )) return;
        if ([...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.ant-modal,.ant-dropdown')]
            .some((element) => element.getClientRects().length)) return;
        const action = HotkeyPreferences?.matchEvent(event, 'editor');
        if (!action) return;
        const actions = {
            layout: ['layout'], rotate_z_90: ['z'], swap_rotate_90: ['x'],
            fit_ground: ['ground'],
            rotate_z_left: ['q'], rotate_z_right: ['w'], rotate_side_left: ['e'], rotate_side_right: ['r'],
            rotate_roll_right: ['roll_right'], rotate_roll_left: ['roll_left'],
            move_forward: ['forward'], move_backward: ['backward'], move_up: ['up'], move_down: ['down'],
            move_right: ['right'], move_left: ['left'],
            resize_forward: ['forward', false, true], resize_backward: ['backward', false, true],
            resize_up: ['up', false, true], resize_down: ['down', false, true],
            resize_right: ['right', false, true], resize_left: ['left', false, true],
            preset_sedan: ['1'], preset_suv: ['2'], preset_motorcycle: ['3'], preset_pedestrian: ['4'],
            sync_size: ['g'], restore_size: ['g', true],
            toggle_track_outside: ['p'], restore_track_outside: ['p', true],
        };
        const [key, restore = false, resize = false] = actions[action.id] || [];
        if (!key) return;
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
                    job: inspector.job, store: inspector.store, restore,
                    playerFrame: inspector.store?.getState()?.annotation?.player?.frame?.number,
                    resize, url: location.href });
            } else if (key === 'layout') queue.push({ key, canvas, url: location.href });
            else if (key === 'ground') {
                const context = groundContext();
                queue.push({ key, canvas: context.canvas, id: context.id, frame: context.frame,
                    url: location.href, automatic: false });
            }
            else if (key === 'p') queue.push(restore ? outsideRestoreItem(canvas) : outsideItem(canvas));
            else {
                const { state } = selected(canvas);
                queue.push({ key, restore, resize, canvas,
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
    window.addEventListener('blur', () => {
        pointers.clear();
        groundEpoch += 1;
        cancelQueue('Đã rời cửa sổ; hủy thao tác đang chờ.');
    }, options);

    window.CVAT3DHotkeys = {
        config,
        fitGround: requestGroundFit,
        get active() { return !stopped; },
        dispose() {
            stopped = true;
            groundEpoch += 1;
            cancelQueue('Đã tắt bộ phím tắt.');
            groundAttachment?.dispose();
            controller.abort();
            console.info('[CVAT 3D] Đã tắt phím tắt.');
        },
    };
    groundAttachment = GroundFit?.attach({
        active: () => !stopped,
        context: () => groundContext(),
        request: () => requestGroundFit({ automatic: true }),
        report,
    }) || null;
}

global.CVATQAQC.install3DHotkeys = install3DHotkeys;
})(window);

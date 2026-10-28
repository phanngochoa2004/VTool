const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const modules = ['src/engine/math_3d.js', 'src/core/track_reader.js', 'src/ui/frame_card.js',
    'src/ui/macos_dock.js', 'src/core/hotkeys.js', 'src/core/hotkeys_autostart.js']
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
const originalPoints = [10, -8, 3, 0.2, -0.3, 0.7, 4.5, 1.85, 1.5, 99];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Independently rotate local coordinates around Z, then Y, then X (Euler XYZ).
function worldPoint(points, local) {
    const [rx, ry, rz] = points.slice(3, 6);
    const x1 = Math.cos(rz) * local[0] - Math.sin(rz) * local[1];
    const y1 = Math.sin(rz) * local[0] + Math.cos(rz) * local[1];
    const x2 = Math.cos(ry) * x1 + Math.sin(ry) * local[2];
    const z2 = -Math.sin(ry) * x1 + Math.cos(ry) * local[2];
    return [points[0] + x2, points[1] + Math.cos(rx) * y1 - Math.sin(rx) * z2,
        points[2] + Math.sin(rx) * y1 + Math.cos(rx) * z2];
}

function faceCorners(points, axis, face) {
    const otherAxes = [0, 1, 2].filter((index) => index !== axis);
    return [-1, 1].flatMap((a) => [-1, 1].map((b) => {
        const local = [0, 0, 0];
        local[axis] = face * points[axis + 6] / 2;
        local[otherAxes[0]] = a * points[otherAxes[0] + 6] / 2;
        local[otherAxes[1]] = b * points[otherAxes[1] + 6] / 2;
        return worldPoint(points, local);
    }));
}

function harness({ points = originalPoints, autostart = false, ready = true, inspector = false, legacyActive = false } = {}) {
    const listeners = new Map();
    const timers = new Map();
    const calls = [];
    const notices = [];
    const state = { clientID: 7, frame: 12, objectType: 'track', shapeType: 'cuboid', points: [...points] };
    const object = { state, data: { points: [...points] }, cuboid: { top: { visible: true }, perspective: { visible: true } } };
    let objects = [object];
    const canvas = {
        isConnected: true,
        getDrawnObjects: () => objects,
        updatePosition(target, next) {
            calls.push({ state: target, points: [...next] });
            target.points = [...next];
            object.data.points = [...next];
        },
    };
    let canvases = ready ? [canvas] : [];
    let dialogs = [];
    let observer;
    let timerID = 0;
    const window = {
        addEventListener(type, callback, options = {}) {
            const callbacks = listeners.get(type) || new Set();
            callbacks.add(callback);
            listeners.set(type, callbacks);
            options.signal?.addEventListener('abort', () => callbacks.delete(callback));
        },
    };
    const document = {
        documentElement: {}, body: { appendChild: (node) => notices.push(node) },
        createElement: () => ({ style: {}, remove() { this.removed = true; } }),
        querySelectorAll: (selector) => selector === 'canvas' ? canvases : dialogs,
    };
    const context = vm.createContext({
        window, document, location: { href: 'http://localhost:8080/tasks/1/jobs/1' }, AbortController,
        console: { info() {}, warn() {}, error() {} },
        setTimeout(callback) { timers.set(++timerID, callback); return timerID; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(callback) { timers.set(++timerID, callback); return timerID; },
        clearInterval(id) { timers.delete(id); },
        MutationObserver: class {
            constructor(callback) { observer = this; this.callback = callback; }
            observe() {} disconnect() { this.disconnected = true; }
        },
    });
    vm.runInContext(modules, context);
    const inspectorCalls = [];
    const readCalls = [];
    const renders = [];
    const inspectorState = { ...state, frame: 25, keyframe: true, outside: false, points: [...points] };
    const otherFrame = { ...inspectorState, frame: 26, points: [...points] };
    otherFrame.points[6] += 1;
    const trackStates = new Map([[12, state], [25, inspectorState], [26, otherFrame]]);
    const trackSaves = [];
    for (const entry of trackStates.values()) {
        entry.keyframe = true; entry.outside = false;
        entry.save = async () => { trackSaves.push({ frame: entry.frame, points: [...entry.points], outside: entry.outside }); };
        entry.export = async () => ({ shapes: [...trackStates.values()].map((s) => ({ frame: s.frame })) });
    }
    const dispatched = [];
    const job = { startFrame: 12, stopFrame: 26,
        annotations: { get: async (frame) => [trackStates.get(frame)].filter(Boolean) },
        actions: { get: async () => ({ undo: trackSaves, redo: [] }) } };
    const store = { getState: () => ({ annotation: {
        job: { instance: job, frameNumbers: [12, 25, 26] }, player: { frame: { number: 12 } },
        annotations: { states: [], selectedStatesID: [], activatedStateID: null }, workspace: 'standard3d',
    } }), dispatch: (action) => dispatched.push(action) };
    const dock = vm.runInContext('Object.create(MacOSDock.prototype)', context);
    const card = vm.runInContext('Object.create(FrameCard.prototype)', context);
    Object.assign(card, { frame: 25, dom: { isConnected: true, dataset: { frame: '25' } },
        data: { frame: 25, points: [...points], box: {} },
        updateHeaderBadges() {}, renderViews() { renders.push([...this.data.points]); } });
    Object.assign(dock, { isOpen: true, hoveredFrame: 25, cards: new Map([[25, card]]),
        state: { currentFrame: 12, activeClientID: 7 }, callbacks: {
            getJob: () => job,
            getStore: () => store,
            onReadCuboid: async (frame, id) => { readCalls.push({ frame, id }); return inspectorState; },
            onUpdateCuboid: async (frame, id, next, box) => {
                inspectorCalls.push({ frame, id, points: [...next], box });
                inspectorState.points = [...next]; return true;
            },
        } });
    const legacy = { active: true, disposed: 0, dispose() { this.active = false; this.disposed++; } };
    if (legacyActive) window.CVAT3DHotkeys = legacy;
    context.inspectorTarget = (event) => dock.getHotkeyTarget(event);
    const options = inspector ? '{ getInspectorTarget: inspectorTarget }' : '';
    vm.runInContext(`${autostart ? 'start3DHotkeysAutostart' : 'install3DHotkeys'}(${options})`, context);

    function emit(type, event = {}) {
        for (const callback of listeners.get(type) || []) callback(event);
    }
    async function press(code, options = {}) {
        const event = {
            code, key: code, composedPath: () => [{}],
            preventDefault() { this.prevented = true; },
            stopImmediatePropagation() { this.stopped = true; }, ...options,
        };
        emit('keydown', event);
        // Flush the edit queue's asynchronous continuation without real browser timers.
        await new Promise((resolve) => setImmediate(resolve));
        return event;
    }
    return { context, window, document, state, object, canvas, calls, notices, timers, listeners, press, emit,
        dock, card, inspectorState, inspectorCalls, readCalls, renders,
        legacy, trackStates, trackSaves, dispatched,
        get observer() { return observer; },
        setCanvases(value) { canvases = value; }, setObjects(value) { objects = value; },
        setDialogs(value) { dialogs = value; },
        dispose() { window.CVAT3DHotkeysAutostart?.dispose(); window.CVAT3DHotkeys?.dispose(); },
    };
}

test('W/E swap horizontal and Side rotation while Q/R keep their direction', async (t) => {
    for (const [code, axis, degrees] of [
        ['KeyW', 5, -2], ['KeyE', 4, 2], ['KeyQ', 5, 2], ['KeyR', 4, -2],
    ]) {
        await t.test(code, async () => {
            const h = harness({ points: [1, 2, 3, 0, 0, 0, 4.5, 1.85, 1.5, 99] });
            await h.press(code);
            assert.equal(h.calls.length, 1);
            close(h.state.points[axis], degrees * Math.PI / 180);
            for (const other of [3, 4, 5].filter((entry) => entry !== axis)) close(h.state.points[other], 0);
            assert.deepEqual(h.state.points.slice(0, 3), [1, 2, 3]);
            assert.deepEqual(h.state.points.slice(6), [4.5, 1.85, 1.5, 99]);
            h.dispose();
        });
    }
});

test('plain movement stays at 4 cm and top-row digits retain vehicle presets', async () => {
    const h = harness({ points: [10, 20, 3, 0, 0, 0, 4.5, 1.85, 1.5, 99] });
    await h.press('ArrowLeft'); close(h.state.points[0], 10.04);
    await h.press('ArrowRight'); close(h.state.points[0], 10);
    await h.press('ArrowUp'); close(h.state.points[2], 3.04);
    await h.press('ArrowDown'); close(h.state.points[2], 3);
    await h.press('Numpad1', { key: 'End' }); close(h.state.points[1], 19.96);
    await h.press('Numpad2', { key: 'ArrowDown' }); close(h.state.points[1], 20);
    await h.press('Digit2'); assert.deepEqual(h.state.points.slice(6, 9), [4.7, 1.95, 1.65]);
    await h.press('Digit1'); assert.deepEqual(h.state.points.slice(6, 9), [4.5, 1.85, 1.5]);
    assert.equal(h.state.points[9], 99);
    h.dispose();
});

test('Shift directions move one face 6 cm and keep every opposite corner fixed on rotated boxes', async (t) => {
    for (const [code, key, index, face, sign] of [
        ['ArrowLeft', 'ArrowLeft', 6, 1, 1], ['ArrowRight', 'ArrowRight', 6, -1, -1],
        ['ArrowUp', 'ArrowUp', 8, 1, 1], ['ArrowDown', 'ArrowDown', 8, -1, -1],
        ['Numpad1', 'End', 7, -1, 1], ['Numpad2', 'ArrowDown', 7, 1, -1],
    ]) {
        await t.test(code, async () => {
            // Nonzero yaw/pitch/roll ensure resizing still uses the cuboid's own dimensions.
            const h = harness();
            const before = [...h.state.points];
            const event = await h.press(code, { key, shiftKey: true });
            assert.equal(event.prevented, true);
            assert.equal(event.stopped, true);
            assert.equal(h.calls.length, 1);
            assert.equal(h.calls[0].state, h.state);
            for (let i = 3; i < before.length; i++) {
                close(h.state.points[i], before[i] + (i === index ? sign * 0.06 : 0));
            }
            const fixedBefore = faceCorners(before, index - 6, -face);
            const fixedAfter = faceCorners(h.state.points, index - 6, -face);
            const movingBefore = faceCorners(before, index - 6, face);
            const movingAfter = faceCorners(h.state.points, index - 6, face);
            for (let corner = 0; corner < 4; corner++) {
                for (let coordinate = 0; coordinate < 3; coordinate++) {
                    assert.ok(Math.abs(fixedAfter[corner][coordinate] - fixedBefore[corner][coordinate]) < 1e-8);
                }
                close(Math.hypot(...movingAfter[corner].map((value, i) => value - movingBefore[corner][i])), 0.06);
            }
            // The stored midpoint follows the changed face by half the step; the entire box does not translate.
            close(Math.hypot(...h.state.points.slice(0, 3).map((value, i) => value - before[i])), 0.03);
            h.dispose();
        });
    }
});

test('rapid face edits remain serialized and reject nonpositive sizes', async () => {
    const h = harness();
    await Promise.all([
        h.press('ArrowLeft', { shiftKey: true }),
        h.press('ArrowLeft', { shiftKey: true }),
        h.press('ArrowRight', { shiftKey: true }),
    ]);
    assert.equal(h.calls.length, 3);
    close(h.state.points[6], originalPoints[6] + 0.06);
    await h.press('ArrowRight', { shiftKey: true });
    for (let i = 3; i < originalPoints.length; i++) close(h.state.points[i], originalPoints[i]);
    // Opposite keys edit different faces, so they restore the size but do not undo the first face edit.
    assert.ok(Math.abs(Math.hypot(...h.state.points.slice(0, 3).map((value, i) => value - originalPoints[i])) - 0.12) < 1e-8);
    h.dispose();
    for (const [code, index] of [['ArrowRight', 6], ['ArrowDown', 8], ['Numpad2', 7]]) {
        const points = [...originalPoints]; points[index] = 0.06;
        const small = harness({ points });
        await small.press(code, { shiftKey: true });
        assert.equal(small.calls.length, 0);
        assert.deepEqual(small.state.points, points);
        assert.match(small.notices.at(-1).textContent, /lớn hơn 0/);
        small.dispose();
    }
});

test('typing, dialogs, modifiers, held keys and dragging do not edit the box', async () => {
    const h = harness();
    for (const options of [
        { composedPath: () => [{ isContentEditable: true }] },
        { composedPath: () => [{ closest: () => ({}) }] },
        { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true },
    ]) await h.press('ArrowLeft', { shiftKey: true, ...options });
    h.setDialogs([{ getClientRects: () => [{}] }]);
    await h.press('ArrowLeft', { shiftKey: true });
    h.setDialogs([]);
    h.emit('pointerdown', { pointerId: 1 });
    await h.press('ArrowLeft', { shiftKey: true });
    h.emit('pointerup', { pointerId: 1 });
    assert.equal(h.calls.length, 0);
    h.dispose();
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.calls.length, 0);
    assert.equal(h.listeners.get('keydown').size, 0);
});

test('locked, hidden, outside, invalid and ambiguous selections cannot be edited', async () => {
    for (const key of ['lock', 'hidden', 'outside', 'isGroundTruth']) {
        const h = harness(); h.state[key] = true;
        await h.press('ArrowUp', { shiftKey: true });
        assert.equal(h.calls.length, 0, key); h.dispose();
    }
    for (const points of [[1, 2, 3], originalPoints.map((value, i) => i === 6 ? NaN : value)]) {
        const h = harness({ points }); await h.press('ArrowUp', { shiftKey: true });
        assert.equal(h.calls.length, 0); h.dispose();
    }
    const h = harness(); h.setObjects([h.object, h.object]);
    await h.press('ArrowUp', { shiftKey: true });
    assert.equal(h.calls.length, 0); h.dispose();
});

test('autostart waits for a 3D canvas, reconnects once, and cleans up', async () => {
    const h = harness({ autostart: true, ready: false });
    assert.equal(h.window.CVAT3DHotkeys, undefined);
    h.setCanvases([h.canvas]);
    h.observer.callback();
    for (const callback of [...h.timers.values()]) callback();
    assert.equal(h.window.CVAT3DHotkeys.active, true);
    const first = h.window.CVAT3DHotkeys;
    for (const callback of [...h.timers.values()]) callback();
    assert.equal(h.window.CVAT3DHotkeys, first);
    h.setCanvases([]); h.canvas.isConnected = false;
    for (const callback of [...h.timers.values()]) callback();
    assert.equal(first.active, false);
    h.canvas.isConnected = true; h.setCanvases([h.canvas]);
    for (const callback of [...h.timers.values()]) callback();
    assert.equal(h.window.CVAT3DHotkeys.active, true);
    assert.notEqual(h.window.CVAT3DHotkeys, first);
    assert.equal(h.listeners.get('keydown').size, 1);
    h.dispose();
    assert.equal(h.observer.disconnected, true);
    assert.equal(h.timers.size, 0);
});

test('Chrome bundle contains hotkeys and leaves sites outside the allowlist inactive', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const script = manifest.content_scripts.find((entry) => entry.world === 'MAIN');
    const source = script.js.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    const window = { location: new URL('https://example.org/tasks/1/jobs/1') };
    const context = vm.createContext({ window, URL, console: { log() {} } });
    vm.runInContext(source, context);
    assert.ok(source.includes('function install3DHotkeys('));
    assert.ok(source.includes('function start3DHotkeysAutostart('));
    assert.equal(window.CVAT3DHotkeys, undefined);
    assert.equal(window.CVAT3DHotkeysAutostart, undefined);
});

test('Inspector hotkeys save the hovered frame through the existing dock callback without a native canvas', async () => {
    const h = harness({ inspector: true, ready: false, autostart: true });
    assert.equal(h.window.CVAT3DHotkeys.active, true);
    const originalNative = [...h.state.points];
    const fixed = faceCorners(h.inspectorState.points, 0, -1);
    const event = await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(event.prevented, true);
    assert.equal(h.inspectorCalls.length, 1);
    assert.deepEqual(h.readCalls, [{ frame: 25, id: 7 }]);
    assert.equal(h.inspectorCalls[0].frame, 25);
    assert.equal(h.inspectorCalls[0].id, 7);
    close(h.inspectorCalls[0].points[6], originalPoints[6] + 0.06);
    assert.equal(h.inspectorCalls[0].box.sx, h.inspectorCalls[0].points[6]);
    const afterFixed = faceCorners(h.inspectorState.points, 0, -1);
    for (let c = 0; c < 4; c++) for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(afterFixed[c][i] - fixed[c][i]) < 1e-8);
    }
    assert.equal(h.renders.length, 1);
    assert.equal(h.card.data.keyframe, true);
    assert.deepEqual(Array.from(h.card.data.points), h.inspectorState.points);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.state.points, originalNative);
    h.dispose();
});

test('Inspector focus works after leaving the card; a closed drawer does not capture native edits', async () => {
    const h = harness({ inspector: true });
    h.dock.hoveredFrame = null;
    h.document.activeElement = { closest: () => ({ dataset: { frame: '25' } }) };
    await h.press('KeyW');
    assert.equal(h.inspectorCalls.length, 1);
    assert.equal(h.calls.length, 0);
    h.dock.isOpen = false;
    await h.press('KeyE');
    assert.equal(h.inspectorCalls.length, 1);
    assert.equal(h.calls.length, 1);
    h.dispose();
});

test('Inspector rejects locked states, dragging, stale selection, and persistence failure', async () => {
    const h = harness({ inspector: true, ready: false });
    h.inspectorState.lock = true;
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.inspectorCalls.length, 0);
    h.inspectorState.lock = false;
    h.card.dragState = {};
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.inspectorCalls.length, 0);
    h.card.dragState = null;
    const read = h.dock.callbacks.onReadCuboid;
    h.dock.callbacks.onReadCuboid = async (...args) => {
        const state = await read(...args); h.dock.state.activeClientID = 9; return state;
    };
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.inspectorCalls.length, 0);
    h.dock.state.activeClientID = 7;
    h.dock.callbacks.onReadCuboid = read;
    h.dock.callbacks.onUpdateCuboid = async () => false;
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.renders.length, 0);
    assert.match(h.notices.at(-1).textContent, /chưa lưu/);
    h.dispose();
});

test('W/E rotate tilted Inspector cuboids around the correct world/local axes', async () => {
    const rotateY = (v, a) => [Math.cos(a) * v[0] + Math.sin(a) * v[2], v[1],
        -Math.sin(a) * v[0] + Math.cos(a) * v[2]];
    const rotateZ = (v, a) => [Math.cos(a) * v[0] - Math.sin(a) * v[1],
        Math.sin(a) * v[0] + Math.cos(a) * v[1], v[2]];
    for (const code of ['KeyW', 'KeyE']) {
        const h = harness({ inspector: true, ready: false });
        const before = [...h.inspectorState.points];
        await h.press(code);
        const after = h.inspectorState.points;
        for (const basis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
            const local = code === 'KeyE' ? rotateY(basis, 2 * Math.PI / 180) : basis;
            let expected = worldPoint(before, local).map((value, i) => value - before[i]);
            if (code === 'KeyW') expected = rotateZ(expected, -2 * Math.PI / 180);
            const actual = worldPoint(after, basis).map((value, i) => value - after[i]);
            for (let i = 0; i < 3; i++) close(actual[i], expected[i]);
        }
        assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
        assert.deepEqual(after.slice(6), before.slice(6));
        h.dispose();
    }
});

test('autostart replaces an already active legacy controller and recovers from an overwritten installer', async () => {
    const h = harness({ inspector: true, autostart: true, legacyActive: true });
    assert.equal(h.legacy.disposed, 1);
    assert.notEqual(h.window.CVAT3DHotkeys, h.legacy);
    await h.press('ArrowLeft', { shiftKey: true });
    assert.equal(h.inspectorCalls.length, 1);
    h.window.CVAT3DHotkeys.dispose();
    const replacement = { active: true, disposed: false, dispose() { this.active = false; this.disposed = true; } };
    h.window.CVAT3DHotkeys = replacement;
    h.window.CVAT3DHotkeysInstall = () => { throw new Error('An older extension replaced this global'); };
    for (const callback of [...h.timers.values()]) callback();
    assert.equal(replacement.disposed, true);
    assert.notEqual(h.window.CVAT3DHotkeys, replacement);
    await h.press('KeyE');
    assert.equal(h.inspectorCalls.length, 2);
    h.dispose();
});

test('a key originating on an Inspector card works without hover/focus callbacks or a CVAT selection', async () => {
    const h = harness({ inspector: true });
    h.setObjects([]);
    h.dock.hoveredFrame = null;
    h.card.dom.closest = (selector) => selector === '.cvat-qaqc-card' ? h.card.dom : null;
    await h.press('ArrowLeft', { shiftKey: true, composedPath: () => [h.card.dom] });
    assert.equal(h.inspectorCalls.length, 1);
    assert.equal(h.calls.length, 0);
    assert.match(h.notices.at(-1).textContent, /Frame 25/);
    h.dispose();
});

test('G and Shift+G use the Inspector track and synchronize the main frame history without selecting a native box', async () => {
    const h = harness({ inspector: true, ready: false });
    const oldLength = h.trackStates.get(26).points[6];
    await h.press('KeyG');
    assert.equal(h.trackSaves.length, 1, h.notices.at(-1)?.textContent);
    close(h.trackStates.get(26).points[6], h.inspectorState.points[6]);
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.dispatched[0].payload.states[0].frame, 12);
    await h.press('KeyG', { shiftKey: true });
    close(h.trackStates.get(26).points[6], oldLength);
    assert.equal(h.trackSaves.length, 2);
    assert.equal(h.calls.length, 0);
    h.dispose();
});

test('P and Shift+P work from the Inspector with no native box selected', async () => {
    const h = harness({ inspector: true, ready: false });
    await h.press('KeyP');
    for (const state of h.trackStates.values()) assert.equal(state.outside, true, h.notices.at(-1)?.textContent);
    assert.equal(h.trackSaves.length, 3);
    await h.press('KeyP', { shiftKey: true });
    for (const state of h.trackStates.values()) assert.equal(state.outside, false);
    assert.equal(h.trackSaves.length, 6);
    h.dispose();
});

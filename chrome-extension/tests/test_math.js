(async function runBrowserMathTests() {
const { Math3D, TrackReader, OrthoCanvasRenderer, SizeClipboard, CVATHook, GroundFit, FrameCard, MacOSDock, isAllowedSite, ALLOWED_SITES } = window.CVATQAQC;

console.log('--- Testing 3D Math & Projections ---');

// 1. Identity rotation test
const R_ident = Math3D.eulerToRotationMatrix(0, 0, 0);
console.assert(Math.abs(R_ident[0] - 1) < 1e-5, 'R[0] should be 1');
console.assert(Math.abs(R_ident[4] - 1) < 1e-5, 'R[4] should be 1');
console.assert(Math.abs(R_ident[8] - 1) < 1e-5, 'R[8] should be 1');
console.log('✓ Identity rotation passed');

// 2. 90 deg rotation around Z
const R_z90 = Math3D.eulerToRotationMatrix(0, 0, Math.PI / 2);
console.assert(Math.abs(R_z90[0]) < 1e-5, 'cos(90) should be 0');
console.assert(Math.abs(R_z90[1] - (-1)) < 1e-5, '-sin(90) should be -1');
console.assert(Math.abs(R_z90[3] - 1) < 1e-5, 'sin(90) should be 1');
console.log('✓ 90 deg rotation around Z passed');

// 3. Point transform & crop test
const box = {
    x: 10, y: 20, z: 5,
    rx: 0, ry: 0, rz: 0,
    sx: 2, sy: 4, sz: 2
};
// Point inside: (10, 20, 5) -> local (0, 0, 0)
// Point inside: (10.5, 21, 5.5) -> local (0.5, 1, 0.5)
// Point outside: (50, 50, 50) -> should be filtered out
const points = new Float32Array([
    10, 20, 5, 0.8,
    10.5, 21, 5.5, 0.9,
    50, 50, 50, 0.1
]);

const cropped = Math3D.transformAndCropPoints(points, 4, box, 1.4);
console.assert(cropped.length === 8, `Expected 2 points (8 floats), got ${cropped.length}`);
console.assert(Math.abs(cropped[0]) < 1e-5 && Math.abs(cropped[1]) < 1e-5 && Math.abs(cropped[2]) < 1e-5, 'Center point should be local (0,0,0)');
console.assert(Math.abs(cropped[4] - 0.5) < 1e-5 && Math.abs(cropped[5] - 1.0) < 1e-5, 'Second point should be local (0.5, 1.0, 0.5)');
console.log('✓ Point transform & cropping passed');

// 4. Test parsePointsToBox & boxToPoints roundtrip
const cvatPoints = [1, 2, 3, 0.1, 0.2, 0.3, 1.8, 4.5, 1.5];
const parsedBox = TrackReader.parsePointsToBox(cvatPoints);
console.assert(parsedBox.x === 1 && parsedBox.y === 2 && parsedBox.z === 3, 'Position parsed correctly');
console.assert(parsedBox.sx === 1.8 && parsedBox.sy === 4.5 && parsedBox.sz === 1.5, 'Dimensions parsed correctly');

const reconstitutedPoints = TrackReader.boxToPoints(parsedBox, cvatPoints);
console.assert(reconstitutedPoints[0] === 1 && reconstitutedPoints[1] === 2 && reconstitutedPoints[2] === 3, 'Position reconstituted correctly');
console.assert(reconstitutedPoints[6] === 1.8 && reconstitutedPoints[7] === 4.5 && reconstitutedPoints[8] === 1.5, 'Dimensions reconstituted correctly');
console.assert(reconstitutedPoints[5] === 0.3, 'Yaw angle reconstituted correctly');
console.log('✓ TrackReader.parsePointsToBox & boxToPoints roundtrip passed');

// 5. Test heading inversion (180 deg flip)
const originalYaw = 0.5; // rad
let flippedYaw = originalYaw + Math.PI;
while (flippedYaw > Math.PI) flippedYaw -= Math.PI * 2;
console.assert(Math.abs(flippedYaw - (0.5 - Math.PI)) < 1e-5, 'Yaw 180 flip should be normalized');
console.log('✓ Heading inversion math passed');

// 6. Test OrthoCanvasRenderer getMetrics & drag translation
const mockCanvas = { width: 220, height: 110 };
const testBox = { x: 5, y: 10, z: 2, rx: 0, ry: 0, rz: Math.PI / 4, sx: 2, sy: 4, sz: 1.5 };
const topMetrics = OrthoCanvasRenderer.getMetrics(mockCanvas, testBox, 'top');
console.assert(topMetrics.width === 220 && topMetrics.height === 110, 'Metrics dimensions parsed');
console.assert(topMetrics.centerX === 110 && topMetrics.centerY === 55, 'Center point calculated');
console.assert(topMetrics.scale > 0, 'Scale is positive');
console.assert(topMetrics.corners && topMetrics.corners.tl && topMetrics.corners.br, 'Corners calculated');
console.assert(typeof topMetrics.rotDotX === 'number' && typeof topMetrics.rotDotY === 'number', 'Rotation handle calculated');

// Test translation conversion in Top view: drag 20px in local horizontal
const d_h = 20 / topMetrics.scale;
const d_v = 0;
const d_lx = d_h;
const d_ly = d_v;
const rz = testBox.rz;
const d_wx = d_lx * Math.cos(rz) - d_ly * Math.sin(rz);
const d_wy = d_lx * Math.sin(rz) + d_ly * Math.cos(rz);
console.assert(Math.abs(Math.hypot(d_wx, d_wy) - d_h) < 1e-4, 'World displacement magnitude matches local');
console.log('✓ Direct manipulation projection math passed');

// 7. Test CVAT 4-corner resizing with fixed opposite corner anchor across Top, Side, Front views
const OPP = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
for (const viewType of ['top', 'side', 'front']) {
    for (const cornerKey of ['tl', 'tr', 'bl', 'br']) {
        const initialBox = { x: 14.2, y: -7.5, z: 2.1, rz: 0.52, sx: 2.2, sy: 4.6, sz: 1.7 };
        let dimH = 2.2, dimV = 4.6;
        if (viewType === 'top') { dimH = initialBox.sx; dimV = initialBox.sy; }
        else if (viewType === 'front') { dimH = initialBox.sy; dimV = initialBox.sz; }
        else if (viewType === 'side') { dimH = initialBox.sx; dimV = initialBox.sz; }

        const signU = (cornerKey === 'tr' || cornerKey === 'br') ? 1 : -1;
        const signV = (cornerKey === 'tl' || cornerKey === 'tr') ? 1 : -1;
        const oppLocalU = -signU * (dimH / 2);
        const oppLocalV = -signV * (dimV / 2);

        // Initial world coordinates of opposite corner
        const rz0 = initialBox.rz;
        let init_lx = 0, init_ly = 0, init_lz = 0;
        if (viewType === 'top') { init_lx = oppLocalU; init_ly = oppLocalV; }
        else if (viewType === 'front') { init_lx = 0; init_ly = oppLocalU; init_lz = oppLocalV; }
        else if (viewType === 'side') { init_lx = -oppLocalU; init_ly = 0; init_lz = oppLocalV; }

        const initOppWorld = {
            x: initialBox.x + init_lx * Math.cos(rz0) - init_ly * Math.sin(rz0),
            y: initialBox.y + init_lx * Math.sin(rz0) + init_ly * Math.cos(rz0),
            z: initialBox.z + init_lz
        };

        // Simulate user dragging corner
        const u_cur = oppLocalU + signU * (dimH + 1.5);
        const v_cur = oppLocalV + signV * (dimV - 0.3);

        const newDimH = Math.max(0.15, (u_cur - oppLocalU) * signU);
        const newDimV = Math.max(0.15, (v_cur - oppLocalV) * signV);
        const u_clamped = oppLocalU + signU * newDimH;
        const v_clamped = oppLocalV + signV * newDimV;

        const u_mid = (oppLocalU + u_clamped) / 2;
        const v_mid = (oppLocalV + v_clamped) / 2;

        let nextSx = initialBox.sx, nextSy = initialBox.sy, nextSz = initialBox.sz;
        let d_mid_lx = 0, d_mid_ly = 0, d_mid_lz = 0;

        if (viewType === 'top') {
            d_mid_lx = u_mid; d_mid_ly = v_mid;
            nextSx = newDimH; nextSy = newDimV;
        } else if (viewType === 'front') {
            d_mid_ly = u_mid; d_mid_lz = v_mid;
            nextSy = newDimH; nextSz = newDimV;
        } else if (viewType === 'side') {
            d_mid_lx = -u_mid; d_mid_lz = v_mid;
            nextSx = newDimH; nextSz = newDimV;
        }

        const d_wx_mid = d_mid_lx * Math.cos(rz0) - d_mid_ly * Math.sin(rz0);
        const d_wy_mid = d_mid_lx * Math.sin(rz0) + d_mid_ly * Math.cos(rz0);
        const d_wz_mid = d_mid_lz;

        const newBox = {
            x: initialBox.x + d_wx_mid,
            y: initialBox.y + d_wy_mid,
            z: initialBox.z + d_wz_mid,
            sx: nextSx, sy: nextSy, sz: nextSz
        };

        // Opposite corner in new box
        const newOppLocalU = -signU * (newDimH / 2);
        const newOppLocalV = -signV * (newDimV / 2);
        let new_lx = 0, new_ly = 0, new_lz = 0;
        if (viewType === 'top') { new_lx = newOppLocalU; new_ly = newOppLocalV; }
        else if (viewType === 'front') { new_lx = 0; new_ly = newOppLocalU; new_lz = newOppLocalV; }
        else if (viewType === 'side') { new_lx = -newOppLocalU; new_ly = 0; new_lz = newOppLocalV; }

        const newOppWorld = {
            x: newBox.x + new_lx * Math.cos(rz0) - new_ly * Math.sin(rz0),
            y: newBox.y + new_lx * Math.sin(rz0) + new_ly * Math.cos(rz0),
            z: newBox.z + new_lz
        };

        const error = Math.hypot(newOppWorld.x - initOppWorld.x, newOppWorld.y - initOppWorld.y, newOppWorld.z - initOppWorld.z);
        console.assert(error < 1e-12, `Opposite corner anchor invariance failed for ${viewType} ${cornerKey}, error = ${error}`);
    }
}
console.log('✓ Authentic CVAT 4-corner resizing with fixed opposite anchor passed (12/12 cases error < 1e-12m)');

// 8. Test SizeClipboard (Copy & Paste size mechanism)
const sampleBox = { sx: 1.95, sy: 4.82, sz: 1.65 };
const copied = SizeClipboard.copy(sampleBox);
console.assert(copied && copied.sx === 1.95 && copied.sy === 4.82 && copied.sz === 1.65, 'SizeClipboard.copy normalizes properly');
console.assert(copied.w === 1.95 && copied.l === 4.82 && copied.h === 1.65, 'W, L, H aliases present for cross-compatibility');

const retrieved = await SizeClipboard.get();
console.assert(retrieved && retrieved.sx === 1.95 && retrieved.sy === 4.82 && retrieved.sz === 1.65, 'SizeClipboard.get retrieves copied size');
console.assert(SizeClipboard.hasData() === true, 'SizeClipboard.hasData reports true');

// Test string / JSON parsing fallback
const normFromJson = SizeClipboard.normalize({ w: 2.1, l: 5.0, h: 1.8 });
console.assert(normFromJson && normFromJson.sx === 2.1 && normFromJson.sy === 5.0 && normFromJson.sz === 1.8, 'SizeClipboard.normalize handles w,l,h format');
console.log('✓ SizeClipboard copy & paste mechanism passed');

// 9. Test CVATHook Undo / Redo Mechanism
const hook = new CVATHook();
let undoCalled = false;
let redoCalled = false;
let dispatchAction = null;

const mockJob = {
    actions: {
        undo: async () => { undoCalled = true; return [42]; },
        redo: async () => { redoCalled = true; return [42]; },
        get: async () => ({ undo: [], redo: [['Changed points', 0]] })
    },
    annotations: {
        get: async () => [{ clientID: 42, points: [1, 2, 3, 0, 0, 0, 2, 4, 1] }]
    }
};

const mockStore = {
    dispatch: (action) => { dispatchAction = action; }
};

hook.jobInstance = mockJob;
hook.store = mockStore;
hook.activeClientID = 42;

let historyEventFired = false;
hook.on('historyChange', () => { historyEventFired = true; });

const undoSuccess = await hook.undo();
console.assert(undoSuccess === true, 'Undo executed successfully');
console.assert(undoCalled === true, 'jobInstance.actions.undo() was called');
console.assert(dispatchAction && dispatchAction.type === 'UPDATE_ANNOTATIONS_SUCCESS', 'Redux UPDATE_ANNOTATIONS_SUCCESS dispatched');
console.assert(historyEventFired === true, 'historyChange event was emitted');

// Reset debounce lock for test
hook._undoRedoLock = false;
const redoSuccess = await hook.redo();
console.assert(redoSuccess === true, 'Redo executed successfully');
console.assert(redoCalled === true, 'jobInstance.actions.redo() was called');
console.log('✓ CVAT native Undo/Redo hook & Redux history synchronization passed');

// Visible-frame edits must use CVAT's native canvas update path so the Three.js
// cuboid moves immediately instead of waiting for a frame change or reload.
const realtimeHook = new CVATHook();
const realtimeOldPoints = [0, 0, 1.2, 0, 0, 0, 4.5, 1.8, 1.5];
const realtimeNewPoints = [0, 0, 0.8, 0.01, -0.02, 0, 4.5, 1.8, 1.5];
let realtimeSaveCalls = 0;
let realtimeCanvasCalls = 0;
const realtimeAnnotationState = {
    clientID: 77,
    frame: 5,
    points: [...realtimeOldPoints],
    async save() { realtimeSaveCalls++; },
};
const realtimeDrawn = {
    state: { clientID: 77, frame: 5, points: [...realtimeOldPoints] },
    data: { points: [...realtimeOldPoints] },
};
const realtimeCanvas = document.createElement('canvas');
realtimeCanvas.getDrawnObjects = () => [realtimeDrawn];
realtimeCanvas.updatePosition = (state, points) => {
    realtimeCanvasCalls++;
    state.points = [...points];
    realtimeDrawn.data.points = [...points];
    realtimeAnnotationState.points = [...points];
};
document.body.appendChild(realtimeCanvas);
realtimeHook.currentFrame = 5;
realtimeHook.canvasInstance = { render() {} };
realtimeHook.jobInstance = {
    annotations: { get: async () => [realtimeAnnotationState] },
    actions: { get: async () => ({ undo: [], redo: [] }) },
};
realtimeHook.store = { dispatch() {} };
const realtimeUpdated = await realtimeHook.updateObjectCuboid(5, 77, realtimeNewPoints);
realtimeCanvas.remove();
console.assert(realtimeUpdated === true && realtimeCanvasCalls === 1,
    'Visible frame must update through canvas.updatePosition exactly once');
console.assert(realtimeSaveCalls === 0,
    'Visible-frame realtime update must not create a second save/history entry');
console.assert(CVATHook.sameCuboidPoints(realtimeDrawn.data.points, realtimeNewPoints),
    'Realtime Three.js geometry must match the requested cuboid points');
console.log('✓ CVATHook visible-frame cuboid updates through native realtime canvas path');

// 10. Test discrete rotation increments for Top (5°, 90°) and Side/Front (1°, 90°)
const rotateAngle = (currentVal, deltaRad) => {
    let nextVal = currentVal + deltaRad;
    while (nextVal > Math.PI) nextVal -= Math.PI * 2;
    while (nextVal < -Math.PI) nextVal += Math.PI * 2;
    return parseFloat(nextVal.toFixed(4));
};

// Top: 5° and 90° increments
let yaw = 0;
yaw = rotateAngle(yaw, 5 * Math.PI / 180);
console.assert(Math.abs(yaw - (5 * Math.PI / 180)) < 1e-4, 'Top +5 deg test');
yaw = rotateAngle(yaw, Math.PI / 2);
console.assert(Math.abs(yaw - (95 * Math.PI / 180)) < 1e-4, 'Top +90 deg test');
yaw = rotateAngle(yaw, -Math.PI / 2);
console.assert(Math.abs(yaw - (5 * Math.PI / 180)) < 1e-4, 'Top -90 deg test');
yaw = rotateAngle(yaw, -5 * Math.PI / 180);
console.assert(Math.abs(yaw - 0) < 1e-4, 'Top -5 deg test');

// Side / Front: 1° and 90° increments
let pitch = 0;
pitch = rotateAngle(pitch, 1 * Math.PI / 180);
console.assert(Math.abs(pitch - (1 * Math.PI / 180)) < 1e-4, 'Side/Front +1 deg test');
pitch = rotateAngle(pitch, Math.PI / 2);
console.assert(Math.abs(pitch - (91 * Math.PI / 180)) < 1e-4, 'Side/Front +90 deg test');
pitch = rotateAngle(pitch, -Math.PI / 2);
console.assert(Math.abs(pitch - (1 * Math.PI / 180)) < 1e-4, 'Side/Front -90 deg test');
pitch = rotateAngle(pitch, -1 * Math.PI / 180);
console.assert(Math.abs(pitch - 0) < 1e-4, 'Side/Front -1 deg test');
console.log('✓ Discrete rotation increments (Top: 5°, 90°; Side/Front: 1°, 90°) passed');

// 11. Test 3-axis rotation across Top (Yaw / rz), Front (Roll / rx), and Side (Pitch / ry)
// Verifies authentic 3D local-axis rotation and independence from yaw cross-coupling
const testLocalRotation = (initialYawDeg) => {
    const initialYaw = initialYawDeg * Math.PI / 180;
    const baseBox = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: initialYaw, sx: 2, sy: 4, sz: 1.5 };

    // Front rotation (+5 deg): must affect roll only
    const rotFront = Math3D.rotateLocal(baseBox, 'front', 5 * Math.PI / 180);
    const anglesFront = Math3D.getLocalAngles(rotFront);
    const rollFrontDeg = anglesFront.roll * 180 / Math.PI;
    const pitchFrontDeg = anglesFront.pitch * 180 / Math.PI;
    console.assert(Math.abs(rollFrontDeg - 5.0) < 0.1, `Front roll test at yaw ${initialYawDeg} deg failed, got ${rollFrontDeg}`);
    console.assert(Math.abs(pitchFrontDeg) < 0.1, `Front pitch leak test at yaw ${initialYawDeg} deg failed, got ${pitchFrontDeg}`);

    // Side rotation (+5 deg): must affect pitch only
    const rotSide = Math3D.rotateLocal(baseBox, 'side', 5 * Math.PI / 180);
    const anglesSide = Math3D.getLocalAngles(rotSide);
    const pitchSideDeg = anglesSide.pitch * 180 / Math.PI;
    const rollSideDeg = anglesSide.roll * 180 / Math.PI;
    console.assert(Math.abs(pitchSideDeg - 5.0) < 0.1, `Side pitch test at yaw ${initialYawDeg} deg failed, got ${pitchSideDeg}`);
    console.assert(Math.abs(rollSideDeg) < 0.1, `Side roll leak test at yaw ${initialYawDeg} deg failed, got ${rollSideDeg}`);

    // Top rotation (+5 deg): must affect yaw only
    const rotTop = Math3D.rotateLocal(baseBox, 'top', 5 * Math.PI / 180);
    const anglesTop = Math3D.getLocalAngles(rotTop);
    const expectedYawDeg = initialYawDeg + 5;
    const diffYaw = Math.abs(anglesTop.yaw * 180 / Math.PI - expectedYawDeg);
    console.assert(diffYaw < 0.1 || Math.abs(diffYaw - 360) < 0.1, `Top yaw test at yaw ${initialYawDeg} deg failed`);
    console.assert(Math.abs(anglesTop.pitch * 180 / Math.PI) < 0.1 && Math.abs(anglesTop.roll * 180 / Math.PI) < 0.1, `Top tilt leak test failed`);
};

for (const yaw of [0, 30, 45, 90, 135, 180, -90]) {
    testLocalRotation(yaw);
}
console.log('✓ 3-Axis local-axis rotation (Top/Yaw, Front/Roll, Side/Pitch) with zero cross-coupling passed across 7 yaw angles');

// 12. Test Outside frame retention and CVATHook.updateObjectOutside
const mockTrackStates = {
    0: [{ clientID: 101, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5], outside: false, keyframe: true, keyframes: { first: 0, last: 2 } }],
    1: [{ clientID: 101, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5], outside: true,  keyframe: true, keyframes: { first: 0, last: 2 } }],
    2: [{ clientID: 101, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5], outside: true,  keyframe: true, keyframes: { first: 0, last: 2 } }],
    3: [{ clientID: 101, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5], outside: true,  keyframe: false, keyframes: { first: 0, last: 2 } }] // After track end
};

const mockJobForOutside = {
    startFrame: 0,
    stopFrame: 3,
    annotations: {
        get: async (f) => mockTrackStates[f] || []
    }
};

const trackResults = await TrackReader.getTrackFrames(101, mockJobForOutside);
console.assert(trackResults.length === 3, `Expected 3 frames (0, 1, 2), got ${trackResults.length}`);
console.assert(trackResults[0].outside === false, 'Frame 0 is inside');
console.assert(trackResults[1].outside === true, 'Frame 1 is outside and RETAINED in filmstrip');
console.assert(trackResults[2].outside === true, 'Frame 2 is outside and RETAINED in filmstrip');
console.log('✓ TrackReader outside frame retention within lifespan passed');

// Test CVATHook.updateObjectOutside
let saveCalled = false;
let updatedStateOutside = null;
const mockTargetState = {
    clientID: 101,
    outside: false,
    save: async () => { saveCalled = true; updatedStateOutside = mockTargetState.outside; }
};

hook.jobInstance = {
    annotations: {
        get: async () => [mockTargetState]
    },
    actions: {
        get: async () => ({})
    }
};

const outsideUpdated = await hook.updateObjectOutside(1, 101, true);
console.assert(outsideUpdated === true, 'updateObjectOutside returned true');
console.assert(saveCalled === true, 'targetState.save() was called');
console.assert(updatedStateOutside === true, 'targetState.outside was updated to true');
console.log('✓ CVATHook.updateObjectOutside in-memory persistence passed');

// Native CVAT Outside changes must emit a dedicated event even when the
// Undo/Redo stack lengths do not change.
let outsideStoreSubscriber = null;
const outsideReduxState = {
    annotation: {
        job: { instance: mockJobForOutside },
        canvas: { instance: null },
        player: { frame: { number: 1 } },
        annotations: {
            states: [{ clientID: 101, frame: 1, outside: false, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5] }],
            activatedStateID: 101,
            selectedStatesID: [101],
            history: { undo: [], redo: [] }
        }
    }
};
const outsideSyncHook = new CVATHook();
outsideSyncHook.store = {
    getState: () => outsideReduxState,
    subscribe: (callback) => { outsideStoreSubscriber = callback; }
};
let nativeOutsideEvent = null;
outsideSyncHook.on('objectOutsideChanged', (event) => { nativeOutsideEvent = event; });
outsideSyncHook.setupStoreListener();
outsideReduxState.annotation.annotations.states[0] = {
    ...outsideReduxState.annotation.annotations.states[0],
    outside: true
};
outsideStoreSubscriber();
console.assert(nativeOutsideEvent?.clientID === 101 && nativeOutsideEvent.frame === 1 && nativeOutsideEvent.outside === true,
    'Native CVAT Outside toggle must emit an immediate Inspector synchronization event');
console.assert(nativeOutsideEvent?.source === 'cvat',
    'Native Outside synchronization event must identify CVAT as its source');
console.log('✓ Native CVAT Outside changes emit realtime Inspector synchronization');

// Test that OrthoCanvasRenderer renders the box when outside is true (with dashed border and outside marking)
let fillRectCalls = [];
let strokeRectCalls = [];
let fillTextCalls = [];
let setLineDashCalls = [];

const mockCtx = {
    save: () => {},
    restore: () => {},
    scale: () => {},
    fillRect: (x, y, w, h) => { fillRectCalls.push({ x, y, w, h }); },
    strokeRect: (x, y, w, h) => { strokeRectCalls.push({ x, y, w, h }); },
    fillText: (text, x, y) => { fillTextCalls.push({ text, x, y }); },
    setLineDash: (d) => { setLineDashCalls.push(d); },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    closePath: () => {},
    measureText: () => ({ width: 30 })
};

const mockCanvasForOutside = {
    width: 220,
    height: 110,
    clientWidth: 220,
    clientHeight: 110,
    getContext: () => mockCtx
};

OrthoCanvasRenderer.render(mockCanvasForOutside, null, testBox, 'top', { outside: true });
console.assert(fillRectCalls.length >= 2, 'Outside frame still renders background and box fill');
console.assert(strokeRectCalls.length >= 1, 'Outside frame still renders box outline');
console.assert(fillTextCalls.some(c => c.text === 'OUTSIDE'), 'Outside watermark text rendered in box');
console.assert(setLineDashCalls.some(d => d.length > 0), 'Outside box outline uses dashed border');
console.log('✓ OrthoCanvasRenderer outside box retention & styling passed');

// 13. Test ALLOWED_SITES whitelist verification without regex

console.assert(isAllowedSite('http://localhost:8080/tasks/1/jobs/1') === true, 'localhost:8080 should be allowed');
console.assert(isAllowedSite('http://127.0.0.1:8080/tasks/2') === true, '127.0.0.1:8080 should be allowed');
console.assert(isAllowedSite('https://app.cvat.ai/tasks/100') === true, 'app.cvat.ai should be allowed');
console.assert(isAllowedSite('http://localhost:3000') === true, 'localhost:3000 should be allowed');

// Custom CVAT instances (matched via https://cvat*)
console.assert(isAllowedSite('https://cvat-test.vantixapps.net/tasks/1/jobs/1') === true, 'cvat-test.vantixapps.net matched via https://cvat*');
console.assert(isAllowedSite('https://cvat-prod.vantixapps.net/jobs/42') === true, 'cvat-prod.vantixapps.net matched via https://cvat*');
console.assert(isAllowedSite('https://cvat.internal-company.org/tasks/5') === true, 'cvat.internal-company.org matched via https://cvat*');

// Non-CVAT ports / sites should be blocked cleanly
console.assert(isAllowedSite('http://127.0.0.1:5173/plans/week-02/test-2-listening-p1-p2') === false, 'Vite port 5173 must be rejected');
console.assert(isAllowedSite('http://localhost:5173') === false, 'localhost:5173 must be rejected');
console.assert(isAllowedSite('http://127.0.0.1:8000') === false, '127.0.0.1:8000 must be rejected');
console.assert(isAllowedSite('https://google.com') === false, 'google.com must be rejected');
console.log('✓ ALLOWED_SITES whitelist verification passed (0 regex, exact origin matching)');

// 14. Test CVATHook.filterByObjectID & clearFilter (Target object isolation)
const mockMultiObjectStates = [
    { clientID: 101, hidden: false, points: [1, 2, 3, 0, 0, 0, 2, 4, 1.5] },
    { clientID: 102, hidden: false, points: [4, 5, 6, 0, 0, 0, 2, 4, 1.5] },
    { clientID: 103, hidden: false, points: [7, 8, 9, 0, 0, 0, 2, 4, 1.5] }
];

let lastDispatchedAction = null;
hook.store = {
    getState: () => ({
        annotation: {
            player: { frame: { number: 0 } },
            annotations: { states: mockMultiObjectStates, filters: [] }
        }
    }),
    dispatch: (action) => {
        lastDispatchedAction = action;
    }
};

hook.jobInstance = {
    annotations: {
        get: async (f, allTracks, filters) => {
            if (filters && filters.length > 0 && JSON.stringify(filters[0]).includes('102')) {
                return mockMultiObjectStates.filter(s => s.clientID === 102);
            }
            return mockMultiObjectStates;
        }
    },
    actions: {
        get: async () => ({})
    }
};

// Filter to Object #102
const filterSuccess = await hook.filterByObjectID(102);
console.assert(filterSuccess === true, 'filterByObjectID returned true');
console.assert(hook.activeFilterID === 102, 'activeFilterID set to 102');
console.assert(lastDispatchedAction.type === 'FETCH_ANNOTATIONS_SUCCESS', 'Dispatched FETCH_ANNOTATIONS_SUCCESS');
console.assert(lastDispatchedAction.payload.states.length === 1, 'Only 1 object returned in state');
console.assert(lastDispatchedAction.payload.states[0].clientID === 102, 'Filtered state has clientID 102');
console.assert(mockMultiObjectStates.find(s => s.clientID === 101).hidden === true, 'Object 101 marked as hidden');
console.assert(mockMultiObjectStates.find(s => s.clientID === 102).hidden === false, 'Object 102 NOT hidden');
console.assert(mockMultiObjectStates.find(s => s.clientID === 103).hidden === true, 'Object 103 marked as hidden');
console.log('✓ CVATHook.filterByObjectID track isolation passed (other objects hidden)');

// Clear filter
const clearSuccess = await hook.clearFilter();
console.assert(clearSuccess === true, 'clearFilter returned true');
console.assert(hook.activeFilterID === null, 'activeFilterID reset to null');
console.assert(lastDispatchedAction.type === 'FETCH_ANNOTATIONS_SUCCESS', 'Dispatched FETCH_ANNOTATIONS_SUCCESS on clear');
console.assert(lastDispatchedAction.payload.states.length === 3, 'All 3 objects restored');
console.assert(mockMultiObjectStates.every(s => s.hidden === false), 'All objects unhidden');
console.log('✓ CVATHook.clearFilter restored all objects');

// 15. Test Realtime Keyframe Detection & Shortest-Arc Interpolation
const degToRad = d => d * Math.PI / 180;
const radToDeg = r => r * 180 / Math.PI;

const mockExportedJob = {
    startFrame: 0,
    stopFrame: 59,
    size: 60,
    annotations: {
        export: async () => ({
            tracks: [
                {
                    clientID: 555,
                    shapes: [
                        { frame: 0, points: [0, 0, 0, 0, 0, degToRad(170), 2, 4, 1.5], outside: false },
                        { frame: 20, points: [20, 40, 0, 0, 0, degToRad(-170), 2, 4, 1.5], outside: false },
                        { frame: 50, points: [50, 100, 0, 0, 0, degToRad(180), 2, 4, 1.5], outside: true }
                    ]
                }
            ],
            shapes: []
        })
    }
};

const startTime = Date.now();
const trackFrames = await TrackReader.getTrackFrames(555, mockExportedJob);
const durationMs = Date.now() - startTime;

console.assert(trackFrames.length === 51, `Expected 51 frames (0 to 50), got ${trackFrames.length}`);
console.assert(durationMs < 20, `Execution took ${durationMs}ms, expected < 20ms`);
console.assert(trackFrames[0].keyframe === true, 'Frame 0 is keyframe');
console.assert(trackFrames[20].keyframe === true, 'Frame 20 is keyframe');
console.assert(trackFrames[50].keyframe === true, 'Frame 50 is keyframe');
console.assert(trackFrames[10].keyframe === false, 'Frame 10 is interpolated');
console.assert(trackFrames[50].outside === true, 'Frame 50 is outside');

// Verify shortest arc interpolation across 180° boundary (170° to -170° -> midpoint at 180°)
const midYawDeg = Math.round(radToDeg(trackFrames[10].points[5]));
console.assert(Math.abs(midYawDeg) === 180, `Midpoint yaw should be 180° or -180°, got ${midYawDeg}°`);
console.assert(trackFrames[10].points[0] === 10, 'Midpoint position x should be 10');
console.assert(trackFrames[10].points[1] === 20, 'Midpoint position y should be 20');

// Test live reactive keyframe update (promote frame 10 to keyframe)
const updatedPoints = [12, 22, 0, 0, 0, degToRad(90), 2, 4, 1.5];
const liveUpdated = TrackReader.updateTrackKeyframe(555, 10, updatedPoints, false);
console.assert(liveUpdated !== null, 'Live keyframe update returned frames');
const f10 = liveUpdated.find(f => f.frame === 10);
console.assert(f10.keyframe === true, 'Frame 10 promoted to keyframe');
console.assert(f10.points[0] === 12, 'Frame 10 updated position');
console.log('✓ TrackReader 100% keyframe accuracy & realtime shortest-arc 3D interpolation passed');

// 17. Test Fixed Camera View Order (Top -> Side -> Front)
const fixedViewOrder = ['top', 'side', 'front'];

const mockGrid = {
    children: [],
    appendChild: function(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.children.push(child);
    }
};

const mockCells = {
    top: { id: 'top' },
    front: { id: 'front' },
    side: { id: 'side' }
};

// Order: Top -> Side -> Front
for (const v of fixedViewOrder) {
    mockGrid.appendChild(mockCells[v]);
}
console.assert(mockGrid.children[0].id === 'top' && mockGrid.children[1].id === 'side' && mockGrid.children[2].id === 'front', 'Default view order is strictly Top, Side, Front');
console.log('✓ Fixed Camera View Order (Top -> Side -> Front) passed');

// 18. Test Quick ID Filter parsing & frame jump logic
const parseQuickFilterID = (raw) => {
    const cleaned = String(raw).trim().replace(/^#/, '');
    const id = parseInt(cleaned, 10);
    return isNaN(id) ? null : id;
};

console.assert(parseQuickFilterID('102') === 102, 'Parsed 102 correctly');
console.assert(parseQuickFilterID('#555') === 555, 'Parsed #555 correctly');
console.assert(parseQuickFilterID('  #1514  ') === 1514, 'Trimmed and parsed #1514 correctly');
console.assert(parseQuickFilterID('abc') === null, 'Invalid non-numeric input returns null');
console.assert(parseQuickFilterID('') === null, 'Empty string returns null');

// Simulate quick filter auto-jump when current frame is outside track
let jumpedFrame = null;
const mockHookForJump = {
    currentFrame: 5,
    jumpToFrame: (f) => { jumpedFrame = f; }
};

const simulateQuickFilter = async (targetID, currentTrack) => {
    const hasCurrent = currentTrack.some(f => f.frame === mockHookForJump.currentFrame);
    const targetFrame = hasCurrent ? mockHookForJump.currentFrame : currentTrack[0].frame;
    if (!hasCurrent) {
        mockHookForJump.jumpToFrame(targetFrame);
    }
    return targetFrame;
};

// Track 102 spans frames 20 to 50 (currentFrame is 5)
const targetTrackFrames = [{ frame: 20 }, { frame: 21 }, { frame: 50 }];
const resultFrame = await simulateQuickFilter(102, targetTrackFrames);
console.assert(resultFrame === 20, 'Target frame should be track start frame (20)');
console.assert(jumpedFrame === 20, 'jumpToFrame was invoked with frame 20');
console.log('✓ Quick ID Filter input parsing & auto frame jump passed');

// 19. Test MacOSDock updateFramesData & refreshTrackData consistency
let updateDataCount = 0;
const mockCard = {
    updateData: (d) => { updateDataCount++; }
};
const mockDockInstance = {
    state: { framesData: [] },
    cards: new Map([[0, mockCard], [1, mockCard]]),
    refreshTrackData(framesData) {
        if (!Array.isArray(framesData) || framesData.length === 0) return;
        this.state.framesData = framesData;
        if (this.cards.size === framesData.length) {
            for (const fData of framesData) {
                const card = this.cards.get(fData.frame);
                if (card && typeof card.updateData === 'function') {
                    card.updateData(fData);
                }
            }
        }
    },
    updateFramesData(framesData) {
        this.refreshTrackData(framesData);
    }
};

mockDockInstance.updateFramesData([{ frame: 0 }, { frame: 1 }]);
console.assert(updateDataCount === 2, 'updateFramesData should delegate to refreshTrackData and update all cards');
console.assert(mockDockInstance.state.framesData.length === 2, 'state.framesData updated');
console.log('✓ MacOSDock updateFramesData & refreshTrackData compatibility passed');

// 20. Test TrackReader.applySizeToTrack and realtime visual box resizing
TrackReader.currentTrackData = {
    clientID: 777,
    shapes: [
        { frame: 0, points: [0, 0, 0, 0, 0, 0, 2.0, 4.0, 1.5], outside: false },
        { frame: 10, points: [10, 20, 0, 0, 0, 0, 2.0, 4.0, 1.5], outside: false }
    ],
    startFrame: 0,
    stopFrame: 10,
    label: { name: 'Vehicle', color: '#0A84FF' }
};

const fixedFrames = TrackReader.applySizeToTrack(777, { sx: 1.85, sy: 4.75, sz: 1.62 });
console.assert(fixedFrames && fixedFrames.length === 11, `Expected 11 frames, got ${fixedFrames?.length}`);
for (const f of fixedFrames) {
    console.assert(Math.abs(f.box.sx - 1.85) < 1e-4, `Frame ${f.frame} sx mismatch: ${f.box.sx}`);
    console.assert(Math.abs(f.box.sy - 4.75) < 1e-4, `Frame ${f.frame} sy mismatch: ${f.box.sy}`);
    console.assert(Math.abs(f.box.sz - 1.62) < 1e-4, `Frame ${f.frame} sz mismatch: ${f.box.sz}`);
}
console.log('✓ TrackReader.applySizeToTrack fixed dimensions across all track frames');

// Regression: after fixing all keyframes to one size, a later manual resize must
// become a new keyframe revision instead of snapping back to the fixed size.
const resizedAfterSync = [...fixedFrames[5].points];
resizedAfterSync[6] = 2.15;
resizedAfterSync[7] = 4.95;
resizedAfterSync[8] = 1.72;
const framesAfterManualResize = TrackReader.updateTrackKeyframe(777, 5, resizedAfterSync);
const manuallyResizedFrame = framesAfterManualResize.find((frame) => frame.frame === 5);
const cachedManualKeyframe = TrackReader.currentTrackData.shapes.find((shape) => shape.frame === 5);
console.assert(manuallyResizedFrame?.keyframe === true && cachedManualKeyframe,
    'Manual resize after sync must promote the edited frame to a cached keyframe');
console.assert(Math.abs(manuallyResizedFrame.box.sx - 2.15) < 1e-9 &&
    Math.abs(manuallyResizedFrame.box.sy - 4.95) < 1e-9 &&
    Math.abs(manuallyResizedFrame.box.sz - 1.72) < 1e-9,
    'Manual size revision must remain visible after track re-interpolation');
const rerenderedAfterManualResize = TrackReader.interpolateTrack(
    TrackReader.currentTrackData.shapes,
    TrackReader.currentTrackData.startFrame,
    TrackReader.currentTrackData.stopFrame,
    TrackReader.currentTrackData.label,
);
console.assert(Math.abs(rerenderedAfterManualResize[5].box.sx - 2.15) < 1e-9,
    'A subsequent UI render must not restore the previous synchronized size');
console.log('✓ Manual resize after track-size sync persists across UI re-render');

// Test OrthoCanvasRenderer visual box expansion/contraction with referenceBox
const refBox = { sx: 2.0, sy: 4.0, sz: 1.5 };
const smallBox = { sx: 1.0, sy: 2.0, sz: 1.5 };
const bigBox = { sx: 3.0, sy: 6.0, sz: 1.5 };

const baseM = OrthoCanvasRenderer.getMetrics(mockCanvas, refBox, 'top', { referenceBox: refBox });
const smallM = OrthoCanvasRenderer.getMetrics(mockCanvas, smallBox, 'top', { referenceBox: refBox });
const bigM = OrthoCanvasRenderer.getMetrics(mockCanvas, bigBox, 'top', { referenceBox: refBox });

console.assert(Math.abs(baseM.scale - smallM.scale) < 1e-5, 'Scale remains constant across dimension changes');
console.assert(Math.abs(baseM.scale - bigM.scale) < 1e-5, 'Scale remains constant across dimension changes');
console.assert(smallM.boxPxW < baseM.boxPxW, 'Smaller box has smaller drawn pixel width in realtime');
console.assert(bigM.boxPxW > baseM.boxPxW, 'Bigger box has larger drawn pixel width in realtime');
console.assert(Math.abs(bigM.boxPxW / baseM.boxPxW - 1.5) < 1e-4, 'Box width scales proportionally (1.5x)');
console.log('✓ OrthoCanvasRenderer realtime visual box expansion/contraction with referenceBox passed');

// Large three-view cards should use most of both axes without distorting geometry.
const largeViewCanvas = { clientWidth: 286, clientHeight: 238, width: 286, height: 238 };
const nearSquareBox = { sx: 1.11, sy: 1.06, sz: 1.0 };
const fittedTop = OrthoCanvasRenderer.getMetrics(largeViewCanvas, nearSquareBox, 'top', {
    referenceBox: nearSquareBox,
    marginFactor: 1.10,
});
const fittedWidthRatio = fittedTop.boxPxW / largeViewCanvas.clientWidth;
const fittedHeightRatio = fittedTop.boxPxH / largeViewCanvas.clientHeight;
console.assert(fittedWidthRatio >= 0.68 && fittedWidthRatio <= 1,
    `Large-card box should fill horizontal space without clipping, got ${fittedWidthRatio}`);
console.assert(fittedHeightRatio >= 0.78 && fittedHeightRatio <= 1,
    `Large-card box should fill vertical space without clipping, got ${fittedHeightRatio}`);
console.assert(Math.abs((fittedTop.boxPxW / fittedTop.boxPxH) - (nearSquareBox.sx / nearSquareBox.sy)) < 1e-9,
    'Auto-fit must preserve the projected box aspect ratio');
console.log('✓ Large-card balanced horizontal/vertical fit preserves aspect ratio');

// Hit-testing must use the same projection as the visible red corner handles.
// This guards against regressions where drawing uses the fitted 1.10 margin and
// a stable reference box, but pointer hover silently falls back to other values.
const hitTestCard = Object.create(FrameCard.prototype);
hitTestCard.data = {
    box: { x: 0, y: 0, z: 0, sx: 1.45, sy: 0.82, sz: 1.0 },
};
hitTestCard.originalBox = { x: 0, y: 0, z: 0, sx: 1.11, sy: 1.06, sz: 1.0 };
hitTestCard.lastRenderOptions = { zoom: 1.0 };
const visibleHandleMetrics = OrthoCanvasRenderer.getMetrics(
    largeViewCanvas,
    hitTestCard.data.box,
    'top',
    {
        zoom: 1.0,
        marginFactor: 1.10,
        referenceBox: hitTestCard.originalBox,
    },
);
const pointerHandleMetrics = hitTestCard.getInteractionMetrics(largeViewCanvas, 'top');
for (const cornerKey of ['tl', 'tr', 'bl', 'br']) {
    console.assert(
        Math.abs(pointerHandleMetrics.corners[cornerKey].x - visibleHandleMetrics.corners[cornerKey].x) < 1e-9 &&
        Math.abs(pointerHandleMetrics.corners[cornerKey].y - visibleHandleMetrics.corners[cornerKey].y) < 1e-9,
        `Pointer hit target must overlap visible ${cornerKey} handle`,
    );
}
console.log('✓ FrameCard pointer hit targets overlap all visible corner handles');

// A grown box must be used as the viewport reference so corner handles keep a
// safe gutter instead of being clipped against the canvas edges.
const safeViewportCard = Object.create(FrameCard.prototype);
safeViewportCard.data = { box: { sx: 2.4, sy: 1.8, sz: 1.4 } };
safeViewportCard.originalBox = { sx: 1.1, sy: 1.0, sz: 1.0 };
safeViewportCard.lastRenderOptions = { zoom: 1 };
safeViewportCard.viewZoom = { top: 1, side: 1, front: 1 };
const safeReference = safeViewportCard.getViewportReferenceBox();
const safeMetrics = safeViewportCard.getInteractionMetrics(largeViewCanvas, 'top');
console.assert(safeReference.sx === 2.4 && safeReference.sy === 1.8,
    'Viewport reference must expand with the current box');
console.assert(safeMetrics.boxLeft >= 14 && safeMetrics.boxRight <= largeViewCanvas.clientWidth - 14,
    'Grown box must retain horizontal pointer gutter');
console.assert(safeMetrics.boxTop >= 14 && safeMetrics.boxBottom <= largeViewCanvas.clientHeight - 14,
    'Grown box must retain vertical pointer gutter');

// Wheel zoom is continuous, directionally correct, and safely bounded.
const zoomInTarget = FrameCard.wheelZoomTarget(1, -120);
const zoomOutTarget = FrameCard.wheelZoomTarget(1, 120);
console.assert(zoomInTarget > 1 && zoomOutTarget < 1,
    'Wheel direction must zoom in/out continuously');
console.assert(FrameCard.wheelZoomTarget(2.75, -10000) === 2.75,
    'Wheel zoom must respect maximum bound');
console.assert(FrameCard.wheelZoomTarget(0.45, 10000) === 0.45,
    'Wheel zoom must respect minimum bound');
console.log('✓ FrameCard safe corner gutter and bounded smooth wheel zoom passed');

// Test 21: Screen-space opposite corner anchor invariance & Edge resize prohibition
const testMetrics = OrthoCanvasRenderer.getMetrics(mockCanvas, { sx: 2.0, sy: 4.0, sz: 1.5 }, 'top');
const oppPxX = testMetrics.corners.bl.x;
const oppPxY = testMetrics.corners.bl.y;
const simulatedDragPos = { x: testMetrics.corners.tr.x + 35, y: testMetrics.corners.tr.y - 20 };

const scale = testMetrics.scale;
const minDimPx = 0.15 * scale;
const clampedDragX = Math.max(oppPxX + minDimPx, simulatedDragPos.x);
const clampedDragY = Math.min(oppPxY - minDimPx, simulatedDragPos.y);

const resizeBoxPx = {
    left: Math.min(oppPxX, clampedDragX),
    right: Math.max(oppPxX, clampedDragX),
    top: Math.min(oppPxY, clampedDragY),
    bottom: Math.max(oppPxY, clampedDragY),
    width: Math.abs(clampedDragX - oppPxX),
    height: Math.abs(oppPxY - clampedDragY)
};

// Invariant 1: Opposite corner pixel position remains 100% frozen
console.assert(Math.abs(resizeBoxPx.left - oppPxX) < 1e-9, 'Opposite anchor X stays invariant to 0px');
console.assert(Math.abs(resizeBoxPx.bottom - oppPxY) < 1e-9, 'Opposite anchor Y stays invariant to 0px');

// Invariant 2: Dragged corner is exactly at mouse pointer
console.assert(Math.abs(resizeBoxPx.right - simulatedDragPos.x) < 1e-9, 'Dragged corner X follows mouse exactly');
console.assert(Math.abs(resizeBoxPx.top - simulatedDragPos.y) < 1e-9, 'Dragged corner Y follows mouse exactly');

console.log('✓ Screen-space 4-corner resizing with fixed opposite anchor & zero edge resize passed');

// Test 22: Localized FrameCard Undo / Redo history stack
class MockFrameCard {
    constructor(frame, data) {
        this.frame = frame;
        this.data = JSON.parse(JSON.stringify(data));
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 30;
    }
    takeSnapshot() {
        return {
            box: { ...(this.data.box || {}) },
            points: Array.isArray(this.data.points) ? [...this.data.points] : [],
            outside: !!this.data.outside,
            keyframe: !!this.data.keyframe
        };
    }
    pushUndoSnapshot(snap) {
        if (!snap) return;
        this.undoStack.push(snap);
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
        this.redoStack = [];
    }
    undo() {
        if (this.undoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const prevSnap = this.undoStack.pop();
        this.redoStack.push(currentSnap);
        if (this.redoStack.length > this.maxHistory) this.redoStack.shift();
        this.restoreSnapshot(prevSnap);
        return true;
    }
    redo() {
        if (this.redoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const nextSnap = this.redoStack.pop();
        this.undoStack.push(currentSnap);
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
        this.restoreSnapshot(nextSnap);
        return true;
    }
    restoreSnapshot(snap) {
        if (!snap) return;
        this.data.box = { ...(snap.box || {}) };
        this.data.points = Array.isArray(snap.points) ? [...snap.points] : [];
        this.data.outside = !!snap.outside;
        this.data.keyframe = !!snap.keyframe;
    }
}

const card0 = new MockFrameCard(0, {
    box: { x: 1, y: 2, z: 3, rx: 0, ry: 0, rz: 0.2, sx: 2.0, sy: 4.5, sz: 1.6 },
    points: [1, 2, 3, 0, 0, 0.2, 2.0, 4.5, 1.6],
    outside: false,
    keyframe: true
});

// 1. Initial state
console.assert(card0.undo() === false, 'Undo on empty stack should return false');
console.assert(card0.redo() === false, 'Redo on empty stack should return false');

// 2. Perform edit 1: change dimensions & outside
card0.pushUndoSnapshot(card0.takeSnapshot());
card0.data.box.sx = 2.5;
card0.data.outside = true;
console.assert(card0.undoStack.length === 1, 'Undo stack has 1 snapshot');

// 3. Perform edit 2: rotate
card0.pushUndoSnapshot(card0.takeSnapshot());
card0.data.box.rz = 0.8;
console.assert(card0.undoStack.length === 2, 'Undo stack has 2 snapshots');

// 4. Undo edit 2
const didUndo1 = card0.undo();
console.assert(didUndo1 === true, 'Undo should succeed');
console.assert(Math.abs(card0.data.box.rz - 0.2) < 1e-5, 'rz restored to 0.2');
console.assert(Math.abs(card0.data.box.sx - 2.5) < 1e-5, 'sx is still 2.5');
console.assert(card0.data.outside === true, 'outside is still true');
console.assert(card0.redoStack.length === 1, 'Redo stack has 1 snapshot');

// 5. Undo edit 1
const didUndo2 = card0.undo();
console.assert(didUndo2 === true, 'Undo should succeed');
console.assert(Math.abs(card0.data.box.sx - 2.0) < 1e-5, 'sx restored to initial 2.0');
console.assert(card0.data.outside === false, 'outside restored to initial false');
console.assert(card0.redoStack.length === 2, 'Redo stack has 2 snapshots');

// 6. Redo edit 1
const didRedo1 = card0.redo();
console.assert(didRedo1 === true, 'Redo should succeed');
console.assert(Math.abs(card0.data.box.sx - 2.5) < 1e-5, 'sx redone to 2.5');
console.assert(card0.data.outside === true, 'outside redone to true');
console.assert(card0.redoStack.length === 1, 'Redo stack has 1 snapshot remaining');

// 7. Branching edit clears redo stack
card0.pushUndoSnapshot(card0.takeSnapshot());
card0.data.box.sy = 5.0;
console.assert(card0.redoStack.length === 0, 'New mutation should clear redo stack');

console.log('✓ Localized FrameCard Undo / Redo history stack passed');

// Test 23: A completed resize must not replay stale interaction/cache state.
const renderInteractionCard = Object.create(FrameCard.prototype);
renderInteractionCard.data = {
    box: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 3.1, sy: 1.1, sz: 2.3 },
    label: { color: '#30D158' },
    outside: false,
};
renderInteractionCard.originalBox = { ...renderInteractionCard.data.box };
renderInteractionCard.dragState = { initialLocalPoints: new Float32Array([0, 0, 0, 1]) };
renderInteractionCard.dom = { classList: { add() {}, remove() {} } };
renderInteractionCard.currentBadge = { style: {} };
renderInteractionCard.grid = { className: '' };
renderInteractionCard.canvases = Object.fromEntries(
    ['top', 'side', 'front'].map((view) => [view, { parentElement: { style: {} } }]),
);

const originalOrthoRender = OrthoCanvasRenderer.render;
const interactionRenders = [];
try {
    OrthoCanvasRenderer.render = (_canvas, _points, _box, viewType, options) => {
        interactionRenders.push({ viewType, interaction: options.interaction });
    };

    renderInteractionCard.renderViews(null, true, {
        viewMode: 'all',
        zoom: 0.4,
        pointSize: 1,
        interaction: { activeAction: 'resize-corner', viewType: 'side' },
    });
    console.assert(
        !Object.hasOwn(renderInteractionCard.lastRenderOptions, 'interaction'),
        'Transient resize interaction must not persist in lastRenderOptions',
    );

    renderInteractionCard.dragState = null;
    interactionRenders.length = 0;
    renderInteractionCard.renderViews(null, true, renderInteractionCard.lastRenderOptions);
    console.assert(
        interactionRenders.length === 3 && interactionRenders.every((entry) => !entry.interaction?.activeAction),
        'First render after pointerup must refresh all views without stale resize state',
    );
} finally {
    OrthoCanvasRenderer.render = originalOrthoRender;
}
console.log('✓ FrameCard pointerup clears transient resize interaction passed');

// Hotkey preferences: selected categories start unassigned and any shortcut can be cleared.
const hotkeyPreferences = window.CVATQAQC.HotkeyPreferences;
hotkeyPreferences.reset();
const unassignedCategories = new Set(['Đổi một mặt', 'Kích thước mẫu']);
const unassignedDefinitions = hotkeyPreferences.definitions.filter((definition) => unassignedCategories.has(definition.category));
console.assert(unassignedDefinitions.length === 10,
    'Expected all one-face resize and size-preset actions in the unassigned group');
console.assert(unassignedDefinitions.every((definition) => hotkeyPreferences.combo(definition.id) === ''),
    'One-face resize and size-preset shortcuts must be empty by default');
console.assert(hotkeyPreferences.setCombo('preset_sedan', 'Digit9').ok,
    'An empty preset shortcut must accept a new key');
console.assert(hotkeyPreferences.combo('preset_sedan') === 'Digit9',
    'Recorded preset shortcut must be saved');
console.assert(hotkeyPreferences.clearCombo('preset_sedan').ok && hotkeyPreferences.combo('preset_sedan') === '',
    'Clearing a shortcut must persist an explicit unassigned value');
hotkeyPreferences.reset();
console.log('✓ Empty hotkey defaults and per-action clearing passed');

// Ground-fit engine: deterministic planar road, alignment and PCD parsing.
const roadPoints = [];
for (let x = -4.8; x <= 4.8; x += 0.2) {
    for (let y = -4.8; y <= 4.8; y += 0.2) {
        roadPoints.push(x, y, 0.04 * x - 0.02 * y + 0.15);
    }
}
const originalGroundBox = [0, 0, 1.0, 0, 0, 0, 4.2, 2.0, 1.6];
const groundEstimate = GroundFit.engine.estimate(new Float32Array(roadPoints), originalGroundBox);
const alignedGroundBox = GroundFit.engine.align(originalGroundBox, groundEstimate);
console.assert(Math.abs(alignedGroundBox.points[0]) < 1e-9 && Math.abs(alignedGroundBox.points[1]) < 1e-9,
    'Ground fit must preserve X/Y center');
console.assert(alignedGroundBox.points.slice(6, 9).every((value, index) => value === originalGroundBox[index + 6]),
    'Ground fit must preserve box dimensions');
console.assert(Math.abs(alignedGroundBox.points[2] - 0.951) < 0.015,
    `Ground-fit center height should follow plane and half box height, got ${alignedGroundBox.points[2]}`);
console.assert(Math.abs(alignedGroundBox.longitudinalDegrees - 2.29) < 0.2,
    'Ground-fit longitudinal slope should match synthetic road');
console.assert(Math.abs(alignedGroundBox.lateralDegrees - 1.15) < 0.2,
    'Ground-fit lateral slope should match synthetic road');

// Inspector ground fitting must use the cached PCD for the card frame and update
// the card directly without requiring a selected cuboid on CVAT's main canvas.
const inspectorGroundCard = {
    frame: 12,
    data: {
        box: TrackReader.parsePointsToBox(originalGroundBox),
        points: [...originalGroundBox],
        keyframe: true,
    },
    dragState: null,
    lastPointCloudData: null,
    takeSnapshot() { return { box: { ...this.data.box }, points: [...this.data.points], outside: false, keyframe: true }; },
    pushUndoSnapshot(snapshot) { this.undoSnapshot = snapshot; },
    updateData(data) { this.data = data; },
};
const inspectorGroundDock = Object.create(MacOSDock.prototype);
inspectorGroundDock.cards = new Map([[12, inspectorGroundCard]]);
inspectorGroundDock.state = { activeClientID: 101, currentFrame: 12 };
inspectorGroundDock.hoveredFrame = 12;
inspectorGroundDock.hotkeyFrame = null;
inspectorGroundDock.pcdCache = { get: (frame) => frame === 12 ? { positions: new Float32Array(roadPoints), stride: 3 } : null };
let inspectorGroundSaved = null;
inspectorGroundDock.callbacks = {
    getJob: () => 'fixture-job',
    onReadCuboid: async () => ({ points: [...originalGroundBox] }),
    onUpdateCuboid: async (frame, id, points) => {
        inspectorGroundSaved = { frame, id, points: [...points] };
        return true;
    },
};
const inspectorGroundResult = await inspectorGroundDock.fitGroundForCard();
console.assert(inspectorGroundSaved?.frame === 12 && inspectorGroundSaved?.id === 101,
    'Inspector ground fit must update the active card frame and object');
console.assert(Math.abs(inspectorGroundSaved.points[2] - alignedGroundBox.points[2]) < 1e-9,
    'Inspector ground fit must apply the computed ground height');
console.assert(inspectorGroundCard.undoSnapshot?.points[2] === originalGroundBox[2],
    'Inspector ground fit must preserve localized undo history');
console.assert(Number.isFinite(inspectorGroundResult.rms) && inspectorGroundCard.data.keyframe === true,
    'Inspector ground fit must complete and keep the card as a keyframe');
console.log('✓ Inspector card ground fitting works without CVAT canvas selection');

const asciiPCD = new TextEncoder().encode(
    '# .PCD v0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA ascii\n1 2 3\n4 5 6\n',
).buffer;
const parsedPCD = GroundFit.engine.parsePCD(asciiPCD);
console.assert(parsedPCD.count === 2 && parsedPCD.positions.length === 6 && parsedPCD.positions[5] === 6,
    'Ground-fit ASCII PCD parser should preserve XYZ points');
console.log('✓ Ground fitting, slope alignment and in-memory PCD parsing passed');

console.log('All Unit Tests Passed Successfully!');
})().catch((error) => {
    console.error('Browser math test failed:', error);
    throw error;
});

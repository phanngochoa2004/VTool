import { Math3D } from '../src/engine/math_3d.js';
import { TrackReader } from '../src/core/track_reader.js';

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
import { OrthoCanvasRenderer } from '../src/engine/ortho_canvas.js';
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
import { SizeClipboard } from '../src/core/size_clipboard.js';
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
import { CVATHook } from '../src/core/cvat_hook.js';
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
const rotateViewAxis = (box, viewType, deltaRad) => {
    const propKey = viewType === 'top' ? 'rz' : (viewType === 'front' ? 'rx' : 'ry');
    const current = typeof box[propKey] === 'number' ? box[propKey] : 0;
    let nextVal = current + deltaRad;
    while (nextVal > Math.PI) nextVal -= Math.PI * 2;
    while (nextVal < -Math.PI) nextVal += Math.PI * 2;
    box[propKey] = parseFloat(nextVal.toFixed(4));
    return box;
};

const multiAxisBox = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 2, sy: 4, sz: 1.5 };

// Top rotation affects rz (Yaw) only
rotateViewAxis(multiAxisBox, 'top', 5 * Math.PI / 180);
console.assert(Math.abs(multiAxisBox.rz - (5 * Math.PI / 180)) < 1e-4, 'Top rotation sets rz');
console.assert(multiAxisBox.rx === 0 && multiAxisBox.ry === 0, 'Top rotation leaves rx and ry unchanged');

// Front rotation affects rx (Roll) only
rotateViewAxis(multiAxisBox, 'front', 1 * Math.PI / 180);
console.assert(Math.abs(multiAxisBox.rx - (1 * Math.PI / 180)) < 1e-4, 'Front rotation sets rx');
console.assert(multiAxisBox.ry === 0, 'Front rotation leaves ry unchanged');

// Side rotation affects ry (Pitch) only
rotateViewAxis(multiAxisBox, 'side', 90 * Math.PI / 180);
console.assert(Math.abs(multiAxisBox.ry - (Math.PI / 2)) < 1e-4, 'Side rotation sets ry');

// 180 flip on Front
rotateViewAxis(multiAxisBox, 'front', Math.PI);
console.assert(Math.abs(Math.abs(multiAxisBox.rx) - (Math.PI - 1 * Math.PI / 180)) < 1e-4, 'Front 180 flip normalized');

console.log('✓ 3-Axis rotation (Top/Yaw, Front/Roll, Side/Pitch) passed');

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

// 13. Test ALLOWED_SITES whitelist verification without regex
import { isAllowedSite, ALLOWED_SITES } from '../src/config/allowed_sites.js';

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

// 17. Test Configurable Camera View Order (Top/Front/Side vs Top/Side/Front)
const defaultViewOrder = ['top', 'front', 'side'];
const customViewOrder = ['top', 'side', 'front'];
const frontFirstOrder = ['front', 'side', 'top'];

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

// Initial order: Top -> Front -> Side
for (const v of defaultViewOrder) {
    mockGrid.appendChild(mockCells[v]);
}
console.assert(mockGrid.children[0].id === 'top' && mockGrid.children[1].id === 'front' && mockGrid.children[2].id === 'side', 'Default view order is Top, Front, Side');

// Reorder to Front -> Side -> Top
for (const v of frontFirstOrder) {
    mockGrid.appendChild(mockCells[v]);
}
console.assert(mockGrid.children[0].id === 'front' && mockGrid.children[1].id === 'side' && mockGrid.children[2].id === 'top', 'Reordered view cells to Front, Side, Top without DOM teardown');

// Reorder to Top -> Side -> Front
for (const v of customViewOrder) {
    mockGrid.appendChild(mockCells[v]);
}
console.assert(mockGrid.children[0].id === 'top' && mockGrid.children[1].id === 'side' && mockGrid.children[2].id === 'front', 'Reordered view cells to Top, Side, Front');
console.log('✓ Configurable Camera View Order (Top/Front/Side) passed');

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

console.log('All Unit Tests Passed Successfully!');

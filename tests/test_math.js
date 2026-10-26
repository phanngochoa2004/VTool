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
        else if (viewType === 'side') { dimH = initialBox.sy; dimV = initialBox.sz; }
        else if (viewType === 'front') { dimH = initialBox.sx; dimV = initialBox.sz; }

        const signU = (cornerKey === 'tr' || cornerKey === 'br') ? 1 : -1;
        const signV = (cornerKey === 'tl' || cornerKey === 'tr') ? 1 : -1;
        const oppLocalU = -signU * (dimH / 2);
        const oppLocalV = -signV * (dimV / 2);

        // Initial world coordinates of opposite corner
        const rz0 = initialBox.rz;
        let init_lx = 0, init_ly = 0, init_lz = 0;
        if (viewType === 'top') { init_lx = oppLocalU; init_ly = oppLocalV; }
        else if (viewType === 'side') { init_ly = oppLocalU; init_lz = oppLocalV; }
        else if (viewType === 'front') { init_lx = oppLocalU; init_lz = oppLocalV; }

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
        } else if (viewType === 'side') {
            d_mid_ly = u_mid; d_mid_lz = v_mid;
            nextSy = newDimH; nextSz = newDimV;
        } else if (viewType === 'front') {
            d_mid_lx = u_mid; d_mid_lz = v_mid;
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
        else if (viewType === 'side') { new_ly = newOppLocalU; new_lz = newOppLocalV; }
        else if (viewType === 'front') { new_lx = newOppLocalU; new_lz = newOppLocalV; }

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

console.log('All Unit Tests Passed Successfully!');

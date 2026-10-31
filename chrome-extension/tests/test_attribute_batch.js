(async function testAttributeBatch() {
    'use strict';
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const Batch = window.CVATQAQC.AttributeBatch;
    const specs = [
        { id: 1, name: 'State', inputType: 'select', mutable: true, defaultValue: 'A', values: ['A', 'B', 'C'] },
        { id: 2, name: 'Kind', inputType: 'text', mutable: false, defaultValue: 'car', values: [] },
        { id: 3, name: 'Speed', inputType: 'number', mutable: true, defaultValue: '0', values: ['0', '100', '5'] },
    ];
    const label = { id: 5, name: 'Vehicle', attributes: specs };
    const shapes = [0, 4, 8, 12].map((frame) => ({ frame, type: 'cuboid',
        points: [frame, 0, 1, 0, 0, 0, 4, 2, 1.5], outside: frame === 4,
        attributes: [{ spec_id: 1, value: frame === 4 ? 'B' : 'A' }] }));
    const track = { clientID: 25, label_id: 5, attributes: [{ spec_id: 2, value: 'car' }], shapes };
    let saves = 0, locked = false, activeID = 25, begin = 0, finish = 0;
    const stateAt = (frame) => {
        const attributes = { 1: 'A', 2: 'car', 3: '0' };
        for (const attr of track.attributes) attributes[attr.spec_id] = attr.value;
        for (const shape of [...track.shapes].sort((a, b) => a.frame - b.frame)) {
            if (shape.frame <= frame) for (const attr of shape.attributes) attributes[attr.spec_id] = attr.value;
        }
        const state = { clientID: 25, frame, objectType: 'track', shapeType: 'cuboid', lock: locked, label,
            points: [frame, 0, 1, 0, 0, 0, 4, 2, 1.5],
            outside: frame >= 4 && frame < 8 };
        let changed = {};
        Object.defineProperty(state, 'attributes', { get: () => attributes, set: (patch) => { changed = patch; } });
        state.save = async () => {
            saves++;
            for (const [key, value] of Object.entries(changed)) {
                const spec = specs.find((item) => item.id === Number(key));
                let list;
                if (spec.mutable) {
                    if (attributes[key] === value) continue;
                    let shape = track.shapes.find((item) => item.frame === frame);
                    if (!shape) { shape = { frame, type: 'cuboid', points: [...state.points], outside: state.outside, attributes: [] }; track.shapes.push(shape); }
                    list = shape.attributes;
                } else list = track.attributes;
                const old = list.find((item) => item.spec_id === Number(key));
                if (old) old.value = value; else list.push({ spec_id: Number(key), value });
            }
        };
        return state;
    };
    const job = { startFrame: 0, stopFrame: 12, annotations: {
        export: async () => ({ tracks: [JSON.parse(JSON.stringify(track))] }),
        get: async (frame) => [stateAt(frame)],
    } };
    const batch = new Batch({ getJob: () => job, getClientID: () => activeID,
        getStore: () => ({ getState: () => ({ annotation: { workspace: 'standard' } }) }),
        onBegin: () => begin++, onEnd: () => finish++ });
    const original = JSON.stringify(track);
    const plan = await batch.prepare({ attributeId: 1, value: 'C', start: 2, end: 6 });
    assert(JSON.stringify(track) === original && saves === 0, 'Preview must be read-only');
    const originalFrames = track.shapes.map((shape) => shape.frame).join(',');
    assert(plan.rows.length === 1 && plan.rows[0].frame === 4, 'Only existing keyframe inside 2–6 is targeted');
    await batch.apply(plan);
    assert(track.shapes.map((shape) => shape.frame).join(',') === originalFrames, 'Range must not create boundary keyframes');
    for (let frame = 0; frame <= 12; frame++) {
        const expected = frame >= 4 && frame < 8 ? 'C' : 'A';
        const state = stateAt(frame);
        assert(state.attributes[1] === expected, `Value incorrect at frame ${frame}`);
        assert(state.attributes[2] === 'car', 'Unrelated attributes preserved');
        assert(state.points[0] === frame && state.outside === (frame >= 4 && frame < 8), 'Geometry and Outside preserved');
    }
    assert(begin === 1 && finish === 1, 'Batch lifecycle balanced');
    let failed = false;
    try { await batch.prepare({ attributeId: 1, value: 'B', start: 5, end: 7 }); } catch (_) { failed = true; }
    assert(failed && saves === 1, 'Range without keyframes must reject without writes');
    const whole = await batch.prepare({ attributeId: 1, value: 'B', wholeTrack: true });
    assert(whole.rows.map((row) => row.frame).join(',') === originalFrames, 'Whole track targets existing keyframes only');
    await batch.apply(whole);
    assert(track.shapes.map((shape) => shape.frame).join(',') === originalFrames, 'Whole track must not create keyframes');
    failed = false;
    try { await batch.prepare({ attributeId: 2, value: 'truck', start: 2, end: 6 }); } catch (_) { failed = true; }
    assert(failed, 'Immutable attribute must reject frame range');
    const immutable = await batch.prepare({ attributeId: 2, value: 'truck', wholeTrack: true });
    await batch.apply(immutable);
    assert(stateAt(0).attributes[2] === 'truck' && stateAt(12).attributes[2] === 'truck', 'Immutable applies track-wide');
    assert(track.shapes.map((shape) => shape.frame).join(',') === originalFrames, 'Immutable update must not create keyframes');
    const stale = await batch.prepare({ attributeId: 1, value: 'A', wholeTrack: true });
    track.shapes[0].outside = true;
    failed = false;
    try { await batch.apply(stale); } catch (_) { failed = true; }
    assert(failed, 'Changes since preview must block apply');
    locked = true;
    failed = false;
    try { await batch.prepare({ attributeId: 1, value: 'A', wholeTrack: true }); } catch (_) { failed = true; }
    assert(failed, 'Locked track must be rejected');
    locked = false;
    failed = false;
    try { await batch.prepare({ attributeId: 3, value: '7', wholeTrack: true }); } catch (_) { failed = true; }
    assert(failed, 'Invalid number step must be rejected');
    failed = false;
    try { await batch.prepare({ attributeId: 1, value: 'invalid', wholeTrack: true }); } catch (_) { failed = true; }
    assert(failed, 'Invalid select option must be rejected');
    const switched = await batch.prepare({ attributeId: 1, value: 'A', wholeTrack: true });
    activeID = 26;
    failed = false;
    try { await batch.apply(switched); } catch (_) { failed = true; }
    assert(failed, 'Track switch must cancel apply');
    activeID = 25;
    const dock = new window.CVATQAQC.MacOSDock({ getJob: () => job,
        getStore: () => ({ getState: () => ({ annotation: { workspace: 'standard' } }) }) });
    const frameData = [0, 4, 8, 12].map((frame) => { const state = stateAt(frame); return {
        frame, points: [...state.points], box: window.CVATQAQC.TrackReader.parsePointsToBox(state.points),
        keyframe: true, outside: state.outside, label,
    }; });
    dock.updateTrack(25, frameData, 0, { get: () => null });
    await dock.open();
    assert(![...dock.dom.querySelectorAll('button')].some((el) => /Active|Căn nền|Cố định All|Nhảy|Jump/.test(el.textContent)),
        'Removed buttons must not remain in UI');
    document.getElementById('result').textContent = 'PASS: read-only preview, existing keyframes only for range/whole track, no boundary keyframes, empty range rejected, inherited values, Outside gap, preserved geometry/other attributes, immutable scope, stale preview, locking, value validation and track switch.';
})().catch((error) => { document.getElementById('result').textContent = 'FAIL: ' + error.stack; console.error(error); });

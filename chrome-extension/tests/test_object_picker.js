(async function testObjectPicker() {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const { CVATHook, MacOSDock, TrackReader } = window.CVATQAQC;
    const labels = [{ id: 1, name: 'vehicles' }, { id: 2, name: 'pedestrian' }];
    const tracks = [7, 25, 44, 50, 63, 80, 91, 105].map((id, i) => ({ clientID: id, label_id: i % 3 === 0 ? 2 : 1,
        shapes: [0, 4].map((frame) => ({ frame, type: 'cuboid', outside: false, points: [10, 0, 1, 0, 0, 0, 4, 2, 1.5] })) }));
    const states = tracks.map((track) => ({ clientID: track.clientID, hidden: false }));
    const dispatches = [];
    const job = { startFrame: 0, stopFrame: 4, labels, annotations: {
        export: async () => ({ tracks }),
        get: async (_frame, _all, filters) => {
            if (!filters.length) return states;
            const group = filters[0].and;
            const conditions = group[0].or || group;
            const ids = conditions.map((entry) => entry['=='][1]);
            return states.filter((state) => ids.includes(state.clientID));
        },
    }, actions: { get: async () => ({ undo: [], redo: [] }), undo: async () => [25, 44], redo: async () => [25, 44] } };
    let currentJob = job;
    const hook = new CVATHook();
    hook.jobInstance = job;
    hook.store = { dispatch: (action) => dispatches.push(action) };
    const dock = new MacOSDock({ getJob: () => currentJob,
        onFilterObject: async (id, ids = [id]) => {
            if (id === 999) return false;
            const track = tracks.find((entry) => entry.clientID === id);
            if (!track) return false;
            await hook.filterByObjectIDs(ids);
            const label = labels.find((entry) => entry.id === track.label_id);
            const frames = track.shapes.map((shape) => ({ ...shape, box: TrackReader.parsePointsToBox(shape.points), label, keyframe: true }));
            dock.updateTrack(id, frames, 0, { get: () => null });
            dock.setFilteredObjectID(id);
            return true;
        },
        onClearFilter: async () => { await hook.clearFilter(); dock.updateTrack(null, [], 0, null); dock.setFilteredObjectID(null); },
    });
    await dock.open();
    assert(!dock.multiSwitch.checked && !dock.multipleObjects, 'Multi-select defaults off');
    assert(dock.multiSwitch.closest('.cvat-qaqc-picker-heading'), 'Multi-select switch is in the object heading');
    assert(!dock.multiSwitch.closest('.cvat-qaqc-picker-mode'), 'Multi-select switch was removed from the action row');
    assert(dock.objectCatalog.length === 8 && dock.pickerGrid.children.length === 8, 'Catalog includes off-frame track IDs and labels');
    assert(!dock.dom.querySelector('.cvat-qaqc-toolbar input'), 'Old toolbar filter removed');
    assert(dock.dom.querySelector('.cvat-qaqc-object-picker input[type=search]'), 'Search belongs in sidebar');
    dock.filterInput.value = 'vehicles'; dock.filterInput.dispatchEvent(new Event('input'));
    assert(dock.pickerGrid.children.length === 5, 'Label search narrows matrix');
    dock.filterInput.value = '#25'; dock.filterInput.dispatchEvent(new Event('input'));
    assert(dock.pickerGrid.children.length === 1, 'ID search narrows matrix');
    dock.filterInput.value = ''; dock.renderObjectPicker();
    await dock.chooseObjects([25], 25);
    assert(dock.state.activeClientID === 25 && hook.getFilterIDs().join() === '25', 'Single selection loads correct Inspector and workspace');
    dock.multipleObjects = true; dock.multiSwitch.checked = true;
    await dock.chooseObjects([25, 44], 44);
    assert(dock.selectedObjectIDs.join() === '25,44' && hook.getObjectFilters()[0].and[0].or.length === 2, 'Multiple IDs use native OR filter');
    const visible = dispatches.filter((action) => action.type === 'FETCH_ANNOTATIONS_SUCCESS').at(-1).payload.states;
    assert(visible.map((state) => state.clientID).join() === '25,44', 'Redux includes exactly both selected IDs');
    assert(states.filter((state) => !state.hidden).map((state) => state.clientID).join() === '25,44', 'Hidden state honors multiple IDs');
    await hook.undo();
    assert(dispatches.filter((action) => action.type === 'UPDATE_ANNOTATIONS_SUCCESS').at(-1).payload.states.map((state) => state.clientID).join() === '25,44', 'Undo retains multiple-ID filter');
    hook._undoRedoLock = false;
    await hook.redo();
    assert(dispatches.filter((action) => action.type === 'UPDATE_ANNOTATIONS_SUCCESS').at(-1).payload.states.map((state) => state.clientID).join() === '25,44', 'Redo retains multiple-ID filter');
    await dock.chooseObjects([25, 44], 25);
    assert(dock.state.activeClientID === 25 && hook.getFilterIDs().length === 2, 'Focus changes do not drop selected IDs');
    assert(!await dock.chooseObjects([999], 999) && dock.selectedObjectIDs.join() === '25,44', 'Failed selection preserves selected IDs');
    await dock.chooseObjects([25], 25);
    dock.multipleObjects = false; dock.multiSwitch.checked = false;
    const clearPromise = dock.chooseObjects([], null);
    assert(dock.selectedObjectIDs.length === 0 && dock.quickClearBtn.hidden, 'Clear selection updates the picker immediately');
    await clearPromise;
    assert(hook.getObjectFilters().length === 0 && dock.cards.size === 0 && states.every((state) => !state.hidden), 'Clear restores workspace and empties Inspector');
    currentJob = { ...job, annotations: { export: async () => ({ tracks: [] }) } };
    await dock.refreshObjectCatalog();
    assert(dock.objectCatalog.length === 0 && !dock.multiSwitch.checked, 'Job change clears catalog and selection mode');
    currentJob = job; await dock.refreshObjectCatalog();
    document.querySelector('#result').textContent = 'PASS: sidebar matrix, default-off switch, ID/label search, single/multiple native filters, focus preservation, failed selection, clear and job reset.';
})().catch((error) => { document.querySelector('#result').textContent = `FAIL: ${error.stack}`; console.error(error); });

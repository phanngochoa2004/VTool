/**
 * CVAT Client Hook
 * Connects directly to CVAT's React Fiber, Redux store, and Canvas3d instance.
 * Completely client-side and reactive.
 */

import { isAllowedSite } from '../config/allowed_sites.js';

export class CVATHook {
    constructor() {
        this.store = null;
        this.jobInstance = null;
        this.canvasInstance = null;
        this.activeClientID = null;
        this.activeFilterID = null;
        this.currentFrame = 0;
        this.listeners = {
            objectChange: [],
            frameChange: [],
            canvasReady: [],
            objectUpdated: [],
            historyChange: [],
            filterChange: []
        };
        this.isHooked = false;
        this._undoRedoLock = false;
    }

    /**
     * Initialize connection to CVAT client
     * @returns {Promise<boolean>}
     */
    async init() {
        return new Promise((resolve) => {
            // First check if this page is in the allowed sites list (zero regex)
            if (typeof window !== 'undefined' && !isAllowedSite()) {
                resolve(false);
                return;
            }

            const checkInterval = setInterval(() => {
                const store = this.findReduxStore();
                if (store) {
                    clearInterval(checkInterval);
                    this.store = store;
                    this.setupStoreListener();
                    this.isHooked = true;
                    console.log('[CVAT-QAQC] Successfully hooked into CVAT Redux store');
                    resolve(true);
                }
            }, 500);

            // Timeout after 15s if not found (info log rather than warn so Chrome won't flag as extension error)
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!this.isHooked) {
                    console.info('[CVAT-QAQC] CVAT store hook standby (waiting for job session)');
                    resolve(false);
                }
            }, 15000);
        });
    }

    /**
     * Find Redux Store from React Fiber root or window
     */
    findReduxStore() {
        // Direct global check
        if (window.__REDUX_STORE__) {
            return window.__REDUX_STORE__;
        }

        const rootEl = document.getElementById('root');
        if (!rootEl) return null;

        const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;

        let rootFiber = rootEl[fiberKey];
        const queue = [rootFiber];
        let maxDepth = 250;

        while (queue.length > 0 && maxDepth-- > 0) {
            const node = queue.shift();
            if (!node) continue;

            const props = node.memoizedProps;
            if (props) {
                if (props.store && typeof props.store.getState === 'function') {
                    return props.store;
                }
                if (props.value && props.value.store && typeof props.value.store.getState === 'function') {
                    return props.value.store;
                }
            }

            if (node.child) queue.push(node.child);
            if (node.sibling) queue.push(node.sibling);
        }

        return null;
    }

    /**
     * Resolve currently active or selected 3D object clientID from Redux state & Canvas
     * @param {any} state
     * @returns {number|null}
     */
    findActiveClientID(state) {
        if (!state || !state.annotation) return null;
        const ann = state.annotation.annotations;
        if (!ann) return null;

        // 1. Check activatedStateID (currently focused / edited object)
        if (typeof ann.activatedStateID === 'number') {
            return ann.activatedStateID;
        }

        // 2. Check selectedStatesID (selected in objects sidebar or via box selection)
        if (Array.isArray(ann.selectedStatesID) && ann.selectedStatesID.length > 0) {
            const firstSelected = ann.selectedStatesID[0];
            if (typeof firstSelected === 'number') {
                return firstSelected;
            }
        }

        // 3. Check Canvas3d activatedElementID
        const canvas = state.annotation.canvas?.instance;
        if (canvas && typeof canvas.activatedElementID === 'number') {
            return canvas.activatedElementID;
        }

        // 3.5 Check active or selected item in DOM objects sidebar
        if (typeof document !== 'undefined') {
            try {
                const activeItem = document.querySelector(
                    '[class*="objects-sidebar-state-item"][class*="active"], ' +
                    '.cvat-objects-sidebar-state-item-active, ' +
                    '[id^="cvat-objects-sidebar-state-item-"].active, ' +
                    '[id^="cvat-objects-sidebar-state-item-"]:focus-within'
                );
                if (activeItem) {
                    const idMatch = (activeItem.id || '').match(/cvat-objects-sidebar-state-item-(\d+)/);
                    if (idMatch) return parseInt(idMatch[1], 10);
                    const numText = activeItem.querySelector('[class*="number"]')?.textContent?.trim() ||
                                   activeItem.querySelector('span')?.textContent?.match(/#(\d+)/)?.[1];
                    if (numText && !isNaN(parseInt(numText, 10))) return parseInt(numText, 10);
                }
            } catch (_) {}
        }

        // 4. Auto-detect: if on current frame there is a 3D cuboid, auto-select it!
        const states = ann.states || [];
        const cuboidState = states.find(s => s.shapeType === 'cuboid' || (s.points && s.points.length >= 9));
        if (cuboidState && typeof cuboidState.clientID === 'number') {
            return cuboidState.clientID;
        }

        return null;
    }

    /**
     * Re-inspect Redux state and force refresh of current active 3D object
     */
    refreshActiveObject() {
        if (!this.store) return;
        const state = this.store.getState();
        if (!state || !state.annotation) return;

        const job = state.annotation.job?.instance || null;
        const canvas = state.annotation.canvas?.instance || null;
        const clientID = this.findActiveClientID(state);
        const frame = state.annotation.player?.frame?.number ?? 0;

        this.jobInstance = job;
        this.canvasInstance = canvas;
        this.currentFrame = frame;
        this.activeClientID = clientID;

        this.emit('objectChange', { clientID, job, canvas, frame });
    }

    /**
     * Subscribe to Redux store updates
     */
    setupStoreListener() {
        if (!this.store) return;

        let prevClientID = null;
        let prevFrame = null;
        let prevCanvas = null;
        let prevUndoLength = 0;
        let prevRedoLength = 0;

        this.store.subscribe(() => {
            try {
                const state = this.store.getState();
                if (!state || !state.annotation) return;

                const job = state.annotation.job?.instance || null;
                const canvas = state.annotation.canvas?.instance || null;
                const clientID = this.findActiveClientID(state);
                const frame = state.annotation.player?.frame?.number ?? 0;

                this.jobInstance = job;
                this.canvasInstance = canvas;
                this.currentFrame = frame;

                if (canvas !== prevCanvas && canvas) {
                    prevCanvas = canvas;
                    this.emit('canvasReady', canvas);
                }

                if (clientID !== prevClientID) {
                    prevClientID = clientID;
                    this.activeClientID = clientID;
                    this.emit('objectChange', { clientID, job, canvas, frame });
                }

                if (frame !== prevFrame) {
                    prevFrame = frame;
                    this.emit('frameChange', { frame, clientID, job, canvas });
                }

                // Check CVAT Undo / Redo history changes
                const annHistory = state.annotation.annotations?.history;
                const undoLen = annHistory?.undo?.length ?? 0;
                const redoLen = annHistory?.redo?.length ?? 0;

                if (undoLen !== prevUndoLength || redoLen !== prevRedoLength) {
                    prevUndoLength = undoLen;
                    prevRedoLength = redoLen;
                    this.emit('historyChange', { undoLen, redoLen, history: annHistory, clientID: this.activeClientID, frame });
                }
            } catch (err) {
                console.error('[CVAT-QAQC] Error in store subscriber:', err);
            }
        });

        // Trigger initial state
        const initialState = this.store.getState();
        if (initialState?.annotation) {
            this.jobInstance = initialState.annotation.job?.instance;
            this.canvasInstance = initialState.annotation.canvas?.instance;
            this.activeClientID = this.findActiveClientID(initialState);
            this.currentFrame = initialState.annotation.player?.frame?.number ?? 0;
            if (this.activeClientID !== null) {
                this.emit('objectChange', {
                    clientID: this.activeClientID,
                    job: this.jobInstance,
                    canvas: this.canvasInstance,
                    frame: this.currentFrame
                });
            }
        }
    }

    /**
     * Jump CVAT main viewport to requested frame
     * @param {number} frameNumber
     */
    jumpToFrame(frameNumber) {
        const target = parseInt(frameNumber, 10);
        if (isNaN(target)) return;

        console.log(`[CVAT-QAQC] Requesting frame jump to #${target}`);

        // Method 1: Ant Design Slider React props
        try {
            const slider = document.querySelector('.cvat-player-slider');
            if (slider) {
                const propsKey = Object.keys(slider).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                if (propsKey && slider[propsKey] && typeof slider[propsKey].onChange === 'function') {
                    slider[propsKey].onChange(target);
                    return;
                }
            }
        } catch (e) {
            console.warn('[CVAT-QAQC] slider jump error:', e);
        }

        // Method 2: InputNumber inside .cvat-player-frame-selector
        try {
            const inputEl = document.querySelector('.cvat-player-frame-selector input') || document.querySelector('.cvat-player-frame-selector');
            if (inputEl) {
                inputEl.focus();
                const propsKey = Object.keys(inputEl).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                const protoSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (protoSetter) {
                    protoSetter.call(inputEl, String(target));
                } else {
                    inputEl.value = String(target);
                }

                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                if (propsKey && inputEl[propsKey]) {
                    if (typeof inputEl[propsKey].onPressEnter === 'function') {
                        inputEl[propsKey].onPressEnter({ target: { value: target } });
                    }
                    if (typeof inputEl[propsKey].onBlur === 'function') {
                        inputEl[propsKey].onBlur({ target: { value: target } });
                    }
                }

                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                return;
            }
        } catch (e) {
            console.warn('[CVAT-QAQC] input selector jump error:', e);
        }

        // Method 3: Redux store dispatch if available
        try {
            if (this.store) {
                this.store.dispatch({
                    type: 'CHANGE_FRAME',
                    payload: { frame: target }
                });
            }
        } catch (_) {}
    }

    /**
     * Update 3D cuboid points for an object at a specific frame (Pure client-side, 0 server requests)
     * @param {number} frameNumber
     * @param {number} clientID
     * @param {number[]} newPoints
     * @returns {Promise<boolean>}
     */
    async updateObjectCuboid(frameNumber, clientID, newPoints) {
        if (!this.jobInstance || clientID === null || typeof clientID === 'undefined') {
            console.warn('[CVAT-QAQC] Cannot update cuboid: Job instance or clientID missing');
            return false;
        }

        try {
            // 1. Fetch in-memory ObjectStates for this frame
            const states = await this.jobInstance.annotations.get(frameNumber, true, []);
            if (!Array.isArray(states)) return false;

            const targetState = states.find(s => s.clientID === clientID);
            if (!targetState) {
                console.warn(`[CVAT-QAQC] Object #${clientID} not found on frame #${frameNumber}`);
                return false;
            }

            // 2. Update points in-place
            targetState.points = [...newPoints];

            // 3. Save to CVAT client-side AnnotationsCollection (0 HTTP requests)
            await targetState.save();
            console.log(`[CVAT-QAQC] In-memory cuboid updated for Object #${clientID} at frame #${frameNumber}`);

            // 4. Sync to CVAT Redux store so CVAT top-bar and history stack register the change
            if (this.store && this.jobInstance?.actions) {
                try {
                    const history = await this.jobInstance.actions.get();
                    const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                    const statesToPush = this.activeFilterID !== null ? freshStates.filter(s => s.clientID === this.activeFilterID) : freshStates;
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: {
                            states: statesToPush,
                            history
                        }
                    });
                } catch (e) {
                    console.warn('[CVAT-QAQC] Could not sync history to Redux:', e);
                }
            }

            // 5. If this is the active frame in CVAT's main viewport, notify canvas
            if (frameNumber === this.currentFrame && this.canvasInstance) {
                const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                const perspective = canvasDOM?.perspective;
                if (perspective) {
                    perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                        bubbles: false,
                        cancelable: true,
                        detail: {
                            state: targetState,
                            points: [...newPoints]
                        }
                    }));
                }
            }

            this.emit('objectUpdated', {
                clientID,
                frame: frameNumber,
                points: [...newPoints]
            });

            return true;
        } catch (err) {
            console.error('[CVAT-QAQC] Failed to update in-memory cuboid:', err);
            return false;
        }
    }

    /**
     * Update in-memory outside flag for a cuboid/track at a specific frame
     * @param {number} frameNumber
     * @param {number} clientID
     * @param {boolean} outside
     * @returns {Promise<boolean>}
     */
    async updateObjectOutside(frameNumber, clientID, outside) {
        if (!this.jobInstance || clientID === null || typeof clientID === 'undefined') {
            console.warn('[CVAT-QAQC] Cannot update outside: Job instance or clientID missing');
            return false;
        }

        try {
            // 1. Fetch in-memory ObjectStates for this frame
            const states = await this.jobInstance.annotations.get(frameNumber, true, []);
            if (!Array.isArray(states)) return false;

            const targetState = states.find(s => s.clientID === clientID);
            if (!targetState) {
                console.warn(`[CVAT-QAQC] Object #${clientID} not found on frame #${frameNumber}`);
                return false;
            }

            // 2. Set outside flag and save (registers CHANGED_OUTSIDE into CVAT history)
            targetState.outside = !!outside;
            await targetState.save();
            console.log(`[CVAT-QAQC] In-memory outside set to ${outside} for Object #${clientID} at frame #${frameNumber}`);

            // 3. Sync to CVAT Redux store so CVAT top-bar, timeline and history stack register the change
            if (this.store && this.jobInstance?.actions) {
                try {
                    const history = await this.jobInstance.actions.get();
                    const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                    const statesToPush = this.activeFilterID !== null ? freshStates.filter(s => s.clientID === this.activeFilterID) : freshStates;
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: {
                            states: statesToPush,
                            history
                        }
                    });
                } catch (e) {
                    console.warn('[CVAT-QAQC] Could not sync history to Redux:', e);
                }
            }

            // 4. If this is the active frame in CVAT's main viewport, notify canvas
            if (frameNumber === this.currentFrame && this.canvasInstance) {
                const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                const perspective = canvasDOM?.perspective;
                if (perspective) {
                    perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                        bubbles: false,
                        cancelable: true,
                        detail: {
                            state: targetState
                        }
                    }));
                }
            }

            this.emit('objectOutsideChanged', {
                clientID,
                frame: frameNumber,
                outside: !!outside
            });

            return true;
        } catch (err) {
            console.error('[CVAT-QAQC] Failed to update in-memory outside:', err);
            return false;
        }
    }

    /**
     * Automate CVAT native Filters modal to isolate an ObjectID.
     * This adds the rule: ObjectID == targetID into CVAT's native react-awesome-query-builder
     * so that the sidebar shows "Items: 1", the top-bar Filters button becomes active (blue),
     * and opening the native modal visibly shows the active rule.
     * @param {number} targetID
     * @returns {Promise<boolean>}
     */
    async applyNativeFilterModal(targetID) {
        if (typeof document === 'undefined') return false;
        targetID = Number(targetID);
        console.log(`[CVAT-QAQC] Automating CVAT native Filters modal for ObjectID #${targetID}...`);

        const sleep = (ms) => new Promise(res => setTimeout(res, ms));

        const findFiltersBtn = () => {
            const byClass = document.querySelector('.cvat-annotation-header-filters-button, [class*="filters-button"], [class*="filter-button"]');
            if (byClass) return byClass;
            const withIcon = document.querySelector('.anticon-filter, [data-icon="filter"]');
            if (withIcon) {
                const btn = withIcon.closest('button') || withIcon.closest('.ant-btn') || withIcon.parentElement;
                if (btn) return btn;
            }
            const topBar = document.querySelector('.cvat-annotation-header, .cvat-top-app-bar, header, #root header') || document.body;
            const btns = topBar.querySelectorAll('button, .ant-btn');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('filter')) return b;
            }
            return null;
        };

        const findFiltersModal = () => {
            const modals = document.querySelectorAll('.ant-modal-content');
            for (const m of modals) {
                const title = m.querySelector('.ant-modal-title')?.textContent || '';
                if (title.toLowerCase().includes('filter')) return m;
                if (m.querySelector('.ant-modal-body')?.textContent?.includes('Objects') &&
                    m.querySelector('.ant-modal-body')?.textContent?.includes('Elements')) return m;
            }
            return null;
        };

        let modal = findFiltersModal();
        const wasAlreadyOpen = !!modal;
        let silencer = null;

        // Open modal if not currently open
        if (!modal) {
            const btn = findFiltersBtn();
            if (!btn) {
                console.warn('[CVAT-QAQC] CVAT native Filters button not found');
                return false;
            }

            // Silence modal visually while automating if it wasn't already open
            silencer = document.createElement('style');
            silencer.id = 'cvat-qaqc-filter-silencer';
            silencer.textContent = `
                .ant-modal-root {
                    opacity: 0 !important;
                    transform: scale(0.001) !important;
                    pointer-events: auto !important;
                }
                .ant-modal-mask {
                    opacity: 0 !important;
                }
            `;
            document.head.appendChild(silencer);

            try {
                btn.click();
            } catch (e) {
                console.warn('[CVAT-QAQC] Error clicking Filters button:', e);
            }

            for (let i = 0; i < 12; i++) {
                await sleep(50);
                modal = findFiltersModal();
                if (modal) break;
            }

            if (!modal) {
                if (silencer) silencer.remove();
                console.warn('[CVAT-QAQC] Filters modal did not appear');
                return false;
            }
        }

        try {
            // 1. Clear any existing rules to ensure clean single-object isolation
            const clearBtn = Array.from(modal.querySelectorAll('button')).find(b => 
                b.textContent && b.textContent.toLowerCase().includes('clear')
            );
            if (clearBtn && !clearBtn.disabled) {
                clearBtn.click();
                await sleep(60);
            }

            // 2. Click "+ Add rule" under Objects (the first Add rule button)
            const addRuleBtns = Array.from(modal.querySelectorAll('button')).filter(b => 
                b.textContent && b.textContent.toLowerCase().includes('add rule')
            );
            if (addRuleBtns.length === 0) {
                console.warn('[CVAT-QAQC] "+ Add rule" button not found in modal');
                return false;
            }

            const objectsAddRuleBtn = addRuleBtns[0];
            objectsAddRuleBtn.click();
            await sleep(100);

            // 3. Find the newly created rule row
            let ruleRow = modal.querySelector('.rule:last-child, .group-or-rule-container:last-child, .rule');
            if (!ruleRow) {
                const selects = modal.querySelectorAll('.ant-select');
                if (selects.length > 0) {
                    ruleRow = selects[0].closest('.ant-row') || selects[0].parentElement?.parentElement || modal;
                } else {
                    ruleRow = modal;
                }
            }

            // 4. Ensure Field is ObjectID
            const fieldSelect = ruleRow.querySelector('.rule--field .ant-select, .ant-select');
            if (fieldSelect) {
                const curVal = fieldSelect.textContent || '';
                if (!curVal.includes('ObjectID')) {
                    const selector = fieldSelect.querySelector('.ant-select-selector') || fieldSelect;
                    selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    selector.click();
                    await sleep(120);

                    const dropdowns = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
                    let foundOpt = null;
                    for (const dd of dropdowns) {
                        const opts = dd.querySelectorAll('.ant-select-item-option, [role="option"], .ant-select-dropdown-menu-item');
                        for (const opt of opts) {
                            if (opt.textContent && opt.textContent.trim() === 'ObjectID') {
                                foundOpt = opt;
                                break;
                            }
                        }
                        if (foundOpt) break;
                    }

                    if (foundOpt) {
                        foundOpt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        foundOpt.click();
                        await sleep(100);
                    }
                }
            }

            // 5. Set targetID into value input
            const valInput = ruleRow.querySelector('input.ant-input-number-input, input[type="number"], .rule--value input, input.ant-input, input');
            if (valInput) {
                valInput.focus();
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(valInput, String(targetID));
                } else {
                    valInput.value = String(targetID);
                }
                valInput.dispatchEvent(new Event('input', { bubbles: true }));
                valInput.dispatchEvent(new Event('change', { bubbles: true }));
                valInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
                valInput.dispatchEvent(new Event('blur', { bubbles: true }));
                await sleep(80);
            }

            // 6. Click Submit
            const submitBtn = Array.from(modal.querySelectorAll('button')).find(b => 
                (b.textContent && b.textContent.trim().toLowerCase() === 'submit') || b.classList.contains('ant-btn-primary')
            );
            if (submitBtn) {
                submitBtn.click();
                console.log(`[CVAT-QAQC] Native Filters modal submitted successfully for ObjectID #${targetID}!`);
                await sleep(80);
                return true;
            }
            return false;
        } finally {
            if (silencer) silencer.remove();
        }
    }

    /**
     * Clear filters in CVAT native Filters modal to restore all objects
     * @returns {Promise<boolean>}
     */
    async clearNativeFilterModal() {
        if (typeof document === 'undefined') return false;
        console.log('[CVAT-QAQC] Automating CVAT native Filters modal to clear all filters...');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));

        const findFiltersBtn = () => {
            const byClass = document.querySelector('.cvat-annotation-header-filters-button, [class*="filters-button"], [class*="filter-button"]');
            if (byClass) return byClass;
            const withIcon = document.querySelector('.anticon-filter, [data-icon="filter"]');
            if (withIcon) {
                const btn = withIcon.closest('button') || withIcon.closest('.ant-btn') || withIcon.parentElement;
                if (btn) return btn;
            }
            const topBar = document.querySelector('.cvat-annotation-header, .cvat-top-app-bar, header, #root header') || document.body;
            const btns = topBar.querySelectorAll('button, .ant-btn');
            for (const b of btns) {
                if (b.textContent && b.textContent.trim().toLowerCase().includes('filter')) return b;
            }
            return null;
        };

        const findFiltersModal = () => {
            const modals = document.querySelectorAll('.ant-modal-content');
            for (const m of modals) {
                const title = m.querySelector('.ant-modal-title')?.textContent || '';
                if (title.toLowerCase().includes('filter')) return m;
                if (m.querySelector('.ant-modal-body')?.textContent?.includes('Objects') &&
                    m.querySelector('.ant-modal-body')?.textContent?.includes('Elements')) return m;
            }
            return null;
        };

        let modal = findFiltersModal();
        let silencer = null;

        if (!modal) {
            const btn = findFiltersBtn();
            if (!btn) return false;

            silencer = document.createElement('style');
            silencer.id = 'cvat-qaqc-filter-silencer';
            silencer.textContent = `
                .ant-modal-root {
                    opacity: 0 !important;
                    transform: scale(0.001) !important;
                    pointer-events: auto !important;
                }
                .ant-modal-mask {
                    opacity: 0 !important;
                }
            `;
            document.head.appendChild(silencer);

            try {
                btn.click();
            } catch (_) {}

            for (let i = 0; i < 10; i++) {
                await sleep(50);
                modal = findFiltersModal();
                if (modal) break;
            }
        }

        if (!modal) {
            if (silencer) silencer.remove();
            return false;
        }

        try {
            const clearBtn = Array.from(modal.querySelectorAll('button')).find(b => 
                b.textContent && b.textContent.toLowerCase().includes('clear')
            );
            if (clearBtn && !clearBtn.disabled) {
                clearBtn.click();
                await sleep(60);
            }

            const submitBtn = Array.from(modal.querySelectorAll('button')).find(b => 
                (b.textContent && b.textContent.trim().toLowerCase() === 'submit') || b.classList.contains('ant-btn-primary')
            );
            if (submitBtn) {
                submitBtn.click();
                await sleep(60);
                return true;
            }
            return false;
        } finally {
            if (silencer) silencer.remove();
        }
    }

    /**
     * Filter CVAT workspace to only show the target object clientID.
     * Hides all other objects from Three.js scene and objects sidebar to prevent lag.
     * @param {number} clientID
     * @returns {Promise<boolean>}
     */
    async filterByObjectID(clientID) {
        if (clientID === null || typeof clientID === 'undefined') {
            return this.clearFilter();
        }

        const targetID = Number(clientID);
        console.log(`[CVAT-QAQC] Filtering workspace to Object ID #${targetID} (isolating track)...`);
        this.activeFilterID = targetID;

        // 1. Automate native CVAT Filters modal (updates native query builder, sidebar counter to 1, and modal contents)
        try {
            await this.applyNativeFilterModal(targetID);
        } catch (e) {
            console.warn('[CVAT-QAQC] Native Filters modal automation error:', e);
        }

        // 2. Immediate in-memory / Canvas / Redux isolation fallback
        if (this.jobInstance) {
            try {
                const allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                for (const s of allStates) {
                    if (typeof s.hidden !== 'undefined') {
                        s.hidden = (s.clientID !== targetID);
                    }
                }

                const filteredStates = allStates.filter(s => s.clientID === targetID);

                if (this.store) {
                    const history = this.jobInstance.actions ? await this.jobInstance.actions.get() : null;
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: {
                            states: filteredStates,
                            history
                        }
                    });
                }
            } catch (err) {
                console.warn('[CVAT-QAQC] Error in fallback state isolation:', err);
            }
        }

        this.emit('filterChange', { clientID: targetID });
        return true;
    }

    /**
     * Clear object filter and restore all objects on the workspace
     * @returns {Promise<boolean>}
     */
    async clearFilter() {
        console.log('[CVAT-QAQC] Clearing object filter, restoring all objects...');
        this.activeFilterID = null;

        // 1. Clear native modal filter
        try {
            await this.clearNativeFilterModal();
        } catch (e) {
            console.warn('[CVAT-QAQC] Native clear filter error:', e);
        }

        // 2. Restore all in-memory states and Redux store
        if (this.jobInstance) {
            try {
                const allStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);
                for (const s of allStates) {
                    if (typeof s.hidden !== 'undefined') {
                        s.hidden = false;
                    }
                }

                if (this.store) {
                    const history = this.jobInstance.actions ? await this.jobInstance.actions.get() : null;
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: {
                            states: allStates,
                            history
                        }
                    });
                }
            } catch (err) {
                console.warn('[CVAT-QAQC] Error restoring all object annotations:', err);
            }
        }

        this.emit('filterChange', { clientID: null });
        return true;
    }

    /**
     * Perform Undo directly on CVAT client-side history stack
     * @returns {Promise<boolean>}
     */
    async undo() {
        if (this._undoRedoLock) return false;
        this._undoRedoLock = true;
        setTimeout(() => { this._undoRedoLock = false; }, 200);

        console.log('[CVAT-QAQC] Executing Undo on CVAT...');

        // Method 1: Click CVAT's native Undo button in top-bar if active
        if (typeof document !== 'undefined') {
            try {
                const nativeUndoBtn = document.querySelector('.cvat-annotation-header-undo-button');
                if (nativeUndoBtn && !nativeUndoBtn.disabled && nativeUndoBtn.style.pointerEvents !== 'none' && nativeUndoBtn.style.opacity !== '0.5') {
                    nativeUndoBtn.click();
                    return true;
                }
            } catch (e) {
                console.warn('[CVAT-QAQC] Native undo button click error:', e);
            }
        }

        // Method 2: Direct jobInstance.actions.undo() + Redux sync + Canvas update
        if (this.jobInstance?.actions?.undo) {
            try {
                const affectedIDs = await this.jobInstance.actions.undo();
                const history = await this.jobInstance.actions.get();
                const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);

                if (this.store) {
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: { states: freshStates, history }
                    });
                }

                if (this.canvasInstance) {
                    const targetState = freshStates.find(s => s.clientID === this.activeClientID);
                    if (targetState) {
                        const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                        const perspective = canvasDOM?.perspective;
                        if (perspective) {
                            perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                                bubbles: false,
                                cancelable: true,
                                detail: {
                                    state: targetState,
                                    points: [...targetState.points]
                                }
                            }));
                        }
                    }
                }

                this.emit('historyChange', { history, clientID: this.activeClientID, frame: this.currentFrame });
                return true;
            } catch (err) {
                console.error('[CVAT-QAQC] Direct job actions undo error:', err);
                return false;
            }
        }

        return false;
    }

    /**
     * Perform Redo directly on CVAT client-side history stack
     * @returns {Promise<boolean>}
     */
    async redo() {
        if (this._undoRedoLock) return false;
        this._undoRedoLock = true;
        setTimeout(() => { this._undoRedoLock = false; }, 200);

        console.log('[CVAT-QAQC] Executing Redo on CVAT...');

        // Method 1: Click CVAT's native Redo button in top-bar if active
        if (typeof document !== 'undefined') {
            try {
                const nativeRedoBtn = document.querySelector('.cvat-annotation-header-redo-button');
                if (nativeRedoBtn && !nativeRedoBtn.disabled && nativeRedoBtn.style.pointerEvents !== 'none' && nativeRedoBtn.style.opacity !== '0.5') {
                    nativeRedoBtn.click();
                    return true;
                }
            } catch (e) {
                console.warn('[CVAT-QAQC] Native redo button click error:', e);
            }
        }

        // Method 2: Direct jobInstance.actions.redo() + Redux sync + Canvas update
        if (this.jobInstance?.actions?.redo) {
            try {
                const affectedIDs = await this.jobInstance.actions.redo();
                const history = await this.jobInstance.actions.get();
                const freshStates = await this.jobInstance.annotations.get(this.currentFrame, true, []);

                if (this.store) {
                    this.store.dispatch({
                        type: 'UPDATE_ANNOTATIONS_SUCCESS',
                        payload: { states: freshStates, history }
                    });
                }

                if (this.canvasInstance) {
                    const targetState = freshStates.find(s => s.clientID === this.activeClientID);
                    if (targetState) {
                        const canvasDOM = typeof this.canvasInstance.html === 'function' ? this.canvasInstance.html() : null;
                        const perspective = canvasDOM?.perspective;
                        if (perspective) {
                            perspective.dispatchEvent(new CustomEvent('canvas.edited', {
                                bubbles: false,
                                cancelable: true,
                                detail: {
                                    state: targetState,
                                    points: [...targetState.points]
                                }
                            }));
                        }
                    }
                }

                this.emit('historyChange', { history, clientID: this.activeClientID, frame: this.currentFrame });
                return true;
            } catch (err) {
                console.error('[CVAT-QAQC] Direct job actions redo error:', err);
                return false;
            }
        }

        return false;
    }

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            for (const cb of this.listeners[event]) {
                try {
                    cb(data);
                } catch (e) {
                    console.error('[CVAT-QAQC] Listener error:', e);
                }
            }
        }
    }
}

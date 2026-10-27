/**
 * macOS Docked QA/QC Drawer Component
 * Strictly adheres to Apple Human Interface Guidelines: No fake titlebars or window traffic lights.
 * Features a minimal floating trigger button when closed so it never interferes with the workspace.
 */

import { FrameCard } from './frame_card.js';
import { SizeClipboard } from '../core/size_clipboard.js';

export class MacOSDock {
    /**
     * @param {Object} callbacks - { onJumpToFrame, onReload }
     */
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.isOpen = false;
        const savedOrder = (typeof window !== 'undefined' && window.localStorage?.getItem('cvat_qaqc_view_order')) || 'top,front,side';
        this.state = {
            height: 480,
            viewMode: 'all', // 'all', 'top', 'front', 'side'
            viewOrder: savedOrder.split(','),
            zoom: 1.0,
            pointSize: 1.0,
            cardSize: 'medium',
            activeClientID: null,
            filteredClientID: null,
            currentFrame: 0,
            framesData: []
        };
        this.cards = new Map(); // frame -> FrameCard
        this.hoveredFrame = null; // Track frame currently hovered by user mouse
        this.dom = null;
        this.triggerEl = null;
        this.triggerDot = null;
        this.triggerBadge = null;
        this.filmstrip = null;
        this.trackBadge = null;
        this.framesBadge = null;
        this.filterBadge = null;
        this.filterInput = null;
        this.quickFilterBtn = null;
        this.quickClearBtn = null;
        this.orderSelect = null;
        this.emptyState = null;
        this.emptyState = null;

        this.initDOM();
        this.setupResizer();
        this.setupKeyboardShortcuts();
    }

    initDOM() {
        // 1. Floating Pill Button (Minimal, unobtrusive launcher)
        const trigger = document.createElement('div');
        trigger.className = 'cvat-qaqc-trigger';
        trigger.title = 'Click to open QA/QC Inspector (Shortcut: Alt + Q)';

        const dot = document.createElement('span');
        dot.className = 'cvat-qaqc-trigger-dot empty';
        const label = document.createElement('span');
        label.textContent = '3D';
        const badge = document.createElement('span');
        badge.className = 'cvat-qaqc-trigger-badge';

        trigger.appendChild(dot);
        trigger.appendChild(label);
        trigger.appendChild(badge);
        trigger.addEventListener('click', () => this.toggleOpen());
        document.body.appendChild(trigger);

        this.triggerEl = trigger;
        this.triggerDot = dot;
        this.triggerBadge = badge;

        // 2. Docked Drawer (Hidden by default)
        const dock = document.createElement('div');
        dock.className = 'cvat-qaqc-dock';
        dock.style.height = `${this.state.height}px`;

        // Resizer Knob
        const resizer = document.createElement('div');
        resizer.className = 'cvat-qaqc-resizer';
        const knob = document.createElement('div');
        knob.className = 'cvat-qaqc-resizer-knob';
        resizer.appendChild(knob);
        this.resizerEl = resizer;
        dock.appendChild(resizer);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'cvat-qaqc-toolbar';

        // Left Controls
        const leftGroup = document.createElement('div');
        leftGroup.className = 'cvat-qaqc-left-group';

        const title = document.createElement('div');
        title.className = 'cvat-qaqc-title';

        // Clean SVG 3D Cube Icon (Trusted Types compliant DOM creation)
        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('width', '15');
        iconSvg.setAttribute('height', '15');
        iconSvg.setAttribute('fill', 'none');
        iconSvg.setAttribute('stroke', '#0A84FF');
        iconSvg.setAttribute('stroke-width', '2');
        iconSvg.setAttribute('stroke-linecap', 'round');
        iconSvg.setAttribute('stroke-linejoin', 'round');

        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '3.27 6.96 12 12.01 20.73 6.96');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '12');
        line.setAttribute('y1', '22.08');
        line.setAttribute('x2', '12');
        line.setAttribute('y2', '12');

        iconSvg.appendChild(path1);
        iconSvg.appendChild(polyline);
        iconSvg.appendChild(line);

        const titleSpan = document.createElement('span');
        titleSpan.textContent = '3D QA/QC';
        title.appendChild(iconSvg);
        title.appendChild(titleSpan);

        const trackBadge = document.createElement('span');
        trackBadge.className = 'cvat-qaqc-track-badge';
        trackBadge.textContent = 'No Object Selected';
        this.trackBadge = trackBadge;

        const framesBadge = document.createElement('span');
        framesBadge.className = 'cvat-qaqc-frames-badge';
        framesBadge.textContent = '0 frames';
        this.framesBadge = framesBadge;

        // Quick ID Filter Bar (Allows user to quickly filter by Object ID directly inside the dock)
        const filterBar = document.createElement('div');
        filterBar.className = 'cvat-qaqc-quick-filter-bar';
        this.filterBar = filterBar;

        const filterIcon = document.createElement('span');
        filterIcon.className = 'cvat-qaqc-filter-icon';
        filterIcon.textContent = '#';

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'cvat-qaqc-quick-filter-input';
        filterInput.placeholder = 'ID...';
        filterInput.title = 'Nhập Object ID cần lọc và ấn Enter';
        this.filterInput = filterInput;

        const filterBtn = document.createElement('button');
        filterBtn.className = 'cvat-qaqc-quick-filter-btn';
        filterBtn.textContent = 'Lọc';
        filterBtn.title = 'Lọc chỉ hiển thị Object ID này (Enter)';
        this.quickFilterBtn = filterBtn;

        const clearFilterBtn = document.createElement('button');
        clearFilterBtn.className = 'cvat-qaqc-quick-clear-btn';
        clearFilterBtn.textContent = '✕';
        clearFilterBtn.title = 'Bỏ lọc, hiện lại toàn bộ đối tượng';
        clearFilterBtn.style.display = 'none';
        this.quickClearBtn = clearFilterBtn;

        const executeFilter = async () => {
            const rawVal = filterInput.value.trim().replace(/^#/, '');
            if (!rawVal) return;
            const targetID = parseInt(rawVal, 10);
            if (isNaN(targetID)) {
                filterBar.classList.add('error-shake');
                setTimeout(() => filterBar.classList.remove('error-shake'), 600);
                return;
            }
            filterBtn.disabled = true;
            filterBtn.textContent = '...';
            try {
                if (typeof this.callbacks.onFilterObject === 'function') {
                    const success = await this.callbacks.onFilterObject(targetID);
                    if (success !== false) {
                        this.setFilteredObjectID(targetID);
                    } else {
                        filterBar.classList.add('error-shake');
                        filterInput.title = `Không tìm thấy Object ID #${targetID}`;
                        setTimeout(() => filterBar.classList.remove('error-shake'), 600);
                    }
                }
            } finally {
                filterBtn.disabled = false;
                filterBtn.textContent = 'Lọc';
            }
        };

        filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeFilter();
            }
        });
        filterBtn.addEventListener('click', () => executeFilter());

        clearFilterBtn.addEventListener('click', async () => {
            if (typeof this.callbacks.onClearFilter === 'function') {
                await this.callbacks.onClearFilter();
            }
            this.setFilteredObjectID(null);
            filterInput.value = '';
        });

        filterBar.appendChild(filterIcon);
        filterBar.appendChild(filterInput);
        filterBar.appendChild(filterBtn);
        filterBar.appendChild(clearFilterBtn);

        leftGroup.appendChild(title);
        leftGroup.appendChild(trackBadge);
        leftGroup.appendChild(framesBadge);
        leftGroup.appendChild(filterBar);

        // Right Controls
        const rightGroup = document.createElement('div');
        rightGroup.className = 'cvat-qaqc-right-group';

        // Segmented Control: Views
        const segmented = document.createElement('div');
        segmented.className = 'cvat-qaqc-segmented';
        const viewModes = [
            { id: 'all', label: 'All 3' },
            { id: 'top', label: 'Top' },
            { id: 'front', label: 'Front' },
            { id: 'side', label: 'Side' }
        ];

        this.segButtons = {};
        for (const vm of viewModes) {
            const btn = document.createElement('button');
            btn.className = `cvat-qaqc-seg-item ${vm.id === this.state.viewMode ? 'active' : ''}`;
            btn.textContent = vm.label;
            btn.addEventListener('click', () => this.setViewMode(vm.id));
            this.segButtons[vm.id] = btn;
            segmented.appendChild(btn);
        }

        // View Order Selector: Top -> Front -> Side (or Top -> Side -> Front, etc.)
        const orderSelect = document.createElement('select');
        orderSelect.className = 'cvat-qaqc-select cvat-qaqc-order-select';
        orderSelect.style.colorScheme = 'dark';
        orderSelect.title = 'Thứ tự các góc chiếu (Camera Order)';
        const currentOrderVal = this.state.viewOrder.join(',');
        [
            { val: 'top,front,side', label: 'Top → Front → Side' },
            { val: 'top,side,front', label: 'Top → Side → Front' },
            { val: 'front,side,top', label: 'Front → Side → Top' },
            { val: 'side,front,top', label: 'Side → Front → Top' }
        ].forEach(({ val, label }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (val === currentOrderVal) opt.selected = true;
            orderSelect.appendChild(opt);
        });

        orderSelect.addEventListener('change', (e) => {
            this.setViewOrder(e.target.value.split(','));
        });
        this.orderSelect = orderSelect;

        // Card Display Size Selector (Compact / Medium / Large)
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'cvat-qaqc-select';
        sizeSelect.style.colorScheme = 'dark';
        sizeSelect.title = 'Kích thước hiển thị các góc chiếu';
        [
            { val: 'compact', label: 'Size: Nhỏ' },
            { val: 'medium', label: 'Size: Vừa', selected: true },
            { val: 'large', label: 'Size: Lớn' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            sizeSelect.appendChild(opt);
        });
        sizeSelect.addEventListener('change', (e) => {
            this.setCardSize(e.target.value);
        });

        // Zoom Selector (supports zoom < 100%)
        const zoomSelect = document.createElement('select');
        zoomSelect.className = 'cvat-qaqc-select';
        zoomSelect.style.colorScheme = 'dark';
        [
            { val: '0.4', label: '40%' },
            { val: '0.6', label: '60%' },
            { val: '0.8', label: '80%' },
            { val: '1.0', label: '100%', selected: true },
            { val: '1.25', label: '125%' },
            { val: '1.5', label: '150%' },
            { val: '2.0', label: '200%' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            zoomSelect.appendChild(opt);
        });
        zoomSelect.addEventListener('change', (e) => {
            this.state.zoom = parseFloat(e.target.value);
            this.refreshAllCards();
        });

        // Point Size Selector
        const ptSelect = document.createElement('select');
        ptSelect.className = 'cvat-qaqc-select';
        ptSelect.style.colorScheme = 'dark';
        [
            { val: '0.5', label: 'Pt: 0.5px' },
            { val: '1.0', label: 'Pt: 1px', selected: true },
            { val: '1.5', label: 'Pt: 1.5px' },
            { val: '2.0', label: 'Pt: 2px' },
            { val: '3.0', label: 'Pt: 3px' }
        ].forEach(({ val, label, selected }) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opt.style.backgroundColor = '#222225';
            opt.style.color = '#ffffff';
            if (selected) opt.selected = true;
            ptSelect.appendChild(opt);
        });
        ptSelect.addEventListener('change', (e) => {
            this.state.pointSize = parseFloat(e.target.value);
            this.refreshAllCards();
        });

        // Rotate Buttons Group (Active Frame)
        const rotGroup = document.createElement('div');
        rotGroup.className = 'cvat-qaqc-rot-group';
        this.rotGroup = rotGroup;
        this.updateToolbarRotateButtons();

        // Copy Size Button (Active Frame / Cuboid)
        const copySizeBtn = document.createElement('button');
        copySizeBtn.className = 'cvat-qaqc-btn cvat-qaqc-copy-size-btn';
        copySizeBtn.textContent = '📋 Copy';
        copySizeBtn.title = 'Sao chép kích thước WxLxH của frame đang chọn (Alt+Shift+C)';
        copySizeBtn.addEventListener('click', () => {
            const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
            if (activeCard) {
                activeCard.handleCopySize(copySizeBtn);
            } else {
                const domSize = SizeClipboard.extractFromCvatDom();
                if (domSize) {
                    SizeClipboard.copy(domSize);
                    copySizeBtn.classList.add('success-flash');
                    copySizeBtn.textContent = '✓ Copy!';
                    setTimeout(() => {
                        copySizeBtn.classList.remove('success-flash');
                        copySizeBtn.textContent = '📋 Copy';
                    }, 1200);
                }
            }
        });

        // Jump to Active Frame Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-btn';
        jumpBtn.textContent = '🎯 Active';
        jumpBtn.title = 'Cuộn đến frame đang chọn trong CVAT';
        jumpBtn.addEventListener('click', () => this.scrollToActiveFrame());

        // Close / Hide Button (Collapses back to floating button)
        const hideBtn = document.createElement('button');
        hideBtn.className = 'cvat-qaqc-btn';
        hideBtn.textContent = '✕ Ẩn';
        hideBtn.title = 'Hide inspector (Alt + Q)';
        hideBtn.addEventListener('click', () => this.close());

        rightGroup.appendChild(segmented);
        rightGroup.appendChild(orderSelect);
        rightGroup.appendChild(sizeSelect);
        rightGroup.appendChild(zoomSelect);
        rightGroup.appendChild(ptSelect);
        rightGroup.appendChild(rotGroup);
        rightGroup.appendChild(copySizeBtn);
        rightGroup.appendChild(jumpBtn);
        rightGroup.appendChild(hideBtn);

        toolbar.appendChild(leftGroup);
        toolbar.appendChild(rightGroup);
        dock.appendChild(toolbar);

        // Filmstrip Container (Medium by default)
        const filmstrip = document.createElement('div');
        filmstrip.className = 'cvat-qaqc-filmstrip size-medium';
        this.filmstrip = filmstrip;

        // Empty State
        const empty = document.createElement('div');
        empty.className = 'cvat-qaqc-empty-state';
        const emptyTitle = document.createElement('div');
        emptyTitle.className = 'cvat-qaqc-empty-title';
        emptyTitle.textContent = 'No 3D Object Selected';
        const emptySub = document.createElement('div');
        emptySub.className = 'cvat-qaqc-empty-sub';
        emptySub.textContent = 'Select any cuboid or track in CVAT to inspect its orthogonal projections across all frames.';
        empty.appendChild(emptyTitle);
        empty.appendChild(emptySub);
        this.emptyState = empty;
        filmstrip.appendChild(empty);

        dock.appendChild(filmstrip);

        this.dom = dock;
        document.body.appendChild(dock);
    }

    updateToolbarRotateButtons() {
        if (!this.rotGroup) return;
        this.rotGroup.replaceChildren();

        const mode = this.state.viewMode;
        const targetView = (mode === 'side' || mode === 'front') ? mode : 'top';
        const axisName = targetView === 'top' ? 'Yaw (Trục Z)' : (targetView === 'side' ? 'Pitch (Trục X)' : 'Roll (Trục Y)');
        const isTop = targetView === 'top';
        const stepDeg = isTop ? 5 : 1;
        const stepRad = stepDeg * Math.PI / 180;

        this.rotGroup.title = `Xoay góc ${axisName} (Frame đang chọn)`;

        const buttons = [
            { label: '↺ 90°', delta: -Math.PI / 2, title: `Xoay -90° (${axisName} - Active Frame)` },
            { label: `↺ ${stepDeg}°`, delta: -stepRad, title: `Xoay -${stepDeg}° (${axisName} - Active Frame)` },
            { label: `↻ ${stepDeg}°`, delta: stepRad,  title: `Xoay +${stepDeg}° (${axisName} - Active Frame)` },
            { label: '↻ 90°', delta: Math.PI / 2,  title: `Xoay +90° (${axisName} - Active Frame)` }
        ];

        buttons.forEach(({ label, delta, title }) => {
            const btn = document.createElement('button');
            btn.className = 'cvat-qaqc-rot-btn';
            btn.textContent = label;
            btn.title = title;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
                if (activeCard) {
                    if (typeof activeCard.rotateView === 'function') {
                        activeCard.rotateView(targetView, delta);
                    } else if (typeof activeCard.rotateBy === 'function') {
                        activeCard.rotateBy(delta);
                    }
                }
            });
            this.rotGroup.appendChild(btn);
        });
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
                return;
            }

            const isCtrlOrCmd = e.ctrlKey || e.metaKey;

            if ((e.altKey || e.metaKey) && (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q')) {
                e.preventDefault();
                this.toggleOpen();
                return;
            } else if (e.altKey && e.shiftKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
                if (activeCard) activeCard.handleCopySize();
                return;
            } else if (e.altKey && e.shiftKey && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
                if (activeCard) activeCard.handlePasteSize();
                return;
            }

            // Hotkey O to toggle outside directly on the box at hovered or active frame
            if (!isCtrlOrCmd && !e.altKey && !e.shiftKey) {
                if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') {
                    const targetFrame = this.hoveredFrame !== null ? this.hoveredFrame : this.state.currentFrame;
                    const targetCard = this.cards.get(targetFrame);
                    if (targetCard) {
                        e.preventDefault();
                        targetCard.toggleOutside();
                        return;
                    }
                }
            }

            // Undo / Redo shortcuts (Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y)
            if (isCtrlOrCmd && !e.altKey) {
                if ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                    // Undo directly on CVAT & UI
                    if (typeof this.callbacks.onUndo === 'function') {
                        e.preventDefault();
                        this.callbacks.onUndo();
                    }
                } else if (
                    ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && e.shiftKey) ||
                    (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y')
                ) {
                    // Redo directly on CVAT & UI
                    if (typeof this.callbacks.onRedo === 'function') {
                        e.preventDefault();
                        this.callbacks.onRedo();
                    }
                }
            }
        });
    }

    /**
     * Paste dimensions from clipboard to ALL loaded cards of the current track
     */
    async pasteSizeToAllCards(btn = null) {
        const size = await SizeClipboard.get();
        if (!size) {
            console.warn('[CVAT-QAQC] No size in clipboard to paste');
            return;
        }

        let updated = 0;
        for (const card of this.cards.values()) {
            if (card && typeof card.pasteSize === 'function') {
                card.pasteSize(size);
                updated++;
            }
        }

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = `✓ Đã dán ${updated}f!`;
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1500);
        }
        console.log(`[CVAT-QAQC] Pasted size (${size.sx} × ${size.sy} × ${size.sz}m) to ${updated} frames`);
    }

    /**
     * Update active filter state and controls in the header
     * @param {number|null} clientID
     */
    setFilteredObjectID(clientID) {
        this.state.filteredClientID = clientID;
        if (this.filterInput) {
            if (clientID !== null && typeof clientID !== 'undefined') {
                this.filterInput.value = String(clientID);
                if (this.quickClearBtn) this.quickClearBtn.style.display = 'inline-flex';
                if (this.filterBar) this.filterBar.classList.add('is-filtered');
            } else {
                this.filterInput.value = '';
                if (this.quickClearBtn) this.quickClearBtn.style.display = 'none';
                if (this.filterBar) this.filterBar.classList.remove('is-filtered');
            }
        }
    }

    /**
     * Set camera view order across all cards
     * @param {Array<string>} orderArray
     */
    setViewOrder(orderArray) {
        if (!Array.isArray(orderArray) || orderArray.length === 0) return;
        this.state.viewOrder = [...orderArray];
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('cvat_qaqc_view_order', orderArray.join(','));
            }
        } catch (_) {}

        if (this.orderSelect && this.orderSelect.value !== orderArray.join(',')) {
            this.orderSelect.value = orderArray.join(',');
        }

        for (const card of this.cards.values()) {
            card.setViewOrder(orderArray);
        }
    }

    async open() {
        this.isOpen = true;
        this.dom.classList.add('open');
        this.triggerEl.style.display = 'none'; // Hide trigger when drawer is active

        // Filter CVAT workspace to target object ID before performing other operations
        if (typeof this.callbacks.onBeforeOpen === 'function') {
            await this.callbacks.onBeforeOpen();
        } else if (typeof this.callbacks.onOpen === 'function') {
            this.callbacks.onOpen();
        }

        this.refreshAllCards();
        this.scrollToActiveFrame();
    }

    close() {
        this.isOpen = false;
        this.dom.classList.remove('open');
        this.triggerEl.style.display = 'flex'; // Restore trigger button
    }

    async toggleOpen() {
        if (this.isOpen) {
            this.close();
        } else {
            await this.open();
        }
    }

    setupResizer() {
        let isDragging = false;
        let startY = 0;
        let startH = 0;

        this.resizerEl.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startH = this.dom.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaY = startY - e.clientY;
            const newH = Math.max(180, Math.min(window.innerHeight * 0.85, startH + deltaY));
            this.state.height = newH;
            this.dom.style.height = `${newH}px`;
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
            }
        });
    }

    setViewMode(mode) {
        this.state.viewMode = mode;
        for (const [id, btn] of Object.entries(this.segButtons)) {
            if (id === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        this.updateToolbarRotateButtons();
        this.refreshAllCards();
    }

    setCardSize(size) {
        if (!this.filmstrip) return;
        this.filmstrip.classList.remove('size-compact', 'size-medium', 'size-large');
        this.filmstrip.classList.add(`size-${size}`);
        requestAnimationFrame(() => {
            this.refreshAllCards();
        });
    }

    /**
     * Update active object track data
     * @param {number|null} clientID
     * @param {Array} framesData
     * @param {number} currentFrame
     * @param {any} pcdCache
     */
    updateTrack(clientID, framesData, currentFrame, pcdCache) {
        this.state.activeClientID = clientID;
        this.state.framesData = framesData || [];
        this.state.currentFrame = currentFrame;
        this.pcdCache = pcdCache;

        if (!clientID || framesData.length === 0) {
            this.trackBadge.textContent = 'No Object Selected';
            this.framesBadge.textContent = '0 frames';
            this.triggerDot.className = 'cvat-qaqc-trigger-dot empty';
            this.triggerBadge.textContent = '';
            this.triggerEl.classList.remove('has-object');
            this.filmstrip.replaceChildren(this.emptyState);
            this.cards.clear();
            return;
        }

        const labelName = framesData[0]?.label?.name || 'Object';
        this.trackBadge.textContent = `Track #${clientID} [${labelName}]`;
        this.framesBadge.textContent = `${framesData.length} frames`;

        // Update floating pill badge without intruding on the user
        this.triggerDot.className = 'cvat-qaqc-trigger-dot';
        this.triggerBadge.textContent = `#${clientID} (${framesData.length}f)`;
        this.triggerEl.classList.add('has-object');

        // Clear filmstrip and build cards
        this.filmstrip.replaceChildren();
        this.cards.clear();

        for (const fData of framesData) {
            const card = new FrameCard(
                fData,
                (frame) => {
                    if (typeof this.callbacks.onJumpToFrame === 'function') {
                        this.callbacks.onJumpToFrame(frame);
                    }
                },
                (frame, newPoints, newBox) => {
                    if (typeof this.callbacks.onUpdateCuboid === 'function') {
                        this.callbacks.onUpdateCuboid(frame, this.state.activeClientID, newPoints, newBox);
                    }
                },
                (sizeObj) => {
                    this.pasteSizeToAllCards(null);
                },
                (frame, outside) => {
                    if (typeof this.callbacks.onUpdateOutside === 'function') {
                        this.callbacks.onUpdateOutside(frame, this.state.activeClientID, outside);
                    }
                },
                (frame, isHovered) => {
                    this.hoveredFrame = isHovered ? frame : (this.hoveredFrame === frame ? null : this.hoveredFrame);
                },
                { viewOrder: this.state.viewOrder }
            );

            this.cards.set(fData.frame, card);
            this.filmstrip.appendChild(card.dom);

            // Render view
            const pts = pcdCache?.get(fData.frame);
            card.renderViews(pts, fData.frame === currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }

        if (this.isOpen) {
            this.scrollToActiveFrame();
        }
    }

    /**
     * In-place data update across all frame cards on Undo/Redo or history changes
     * Zero DOM recreation, preserving scroll and focus
     * @param {Array} framesData
     */
    refreshTrackData(framesData) {
        if (!Array.isArray(framesData) || framesData.length === 0) return;
        this.state.framesData = framesData;

        // If card count matches frame count, update cards in-place
        if (this.cards.size === framesData.length) {
            for (const fData of framesData) {
                const card = this.cards.get(fData.frame);
                if (card && typeof card.updateData === 'function') {
                    card.updateData(fData);
                }
            }
        } else {
            // If frames were added/removed, do a clean rebuild
            this.updateTrack(this.state.activeClientID, framesData, this.state.currentFrame, this.pcdCache);
        }
    }

    /**
     * Update active frame highlight
     * @param {number} frameNumber
     * @param {any} pcdCache
     */
    updateActiveFrame(frameNumber, pcdCache) {
        const prevFrame = this.state.currentFrame;
        this.state.currentFrame = frameNumber;
        this.pcdCache = pcdCache;

        // Fast toggle of active classes on previous and current cards
        if (prevFrame !== null && prevFrame !== frameNumber) {
            const prevCard = this.cards.get(prevFrame);
            if (prevCard && typeof prevCard.setActive === 'function') {
                prevCard.setActive(false);
            }
        }

        const currentCard = this.cards.get(frameNumber);
        if (currentCard) {
            if (typeof currentCard.setActive === 'function') {
                currentCard.setActive(true);
            }
            const pts = pcdCache?.get(frameNumber);
            if (pts) {
                currentCard.renderViews(pts, true, {
                    viewMode: this.state.viewMode,
                    zoom: this.state.zoom,
                    pointSize: this.state.pointSize
                });
            }
        }

        if (this.isOpen) {
            this.scrollToActiveFrame();
        }
    }

    /**
     * Update point cloud on an individual frame card as soon as it decodes in memory
     * @param {number} frame
     * @param {{ positions: Float32Array, stride: number } | null} pts
     */
    updateCardPointCloud(frame, pts) {
        const card = this.cards.get(frame);
        if (card) {
            card.renderViews(pts, frame === this.state.currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }
    }

    refreshAllCards() {
        for (const [f, card] of this.cards.entries()) {
            const pts = this.pcdCache?.get(f);
            card.renderViews(pts, f === this.state.currentFrame, {
                viewMode: this.state.viewMode,
                zoom: this.state.zoom,
                pointSize: this.state.pointSize
            });
        }
    }

    scrollToActiveFrame() {
        const activeCard = this.cards.get(this.state.currentFrame);
        if (activeCard && activeCard.dom) {
            activeCard.dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

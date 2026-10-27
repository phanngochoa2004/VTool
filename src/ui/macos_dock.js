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
        this.state = {
            height: 480,
            viewMode: 'all', // 'all', 'top', 'front', 'side'
            zoom: 1.0,
            pointSize: 1.0,
            cardSize: 'medium',
            activeClientID: null,
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
        titleSpan.textContent = '3D QA/QC Inspector';
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

        leftGroup.appendChild(title);
        leftGroup.appendChild(trackBadge);
        leftGroup.appendChild(framesBadge);

        // Right Controls
        const rightGroup = document.createElement('div');
        rightGroup.className = 'cvat-qaqc-right-group';

        // Segmented Control: Views (CVAT Order: Top, Side, Front)
        const segmented = document.createElement('div');
        segmented.className = 'cvat-qaqc-segmented';
        const viewModes = [
            { id: 'all', label: 'All 3 Views' },
            { id: 'top', label: 'Top' },
            { id: 'side', label: 'Side' },
            { id: 'front', label: 'Front' }
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

        // Card Display Size Selector (Compact / Medium / Large)
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'cvat-qaqc-select';
        sizeSelect.style.colorScheme = 'dark';
        sizeSelect.title = 'Kích thước hiển thị các góc chiếu';
        [
            { val: 'compact', label: 'Size: Nhỏ (Compact)' },
            { val: 'medium', label: 'Size: Vừa (Medium)', selected: true },
            { val: 'large', label: 'Size: Lớn (Large)' }
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
            { val: '0.4', label: 'Zoom 40%' },
            { val: '0.6', label: 'Zoom 60%' },
            { val: '0.8', label: 'Zoom 80%' },
            { val: '1.0', label: 'Zoom 100%', selected: true },
            { val: '1.25', label: 'Zoom 125%' },
            { val: '1.5', label: 'Zoom 150%' },
            { val: '2.0', label: 'Zoom 200%' }
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
        copySizeBtn.textContent = '📋 Copy Size';
        copySizeBtn.title = 'Sao chép kích thước WxLxH của frame đang chọn vào clipboard (Alt+Shift+C)';
        copySizeBtn.addEventListener('click', () => {
            const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
            if (activeCard) {
                activeCard.handleCopySize(copySizeBtn);
            } else {
                const domSize = SizeClipboard.extractFromCvatDom();
                if (domSize) {
                    SizeClipboard.copy(domSize);
                    copySizeBtn.classList.add('success-flash');
                    copySizeBtn.textContent = '✓ Đã Copy!';
                    setTimeout(() => {
                        copySizeBtn.classList.remove('success-flash');
                        copySizeBtn.textContent = '📋 Copy Size';
                    }, 1200);
                }
            }
        });

        // Jump to Active Frame Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-btn';
        jumpBtn.textContent = 'Jump to Active';
        jumpBtn.addEventListener('click', () => this.scrollToActiveFrame());

        // Close / Hide Button (Collapses back to floating button)
        const hideBtn = document.createElement('button');
        hideBtn.className = 'cvat-qaqc-btn';
        const hideSpan = document.createElement('span');
        hideSpan.textContent = '✕ Ẩn / Hide';
        hideBtn.appendChild(hideSpan);
        hideBtn.title = 'Hide inspector (Alt + Q)';
        hideBtn.addEventListener('click', () => this.close());

        rightGroup.appendChild(segmented);
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

    open() {
        this.isOpen = true;
        this.dom.classList.add('open');
        this.triggerEl.style.display = 'none'; // Hide trigger when drawer is active
        if (typeof this.callbacks.onOpen === 'function') {
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

    toggleOpen() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
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
                }
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
        this.state.currentFrame = frameNumber;
        this.pcdCache = pcdCache;

        for (const [f, card] of this.cards.entries()) {
            const pts = pcdCache?.get(f);
            card.renderViews(pts, f === frameNumber, {
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

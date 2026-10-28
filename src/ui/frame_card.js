/**
 * Frame Card Component for Multi-frame QA/QC
 * Renders Top, Side, Front views in the exact convention and order of CVAT.
 * Compact display allowing multiple frames to be visible simultaneously.
 */

import { Math3D } from '../engine/math_3d.js';
import { OrthoCanvasRenderer } from '../engine/ortho_canvas.js';
import { TrackReader } from '../core/track_reader.js';
import { SizeClipboard } from '../core/size_clipboard.js';

export class FrameCard {
    /**
     * @param {Object} data - { frame, points, box, keyframe, outside, label }
     * @param {Function} onSelectFrame - callback when clicked to jump
     * @param {Function} [onUpdateCuboid] - callback when user edits cuboid (frame, newPoints, newBox)
     * @param {Function} [onPasteSizeToAll] - callback when user chooses to paste size to all frames
     * @param {Function} [onToggleOutside] - callback when outside is toggled (frame, outside)
     * @param {Function} [onHover] - callback when mouse enters/leaves card (frame, isHovered)
     * @param {Object} [options] - additional configuration options (e.g. viewOrder)
     */
    constructor(data, onSelectFrame, onUpdateCuboid, onPasteSizeToAll, onToggleOutside, onHover, options = {}) {
        this.data = data;
        this.frame = data.frame;
        this.onSelectFrame = onSelectFrame;
        this.onUpdateCuboid = onUpdateCuboid;
        this.onPasteSizeToAll = onPasteSizeToAll;
        this.onToggleOutside = onToggleOutside;
        this.onHover = onHover;
        this.options = options || {};

        // Camera order: fixed default 'top,side,front'
        this.viewOrder = Array.isArray(this.options.viewOrder) && this.options.viewOrder.length === 3
            ? [...this.options.viewOrder]
            : ['top', 'side', 'front'];

        // Keep deep copy of original state for reset capability
        this.originalBox = { ...(data.box || {}) };
        this.originalPoints = Array.isArray(data.points) ? [...data.points] : [];

        this.canvases = {};
        this.cells = {};
        this.lastPointCloudData = null;
        this.lastRenderOptions = null;
        this.isCurrent = false;

        this.valDisplays = {};
        this.angleDisplays = {};
        this.dragState = null;
        this.hoverState = null;
        this.rafPending = false;

        // Per-frame localized Undo / Redo history stack
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 30;
        this.undoBtn = null;
        this.redoBtn = null;

        this.dom = this.createDOM();
    }

    createDOM() {
        const card = document.createElement('div');
        card.className = 'cvat-qaqc-card';
        card.dataset.frame = String(this.frame);
        card.tabIndex = 0;
        const activate = () => this.options.onActivate?.(this.frame);
        card.addEventListener('pointerdown', (event) => {
            activate();
            if (!event.target.closest('button,input,textarea,select,canvas,[contenteditable="true"]')) {
                card.focus({ preventScroll: true });
            }
        }, true);
        card.addEventListener('focusin', activate);

        card.addEventListener('mouseenter', () => {
            if (typeof this.onHover === 'function') {
                this.onHover(this.frame, true);
            }
        });
        card.addEventListener('mouseleave', () => {
            if (typeof this.onHover === 'function') {
                this.onHover(this.frame, false);
            }
        });

        // 1. Header Bar (Compact 24px)
        const header = document.createElement('div');
        header.className = 'cvat-qaqc-card-header';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'cvat-qaqc-card-left-group';

        const title = document.createElement('div');
        title.className = 'cvat-qaqc-card-title';
        const frameSpan = document.createElement('span');
        frameSpan.textContent = `Frame ${this.frame}`;
        title.appendChild(frameSpan);

        const kfBadge = document.createElement('span');
        kfBadge.className = 'cvat-qaqc-keyframe-badge';
        kfBadge.textContent = 'Keyframe';
        kfBadge.style.display = this.data.keyframe ? 'inline-block' : 'none';
        this.kfBadge = kfBadge;
        title.appendChild(kfBadge);

        const currentBadge = document.createElement('span');
        currentBadge.className = 'cvat-qaqc-current-badge';
        currentBadge.style.display = 'none';
        currentBadge.textContent = 'Active';
        this.currentBadge = currentBadge;

        // Outside Indicator Badge
        const outsideBadge = document.createElement('span');
        outsideBadge.className = 'cvat-qaqc-outside-badge';
        outsideBadge.textContent = 'Outside';
        outsideBadge.title = 'Box trên frame này đang bị Outside (không hiển thị box). Bấm để chuyển về Inside (Phím tắt: O)';
        outsideBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleOutside();
        });
        this.outsideBadge = outsideBadge;

        // Angle & Dimension Badges
        const yawBadge = document.createElement('span');
        yawBadge.className = 'cvat-qaqc-yaw-badge';
        this.yawBadge = yawBadge;

        const dimBadge = document.createElement('span');
        dimBadge.className = 'cvat-qaqc-dim-badge';
        this.dimBadge = dimBadge;

        this.updateHeaderBadges();

        leftGroup.appendChild(title);
        leftGroup.appendChild(currentBadge);
        leftGroup.appendChild(outsideBadge);
        leftGroup.appendChild(yawBadge);
        leftGroup.appendChild(dimBadge);

        // Header Actions (Right Group)
        const rightGroup = document.createElement('div');
        rightGroup.className = 'cvat-qaqc-card-right-group';

        // Local Per-Frame Undo / Redo Group
        const historyGroup = document.createElement('div');
        historyGroup.className = 'cvat-qaqc-history-group';

        const undoBtn = document.createElement('button');
        undoBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-undo-btn';
        undoBtn.textContent = '↶';
        undoBtn.title = `Hoàn tác (Undo) frame ${this.frame} (Ctrl+Z)`;
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.undo();
        });
        this.undoBtn = undoBtn;

        const redoBtn = document.createElement('button');
        redoBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-redo-btn';
        redoBtn.textContent = '↷';
        redoBtn.title = `Làm lại (Redo) frame ${this.frame} (Ctrl+Y)`;
        redoBtn.disabled = true;
        redoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.redo();
        });
        this.redoBtn = redoBtn;

        historyGroup.appendChild(undoBtn);
        historyGroup.appendChild(redoBtn);

        // Outside Toggle Button
        const outsideBtn = document.createElement('button');
        outsideBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-outside-toggle-btn';
        outsideBtn.textContent = this.data.outside ? '⚡ Đặt Inside' : '🚫 Outside';
        outsideBtn.title = 'Bật/tắt trạng thái Outside cho box trên frame này (Phím tắt: O)';
        outsideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleOutside();
        });
        this.outsideBtn = outsideBtn;

        // Copy Size Button (Compact)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-copy-size-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.title = `Sao chép kích thước (${this.data.box?.sx} × ${this.data.box?.sy} × ${this.data.box?.sz}m) vào clipboard`;
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleCopySize(copyBtn);
        });

        // Paste Size Button (Compact)
        const pasteBtn = document.createElement('button');
        pasteBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-paste-size-btn';
        pasteBtn.textContent = '📄 Dán';
        pasteBtn.title = 'Dán kích thước từ clipboard vào cuboid trên frame này (Realtime)';
        pasteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handlePasteSize(pasteBtn);
        });

        // Fix / Apply to All Frames Button (Compact)
        const fixAllBtn = document.createElement('button');
        fixAllBtn.className = 'cvat-qaqc-card-btn cvat-qaqc-apply-all-btn';
        fixAllBtn.textContent = '⚡ Cố định All';
        fixAllBtn.title = 'Cố định kích thước của frame này cho TẤT CẢ các frame của track (Realtime)';
        fixAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handlePasteSizeToAll(fixAllBtn);
        });

        // Jump Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-jump-btn';
        jumpBtn.textContent = '↗ Nhảy / Jump';
        jumpBtn.title = `Chuyển vùng nhìn CVAT đến Frame ${this.frame}`;
        jumpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.triggerJump();
        });

        rightGroup.appendChild(historyGroup);
        rightGroup.appendChild(outsideBtn);
        rightGroup.appendChild(copyBtn);
        rightGroup.appendChild(pasteBtn);
        rightGroup.appendChild(fixAllBtn);
        rightGroup.appendChild(jumpBtn);

        header.appendChild(leftGroup);
        header.appendChild(rightGroup);

        header.addEventListener('click', () => {
            this.triggerJump();
        });

        // 2. Views Grid: Configurable order (default: Top, Front, Side)
        const grid = document.createElement('div');
        grid.className = 'cvat-qaqc-views-grid';
        this.grid = grid;

        const viewDefinitions = {
            top: { id: 'top', label: 'Top' },
            front: { id: 'front', label: 'Front' },
            side: { id: 'side', label: 'Side' }
        };

        const activeOrder = Array.isArray(this.viewOrder) && this.viewOrder.length === 3
            ? this.viewOrder
            : ['top', 'side', 'front'];

        for (const viewType of activeOrder) {
            const def = viewDefinitions[viewType] || { id: viewType, label: viewType.toUpperCase() };
            const label = def.label;
            const cell = document.createElement('div');
            cell.className = `cvat-qaqc-view-cell cell-${viewType}`;
            this.cells[viewType] = cell;

            // CVAT-style Header Strip for each view with integrated rotation buttons
            const cellHeader = document.createElement('div');
            cellHeader.className = 'cvat-qaqc-cell-header';

            const cellTitle = document.createElement('div');
            cellTitle.className = 'cvat-qaqc-cell-title';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'cvat-qaqc-cell-name';
            nameSpan.textContent = label;

            const angleSpan = document.createElement('span');
            angleSpan.className = 'cvat-qaqc-cell-angle';
            this.angleDisplays[viewType] = angleSpan;

            cellTitle.appendChild(nameSpan);
            cellTitle.appendChild(angleSpan);

            // Rotate buttons for this specific view (Top: Yaw, Side: Pitch, Front: Roll)
            const rotGroup = this.createRotateGroup(viewType, (delta) => this.rotateView(viewType, delta));

            cellHeader.appendChild(cellTitle);
            cellHeader.appendChild(rotGroup);

            const canvas = document.createElement('canvas');
            canvas.tabIndex = 0;
            canvas.setAttribute('aria-label', `${viewType} — Frame ${this.frame}. Phím tắt chỉnh box đang trỏ hoặc focus.`);
            canvas.width = 220;
            canvas.height = 110;
            this.canvases[viewType] = canvas;

            this.setupCanvasInteractions(canvas, viewType);

            cell.appendChild(cellHeader);
            cell.appendChild(canvas);
            grid.appendChild(cell);
        }

        card.appendChild(header);
        card.appendChild(grid);

        return card;
    }

    /**
     * Reorder view cells without destroying DOM or canvases
     * @param {Array<string>} orderArray
     */
    setViewOrder(orderArray) {
        if (!this.grid || !this.cells || !Array.isArray(orderArray)) return;
        this.viewOrder = [...orderArray];
        for (const viewType of orderArray) {
            const cell = this.cells[viewType];
            if (cell) {
                this.grid.appendChild(cell);
            }
        }
    }

    /**
     * Rotate cuboid around its camera's local view axis
     * Top: Local Z (Yaw)
     * Front: Local X (Roll)
     * Side: Local Y (Pitch)
     * @param {'top'|'side'|'front'} viewType
     * @param {number} deltaRad - angle increment in radians
     */
    rotateView(viewType, deltaRad) {
        if (!this.data.box) return;

        this.pushUndoSnapshot(this.takeSnapshot());

        // Perform authentic 3D local-axis rotation matching Three.js / CVAT canvas3d
        const newAngles = Math3D.rotateLocal(this.data.box, viewType, deltaRad);
        this.data.box.rx = newAngles.rx;
        this.data.box.ry = newAngles.ry;
        this.data.box.rz = newAngles.rz;

        this.applyBoxChanges();
    }

    /**
     * Convenience method for rotating Yaw (around Z)
     * @param {number} deltaRad
     */
    rotateBy(deltaRad) {
        this.rotateView('top', deltaRad);
    }

    createRotateGroup(viewType = 'top', onRotate) {
        const group = document.createElement('div');
        group.className = 'cvat-qaqc-rot-group';
        const axisName = viewType === 'top' ? 'Yaw' : (viewType === 'front' ? 'Roll' : 'Pitch');
        group.title = `Xoay góc ${axisName}`;

        const isTop = viewType === 'top';
        const stepDeg = isTop ? 5 : 1;
        const stepRad = stepDeg * Math.PI / 180;

        const buttons = [
            { label: '↺ 90°', delta: -Math.PI / 2, title: `Xoay -90° (${axisName})` },
            { label: `↺ ${stepDeg}°`, delta: -stepRad, title: `Xoay -${stepDeg}° (${axisName})` },
            { label: `↻ ${stepDeg}°`, delta: stepRad,  title: `Xoay +${stepDeg}° (${axisName})` },
            { label: '↻ 90°', delta: Math.PI / 2,  title: `Xoay +90° (${axisName})` }
        ];

        buttons.forEach(({ label, delta, title }) => {
            const btn = document.createElement('button');
            btn.className = 'cvat-qaqc-rot-btn';
            btn.textContent = label;
            btn.title = title;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onRotate(delta);
            });
            group.appendChild(btn);
        });

        return group;
    }

    /**
     * Capture immutable snapshot of current state for localized undo/redo
     */
    takeSnapshot() {
        return {
            box: { ...(this.data.box || {}) },
            points: Array.isArray(this.data.points) ? [...this.data.points] : [],
            outside: !!this.data.outside,
            keyframe: !!this.data.keyframe
        };
    }

    /**
     * Push snapshot into card's local undo stack and clear redo stack
     * @param {Object} snap
     */
    pushUndoSnapshot(snap) {
        if (!snap) return;
        this.undoStack.push(snap);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = []; // New user edit invalidates redo stack
        this.updateUndoRedoButtons();
    }

    /**
     * Update state and tooltip text of Undo / Redo buttons
     */
    updateUndoRedoButtons() {
        if (this.undoBtn) {
            this.undoBtn.disabled = this.undoStack.length === 0;
            this.undoBtn.title = this.undoStack.length > 0
                ? `Hoàn tác (Undo) frame ${this.frame} (${this.undoStack.length} bước - Ctrl+Z)`
                : `Không có thao tác nào để hoàn tác trên frame ${this.frame}`;
        }
        if (this.redoBtn) {
            this.redoBtn.disabled = this.redoStack.length === 0;
            this.redoBtn.title = this.redoStack.length > 0
                ? `Làm lại (Redo) frame ${this.frame} (${this.redoStack.length} bước - Ctrl+Y)`
                : `Không có thao tác nào để làm lại trên frame ${this.frame}`;
        }
    }

    /**
     * Restore previous state on this specific frame
     * @returns {boolean}
     */
    undo() {
        if (this.undoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const prevSnap = this.undoStack.pop();
        this.redoStack.push(currentSnap);
        if (this.redoStack.length > this.maxHistory) {
            this.redoStack.shift();
        }

        this.restoreSnapshot(prevSnap);
        this.updateUndoRedoButtons();
        return true;
    }

    /**
     * Re-apply undone state on this specific frame
     * @returns {boolean}
     */
    redo() {
        if (this.redoStack.length === 0) return false;
        const currentSnap = this.takeSnapshot();
        const nextSnap = this.redoStack.pop();
        this.undoStack.push(currentSnap);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }

        this.restoreSnapshot(nextSnap);
        this.updateUndoRedoButtons();
        return true;
    }

    /**
     * Apply snapshot back into this card and sync in-place to CVAT
     * @param {Object} snap
     */
    restoreSnapshot(snap) {
        if (!snap) return;
        this.data.box = { ...(snap.box || {}) };
        this.data.points = Array.isArray(snap.points) ? [...snap.points] : [];
        this.data.outside = !!snap.outside;
        this.data.keyframe = !!snap.keyframe;

        this.applyBoxChanges();

        if (typeof this.onToggleOutside === 'function') {
            this.onToggleOutside(this.frame, this.data.outside);
        }
    }

    applyBoxChanges() {
        this.data.points = TrackReader.boxToPoints(this.data.box, this.data.points);
        this.data.keyframe = true; // Editing an interpolated frame promotes it to a keyframe

        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        }

        this.updateHeaderBadges();

        if (typeof this.onUpdateCuboid === 'function') {
            this.onUpdateCuboid(this.frame, this.data.points, this.data.box);
        }
    }

    resetToOriginal() {
        this.pushUndoSnapshot(this.takeSnapshot());
        this.data.box = { ...this.originalBox };
        this.data.points = [...this.originalPoints];
        this.applyBoxChanges();
    }

    /**
     * Seamlessly update card data and views without rebuilding DOM
     * Used when an Undo, Redo, or external CVAT edit occurs
     * @param {Object} newData - { frame, points, box, keyframe, outside, label }
     */
    updateData(newData) {
        if (!newData) return;
        this.data = newData;
        this.frame = newData.frame;

        this.updateHeaderBadges();

        // Re-render views with existing point cloud data & options
        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        } else {
            this.renderViews(null, this.isCurrent, this.lastRenderOptions || {
                viewMode: 'all',
                zoom: 1.0,
                pointSize: 1.0
            });
        }
    }

    /**
     * Copy dimensions of this frame's cuboid into clipboard
     */
    handleCopySize(btn) {
        if (!this.data.box) return;
        const res = SizeClipboard.copy(this.data.box);
        if (!res) return;

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = `✓ ${res.sx}×${res.sy}×${res.sz}m`;
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1500);
        }
    }

    /**
     * Paste dimensions from clipboard into this frame's cuboid
     */
    async handlePasteSize(btn) {
        const size = await SizeClipboard.get();
        if (!size) {
            if (btn) {
                const origHTML = btn.innerHTML;
                btn.innerHTML = '⚠️ Chưa có size!';
                setTimeout(() => {
                    btn.innerHTML = origHTML;
                }, 1200);
            }
            return;
        }

        const success = this.pasteSize(size);
        if (success && btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = '✓ Đã Dán!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1200);
        }
    }

    /**
     * Apply dimensions to this frame's box in-memory (0 server requests)
     * @param {Object} sizeObj - { sx, sy, sz } or { w, l, h }
     */
    pasteSize(sizeObj) {
        if (!sizeObj) return false;
        const sx = Number(sizeObj.sx ?? sizeObj.w);
        const sy = Number(sizeObj.sy ?? sizeObj.l);
        const sz = Number(sizeObj.sz ?? sizeObj.h);

        if (isNaN(sx) || isNaN(sy) || isNaN(sz) || sx <= 0 || sy <= 0 || sz <= 0) {
            return false;
        }

        this.pushUndoSnapshot(this.takeSnapshot());

        if (!this.data.box) this.data.box = {};
        this.data.box.sx = parseFloat(sx.toFixed(3));
        this.data.box.sy = parseFloat(sy.toFixed(3));
        this.data.box.sz = parseFloat(sz.toFixed(3));

        this.applyBoxChanges();
        return true;
    }

    /**
     * Paste current frame dimensions to ALL loaded frames of this track
     */
    async handlePasteSizeToAll(btn) {
        if (!this.data.box) return;
        let size = SizeClipboard.copy(this.data.box);
        if (!size) size = await SizeClipboard.get();
        if (!size) return;

        if (typeof this.onPasteSizeToAll === 'function') {
            await this.onPasteSizeToAll(size);
        } else {
            this.pasteSize(size);
        }

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = '✓ Đã cố định All!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1500);
        }
    }

    /**
     * Toggle outside flag for this frame card
     */
    toggleOutside() {
        this.pushUndoSnapshot(this.takeSnapshot());
        this.data.outside = !this.data.outside;
        this.updateHeaderBadges();

        if (this.lastPointCloudData && this.lastRenderOptions) {
            this.renderViews(this.lastPointCloudData, this.isCurrent, this.lastRenderOptions);
        } else {
            this.renderViews(null, this.isCurrent, this.lastRenderOptions || {
                viewMode: 'all',
                zoom: 1.0,
                pointSize: 1.0
            });
        }

        if (typeof this.onToggleOutside === 'function') {
            this.onToggleOutside(this.frame, this.data.outside);
        }
    }

    updateHeaderBadges() {
        const { box } = this.data;
        if (!box) return;

        const isOutside = !!this.data.outside;

        if (this.kfBadge) {
            this.kfBadge.style.display = this.data.keyframe ? 'inline-block' : 'none';
        }

        if (this.outsideBadge) {
            this.outsideBadge.style.display = isOutside ? 'inline-block' : 'none';
        }

        if (this.outsideBtn) {
            this.outsideBtn.textContent = isOutside ? '⚡ Đặt Inside' : '🚫 Outside';
            if (isOutside) {
                this.outsideBtn.classList.add('active-outside');
            } else {
                this.outsideBtn.classList.remove('active-outside');
            }
        }

        if (this.dom) {
            if (isOutside) {
                this.dom.classList.add('is-outside');
            } else {
                this.dom.classList.remove('is-outside');
            }
        }

        const toDegStr = (rad) => {
            const deg = ((rad * 180 / Math.PI) % 360).toFixed(1);
            return `${deg >= 0 ? '+' : ''}${deg}°`;
        };

        if (this.yawBadge) {
            const rz = box.rz ?? 0;
            this.yawBadge.textContent = isOutside ? `Yaw: ${toDegStr(rz)} (Outside)` : `Yaw: ${toDegStr(rz)}`;
        }

        if (this.angleDisplays) {
            const localAngles = Math3D.getLocalAngles(box);
            if (this.angleDisplays.top) {
                this.angleDisplays.top.textContent = toDegStr(localAngles.yaw);
            }
            if (this.angleDisplays.side) {
                this.angleDisplays.side.textContent = toDegStr(localAngles.pitch);
            }
            if (this.angleDisplays.front) {
                this.angleDisplays.front.textContent = toDegStr(localAngles.roll);
            }
        }

        if (this.dimBadge) {
            const { sx = 2, sy = 4, sz = 1.5 } = box;
            this.dimBadge.textContent = isOutside
                ? `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}m [Outside]`
                : `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}m`;
        }
    }

    triggerJump() {
        this.dom.classList.add('jumping');
        setTimeout(() => this.dom.classList.remove('jumping'), 300);

        if (typeof this.onSelectFrame === 'function') {
            this.onSelectFrame(this.frame);
        }
    }

    /**
     * Set up smooth direct manipulation (rotate like CVAT, translate, 4-corner resize) on canvas
     * @param {HTMLCanvasElement} canvas
     * @param {'top'|'side'|'front'} viewType
     */
    setupCanvasInteractions(canvas, viewType) {
        canvas.style.touchAction = 'none';

        const OPPOSITE_CORNER = {
            tl: 'br',
            tr: 'bl',
            bl: 'tr',
            br: 'tl'
        };

        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        const detectActionAtPos = (pos, metrics) => {
            if (!this.data.box) return null;

            // 1. Heading rotation helper (Top view only - green circle dot on forward stem)
            if (viewType === 'top') {
                const distToDot = Math.hypot(pos.x - metrics.rotDotX, pos.y - metrics.rotDotY);
                if (distToDot <= 14) {
                    return { action: 'rotate', target: 'rotate' };
                }
            }

            // 2. CVAT 4 Red Corner Handles (strictly used for resizing, opposite vertex remains anchored)
            if (metrics.corners) {
                for (const [key, pt] of Object.entries(metrics.corners)) {
                    const dist = Math.hypot(pos.x - pt.x, pos.y - pt.y);
                    if (dist <= 14) {
                        return { action: 'resize-corner', cornerKey: key, target: `corner-${key}` };
                    }
                }
            }

            // 3. Inside box for translation (drag) - edges do NOT resize
            if (pos.x >= metrics.boxLeft && pos.x <= metrics.boxRight &&
                pos.y >= metrics.boxTop && pos.y <= metrics.boxBottom) {
                return { action: 'translate', target: 'box' };
            }

            return null;
        };

        canvas.addEventListener('pointerenter', () => {
            this.hoverState = { viewType, target: null };
        });

        canvas.addEventListener('pointerleave', () => {
            if (!this.dragState) {
                this.hoverState = null;
                canvas.style.cursor = 'default';
                this.requestRender();
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            const pos = getCanvasPos(e);
            const metrics = OrthoCanvasRenderer.getMetrics(canvas, this.data.box, viewType, this.lastRenderOptions);

            if (!this.dragState) {
                const hit = detectActionAtPos(pos, metrics);
                const target = hit?.target || null;
                const prevTarget = this.hoverState?.target;
                this.hoverState = { viewType, target, cornerKey: hit?.cornerKey || null };

                if (target === 'rotate') {
                    canvas.style.cursor = 'crosshair';
                } else if (target === 'corner-tl' || target === 'corner-br') {
                    canvas.style.cursor = 'nwse-resize';
                } else if (target === 'corner-tr' || target === 'corner-bl') {
                    canvas.style.cursor = 'nesw-resize';
                } else if (target === 'box') {
                    canvas.style.cursor = 'grab';
                } else {
                    canvas.style.cursor = 'default';
                }

                if (target !== prevTarget) {
                    this.requestRender();
                }
                return;
            }

            if (this.dragState.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            this.dragState.hasMoved = true;
            const { action } = this.dragState;

            if (action === 'rotate') {
                const currAngle = Math.atan2(this.dragState.initialMetrics.centerY - pos.y, pos.x - this.dragState.initialMetrics.centerX);
                let dAngle = currAngle - this.dragState.lastAngle;
                while (dAngle > Math.PI) dAngle -= Math.PI * 2;
                while (dAngle < -Math.PI) dAngle += Math.PI * 2;

                this.dragState.lastAngle = currAngle;
                let nextRz = (this.data.box.rz || 0) + dAngle;
                while (nextRz > Math.PI) nextRz -= Math.PI * 2;
                while (nextRz < -Math.PI) nextRz += Math.PI * 2;
                this.data.box.rz = parseFloat(nextRz.toFixed(4));
            } else if (action === 'translate') {
                const totalDxPx = pos.x - this.dragState.startX;
                const totalDyPx = pos.y - this.dragState.startY;
                this.dragState.translateOffsetPx = { dx: totalDxPx, dy: totalDyPx };
                this.dragState.lastX = pos.x;
                this.dragState.lastY = pos.y;

                const { initialBox, initialMetrics } = this.dragState;
                const scale = initialMetrics.scale;
                const d_h = totalDxPx / scale;
                const d_v = -totalDyPx / scale;
                const rz = initialBox.rz || 0;

                let d_lx = 0, d_ly = 0, d_lz = 0;
                if (viewType === 'top') {
                    d_lx = d_h;
                    d_ly = d_v;
                } else if (viewType === 'front') {
                    d_ly = d_h;
                    d_lz = d_v;
                } else if (viewType === 'side') {
                    d_lx = -d_h;
                    d_lz = d_v;
                }

                const d_wx = d_lx * Math.cos(rz) - d_ly * Math.sin(rz);
                const d_wy = d_lx * Math.sin(rz) + d_ly * Math.cos(rz);
                const d_wz = d_lz;

                this.data.box.x = parseFloat(((initialBox.x || 0) + d_wx).toFixed(3));
                this.data.box.y = parseFloat(((initialBox.y || 0) + d_wy).toFixed(3));
                this.data.box.z = parseFloat(((initialBox.z || 0) + d_wz).toFixed(3));
            } else if (action === 'resize-corner') {
                // Authentic CVAT 4-corner resizing with fixed opposite corner anchor
                const {
                    signU, signV, oppPxX, oppPxY,
                    initialBox, initialMetrics
                } = this.dragState;

                const scale = initialMetrics.scale;
                const minDimPx = 0.15 * scale; // Minimum 0.15m in pixels

                // In canvas pixel coordinates: clamp dragged corner so box never collapses
                let dragPxX = pos.x;
                let dragPxY = pos.y;

                if (signU > 0) {
                    dragPxX = Math.max(oppPxX + minDimPx, dragPxX);
                } else {
                    dragPxX = Math.min(oppPxX - minDimPx, dragPxX);
                }

                if (signV > 0) {
                    dragPxY = Math.min(oppPxY - minDimPx, dragPxY);
                } else {
                    dragPxY = Math.max(oppPxY + minDimPx, dragPxY);
                }

                const boxPxLeft = Math.min(oppPxX, dragPxX);
                const boxPxRight = Math.max(oppPxX, dragPxX);
                const boxPxTop = Math.min(oppPxY, dragPxY);
                const boxPxBottom = Math.max(oppPxY, dragPxY);
                const boxPxW = boxPxRight - boxPxLeft;
                const boxPxH = boxPxBottom - boxPxTop;

                // Pass screen pixel bounds to renderer so opposite anchor stays rock solid
                this.dragState.resizeBoxPx = {
                    left: boxPxLeft,
                    right: boxPxRight,
                    top: boxPxTop,
                    bottom: boxPxBottom,
                    width: boxPxW,
                    height: boxPxH
                };

                const newDimH = boxPxW / scale;
                const newDimV = boxPxH / scale;

                // Center displacement in local view frame
                const newPxCenterX = (boxPxLeft + boxPxRight) / 2;
                const newPxCenterY = (boxPxTop + boxPxBottom) / 2;
                const dxPx = newPxCenterX - initialMetrics.centerX;
                const dyPx = newPxCenterY - initialMetrics.centerY;
                const u_mid = dxPx / scale;
                const v_mid = -dyPx / scale;

                const rz0 = initialBox.rz || 0;
                let d_lx = 0, d_ly = 0, d_lz = 0;
                let nextSx = initialBox.sx || 2;
                let nextSy = initialBox.sy || 4;
                let nextSz = initialBox.sz || 1.5;

                if (viewType === 'top') {
                    d_lx = u_mid;
                    d_ly = v_mid;
                    nextSx = newDimH;
                    nextSy = newDimV;
                } else if (viewType === 'front') {
                    d_ly = u_mid;
                    d_lz = v_mid;
                    nextSy = newDimH;
                    nextSz = newDimV;
                } else if (viewType === 'side') {
                    d_lx = -u_mid;
                    d_lz = v_mid;
                    nextSx = newDimH;
                    nextSz = newDimV;
                }

                const d_wx = d_lx * Math.cos(rz0) - d_ly * Math.sin(rz0);
                const d_wy = d_lx * Math.sin(rz0) + d_ly * Math.cos(rz0);
                const d_wz = d_lz;

                this.data.box.x = parseFloat(((initialBox.x || 0) + d_wx).toFixed(3));
                this.data.box.y = parseFloat(((initialBox.y || 0) + d_wy).toFixed(3));
                this.data.box.z = parseFloat(((initialBox.z || 0) + d_wz).toFixed(3));
                this.data.box.sx = parseFloat(nextSx.toFixed(3));
                this.data.box.sy = parseFloat(nextSy.toFixed(3));
                this.data.box.sz = parseFloat(nextSz.toFixed(3));
            }

            this.requestRender();
        });

        canvas.addEventListener('pointerdown', (e) => {
            canvas.focus({ preventScroll: true });
            if (e.button !== 0 || this.data.outside) return; // Only primary mouse button and not outside

            const pos = getCanvasPos(e);
            const metrics = OrthoCanvasRenderer.getMetrics(canvas, this.data.box, viewType, this.lastRenderOptions);
            const hit = detectActionAtPos(pos, metrics);

            if (!hit) return;

            e.preventDefault();
            e.stopPropagation();

            try {
                canvas.setPointerCapture(e.pointerId);
            } catch (_) {}

            const action = hit.action;
            const cornerKey = hit.cornerKey || null;
            const oppKey = cornerKey ? OPPOSITE_CORNER[cornerKey] : null;

            if (action === 'translate') {
                canvas.style.cursor = 'grabbing';
            } else if (action === 'rotate') {
                canvas.style.cursor = 'crosshair';
            } else if (action === 'resize-corner') {
                canvas.style.cursor = (cornerKey === 'tl' || cornerKey === 'br') ? 'nwse-resize' : 'nesw-resize';
            }

            const initialBox = { ...(this.data.box || {}) };
            const initialMetrics = { ...metrics };

            let oppLocalU = 0;
            let oppLocalV = 0;
            let oppPxX = 0;
            let oppPxY = 0;
            let signU = 0;
            let signV = 0;

            if (action === 'resize-corner' && cornerKey && oppKey) {
                signU = (cornerKey === 'tr' || cornerKey === 'br') ? 1 : -1;
                signV = (cornerKey === 'tl' || cornerKey === 'tr') ? 1 : -1;
                oppLocalU = -signU * (metrics.dimH / 2);
                oppLocalV = -signV * (metrics.dimV / 2);
                oppPxX = metrics.corners[oppKey].x;
                oppPxY = metrics.corners[oppKey].y;
            }

            this.dragState = {
                pointerId: e.pointerId,
                viewType,
                action,
                cornerKey,
                oppositeCornerKey: oppKey,
                signU,
                signV,
                oppLocalU,
                oppLocalV,
                oppPxX,
                oppPxY,
                initialBox,
                initialMetrics,
                initialLocalPoints: this.lastRenderLocalPoints || null,
                snapshotBeforeDrag: this.takeSnapshot(),
                startX: pos.x,
                startY: pos.y,
                lastX: pos.x,
                lastY: pos.y,
                lastAngle: Math.atan2(metrics.centerY - pos.y, pos.x - metrics.centerX),
                hasMoved: false,
                resizeBoxPx: null,
                translateOffsetPx: { dx: 0, dy: 0 }
            };

            this.requestRender();
        });

        const handlePointerUp = (e) => {
            if (!this.dragState || this.dragState.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const hadMoved = this.dragState.hasMoved;
            const snap = this.dragState.snapshotBeforeDrag;
            this.dragState = null;
            canvas.style.cursor = 'default';

            if (hadMoved) {
                this.pushUndoSnapshot(snap);
                this.applyBoxChanges();
            } else {
                this.requestRender();
            }
        };

        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointercancel', handlePointerUp);
    }

    requestRender() {
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
            this.rafPending = false;
            const opts = {
                ...(this.lastRenderOptions || {}),
                interaction: {
                    activeAction: this.dragState?.action || null,
                    activeCornerKey: this.dragState?.cornerKey || null,
                    oppositeCornerKey: this.dragState?.oppositeCornerKey || null,
                    viewType: this.dragState?.viewType || null,
                    hoverViewType: this.hoverState?.viewType || null,
                    hoverTarget: this.hoverState?.target || null,
                    resizeBoxPx: this.dragState?.resizeBoxPx || null,
                    translateOffsetPx: this.dragState?.translateOffsetPx || null
                }
            };
            this.renderViews(this.lastPointCloudData, this.isCurrent, opts);
            this.updateHeaderBadges();
        });
    }

    /**
     * Fast toggle of active frame border and badge without expensive canvas re-render
     * @param {boolean} isCurrentFrame
     */
    setActive(isCurrentFrame) {
        this.isCurrent = !!isCurrentFrame;
        if (isCurrentFrame) {
            this.dom.classList.add('active-frame');
            if (this.currentBadge) this.currentBadge.style.display = 'inline-block';
        } else {
            this.dom.classList.remove('active-frame');
            if (this.currentBadge) this.currentBadge.style.display = 'none';
        }
    }

    /**
     * Render or refresh canvas projections in CVAT order (Top, Side, Front)
     * @param {{ positions: Float32Array, stride: number } | null} pointCloudData
     * @param {boolean} isCurrentFrame
     * @param {Object} options - { viewMode, zoom, pointSize, interaction }
     */
    renderViews(pointCloudData, isCurrentFrame, options = {}) {
        this.lastPointCloudData = pointCloudData;
        this.lastRenderOptions = options;
        this.isCurrent = isCurrentFrame;

        const { box, label } = this.data;
        const color = label?.color || '#30D158';
        const viewMode = options.viewMode || 'all'; // 'all', 'top', 'side', 'front'
        const zoom = options.zoom || 1.0;
        const pointSize = typeof options.pointSize === 'number' ? options.pointSize : 1.0;

        // Active frame highlight
        if (isCurrentFrame) {
            this.dom.classList.add('active-frame');
            this.currentBadge.style.display = 'inline-block';
        } else {
            this.dom.classList.remove('active-frame');
            this.currentBadge.style.display = 'none';
        }

        // View Mode Class
        this.grid.className = `cvat-qaqc-views-grid mode-${viewMode}`;

        // Transform points to local box coordinate frame (cached during any active drag to eliminate GC stutter)
        let localPoints = null;
        if (options.interaction?.activeAction && this.dragState?.initialLocalPoints) {
            localPoints = this.dragState.initialLocalPoints;
        } else if (pointCloudData && pointCloudData.positions) {
            localPoints = Math3D.transformAndCropPoints(
                pointCloudData.positions,
                pointCloudData.stride || 3,
                box,
                1.35
            );
            this.lastRenderLocalPoints = localPoints;
        }

        const renderOptions = {
            zoom,
            pointSize,
            color,
            marginFactor: 1.35,
            referenceBox: this.originalBox || box,
            outside: !!this.data.outside,
            interaction: options.interaction || null
        };

        const activeViews = viewMode === 'all' ? ['top', 'side', 'front'] : [viewMode];

        for (const viewType of ['top', 'side', 'front']) {
            const canvas = this.canvases[viewType];
            const cell = canvas?.parentElement;
            if (activeViews.includes(viewType)) {
                if (cell) cell.style.display = 'flex';
                OrthoCanvasRenderer.render(canvas, localPoints, box, viewType, renderOptions);
            } else {
                if (cell) cell.style.display = 'none';
            }
        }
    }
}

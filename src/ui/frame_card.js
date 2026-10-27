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

        this.dom = this.createDOM();
    }

    createDOM() {
        const card = document.createElement('div');
        card.className = 'cvat-qaqc-card';
        card.dataset.frame = String(this.frame);

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
        pasteBtn.textContent = '📄 Paste';
        pasteBtn.title = 'Dán kích thước từ clipboard vào cuboid trên frame này';
        pasteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handlePasteSize(pasteBtn);
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

        rightGroup.appendChild(outsideBtn);
        rightGroup.appendChild(copyBtn);
        rightGroup.appendChild(pasteBtn);
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
     * Rotate cuboid in specific projection view
     * @param {'top'|'side'|'front'} viewType
     * @param {number} deltaRad - angle increment in radians
     */
    rotateView(viewType, deltaRad) {
        if (!this.data.box || this.data.outside) return;

        // Top: Yaw (rz, around Z)
        // Front: Roll (rx, around X)
        // Side: Pitch (ry, around Y)
        const propKey = viewType === 'top' ? 'rz' : (viewType === 'front' ? 'rx' : 'ry');
        const current = typeof this.data.box[propKey] === 'number' ? this.data.box[propKey] : 0;
        let nextVal = current + deltaRad;

        while (nextVal > Math.PI) nextVal -= Math.PI * 2;
        while (nextVal < -Math.PI) nextVal += Math.PI * 2;

        this.data.box[propKey] = parseFloat(nextVal.toFixed(4));
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
            btn.innerHTML = '✓ Đã Copy!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1200);
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
        let size = await SizeClipboard.get();
        if (!size && this.data.box) {
            size = SizeClipboard.copy(this.data.box);
        }
        if (!size) return;

        if (typeof this.onPasteSizeToAll === 'function') {
            this.onPasteSizeToAll(size);
        } else {
            this.pasteSize(size);
        }

        if (btn) {
            const origHTML = btn.innerHTML;
            btn.classList.add('success-flash');
            btn.innerHTML = '✓ Đã dán tất cả!';
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.innerHTML = origHTML;
            }, 1400);
        }
    }

    /**
     * Toggle outside flag for this frame card
     */
    toggleOutside() {
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
            this.yawBadge.textContent = isOutside ? 'Yaw: Outside' : `Yaw: ${toDegStr(rz)}`;
        }

        if (this.angleDisplays) {
            if (this.angleDisplays.top) {
                this.angleDisplays.top.textContent = isOutside ? '--' : toDegStr(box.rz ?? 0);
            }
            if (this.angleDisplays.side) {
                this.angleDisplays.side.textContent = isOutside ? '--' : toDegStr(box.rx ?? 0);
            }
            if (this.angleDisplays.front) {
                this.angleDisplays.front.textContent = isOutside ? '--' : toDegStr(box.ry ?? 0);
            }
        }

        if (this.dimBadge) {
            const { sx = 2, sy = 4, sz = 1.5 } = box;
            this.dimBadge.textContent = isOutside ? '[Outside]' : `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}m`;
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
            if (!this.data.box || this.data.outside) return null;

            // 1. Heading rotation helper (Top view only - green circle dot on forward stem)
            if (viewType === 'top') {
                const distToDot = Math.hypot(pos.x - metrics.rotDotX, pos.y - metrics.rotDotY);
                if (distToDot <= 12) {
                    return { action: 'rotate', target: 'rotate' };
                }
            }

            // 2. CVAT 4 Red Corner Handles (diagonally opposite vertex remains anchored)
            if (metrics.corners) {
                for (const [key, pt] of Object.entries(metrics.corners)) {
                    const dist = Math.hypot(pos.x - pt.x, pos.y - pt.y);
                    if (dist <= 12) {
                        return { action: 'resize-corner', cornerKey: key, target: `corner-${key}` };
                    }
                }
            }

            // 3. Fallback: Near edges for single-edge resizing (6px tolerance)
            const tol = 6;
            const inYRange = pos.y >= metrics.boxTop - tol && pos.y <= metrics.boxBottom + tol;
            const inXRange = pos.x >= metrics.boxLeft - tol && pos.x <= metrics.boxRight + tol;

            if (inYRange) {
                if (Math.abs(pos.x - metrics.boxLeft) <= tol) return { action: 'resize-left', target: 'edge-left' };
                if (Math.abs(pos.x - metrics.boxRight) <= tol) return { action: 'resize-right', target: 'edge-right' };
            }
            if (inXRange) {
                if (Math.abs(pos.y - metrics.boxTop) <= tol) return { action: 'resize-top', target: 'edge-top' };
                if (Math.abs(pos.y - metrics.boxBottom) <= tol) return { action: 'resize-bottom', target: 'edge-bottom' };
            }

            // 4. Inside box for translation (drag)
            if (pos.x > metrics.boxLeft && pos.x < metrics.boxRight &&
                pos.y > metrics.boxTop && pos.y < metrics.boxBottom) {
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
                } else if (target === 'edge-left' || target === 'edge-right') {
                    canvas.style.cursor = 'ew-resize';
                } else if (target === 'edge-top' || target === 'edge-bottom') {
                    canvas.style.cursor = 'ns-resize';
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
                const dxPx = pos.x - this.dragState.lastX;
                const dyPx = pos.y - this.dragState.lastY;
                this.dragState.lastX = pos.x;
                this.dragState.lastY = pos.y;

                const scale = metrics.scale;
                const d_h = dxPx / scale;
                const d_v = -dyPx / scale;
                const rz = this.data.box.rz || 0;

                let d_lx = 0, d_ly = 0, d_lz = 0;
                if (viewType === 'top') {
                    d_lx = d_h;
                    d_ly = d_v;
                } else if (viewType === 'side') {
                    d_ly = d_h;
                    d_lz = d_v;
                } else if (viewType === 'front') {
                    d_lx = d_h;
                    d_lz = d_v;
                }

                const d_wx = d_lx * Math.cos(rz) - d_ly * Math.sin(rz);
                const d_wy = d_lx * Math.sin(rz) + d_ly * Math.cos(rz);
                const d_wz = d_lz;

                this.data.box.x = parseFloat(((this.data.box.x || 0) + d_wx).toFixed(3));
                this.data.box.y = parseFloat(((this.data.box.y || 0) + d_wy).toFixed(3));
                this.data.box.z = parseFloat(((this.data.box.z || 0) + d_wz).toFixed(3));
            } else if (action === 'resize-corner') {
                // Authentic CVAT 4-corner resizing with fixed opposite corner anchor
                const {
                    signU, signV, oppLocalU, oppLocalV,
                    initialBox, initialMetrics
                } = this.dragState;

                const u_cur = (pos.x - initialMetrics.centerX) / initialMetrics.scale;
                const v_cur = (initialMetrics.centerY - pos.y) / initialMetrics.scale;
                const minDim = 0.15;

                const rawDimH = (u_cur - oppLocalU) * signU;
                const newDimH = Math.max(minDim, rawDimH);
                const u_clamped = oppLocalU + signU * newDimH;

                const rawDimV = (v_cur - oppLocalV) * signV;
                const newDimV = Math.max(minDim, rawDimV);
                const v_clamped = oppLocalV + signV * newDimV;

                // Midpoint between fixed opposite corner and clamped dragged corner
                const u_mid = (oppLocalU + u_clamped) / 2;
                const v_mid = (oppLocalV + v_clamped) / 2;

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
                } else if (viewType === 'side') {
                    d_ly = u_mid;
                    d_lz = v_mid;
                    nextSy = newDimH;
                    nextSz = newDimV;
                } else if (viewType === 'front') {
                    d_lx = u_mid;
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
            } else if (action.startsWith('resize-')) {
                // Fallback single-edge resizing
                const dxPx = pos.x - this.dragState.lastX;
                const dyPx = pos.y - this.dragState.lastY;
                this.dragState.lastX = pos.x;
                this.dragState.lastY = pos.y;

                const scale = metrics.scale;
                if (action === 'resize-left' || action === 'resize-right') {
                    const sign = action === 'resize-right' ? 1 : -1;
                    const deltaM = (dxPx / scale) * sign;
                    if (viewType === 'top' || viewType === 'front') {
                        this.data.box.sx = Math.max(0.15, parseFloat(((this.data.box.sx || 1) + deltaM).toFixed(3)));
                    } else if (viewType === 'side') {
                        this.data.box.sy = Math.max(0.15, parseFloat(((this.data.box.sy || 1) + deltaM).toFixed(3)));
                    }
                } else if (action === 'resize-top' || action === 'resize-bottom') {
                    const sign = action === 'resize-bottom' ? 1 : -1;
                    const deltaM = (dyPx / scale) * sign;
                    if (viewType === 'top') {
                        this.data.box.sy = Math.max(0.15, parseFloat(((this.data.box.sy || 1) - deltaM).toFixed(3)));
                    } else if (viewType === 'side' || viewType === 'front') {
                        this.data.box.sz = Math.max(0.15, parseFloat(((this.data.box.sz || 1) - deltaM).toFixed(3)));
                    }
                }
            }

            this.requestRender();
        });

        canvas.addEventListener('pointerdown', (e) => {
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
            let signU = 0;
            let signV = 0;

            if (action === 'resize-corner' && cornerKey) {
                signU = (cornerKey === 'tr' || cornerKey === 'br') ? 1 : -1;
                signV = (cornerKey === 'tl' || cornerKey === 'tr') ? 1 : -1;
                oppLocalU = -signU * (metrics.dimH / 2);
                oppLocalV = -signV * (metrics.dimV / 2);
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
                initialBox,
                initialMetrics,
                startX: pos.x,
                startY: pos.y,
                lastX: pos.x,
                lastY: pos.y,
                lastAngle: Math.atan2(metrics.centerY - pos.y, pos.x - metrics.centerX),
                hasMoved: false
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
            this.dragState = null;
            canvas.style.cursor = 'default';

            if (hadMoved) {
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
                    hoverTarget: this.hoverState?.target || null
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

        // Transform points to local box coordinate frame
        let localPoints = null;
        if (pointCloudData && pointCloudData.positions) {
            localPoints = Math3D.transformAndCropPoints(
                pointCloudData.positions,
                pointCloudData.stride || 3,
                box,
                1.35
            );
        }

        const renderOptions = {
            zoom,
            pointSize,
            color,
            marginFactor: 1.35,
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

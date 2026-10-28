/**
 * macOS Docked QA/QC Drawer Component
 * Strictly adheres to Apple Human Interface Guidelines: No fake titlebars or window traffic lights.
 * Features a minimal floating trigger button when closed so it never interferes with the workspace.
 */

(function registerMacOSDock(global) {
    'use strict';

const { FrameCard, SizeClipboard, TrackReader } = global.CVATQAQC;

class MacOSDock {
    /**
     * @param {Object} callbacks - { onJumpToFrame, onReload }
     */
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.isOpen = false;
        this.state = {
            height: 480,
            viewMode: 'all', // 'all', 'top', 'side', 'front'
            viewOrder: ['top', 'side', 'front'],
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
        this.hotkeyFrame = null;
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
        this.helpDialog = null;
        this.helpCloseBtn = null;
        this.helpBtn = null;
        this.helpPreviousFocus = null;

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

        const versionBadge = document.createElement('span');
        versionBadge.className = 'cvat-qaqc-version-pill';
        const buildVersion = window.__CVAT_QAQC_BUILD_VERSION__ || 'dev';
        versionBadge.textContent = `v${buildVersion}`;
        versionBadge.title = `v${buildVersion}: 4-Corner Resizing Only (Edge resizing disabled)`;
        versionBadge.style.cssText = 'font-size: 9.5px; background: rgba(10, 132, 255, 0.2); color: #0A84FF; padding: 1px 5px; border-radius: 4px; margin-left: 5px; font-weight: 600; border: 1px solid rgba(10, 132, 255, 0.4); letter-spacing: 0.3px;';

        title.appendChild(iconSvg);
        title.appendChild(titleSpan);
        title.appendChild(versionBadge);

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

        // Segmented Control: Views (Top -> Side -> Front)
        const segmented = document.createElement('div');
        segmented.className = 'cvat-qaqc-segmented';
        const viewModes = [
            { id: 'all', label: 'All 3' },
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
            { val: 'compact', label: 'Size: Nhỏ' },
            { val: 'medium', label: 'Size: Vừa' },
            { val: 'large', label: 'Size: Lớn', selected: true }
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

        // Jump to Active Frame Button
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'cvat-qaqc-btn';
        jumpBtn.textContent = '🎯 Active';
        jumpBtn.title = 'Cuộn đến frame đang chọn trong CVAT';
        jumpBtn.addEventListener('click', () => this.scrollToActiveFrame());

        // Help button: usage guide and complete keyboard shortcut reference
        const helpBtn = document.createElement('button');
        helpBtn.className = 'cvat-qaqc-btn cvat-qaqc-help-btn';
        helpBtn.textContent = '?';
        helpBtn.title = 'Hướng dẫn sử dụng và danh sách phím tắt';
        helpBtn.setAttribute('aria-label', 'Mở hướng dẫn sử dụng và phím tắt');
        helpBtn.setAttribute('aria-haspopup', 'dialog');
        helpBtn.setAttribute('aria-expanded', 'false');
        helpBtn.setAttribute('aria-controls', 'cvat-qaqc-help-dialog');
        helpBtn.addEventListener('click', () => this.openHelp());
        this.helpBtn = helpBtn;

        // Close / Hide Button (Collapses back to floating button)
        const hideBtn = document.createElement('button');
        hideBtn.className = 'cvat-qaqc-btn';
        hideBtn.textContent = '✕ Ẩn';
        hideBtn.title = 'Hide inspector (Alt + Q)';
        hideBtn.addEventListener('click', () => this.close());

        rightGroup.appendChild(segmented);
        rightGroup.appendChild(sizeSelect);
        rightGroup.appendChild(zoomSelect);
        rightGroup.appendChild(ptSelect);
        rightGroup.appendChild(jumpBtn);
        rightGroup.appendChild(helpBtn);
        rightGroup.appendChild(hideBtn);

        toolbar.appendChild(leftGroup);
        toolbar.appendChild(rightGroup);
        dock.appendChild(toolbar);

        // Filmstrip Container (Medium by default)
        const filmstrip = document.createElement('div');
        filmstrip.className = 'cvat-qaqc-filmstrip size-medium';
        this.filmstrip = filmstrip;
        this.setupFilmstripScrollObserver();

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

        const helpDialog = this.createHelpDialog();
        dock.appendChild(helpDialog);

        this.dom = dock;
        document.body.appendChild(dock);
    }

    createHelpDialog() {
        const create = (tag, className = '', text = '') => {
            const element = document.createElement(tag);
            if (className) element.className = className;
            if (text) element.textContent = text;
            return element;
        };

        const overlay = create('div', 'cvat-qaqc-help-overlay');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeHelp();
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.closeHelp();
                return;
            }
            if (event.key === 'Tab') {
                const focusable = [...overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
                    .filter((element) => element.getClientRects().length > 0);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });

        const panel = create('section', 'cvat-qaqc-help-panel');
        panel.id = 'cvat-qaqc-help-dialog';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'cvat-qaqc-help-title');

        const header = create('header', 'cvat-qaqc-help-header');
        const headingGroup = create('div', 'cvat-qaqc-help-heading-group');
        const eyebrow = create('span', 'cvat-qaqc-help-eyebrow', 'TRỢ GIÚP');
        const title = create('h2', 'cvat-qaqc-help-title', '3D QA/QC Inspector');
        title.id = 'cvat-qaqc-help-title';
        const subtitle = create('p', 'cvat-qaqc-help-subtitle', 'Chỉnh cuboid trong RAM của CVAT. Bấm Save trên CVAT để lưu lên server.');
        headingGroup.appendChild(eyebrow);
        headingGroup.appendChild(title);
        headingGroup.appendChild(subtitle);

        const closeBtn = create('button', 'cvat-qaqc-help-close', 'Đóng');
        closeBtn.type = 'button';
        closeBtn.title = 'Đóng hướng dẫn (Esc)';
        closeBtn.setAttribute('aria-label', 'Đóng hướng dẫn');
        closeBtn.addEventListener('click', () => this.closeHelp());
        this.helpCloseBtn = closeBtn;

        header.appendChild(headingGroup);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        const body = create('div', 'cvat-qaqc-help-body');
        body.setAttribute('role', 'document');

        const addSection = (sectionTitle, rows) => {
            const section = create('section', 'cvat-qaqc-help-section');
            section.appendChild(create('h3', 'cvat-qaqc-help-section-title', sectionTitle));
            const grid = create('div', 'cvat-qaqc-help-grid');
            for (const [keys, description] of rows) {
                const keyCell = create('div', 'cvat-qaqc-help-keys');
                for (const key of keys) keyCell.appendChild(create('kbd', '', key));
                grid.appendChild(keyCell);
                grid.appendChild(create('div', 'cvat-qaqc-help-description', description));
            }
            section.appendChild(grid);
            body.appendChild(section);
        };

        addSection('Bắt đầu', [
            [['1'], 'Chọn một cuboid hoặc Track trong CVAT.'],
            [['2'], 'Bấm nút 3D hoặc Alt+Q để mở Inspector.'],
            [['3'], 'Trỏ chuột hoặc focus vào card frame cần sửa.'],
            [['4'], 'Chỉnh box, kiểm tra ba góc nhìn, rồi bấm Save trên CVAT.']
        ]);

        addSection('Thao tác chuột và card', [
            [['Kéo box'], 'Dịch vị trí theo mặt Top, Side hoặc Front.'],
            [['Kéo góc đỏ'], 'Đổi hai kích thước; giữ nguyên góc đối diện.'],
            [['Kéo chấm xanh'], 'Xoay Yaw trên mặt Top.'],
            [['↺ / ↻'], 'Xoay Yaw, Pitch hoặc Roll theo nút trên từng góc nhìn.'],
            [['Jump'], 'Chuyển player CVAT đến frame của card.'],
            [['Copy / Dán'], 'Sao chép hoặc áp dụng W × L × H cho frame.'],
            [['Cố định All'], 'Áp dụng kích thước hiện tại cho keyframe toàn Track.'],
            [['Outside'], 'Bật hoặc tắt trạng thái Outside của frame.']
        ]);

        addSection('Mở panel và lịch sử', [
            [['Alt', 'Q'], 'Mở hoặc ẩn Inspector.'],
            [['Alt', 'Shift', 'C'], 'Copy kích thước card active.'],
            [['Alt', 'Shift', 'V'], 'Dán kích thước vào card active.'],
            [['O'], 'Bật hoặc tắt Outside của card đang trỏ hoặc frame active.'],
            [['Ctrl/Cmd', 'Z'], 'Undo card đang trỏ; nếu hết lịch sử thì Undo CVAT.'],
            [['Ctrl/Cmd', 'Shift', 'Z'], 'Redo card đang trỏ; nếu hết lịch sử thì Redo CVAT.'],
            [['Ctrl', 'Y'], 'Redo card đang trỏ hoặc Redo CVAT.']
        ]);

        addSection('Dịch chuyển và đổi một mặt', [
            [['← / →'], 'Tiến hoặc lùi 4 cm theo hướng box.'],
            [['↑ / ↓'], 'Nâng hoặc hạ box 4 cm.'],
            [['Num 1 / Num 2'], 'Dịch ngang phải hoặc trái 4 cm.'],
            [['Shift', '← / →'], 'Nới mặt trước hoặc thu mặt sau 6 cm.'],
            [['Shift', '↑ / ↓'], 'Nới mặt trên hoặc thu mặt dưới 6 cm.'],
            [['Shift', 'Num 1 / Num 2'], 'Nới mặt phải hoặc thu mặt trái 6 cm.']
        ]);

        addSection('Xoay và kích thước mẫu', [
            [['Q / W'], 'Xoay trái hoặc phải 2° quanh trục Z point cloud.'],
            [['E / R'], 'Xoay trái hoặc phải 2° quanh trục Y cục bộ.'],
            [['Num 4 / Num 5'], 'Nghiêng ngang phải hoặc trái 3° quanh trục X cục bộ.'],
            [['Z'], 'Xoay trái 90° quanh trục Z point cloud.'],
            [['X'], 'Xoay 90° cục bộ và đổi chiều dài/rộng.'],
            [['1'], 'Kích thước Sedan: 4.5 × 1.85 × 1.5 m.'],
            [['2'], 'Kích thước SUV: 4.7 × 1.95 × 1.65 m.'],
            [['3'], 'Kích thước xe máy: 1.85 × 0.8 × 1.5 m.'],
            [['4'], 'Kích thước người đi bộ: 0.6 × 0.6 × 1.7 m.']
        ]);

        addSection('Toàn Track và bố cục', [
            [['G'], 'Đồng bộ kích thước card đang trỏ sang mọi keyframe cùng Track.'],
            [['Shift', 'G'], 'Khôi phục lần đồng bộ kích thước gần nhất trong phiên.'],
            [['P'], 'Bật hoặc tắt Outside trên toàn bộ keyframe cùng Track.'],
            [['Shift', 'P'], 'Khôi phục lần Outside toàn Track gần nhất trong phiên.'],
            [['Alt', 'T'], 'Sắp xếp 3D trái, Top trên phải, Side/Front dưới phải.']
        ]);

        const note = create('p', 'cvat-qaqc-help-note', 'Phím chỉnh box không tự lặp khi giữ. Phím bị khóa khi đang nhập liệu, mở hộp thoại, kéo chuột hoặc box không thể chỉnh sửa.');
        body.appendChild(note);
        panel.appendChild(body);
        overlay.appendChild(panel);
        this.helpDialog = overlay;
        return overlay;
    }

    openHelp() {
        if (!this.helpDialog) return;
        this.helpPreviousFocus = document.activeElement;
        this.helpDialog.hidden = false;
        this.helpDialog.setAttribute('aria-hidden', 'false');
        this.helpBtn?.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => this.helpCloseBtn?.focus({ preventScroll: true }));
    }

    closeHelp() {
        if (!this.helpDialog || this.helpDialog.hidden) return;
        this.helpDialog.hidden = true;
        this.helpDialog.setAttribute('aria-hidden', 'true');
        this.helpBtn?.setAttribute('aria-expanded', 'false');
        if (this.helpPreviousFocus?.isConnected) {
            this.helpPreviousFocus.focus({ preventScroll: true });
        }
        this.helpPreviousFocus = null;
    }

    updateToolbarRotateButtons() {
        // Toolbar rotate buttons removed per user preference; each card retains its own rotation controls
    }

    /** Resolve a hovered or keyboard-focused inspector card independently of CVAT's main canvas. */
    getHotkeyTarget(event) {
        if (!this.isOpen) return null;
        const target = event?.composedPath?.()[0] || event?.target;

        // 1. Hovered card has highest priority (user mouse is pointing directly at this card)
        const hoveredCard = this.dom?.querySelector?.('.cvat-qaqc-card:hover');
        const hoveredFrame = hoveredCard ? Number(hoveredCard.dataset.frame) :
            (this.hoveredFrame !== null && this.hoveredFrame !== undefined ? Number(this.hoveredFrame) : null);

        // 2. Focused card (user focused card or input/canvas inside card via keyboard)
        const focusedCard = document.activeElement?.closest?.('.cvat-qaqc-card');

        // 3. Direct event card (composedPath or target originates from a card)
        const eventCard = target?.closest?.('.cvat-qaqc-card');

        // 4. Panel check
        const inPanel = target?.closest?.('.cvat-qaqc-dock') ||
            document.activeElement?.closest?.('.cvat-qaqc-dock') || this.dom?.matches?.(':hover');

        let frame = null;
        if (hoveredFrame !== null && !isNaN(hoveredFrame) && this.cards.has(hoveredFrame)) {
            frame = hoveredFrame;
        } else if (focusedCard && !isNaN(Number(focusedCard.dataset.frame)) && this.cards.has(Number(focusedCard.dataset.frame))) {
            frame = Number(focusedCard.dataset.frame);
        } else if (eventCard && !isNaN(Number(eventCard.dataset.frame)) && this.cards.has(Number(eventCard.dataset.frame))) {
            frame = Number(eventCard.dataset.frame);
        } else if (inPanel) {
            frame = (this.hotkeyFrame !== null && this.cards.has(this.hotkeyFrame)) ? this.hotkeyFrame :
                (this.cards.has(this.state.currentFrame) ? this.state.currentFrame : null);
        }

        if (frame === null || !this.cards.has(frame)) return null;
        const card = this.cards.get(frame);
        const clientID = this.state.activeClientID;
        if (!card?.dom?.isConnected || clientID === null || clientID === undefined) return null;
        const job = this.callbacks.getJob?.();
        return {
            card, job, clientID, frame,
            store: this.callbacks.getStore?.(),
            isCurrent: () => this.isOpen && card.dom.isConnected && this.cards.get(frame) === card &&
                this.state.activeClientID === clientID && this.callbacks.getJob?.() === job,
            refresh: () => this.callbacks.onRefreshTrack?.(clientID),
            read: () => this.callbacks.onReadCuboid(frame, clientID),
            update: async (points) => {
                if (this.state.activeClientID !== clientID || this.callbacks.getJob?.() !== job) {
                    throw new Error('Đã đổi track/job; bỏ phím đang chờ.');
                }
                const box = TrackReader.parsePointsToBox(points);
                const saved = await this.callbacks.onUpdateCuboid(frame, clientID, points, box);
                if (saved === false) throw new Error('CVAT chưa lưu được thay đổi của frame này.');
                if (this.cards.get(frame) === card) {
                    card.updateData({ ...card.data, points: [...points], box, keyframe: true });
                }
            },
        };
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
                const targetFrame = this.hoveredFrame !== null ? this.hoveredFrame : this.state.currentFrame;
                const targetCard = this.cards.get(targetFrame);

                if ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                    // Local Frame Undo has top priority when hovering or focused on a card
                    if (targetCard && targetCard.undo()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    // Global fallback undo on CVAT & UI
                    if (typeof this.callbacks.onUndo === 'function') {
                        e.preventDefault();
                        this.callbacks.onUndo();
                    }
                } else if (
                    ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && e.shiftKey) ||
                    (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y')
                ) {
                    // Local Frame Redo has top priority when hovering or focused on a card
                    if (targetCard && targetCard.redo()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    // Global fallback redo on CVAT & UI
                    if (typeof this.callbacks.onRedo === 'function') {
                        e.preventDefault();
                        this.callbacks.onRedo();
                    }
                }
            }
        });
    }

    /**
     * Apply dimensions across ALL frames of the current track in realtime
     * @param {HTMLElement|null} btn
     * @param {Object|null} customSize
     */
    async applySizeToAllFrames(btn = null, customSize = null) {
        let size = customSize || await SizeClipboard.get();
        if (!size) {
            const activeCard = this.cards.get(this.state.currentFrame) || this.cards.values().next().value;
            if (activeCard?.data?.box) {
                size = SizeClipboard.copy(activeCard.data.box);
            }
        }
        if (!size) {
            console.warn('[CVAT-QAQC] No size available to apply');
            if (btn) {
                const origText = btn.textContent;
                btn.textContent = '⚠️ Chưa có size!';
                setTimeout(() => { btn.textContent = origText; }, 1200);
            }
            return;
        }

        const clientID = this.state.activeClientID;
        if (clientID === null || typeof clientID === 'undefined') return;

        if (typeof this.callbacks.onApplySizeToTrack === 'function') {
            await this.callbacks.onApplySizeToTrack(clientID, size);
        } else {
            // Local fallback
            for (const card of this.cards.values()) {
                if (card && typeof card.pasteSize === 'function') {
                    card.pasteSize(size);
                }
            }
        }

        if (btn) {
            const origText = btn.textContent;
            btn.classList.add('success-flash');
            btn.textContent = `✓ Đã cố định ${size.sx}×${size.sy}×${size.sz}m!`;
            setTimeout(() => {
                btn.classList.remove('success-flash');
                btn.textContent = origText;
            }, 1500);
        }
        console.log(`[CVAT-QAQC] Fixed size (${size.sx} × ${size.sy} × ${size.sz}m) to track #${clientID} realtime`);
    }

    /**
     * Paste dimensions from clipboard to ALL loaded cards of the current track
     */
    async pasteSizeToAllCards(btn = null) {
        return this.applySizeToAllFrames(btn);
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
        this.closeHelp();
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
        if (this.hotkeyFrame !== null && (this.hotkeyFrame < 0 || !framesData.some((data) => data.frame === this.hotkeyFrame))) {
            this.hotkeyFrame = null;
        }
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
                async (sizeObj) => {
                    await this.applySizeToAllFrames(null, sizeObj);
                },
                (frame, outside) => {
                    if (typeof this.callbacks.onUpdateOutside === 'function') {
                        this.callbacks.onUpdateOutside(frame, this.state.activeClientID, outside);
                    }
                },
                (frame, isHovered) => {
                    this.hoveredFrame = isHovered ? frame : (this.hoveredFrame === frame ? null : this.hoveredFrame);
                    if (isHovered) this.hotkeyFrame = frame;
                },
                { viewOrder: this.state.viewOrder, onActivate: (frame) => { this.hotkeyFrame = frame; } }
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
     * Check if a frame card is currently visible inside the scrollable filmstrip viewport
     * @param {Object} card
     * @returns {boolean}
     */
    isCardVisible(card) {
        if (!card || !card.dom || !this.filmstrip) return true;
        if (typeof window === 'undefined') return true;
        try {
            const stripRect = this.filmstrip.getBoundingClientRect();
            const cardRect = card.dom.getBoundingClientRect();
            // Visible if it intersects the filmstrip viewport with a 350px buffer on each side
            return cardRect.right >= stripRect.left - 350 && cardRect.left <= stripRect.right + 350;
        } catch (_) {
            return true;
        }
    }

    /**
     * Passive scroll observer that renders off-screen dirty cards on-demand as they scroll into view
     */
    setupFilmstripScrollObserver() {
        if (!this.filmstrip) return;
        let scrollRaf = false;
        this.filmstrip.addEventListener('scroll', () => {
            if (scrollRaf) return;
            scrollRaf = true;
            requestAnimationFrame(() => {
                scrollRaf = false;
                for (const [, card] of this.cards.entries()) {
                    if (card.isDirty && this.isCardVisible(card)) {
                        card.isDirty = false;
                        if (typeof card.renderViews === 'function') {
                            const pts = this.pcdCache?.get(card.frame) || card.lastPointCloudData;
                            card.renderViews(pts, card.frame === this.state.currentFrame, card.lastRenderOptions);
                        }
                    }
                }
            });
        }, { passive: true });
    }

    /**
     * In-place data update across all frame cards on Undo/Redo or history changes
     * Zero DOM recreation, preserving scroll and focus
     * Only re-renders visible cards immediately, marking offscreen cards dirty for on-demand scroll rendering (< 10ms INP)
     * @param {Array} framesData
     */
    refreshTrackData(framesData) {
        if (!Array.isArray(framesData) || framesData.length === 0) return;
        this.state.framesData = framesData;

        // If card count matches frame count, update cards in-place
        if (this.cards.size === framesData.length) {
            for (const fData of framesData) {
                const card = this.cards.get(fData.frame);
                if (!card) continue;
                if (this.isCardVisible(card)) {
                    card.isDirty = false;
                    if (typeof card.updateData === 'function') {
                        card.updateData(fData);
                    }
                } else {
                    // Fast in-memory data update without triggering expensive canvas rendering
                    card.data = fData;
                    card.frame = fData.frame;
                    card.isDirty = true;
                    if (typeof card.updateHeaderBadges === 'function') {
                        card.updateHeaderBadges();
                    }
                }
            }
        } else {
            // If frames were added/removed, do a clean rebuild
            this.updateTrack(this.state.activeClientID, framesData, this.state.currentFrame, this.pcdCache);
        }
    }

    /**
     * Update frames data across cards (alias for refreshTrackData for backward compatibility)
     * @param {Array} framesData
     */
    updateFramesData(framesData) {
        this.refreshTrackData(framesData);
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

global.CVATQAQC.MacOSDock = MacOSDock;
})(window);

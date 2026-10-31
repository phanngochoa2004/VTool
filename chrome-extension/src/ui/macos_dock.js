/**
 * macOS Docked QA/QC Drawer Component
 * Strictly adheres to Apple Human Interface Guidelines: No fake titlebars or window traffic lights.
 * Features a minimal floating trigger button when closed so it never interferes with the workspace.
 */

(function registerMacOSDock(global) {
    'use strict';

const { FrameCard, SizeClipboard, TrackReader, HotkeyPreferences, GroundFit } = global.CVATQAQC;

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

        const batch = new global.CVATQAQC.AttributeBatch({
            getJob: () => this.callbacks.getJob?.(),
            getStore: () => this.callbacks.getStore?.(),
            getClientID: () => this.state.activeClientID,
            onBegin: () => this.callbacks.onAttributeBatchBegin?.(),
            onEnd: (job, id) => this.callbacks.onAttributeBatchEnd?.(job, id),
        });
        this.attributeDialog = new global.CVATQAQC.AttributeDialog(batch);

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
        label.textContent = '⏻ 3D';
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
                        global.CVATQAQC.Notifications?.showError(`Không tìm thấy hoặc không thể nạp Object ID #${targetID}.`,
                            { title: 'Không thể tìm object' });
                        filterBar.classList.add('error-shake');
                        filterInput.title = `Không tìm thấy Object ID #${targetID}`;
                        setTimeout(() => filterBar.classList.remove('error-shake'), 600);
                    }
                }
            } catch (error) {
                global.CVATQAQC.Notifications?.showError(error, { title: 'Không thể tìm object' });
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

        const attributesBtn = document.createElement('button');
        attributesBtn.className = 'cvat-qaqc-btn';
        attributesBtn.textContent = 'Thuộc tính';
        attributesBtn.title = 'Cập nhật thuộc tính hàng loạt cho track đã tìm';
        attributesBtn.addEventListener('click', () => this.attributeDialog.open(attributesBtn));

        // Keyboard shortcut configuration
        const helpBtn = document.createElement('button');
        helpBtn.className = 'cvat-qaqc-btn cvat-qaqc-help-btn';
        helpBtn.textContent = '⌨';
        helpBtn.title = 'Cấu hình phím';
        helpBtn.setAttribute('aria-label', 'Mở cấu hình phím');
        helpBtn.setAttribute('aria-haspopup', 'dialog');
        helpBtn.setAttribute('aria-expanded', 'false');
        helpBtn.setAttribute('aria-controls', 'cvat-qaqc-help-dialog');
        helpBtn.addEventListener('click', () => this.openHelp());
        this.helpBtn = helpBtn;

        // Quick UI toggle. When closed, the floating "Power 3D" pill turns it back on.
        const uiToggleBtn = document.createElement('button');
        uiToggleBtn.className = 'cvat-qaqc-btn cvat-qaqc-ui-toggle-btn';
        uiToggleBtn.textContent = '⏻ UI';
        uiToggleBtn.title = 'Tắt giao diện Inspector. Bật lại bằng nút ⏻ 3D hoặc Alt+Q';
        uiToggleBtn.setAttribute('aria-label', 'Tắt giao diện 3D QA/QC Inspector');
        uiToggleBtn.addEventListener('click', () => this.close());

        rightGroup.appendChild(segmented);
        rightGroup.appendChild(sizeSelect);
        rightGroup.appendChild(zoomSelect);
        rightGroup.appendChild(ptSelect);
        rightGroup.appendChild(attributesBtn);
        rightGroup.appendChild(helpBtn);
        rightGroup.appendChild(uiToggleBtn);

        toolbar.appendChild(leftGroup);
        toolbar.appendChild(rightGroup);
        dock.appendChild(toolbar);

        // Match the toolbar's selected "Size: Lớn" option on first render.
        const filmstrip = document.createElement('div');
        filmstrip.className = 'cvat-qaqc-filmstrip size-large';
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
        emptySub.textContent = 'Nhập Object ID vào ô tìm kiếm rồi bấm Lọc hoặc Enter để nạp các frame vào Inspector.';
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

        let recordingAction = null;
        let settingsStatus = null;
        const shortcutControls = new Map();
        const refreshShortcutValues = () => shortcutControls.forEach(({ value, clear }, id) => {
            const assignedCombo = HotkeyPreferences.combo(id);
            value.textContent = HotkeyPreferences.format(assignedCombo);
            clear.disabled = !assignedCombo;
        });

        const overlay = create('div', 'cvat-qaqc-help-overlay');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeHelp();
        });
        overlay.addEventListener('keydown', (event) => {
            if (recordingAction) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (event.key === 'Escape') {
                    settingsStatus.textContent = 'Đã hủy ghi phím.';
                    recordingAction = null;
                    return;
                }
                if (['Delete', 'Backspace'].includes(event.key) &&
                    !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
                    const result = HotkeyPreferences.clearCombo(recordingAction);
                    settingsStatus.textContent = result.ok ? 'Đã xóa phím tắt. Chức năng hiện chưa được gán phím.' : result.message;
                    if (result.ok) {
                        recordingAction = null;
                        refreshShortcutValues();
                    }
                    return;
                }
                const value = HotkeyPreferences.eventCombo(event);
                if (value === '') {
                    settingsStatus.textContent = 'Giữ phím bổ trợ rồi nhấn thêm một phím chính…';
                    return;
                }
                if (!value) {
                    settingsStatus.textContent = 'Chỉ hỗ trợ 1 phím hoặc 1 phím bổ trợ + 1 phím chính.';
                    return;
                }
                const result = HotkeyPreferences.setCombo(recordingAction, value);
                settingsStatus.textContent = result.ok ? `Đã lưu: ${HotkeyPreferences.format(value)}` : result.message;
                if (result.ok) {
                    recordingAction = null;
                    refreshShortcutValues();
                }
                return;
            }
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
        const eyebrow = create('span', 'cvat-qaqc-help-eyebrow', 'PHÍM TẮT');
        const title = create('h2', 'cvat-qaqc-help-title', 'Cấu hình phím');
        title.id = 'cvat-qaqc-help-title';
        const subtitle = create('p', 'cvat-qaqc-help-subtitle', 'Ghi lại tổ hợp phím phù hợp với quy trình làm việc của bạn.');
        headingGroup.appendChild(eyebrow);
        headingGroup.appendChild(title);
        headingGroup.appendChild(subtitle);

        const closeBtn = create('button', 'cvat-qaqc-help-close', 'Đóng');
        closeBtn.type = 'button';
        closeBtn.title = 'Đóng cấu hình phím (Esc)';
        closeBtn.setAttribute('aria-label', 'Đóng cấu hình phím');
        closeBtn.addEventListener('click', () => this.closeHelp());
        this.helpCloseBtn = closeBtn;

        header.appendChild(headingGroup);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        const settingsBody = create('div', 'cvat-qaqc-help-body cvat-qaqc-hotkey-settings');
        settingsBody.setAttribute('role', 'document');
        const intro = create('p', 'cvat-qaqc-help-note', 'Bấm “Ghi phím” để gán phím. Bấm “Xóa phím” để bỏ gán, hoặc nhấn Delete/Backspace khi đang ghi. Cấu hình tự lưu trên trình duyệt này.');
        settingsBody.appendChild(intro);
        if (GroundFit) {
            const groundSection = create('section', 'cvat-qaqc-help-section');
            groundSection.appendChild(create('h3', 'cvat-qaqc-help-section-title', 'Căn nền tự động'));
            const groundRow = create('label', 'cvat-qaqc-ground-auto-row');
            const groundText = create('span', 'cvat-qaqc-ground-auto-text',
                'Tự căn khi chọn box trên canvas CVAT (chỉ trong phiên hiện tại)');
            const groundToggle = create('input', 'cvat-qaqc-ground-auto-toggle');
            groundToggle.type = 'checkbox';
            groundToggle.checked = GroundFit.status().automatic;
            groundToggle.addEventListener('change', () => {
                GroundFit.setAutomatic(groundToggle.checked);
                settingsStatus.textContent = groundToggle.checked ?
                    'Đã bật tự căn nền trong phiên này.' : 'Đã tắt tự căn nền.';
            });
            groundRow.append(groundText, groundToggle);
            groundSection.appendChild(groundRow);
            settingsBody.appendChild(groundSection);
        }
        const categories = new Map();
        for (const definition of HotkeyPreferences.definitions) {
            if (!categories.has(definition.category)) {
                const section = create('section', 'cvat-qaqc-help-section');
                section.appendChild(create('h3', 'cvat-qaqc-help-section-title', definition.category));
                const list = create('div', 'cvat-qaqc-hotkey-list');
                section.appendChild(list);
                settingsBody.appendChild(section);
                categories.set(definition.category, list);
            }
            const row = create('div', 'cvat-qaqc-hotkey-row');
            row.appendChild(create('span', 'cvat-qaqc-hotkey-label', definition.label));
            const value = create('kbd', 'cvat-qaqc-hotkey-value', HotkeyPreferences.format(HotkeyPreferences.combo(definition.id)));
            row.appendChild(value);
            const record = create('button', 'cvat-qaqc-hotkey-record', 'Ghi phím');
            record.type = 'button';
            record.setAttribute('aria-label', `Ghi phím cho ${definition.label}`);
            record.addEventListener('click', () => {
                recordingAction = definition.id;
                settingsStatus.textContent = `Đang ghi “${definition.label}”… Delete/Backspace để xóa phím, Esc để hủy.`;
            });
            row.appendChild(record);
            const clear = create('button', 'cvat-qaqc-hotkey-clear', 'Xóa phím');
            clear.title = 'Bỏ gán phím tắt cho chức năng này';
            clear.type = 'button';
            clear.disabled = !HotkeyPreferences.combo(definition.id);
            clear.setAttribute('aria-label', `Xóa phím của ${definition.label}`);
            clear.addEventListener('click', () => {
                const result = HotkeyPreferences.clearCombo(definition.id);
                if (!result.ok) {
                    settingsStatus.textContent = result.message;
                    return;
                }
                recordingAction = null;
                refreshShortcutValues();
                settingsStatus.textContent = `Đã xóa phím của “${definition.label}”.`;
            });
            shortcutControls.set(definition.id, { value, clear });
            row.appendChild(clear);
            categories.get(definition.category).appendChild(row);
        }
        const footer = create('div', 'cvat-qaqc-hotkey-footer');
        settingsStatus = create('span', 'cvat-qaqc-hotkey-status', '');
        settingsStatus.setAttribute('role', 'status');
        const reset = create('button', 'cvat-qaqc-hotkey-reset', 'Khôi phục mặc định');
        reset.type = 'button';
        reset.addEventListener('click', () => {
            HotkeyPreferences.reset();
            recordingAction = null;
            refreshShortcutValues();
            settingsStatus.textContent = 'Đã khôi phục toàn bộ phím mặc định.';
        });
        footer.append(settingsStatus, reset);
        settingsBody.appendChild(footer);

        panel.appendChild(settingsBody);
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
            fitGround: (points) => this.fitGroundForCard(frame, points),
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

    static pointCloudXYZ(pointCloud) {
        const positions = pointCloud?.positions;
        const stride = Number(pointCloud?.stride || 3);
        if (!positions?.length || !Number.isInteger(stride) || stride < 3 || positions.length % stride) {
            throw new Error('Point cloud của frame không hợp lệ hoặc chưa tải xong.');
        }
        if (stride === 3) return positions;
        const xyz = new Float32Array((positions.length / stride) * 3);
        for (let source = 0, target = 0; source < positions.length; source += stride) {
            xyz[target++] = positions[source];
            xyz[target++] = positions[source + 1];
            xyz[target++] = positions[source + 2];
        }
        return xyz;
    }

    static sameCuboidPoints(left, right) {
        return Array.isArray(left) && Array.isArray(right) && left.length >= 9 && right.length >= 9 &&
            left.slice(0, 9).every((value, index) => Math.abs(value - right[index]) <= 1e-9);
    }

    resolveGroundFitCard(frame = null) {
        const preferredFrame = frame ?? this.hoveredFrame ?? this.hotkeyFrame ?? this.state.currentFrame;
        return this.cards.get(preferredFrame) || this.cards.get(this.state.currentFrame) ||
            this.cards.values().next().value || null;
    }

    /** Fit an Inspector card against the point cloud cached for that exact frame. */
    async fitGroundForCard(frame = null, sourcePoints = null) {
        if (!GroundFit?.engine) throw new Error('Chức năng căn nền chưa sẵn sàng.');
        const card = this.resolveGroundFitCard(frame);
        const clientID = this.state.activeClientID;
        const job = this.callbacks.getJob?.();
        if (!card?.data?.box || clientID === null || clientID === undefined) {
            throw new Error('Chưa có card frame đang active để căn nền.');
        }
        const targetFrame = card.frame;
        const cloud = this.pcdCache?.get?.(targetFrame) || card.lastPointCloudData;
        const positions = MacOSDock.pointCloudXYZ(cloud);

        let points = Array.isArray(sourcePoints) ? [...sourcePoints] : null;
        if (!points && typeof this.callbacks.onReadCuboid === 'function') {
            const state = await this.callbacks.onReadCuboid(targetFrame, clientID);
            points = Array.isArray(state?.points) ? [...state.points] : null;
        }
        if (!points) points = [...(card.data.points || [])];
        if (points.length < 9) throw new Error('Dữ liệu cuboid của card không hợp lệ.');

        const snapshot = card.takeSnapshot();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = GroundFit.engine.align(
            points,
            GroundFit.engine.estimate(positions, points, GroundFit.config),
            GroundFit.config
        );

        if (this.state.activeClientID !== clientID || this.callbacks.getJob?.() !== job ||
            this.cards.get(targetFrame) !== card || card.dragState) {
            throw new Error('Đã đổi card, track hoặc job trong lúc tính nền; hủy cập nhật.');
        }
        if (typeof this.callbacks.onReadCuboid === 'function') {
            const current = await this.callbacks.onReadCuboid(targetFrame, clientID);
            if (!MacOSDock.sameCuboidPoints(current?.points, points)) {
                throw new Error('Box đã thay đổi trong lúc tính nền; giữ thay đổi hiện tại.');
            }
        }

        const nextPoints = [...result.points];
        const nextBox = TrackReader.parsePointsToBox(nextPoints);
        if (typeof this.callbacks.onUpdateCuboid === 'function') {
            const saved = await this.callbacks.onUpdateCuboid(targetFrame, clientID, nextPoints, nextBox);
            if (saved === false) throw new Error('CVAT chưa nhận được kết quả căn nền của card.');
        }

        card.pushUndoSnapshot(snapshot);
        card.updateData({ ...card.data, points: nextPoints, box: nextBox, keyframe: true });
        return result;
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
                return;
            }
            const action = HotkeyPreferences?.matchEvent(e, 'dock');
            if (!action) return;
            e.preventDefault();
            const activeCard = this.cards.get(this.hoveredFrame ?? this.state.currentFrame) || this.cards.values().next().value;
            if (action.id === 'toggle_ui') return this.toggleOpen();
            if (action.id === 'copy_size') return activeCard?.handleCopySize();
            if (action.id === 'paste_size') return activeCard?.handlePasteSize();
            if (action.id === 'toggle_frame_outside') return activeCard?.toggleOutside();
            if (action.id === 'undo') {
                if (activeCard?.undo()) e.stopPropagation();
                else this.callbacks.onUndo?.();
                return;
            }
            if (action.id === 'redo') {
                if (activeCard?.redo()) e.stopPropagation();
                else this.callbacks.onRedo?.();
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

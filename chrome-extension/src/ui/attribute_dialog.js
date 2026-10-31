(function registerAttributeDialog(global) {
    'use strict';

    class AttributeDialog {
        constructor(batch) { this.batch = batch; this.overlay = null; }

        async open(trigger) {
            if (this.overlay?.isConnected) return;
            const create = (tag, className, text) => {
                const el = document.createElement(tag);
                if (className) el.className = className;
                if (text) el.textContent = text;
                return el;
            };
            const overlay = create('div', 'cvat-qaqc-help-overlay cvat-qaqc-attribute-overlay');
            const panel = create('section', 'cvat-qaqc-help-panel cvat-qaqc-attribute-panel');
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Cập nhật thuộc tính hàng loạt');
            const header = create('header', 'cvat-qaqc-help-header');
            const heading = create('div', 'cvat-qaqc-help-heading-group');
            heading.appendChild(create('h2', 'cvat-qaqc-help-title', 'Cập nhật thuộc tính'));
            const context = create('p', 'cvat-qaqc-help-subtitle');
            heading.appendChild(context);
            header.appendChild(heading);
            const close = create('button', 'cvat-qaqc-help-close', 'Đóng');
            const dismiss = () => {
                if (this.batch.busy) return;
                overlay.remove();
                this.overlay = null;
                trigger?.focus({ preventScroll: true });
            };
            close.addEventListener('click', dismiss);
            header.appendChild(close);
            const body = create('div', 'cvat-qaqc-help-body cvat-qaqc-attribute-body');
            const status = create('p', 'cvat-qaqc-attribute-status', 'Đang đọc thuộc tính…');
            status.setAttribute('role', 'status');
            body.appendChild(status);
            panel.append(header, body);
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            this.overlay = overlay;
            let pending = false;
            overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay && !pending) dismiss(); });
            overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { event.preventDefault(); if (!pending) dismiss(); }
                if (event.key === 'Tab') {
                    const items = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
                        .filter((el) => el.getClientRects().length);
                    const index = items.indexOf(document.activeElement);
                    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
                    else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
                }
            });
            close.focus();
            try {
                const description = await this.batch.describe();
                if (!overlay.isConnected) return;
                if (!description.specs.length) { status.textContent = 'Label này chưa có thuộc tính.'; return; }
                context.textContent = `Track #${description.id} · ${description.label}`;
                status.textContent = 'Chọn thuộc tính và phạm vi để xem trước.';
                const fields = create('div', 'cvat-qaqc-attribute-fields');
                const field = (labelText, control) => {
                    const label = create('label', 'cvat-qaqc-attribute-field');
                    label.append(create('span', '', labelText), control);
                    fields.appendChild(label);
                    return control;
                };
                const specSelect = field('Thuộc tính', create('select'));
                description.specs.forEach((spec) => {
                    const option = create('option', '', spec.name);
                    option.value = String(spec.id);
                    specSelect.appendChild(option);
                });
                const valueWrap = create('label', 'cvat-qaqc-attribute-field');
                valueWrap.appendChild(create('span', '', 'Giá trị mới'));
                fields.appendChild(valueWrap);
                const scope = field('Phạm vi', create('select'));
                scope.parentElement.classList.add('cvat-qaqc-attribute-scope');
                for (const [value, text] of [['whole', 'Toàn track'], ['range', 'Khoảng frame']]) {
                    const option = create('option', '', text); option.value = value; scope.appendChild(option);
                }
                const start = field('Từ frame', create('input'));
                const end = field('Đến frame', create('input'));
                for (const input of [start, end]) {
                    input.type = 'number'; input.step = '1'; input.min = description.first; input.max = description.last;
                }
                start.value = String(description.first); end.value = String(description.last);
                const note = create('p', 'cvat-qaqc-attribute-status');
                const preview = create('div', 'cvat-qaqc-attribute-preview');
                const actions = create('div', 'cvat-qaqc-attribute-actions');
                const previewButton = create('button', 'cvat-qaqc-attribute-button', 'Xem trước');
                const applyButton = create('button', 'cvat-qaqc-attribute-button cvat-qaqc-attribute-primary', 'Áp dụng');
                applyButton.disabled = true;
                actions.append(previewButton, applyButton);
                const historyNote = create('p', 'cvat-qaqc-attribute-history', 'Undo để hoàn tác · Save để lưu');
                const footer = create('footer', 'cvat-qaqc-attribute-footer');
                footer.append(historyNote, actions);
                body.append(fields, note, preview);
                body.appendChild(status);
                panel.appendChild(footer);
                let plan = null;
                let valueControl;
                const spec = () => description.specs.find((item) => item.id === Number(specSelect.value));
                const invalidate = () => { plan = null; preview.replaceChildren(); applyButton.disabled = true; };
                const updateScope = () => {
                    if (!spec().mutable) scope.value = 'whole';
                    scope.disabled = !spec().mutable;
                    start.disabled = end.disabled = scope.value === 'whole';
                    note.textContent = spec().mutable
                        ? 'Chỉ sửa keyframe hiện có. Frame sau kế thừa đến mốc đổi thuộc tính tiếp theo.'
                        : 'Thuộc tính cố định: áp dụng cho toàn track.';
                };
                const updateValue = () => {
                    valueControl?.remove();
                    const selected = spec();
                    const choices = selected.inputType === 'checkbox' ? ['false', 'true'] : selected.values;
                    valueControl = create(['select', 'radio', 'checkbox'].includes(selected.inputType) ? 'select' : 'input');
                    if (valueControl.tagName === 'SELECT') choices.forEach((choice) => {
                        const option = create('option', '', choice); option.value = choice; valueControl.appendChild(option);
                    });
                    else {
                        valueControl.type = selected.inputType === 'number' ? 'number' : 'text';
                        if (selected.inputType === 'number') [valueControl.min, valueControl.max, valueControl.step] = selected.values;
                    }
                    valueControl.value = selected.defaultValue;
                    valueControl.addEventListener('input', invalidate);
                    valueControl.addEventListener('change', invalidate);
                    valueWrap.appendChild(valueControl);
                    updateScope(); invalidate();
                };
                specSelect.addEventListener('change', updateValue);
                scope.addEventListener('change', () => { updateScope(); invalidate(); });
                for (const input of [start, end]) input.addEventListener('input', invalidate);
                updateValue();
                const setPending = (value) => {
                    pending = value; close.disabled = value; previewButton.disabled = value;
                    for (const control of fields.querySelectorAll('input,select')) control.disabled = value;
                    if (!value) updateScope();
                };
                previewButton.addEventListener('click', async () => {
                    invalidate(); setPending(true); status.textContent = 'Đang kiểm tra…';
                    try {
                        plan = await this.batch.prepare({ attributeId: Number(specSelect.value), value: valueControl.value,
                            wholeTrack: scope.value === 'whole', start: Number(start.value), end: Number(end.value) });
                        if (!overlay.isConnected) return;
                        const table = create('table');
                        const head = create('tr');
                        for (const text of ['Frame', 'Giá trị hiện tại', 'Giá trị mới']) head.appendChild(create('th', '', text));
                        table.appendChild(head);
                        plan.rows.slice(0, 100).forEach((row) => {
                            const tr = create('tr');
                            [String(row.frame), row.before, row.after]
                                .forEach((text) => tr.appendChild(create('td', '', text)));
                            table.appendChild(tr);
                        });
                        preview.appendChild(table);
                        status.textContent = (plan.spec.mutable ? `${plan.affectedKeyframes} keyframe hiện có trong phạm vi.` : 'Thuộc tính cố định của toàn track.') +
                            (plan.rows.length > 100 ? ' Bảng hiển thị 100 mốc đầu.' : '');
                        applyButton.disabled = false;
                    } catch (error) { status.textContent = error.message; }
                    finally { setPending(false); }
                });
                applyButton.addEventListener('click', async () => {
                    if (!plan || pending) return;
                    setPending(true); applyButton.disabled = true;
                    try {
                        const result = await this.batch.apply(plan, (count) => { status.textContent = `Đã ghi ${count} mốc…`; });
                        status.textContent = result.saved ? `Đã cập nhật ${result.saved} mốc. Save trong CVAT để lưu.` : 'Thuộc tính đã có giá trị này.';
                    } catch (error) { status.textContent = error.message; }
                    finally { plan = null; setPending(false); }
                });
            } catch (error) { if (overlay.isConnected) status.textContent = error.message; }
        }
    }

    global.CVATQAQC.AttributeDialog = AttributeDialog;
})(window);

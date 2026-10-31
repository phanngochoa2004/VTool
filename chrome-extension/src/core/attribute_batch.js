(function registerAttributeBatch(global) {
    'use strict';

    const fail = (message) => { throw new Error(message); };
    const clone = (value) => JSON.parse(JSON.stringify(value));

    function normalizeSpec(spec) {
        const result = { id: spec.id, name: spec.name, mutable: spec.mutable,
            inputType: spec.inputType ?? spec.input_type,
            defaultValue: spec.defaultValue ?? spec.default_value ?? '', values: [...(spec.values || [])] };
        if (!Number.isInteger(result.id) || typeof result.mutable !== 'boolean') fail('Định nghĩa thuộc tính không hợp lệ.');
        return result;
    }

    function validateValue(spec, input) {
        const value = String(input);
        if (['select', 'radio'].includes(spec.inputType) && !spec.values.includes(value)) fail('Chọn giá trị trong danh sách.');
        if (spec.inputType === 'checkbox' && !['true', 'false'].includes(value)) fail('Giá trị phải là true hoặc false.');
        if (spec.inputType === 'number') {
            const [min, max, step] = spec.values.map(Number);
            const number = Number(value);
            if (!value.trim() || !Number.isFinite(number) || ![min, max, step].every(Number.isFinite) || step <= 0 ||
                number < min || number > max || Math.abs((number - min) / step - Math.round((number - min) / step)) > 1e-6) {
                fail('Giá trị số không đúng giới hạn hoặc bước nhảy.');
            }
        }
        if (!['select', 'radio', 'checkbox', 'number', 'text'].includes(spec.inputType)) fail('Loại thuộc tính chưa được hỗ trợ.');
        return value;
    }

    class AttributeBatch {
        constructor({ getJob, getStore, getClientID, onBegin, onEnd } = {}) {
            Object.assign(this, { getJob, getStore, getClientID, onBegin, onEnd });
            this.busy = false;
            this.plans = new WeakSet();
        }

        guard(job, id) {
            if (this.getJob() !== job || this.getClientID() !== id) fail('Track hoặc job đã thay đổi. Hãy xem trước lại.');
            if (this.getStore()?.getState()?.annotation?.workspace === 'review') fail('Không thể sửa trong chế độ Review.');
        }

        async exported(job, id) {
            this.guard(job, id);
            const data = await job.annotations.export();
            this.guard(job, id);
            const track = data?.tracks?.find((item) => item.clientID === id);
            if (!track?.shapes?.length || track.shapes.some((shape) => shape.type && shape.type !== 'cuboid')) {
                fail('Chức năng này cần một track cuboid hợp lệ.');
            }
            return clone(track);
        }

        async state(job, id, frame) {
            this.guard(job, id);
            const states = await job.annotations.get(frame, true, []);
            this.guard(job, id);
            const state = states.find((item) => item.clientID === id && item.frame === frame && item.objectType === 'track');
            if (!state || state.shapeType !== 'cuboid' || state.lock || state.isGroundTruth || typeof state.save !== 'function') {
                fail(`Không thể sửa track tại frame ${frame}.`);
            }
            return state;
        }

        async describe() {
            const job = this.getJob();
            const id = this.getClientID();
            if (!job || !Number.isInteger(id)) fail('Tìm Object ID trước khi sửa thuộc tính.');
            const track = await this.exported(job, id);
            const first = Math.max(job.startFrame, Math.min(...track.shapes.map((shape) => shape.frame)));
            const state = await this.state(job, id, first);
            return { job, id, first, last: job.stopFrame, label: state.label.name,
                specs: state.label.attributes.filter((spec) => !spec.deleted).map(normalizeSpec) };
        }

        async prepare({ attributeId, value, start, end, wholeTrack = false }) {
            if (this.busy) fail('Đang cập nhật thuộc tính.');
            const description = await this.describe();
            const { job, id, first, last } = description;
            const spec = description.specs.find((entry) => entry.id === attributeId);
            if (!spec) fail('Không tìm thấy thuộc tính của label này.');
            const nextValue = validateValue(spec, value);
            if (!spec.mutable && !wholeTrack) fail('Thuộc tính cố định chỉ được áp dụng toàn track.');
            if (wholeTrack) { start = first; end = last; }
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < first || end > last || start > end) {
                fail(`Khoảng frame phải nằm trong ${first}–${last}.`);
            }
            const snapshot = await this.exported(job, id);
            const frames = spec.mutable
                ? [...new Set(snapshot.shapes.map((shape) => shape.frame).filter((frame) => frame >= start && frame <= end))]
                : [first];
            if (!frames.length) fail('Khoảng chọn không có keyframe hiện có.');
            frames.sort((a, b) => a - b);
            const rows = [];
            for (const frame of frames) {
                const state = await this.state(job, id, frame);
                if (state.label.id !== snapshot.label_id) fail('Label của track đã thay đổi.');
                const before = String(state.attributes[spec.id] ?? spec.defaultValue);
                rows.push({ frame, before, after: nextValue,
                    points: [...state.points], outside: !!state.outside,
                    otherAttributes: Object.fromEntries(Object.entries(state.attributes).filter(([key]) => key !== String(spec.id))) });
            }
            const fresh = await this.exported(job, id);
            if (JSON.stringify(snapshot) !== JSON.stringify(fresh)) fail('Annotation đã thay đổi. Hãy xem trước lại.');
            const plan = { job, id, spec, start, end, snapshot, rows, value: nextValue,
                affectedKeyframes: spec.mutable ? frames.length : 0 };
            this.plans.add(plan);
            return plan;
        }

        async apply(plan, onProgress = () => {}) {
            if (this.busy || !this.plans.has(plan)) fail('Hãy tạo bản xem trước mới.');
            this.guard(plan.job, plan.id);
            const original = await this.exported(plan.job, plan.id);
            if (this.busy) fail('Đang cập nhật thuộc tính.');
            if (JSON.stringify(original) !== JSON.stringify(plan.snapshot)) fail('Annotation đã thay đổi sau khi xem trước.');
            this.plans.delete(plan);
            this.busy = true;
            let saved = 0;
            let expected = original;
            this.onBegin?.();
            try {
                for (const row of plan.rows) {
                    if (JSON.stringify(await this.exported(plan.job, plan.id)) !== JSON.stringify(expected)) {
                        fail('Annotation vừa thay đổi ngoài thao tác này; đã dừng.');
                    }
                    const state = await this.state(plan.job, plan.id, row.frame);
                    const before = String(state.attributes[plan.spec.id] ?? plan.spec.defaultValue);
                    if (before === row.after) continue;
                    // Set only the requested attribute. CVAT handles its attribute keyframe/history.
                    state.attributes = { [plan.spec.id]: row.after };
                    await state.save();
                    saved++;
                    this.guard(plan.job, plan.id);
                    const verified = await this.state(plan.job, plan.id, row.frame);
                    if (String(verified.attributes[plan.spec.id]) !== row.after ||
                        verified.points.length !== row.points.length || verified.points.some((p, i) => Math.abs(p - row.points[i]) > 1e-7) ||
                        !!verified.outside !== row.outside || Object.entries(row.otherAttributes).some(([key, val]) => verified.attributes[key] !== val)) {
                        fail(`Chưa xác nhận được cập nhật tại frame ${row.frame}.`);
                    }
                    expected = await this.exported(plan.job, plan.id);
                    if (JSON.stringify(expected.shapes.map((shape) => shape.frame).sort((a, b) => a - b)) !==
                        JSON.stringify(plan.snapshot.shapes.map((shape) => shape.frame).sort((a, b) => a - b))) {
                        fail('Danh sách keyframe đã thay đổi; đã dừng.');
                    }
                    onProgress(saved, plan.rows.length);
                }
                return { saved, affectedKeyframes: plan.affectedKeyframes };
            } catch (error) {
                throw new Error(`${error.message} Đã ghi ${saved} bước. Dùng Undo của CVAT để hoàn tác.`);
            } finally {
                this.busy = false;
                await this.onEnd?.(plan.job, plan.id);
            }
        }
    }

    global.CVATQAQC.AttributeBatch = AttributeBatch;
})(window);

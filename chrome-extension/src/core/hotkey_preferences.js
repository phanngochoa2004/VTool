(function registerHotkeyPreferences(global) {
    'use strict';

    const STORAGE_KEY = 'cvat_qaqc_hotkeys_v1';
    const definitions = [
        ['toggle_ui', 'Chung', 'Ẩn/hiện Inspector', 'Alt+KeyQ', 'dock'],
        ['copy_size', 'Chung', 'Copy kích thước', 'Alt+KeyC', 'dock'],
        ['paste_size', 'Chung', 'Dán kích thước', 'Alt+KeyV', 'dock'],
        ['toggle_frame_outside', 'Chung', 'Outside card hiện tại', 'KeyO', 'dock'],
        ['undo', 'Chung', 'Undo', 'Mod+KeyZ', 'dock'],
        ['redo', 'Chung', 'Redo', 'Mod+KeyY', 'dock'],
        ['layout', 'Bố cục', 'Bật/tắt Split View 3D', 'Alt+KeyT', 'editor'],
        ['rotate_z_left', 'Xoay', 'Xoay trái quanh Z', 'KeyQ', 'editor'],
        ['rotate_z_right', 'Xoay', 'Xoay phải quanh Z', 'KeyW', 'editor'],
        ['rotate_side_left', 'Xoay', 'Xoay trái mặt Side', 'KeyE', 'editor'],
        ['rotate_side_right', 'Xoay', 'Xoay phải mặt Side', 'KeyR', 'editor'],
        ['rotate_roll_right', 'Xoay', 'Nghiêng phải', 'Numpad4', 'editor'],
        ['rotate_roll_left', 'Xoay', 'Nghiêng trái', 'Numpad5', 'editor'],
        ['rotate_z_90', 'Xoay', 'Xoay trái 90°', 'KeyZ', 'editor'],
        ['swap_rotate_90', 'Xoay', 'Xoay 90° và đổi dài/rộng', 'KeyX', 'editor'],
        ['move_forward', 'Di chuyển', 'Tiến', 'ArrowLeft', 'editor'],
        ['move_backward', 'Di chuyển', 'Lùi', 'ArrowRight', 'editor'],
        ['move_up', 'Di chuyển', 'Nâng', 'ArrowUp', 'editor'],
        ['move_down', 'Di chuyển', 'Hạ', 'ArrowDown', 'editor'],
        ['move_right', 'Di chuyển', 'Qua phải', 'Numpad1', 'editor'],
        ['move_left', 'Di chuyển', 'Qua trái', 'Numpad2', 'editor'],
        ['resize_forward', 'Đổi một mặt', 'Nới mặt trước', 'Shift+ArrowLeft', 'editor'],
        ['resize_backward', 'Đổi một mặt', 'Thu mặt sau', 'Shift+ArrowRight', 'editor'],
        ['resize_up', 'Đổi một mặt', 'Nới mặt trên', 'Shift+ArrowUp', 'editor'],
        ['resize_down', 'Đổi một mặt', 'Thu mặt dưới', 'Shift+ArrowDown', 'editor'],
        ['resize_right', 'Đổi một mặt', 'Nới mặt phải', 'Shift+Numpad1', 'editor'],
        ['resize_left', 'Đổi một mặt', 'Thu mặt trái', 'Shift+Numpad2', 'editor'],
        ['preset_sedan', 'Kích thước mẫu', 'Sedan', 'Digit1', 'editor'],
        ['preset_suv', 'Kích thước mẫu', 'SUV', 'Digit2', 'editor'],
        ['preset_motorcycle', 'Kích thước mẫu', 'Xe máy', 'Digit3', 'editor'],
        ['preset_pedestrian', 'Kích thước mẫu', 'Người đi bộ', 'Digit4', 'editor'],
        ['sync_size', 'Toàn Track', 'Đồng bộ kích thước', 'KeyG', 'editor'],
        ['restore_size', 'Toàn Track', 'Khôi phục kích thước', 'Shift+KeyG', 'editor'],
        ['toggle_track_outside', 'Toàn Track', 'Bật/tắt Outside', 'KeyP', 'editor'],
        ['restore_track_outside', 'Toàn Track', 'Khôi phục Outside', 'Shift+KeyP', 'editor'],
    ].map(([id, category, label, defaultCombo, scope]) => ({ id, category, label, defaultCombo, scope }));

    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    let saved = load();

    function load() {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
    }

    function combo(id) { return saved[id] || byId.get(id)?.defaultCombo || ''; }
    function eventCombo(event) {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
        const modifiers = [];
        if (event.ctrlKey || event.metaKey) modifiers.push('Mod');
        if (event.altKey) modifiers.push('Alt');
        if (event.shiftKey) modifiers.push('Shift');
        if (modifiers.length > 1) return null;
        const code = event.code || (/^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : event.key);
        return code ? [...modifiers, code].join('+') : null;
    }

    function matchEvent(event, scope) {
        const pressed = eventCombo(event);
        if (!pressed) return null;
        return definitions.find((definition) => definition.scope === scope && combo(definition.id) === pressed) || null;
    }

    function format(value) {
        const names = { Mod: navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl', Alt: navigator.platform?.includes('Mac') ? '⌥' : 'Alt', Shift: '⇧',
            ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
        return String(value || '').split('+').map((part) => names[part] || part.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join(' + ');
    }

    function setCombo(id, value) {
        if (!byId.has(id) || !value || value.split('+').length > 2) return { ok: false, message: 'Chỉ dùng 1 phím hoặc 1 phím bổ trợ + 1 phím chính.' };
        const conflict = definitions.find((definition) => definition.id !== id && combo(definition.id) === value);
        if (conflict) return { ok: false, message: `Trùng với “${conflict.label}”.` };
        saved[id] = value;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        window.dispatchEvent(new CustomEvent('cvat-qaqc-hotkeys-changed'));
        return { ok: true };
    }

    function reset() {
        saved = {};
        localStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new CustomEvent('cvat-qaqc-hotkeys-changed'));
    }

    global.CVATQAQC.HotkeyPreferences = { definitions, combo, eventCombo, matchEvent, format, setCombo, reset };
})(window);

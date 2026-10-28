(function registerHotkeysAutostart(global) {
    'use strict';

const { install3DHotkeys } = global.CVATQAQC;

function start3DHotkeysAutostart({ getInspectorTarget } = {}) {
    const install = () => install3DHotkeys({ getInspectorTarget });
    window.CVAT3DHotkeysInstall = install;

    window.CVAT3DHotkeysAutostart?.dispose?.();
    const controller = new AbortController();
    let active = true;
    let installedCanvas = null;
    let installedController = null;
    let debounce;

    function readyCanvas() {
        return [...document.querySelectorAll('canvas')].find((canvas) =>
            typeof canvas.getDrawnObjects === 'function' && typeof canvas.updatePosition === 'function');
    }

    function check() {
        if (!active) return;
        const canvas = readyCanvas();
        if (window.CVAT3DHotkeys?.active && window.CVAT3DHotkeys === installedController) {
            // Inspector targets resolve dynamically and do not require CVAT's patched canvases.
            if (typeof getInspectorTarget === 'function') return;
            if (!installedCanvas && canvas) installedCanvas = canvas;
            if (canvas === installedCanvas && canvas?.isConnected) return;
            window.CVAT3DHotkeys.dispose();
            installedCanvas = null;
            installedController = null;
        }
        if (!canvas && typeof getInspectorTarget !== 'function') return;
        try {
            install();
            if (window.CVAT3DHotkeys?.active) {
                installedCanvas = canvas;
                installedController = window.CVAT3DHotkeys;
            }
        } catch (error) {
            console.warn('[CVAT 3D extension] Chưa khởi động được phím tắt:', error);
        }
    }

    function schedule() {
        clearTimeout(debounce);
        debounce = setTimeout(check, 120);
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // CVAT may attach JavaScript properties after a canvas is inserted without
    // causing another DOM mutation. This inexpensive fallback also covers SPA history.
    const poll = setInterval(check, 1500);
    window.addEventListener('popstate', schedule, { signal: controller.signal });
    window.addEventListener('hashchange', schedule, { signal: controller.signal });
    window.addEventListener('pageshow', schedule, { signal: controller.signal });
    window.CVAT3DHotkeysAutostart = {
        get active() { return active; },
        dispose() {
            if (!active) return;
            active = false;
            observer.disconnect();
            controller.abort();
            clearTimeout(debounce);
            clearInterval(poll);
        },
    };
    check();
}

global.CVATQAQC.start3DHotkeysAutostart = start3DHotkeysAutostart;
})(window);

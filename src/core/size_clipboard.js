/**
 * Size Clipboard Module for CVAT 3D QA/QC Inspector
 * Copies and Pastes bounding box dimensions (W: sx, L: sy, H: sz) across frames.
 * Follows the mechanism of CVAT-prelabel-analysis:
 * 1. In-memory clipboard
 * 2. Persistent sessionStorage ('cvat_coof_dims' and 'cvat_qaqc_size_clipboard')
 * 3. System Clipboard integration (formatted text and JSON)
 * 4. Pure UI operation in CVAT-QAQC: 0 HTTP requests, 0 buttons added to CVAT web page.
 */

(function registerSizeClipboard(global) {
    'use strict';

class SizeClipboard {
    static _memory = null;

    /**
     * Restore clipboard from sessionStorage on init
     */
    static init() {
        try {
            const saved = sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims');
            if (saved) {
                const parsed = JSON.parse(saved);
                this._memory = this.normalize(parsed);
            }
        } catch (_) {}
    }

    /**
     * Normalize any size object into { sx, sy, sz, w, l, h }
     * @param {Object} obj - { sx, sy, sz } or { w, l, h }
     */
    static normalize(obj) {
        if (!obj || typeof obj !== 'object') return null;

        const w = Number(obj.sx ?? obj.w ?? 0);
        const l = Number(obj.sy ?? obj.l ?? 0);
        const h = Number(obj.sz ?? obj.h ?? 0);

        if (isNaN(w) || isNaN(l) || isNaN(h) || w <= 0 || l <= 0 || h <= 0) {
            return null;
        }

        const sx = parseFloat(w.toFixed(3));
        const sy = parseFloat(l.toFixed(3));
        const sz = parseFloat(h.toFixed(3));

        return {
            sx,
            sy,
            sz,
            w: sx,
            l: sy,
            h: sz,
            copiedAt: Date.now()
        };
    }

    /**
     * Copy dimensions of a box to clipboard
     * @param {Object} box - { sx, sy, sz }
     * @returns {Object|null}
     */
    static copy(box) {
        const normalized = this.normalize(box);
        if (!normalized) return null;

        this._memory = normalized;

        // 1. Save to sessionStorage (supports cvat_coof_dims interoperability)
        try {
            sessionStorage.setItem('cvat_qaqc_size_clipboard', JSON.stringify(normalized));
            sessionStorage.setItem('cvat_coof_dims', JSON.stringify({
                l: normalized.sy,
                w: normalized.sx,
                h: normalized.sz
            }));
        } catch (_) {}

        // 2. Write to system clipboard if permitted
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                const text = `${normalized.sx} x ${normalized.sy} x ${normalized.sz}`;
                navigator.clipboard.writeText(text).catch(() => {});
            }
        } catch (_) {}

        // 3. Dispatch custom event for UI updates
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('cvat_qaqc_size_copied', {
                    detail: normalized
                }));
            }
        } catch (_) {}

        return normalized;
    }

    /**
     * Retrieve dimensions from memory, sessionStorage, or system clipboard
     * @returns {Promise<Object|null>}
     */
    static async get() {
        if (this._memory) return { ...this._memory };

        try {
            const raw = sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims');
            if (raw) {
                const parsed = JSON.parse(raw);
                const norm = this.normalize(parsed);
                if (norm) {
                    this._memory = norm;
                    return { ...norm };
                }
            }
        } catch (_) {}

        // Try reading from system clipboard as fallback
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                const text = await navigator.clipboard.readText();
                if (text && typeof text === 'string') {
                    // Try JSON parse
                    try {
                        const json = JSON.parse(text);
                        const norm = this.normalize(json);
                        if (norm) {
                            this._memory = norm;
                            return { ...norm };
                        }
                    } catch (_) {}

                    // Try regex parse "1.85 x 4.52 x 1.55" or "1.85, 4.52, 1.55"
                    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*[\*x×,; ]\s*([0-9]+(?:\.[0-9]+)?)\s*[\*x×,; ]\s*([0-9]+(?:\.[0-9]+)?)/i);
                    if (match) {
                        const v1 = parseFloat(match[1]);
                        const v2 = parseFloat(match[2]);
                        const v3 = parseFloat(match[3]);
                        const norm = this.normalize({ sx: v1, sy: v2, sz: v3 });
                        if (norm) {
                            this._memory = norm;
                            return { ...norm };
                        }
                    }
                }
            }
        } catch (_) {}

        return null;
    }

    /**
     * Check synchronously if clipboard has data
     */
    static hasData() {
        if (this._memory) return true;
        try {
            return Boolean(sessionStorage.getItem('cvat_qaqc_size_clipboard') || sessionStorage.getItem('cvat_coof_dims'));
        } catch (_) {
            return false;
        }
    }

    /**
     * Extract active cuboid dimensions from CVAT HTML DOM (pure read-only inspection)
     * Does NOT create or inject any buttons into CVAT.
     */
    static extractFromCvatDom() {
        try {
            const sizeRow = document.querySelector('.cvat-objects-sidebar-state-active .cvat-objects-sidebar-size-params') ||
                            document.querySelector('.cvat-canvas-3d-cuboid-popover .cvat-objects-sidebar-size-params') ||
                            document.querySelector('.cvat-objects-sidebar-size-params');

            let l = null, w = null, h = null;

            if (sizeRow) {
                const cols = sizeRow.querySelectorAll('.ant-col');
                for (const col of cols) {
                    const text = (col.textContent || '').trim().toUpperCase();
                    const input = col.querySelector('input');
                    if (!input) continue;
                    const val = parseFloat(input.value);
                    if (isNaN(val) || val <= 0) continue;

                    if (text.startsWith('L') || text.includes('L:')) l = val;
                    else if (text.startsWith('W') || text.includes('W:')) w = val;
                    else if (text.startsWith('H') || text.includes('H:')) h = val;
                }
            }

            if (w !== null && l !== null && h !== null) {
                return this.normalize({ sx: w, sy: l, sz: h });
            }
        } catch (_) {}

        return null;
    }
}

SizeClipboard.init();

global.CVATQAQC.SizeClipboard = SizeClipboard;
})(window);

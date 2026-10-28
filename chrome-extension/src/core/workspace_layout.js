(function registerWorkspaceLayout(global) {
    'use strict';

    const STORAGE_KEY = 'cvat_split_layout_enabled';
    const ACTIVE_CLASS = 'cvat-qaqc-split-layout-active';

    class WorkspaceLayout {
        static isSplit = false;
        static observer = null;

        static init() {
            if (this.observer) return;
            try { this.isSplit = localStorage.getItem(STORAGE_KEY) === 'true'; } catch (_) { /* ignore */ }
            this.observer = new MutationObserver(() => {
                if (!this.isSplit) return;
                this.tagGridItems();
                document.body?.classList.add(ACTIVE_CLASS);
            });
            this.observer.observe(document.documentElement, { childList: true, subtree: true });
            if (this.isSplit) this.set(true, false);
        }

        static tagGridItems() {
            const views = [
                ['perspective', '.cvat-canvas3d-perspective'],
                ['top', '.cvat-canvas3d-topview'],
                ['side', '.cvat-canvas3d-sideview'],
                ['front', '.cvat-canvas3d-frontview'],
            ];
            document.querySelectorAll('.cvat-canvas-grid-item, .react-grid-item').forEach((item) => {
                const match = views.find(([, selector]) => item.querySelector(selector));
                if (match) item.dataset.qaqcView = match[0];
            });
        }

        static available() {
            this.tagGridItems();
            return ['perspective', 'top', 'side', 'front'].every((view) =>
                document.querySelectorAll(`[data-qaqc-view="${view}"]`).length === 1);
        }

        static toggle() {
            return this.set(!this.isSplit);
        }

        static set(enable, validate = true) {
            if (enable && validate && !this.available()) {
                throw new Error('Split View cần đủ 4 khung 3D, Top, Side và Front trong Standard 3D.');
            }
            this.isSplit = Boolean(enable);
            try { localStorage.setItem(STORAGE_KEY, String(this.isSplit)); } catch (_) { /* ignore */ }
            document.body.classList.toggle(ACTIVE_CLASS, this.isSplit);
            if (this.isSplit) {
                this.tagGridItems();
                const sidebar = document.querySelector('.cvat-objects-sidebar');
                if (sidebar && !sidebar.classList.contains('ant-layout-sider-collapsed')) {
                    document.querySelector('.cvat-objects-sidebar-sider')?.click();
                }
            }
            this.triggerResize();
            return this.isSplit;
        }

        static triggerResize() {
            for (const delay of [0, 60, 180, 350]) {
                setTimeout(() => window.dispatchEvent(new Event('resize')), delay);
            }
        }
    }

    global.CVATQAQC.WorkspaceLayout = WorkspaceLayout;
    WorkspaceLayout.init();
})(window);

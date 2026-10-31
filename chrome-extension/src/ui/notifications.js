(function registerNotifications(global) {
    'use strict';

    const notices = new Map();
    let region = null;

    function showError(error, { title = 'Không thể thực hiện thao tác', context = '' } = {}) {
        const message = typeof error === 'string' ? error : error?.message || 'Đã xảy ra lỗi. Vui lòng thử lại.';
        const shortTitle = /căn nền/i.test(title) ? 'Không thể căn nền' : title.replace(/\s*bằng RANSAC/gi, '');
        let shortMessage = message;
        if (/point cloud|PCD|chưa tải/i.test(message)) shortMessage = 'Điểm chưa tải xong. Thử lại sau.';
        else if (/đáy box|chưa đủ.*nền|chưa tìm được nền|điểm nền/i.test(message)) shortMessage = 'Không đủ điểm mặt đường.';
        else if (/nhiều cao độ|nhiều.*độ dốc/i.test(message)) shortMessage = 'Không xác định được mặt đường phù hợp.';
        else if (/cao độ|độ dốc vượt|nghiêng quá/i.test(message)) shortMessage = 'Box lệch hoặc nghiêng quá nhiều.';
        else if (/đã đổi|đã thay đổi|trạng thái trang/i.test(message)) shortMessage = 'Dữ liệu đã thay đổi. Thử lại.';
        if (shortMessage.length > 140) shortMessage = shortMessage.slice(0, 137) + '…';
        const key = `${title}\n${context}\n${message}`;
        if (notices.has(key)) {
            notices.get(key).restart();
            return;
        }
        if (!region?.isConnected) {
            region = document.createElement('div');
            region.className = 'cvat-qaqc-notifications';
            region.setAttribute('aria-label', 'Thông báo lỗi Inspector');
            document.body.appendChild(region);
        }
        if (notices.size >= 3) notices.values().next().value.close();

        const notice = document.createElement('section');
        notice.className = 'cvat-qaqc-notification';
        notice.setAttribute('role', 'alert');
        notice.setAttribute('aria-atomic', 'true');
        const detail = document.createElement('p');
        detail.textContent = `${shortTitle}: ${shortMessage}`;
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Đóng thông báo lỗi');
        notice.appendChild(detail);
        notice.appendChild(closeButton);
        let timer;
        const close = () => {
            clearTimeout(timer);
            notices.delete(key);
            notice.remove();
        };
        const restart = () => {
            clearTimeout(timer);
            timer = setTimeout(close, 12000);
        };
        closeButton.addEventListener('click', close);
        notice.addEventListener('mouseenter', () => clearTimeout(timer));
        notice.addEventListener('mouseleave', restart);
        notice.addEventListener('focusin', () => clearTimeout(timer));
        notice.addEventListener('focusout', restart);
        notices.set(key, { close, restart });
        region.appendChild(notice);
        restart();
    }

    global.CVATQAQC.Notifications = {
        showError,
        clear: () => { for (const notice of notices.values()) notice.close(); },
    };
})(window);

/**
 * Danh sách các trang web / địa chỉ CVAT được phép inject extension.
 * Thay cho việc dùng regex hoặc đoán DOM, extension sẽ chỉ chạy trên các trang thuộc danh sách này.
 *
 * CÁCH CẤU HÌNH:
 * 1. Địa chỉ chính xác (Khuyên dùng):
 *    'https://cvat-test.vantixapps.net'
 *    'http://localhost:8080'
 *
 * 2. Wildcard tiền tố (Khớp mọi trang bắt đầu bằng https://cvat...):
 *    'https://cvat*' (khớp https://cvat-test.vantixapps.net, https://cvat-prod.vantixapps.net, v.v.)
 *
 * 3. Wildcard domain (Khớp mọi subdomain của vantixapps.net):
 *    '*.vantixapps.net'
 */

export const ALLOWED_SITES = [
    // Local CVAT Server instances (mặc định của CVAT là port 8080)
    'http://localhost:8080',
    'http://127.0.0.1:8080',

    // Local CVAT Web UI dev server (port 3000)
    'http://localhost:3000',
    'http://127.0.0.1:3000',

    // Local port 80 (nếu chạy CVAT qua reverse proxy port chuẩn)
    'http://localhost',
    'http://127.0.0.1',

    // Official CVAT Cloud instances
    'https://app.cvat.ai',
    'https://cvat.ai',

    // Hỗ trợ dạng tiền tố: khớp mọi site bắt đầu bằng https://cvat...
    'https://cvat*',
];

/**
 * Kiểm tra xem URL hoặc location hiện tại có thuộc danh sách ALLOWED_SITES hay không.
 * Hoàn toàn dùng so sánh chuỗi (origin, prefix, domain suffix) - không dùng regex.
 * @param {Location|string} [target] - window.location hoặc chuỗi URL cần kiểm tra
 * @returns {boolean}
 */
export function isAllowedSite(target) {
    let currentOrigin = '';
    let currentHref = '';
    let currentHost = '';
    let currentHostname = '';

    if (typeof target === 'string') {
        try {
            const parsed = new URL(target, 'http://localhost');
            currentOrigin = parsed.origin;
            currentHref = parsed.href;
            currentHost = parsed.host;
            currentHostname = parsed.hostname;
        } catch (_) {
            currentOrigin = target;
            currentHref = target;
        }
    } else if (target && typeof target === 'object') {
        currentOrigin = target.origin || '';
        currentHref = target.href || '';
        currentHost = target.host || '';
        currentHostname = target.hostname || '';
    } else if (typeof window !== 'undefined' && window.location) {
        currentOrigin = window.location.origin || '';
        currentHref = window.location.href || '';
        currentHost = window.location.host || '';
        currentHostname = window.location.hostname || '';
    }

    if (!currentOrigin && !currentHref) return false;

    const lowerOrigin = currentOrigin.toLowerCase();
    const lowerHref = currentHref.toLowerCase();
    const lowerHostname = currentHostname.toLowerCase();

    for (const rawSite of ALLOWED_SITES) {
        if (!rawSite || typeof rawSite !== 'string') continue;
        const site = rawSite.trim().toLowerCase().replace(/\/+$/, '');
        if (!site) continue;

        // 1. Wildcard dạng prefix (ví dụ: 'https://cvat*' hoặc 'http://cvat*')
        if (site.endsWith('*')) {
            const prefix = site.slice(0, -1);
            if (lowerOrigin.startsWith(prefix) || lowerHref.startsWith(prefix)) {
                return true;
            }
        }

        // 2. Wildcard dạng domain (ví dụ: '*.vantixapps.net')
        if (site.startsWith('*.')) {
            const domainSuffix = site.slice(1); // '.vantixapps.net'
            if (lowerHostname.endsWith(domainSuffix) || lowerHostname === site.slice(2)) {
                return true;
            }
        }

        // 3. Tiền tố linh hoạt nếu người dùng chỉ nhập 'https://cvat'
        if (site.startsWith('https://cvat') || site.startsWith('http://cvat')) {
            if (lowerOrigin.startsWith(site)) {
                return true;
            }
        }

        // 4. So khớp chính xác Origin (ví dụ: 'https://cvat-test.vantixapps.net', 'http://localhost:8080')
        if (lowerOrigin === site) {
            return true;
        }

        // 5. So khớp tiền tố URL đầy đủ
        if (lowerHref.startsWith(site + '/') || lowerHref === site) {
            return true;
        }

        // 6. So khớp hostname thuần
        if (lowerHostname === site || currentHost.toLowerCase() === site) {
            return true;
        }
    }

    return false;
}

# CVAT 3D Multi-Frame QA/QC Inspector (Chrome Extension)

Công cụ kiểm định chất lượng (QA/QC) gán nhãn 3D Point Cloud chuyên dụng cho CVAT local, hiển thị đồng thời 3 góc chiếu trực giao (**Top**, **Front**, **Side**) xuyên suốt toàn bộ các frame (**>60 frames**) của vật thể được chọn, hỗ trợ **hiển thị hướng (orientation)** và **chỉnh sửa trực tiếp (in-place editing)** vị trí, kích thước, góc quay cuboid mà không cần gửi bất kỳ request nào lên server.

---

## 🌟 Tính Năng Nổi Bật

1. **Tuân thủ triệt để Apple Human Interface Guidelines (`skill_ui_macos`)**:
   - **Tuyệt đối không có 3 nút tròn đỏ/vàng/xanh** (Traffic lights) và không vẽ thanh tiêu đề cửa sổ giả (Fake titlebar).
   - Thiết kế dạng **Docked Drawer kính mờ (Frosted glass / Vibrancy)** gắn cố định ở chân màn hình, có thể kéo chỉnh độ cao (`drag handle`).
   - Nút bấm và nhãn nhỏ gọn, tinh tế (chiều cao nút chuẩn 22px–28px, font SF Pro 10px–13px), tối ưu hóa mật độ hiển thị thông tin chuyên nghiệp.
   - 3 khung chiếu trực giao Top, Front, Side có **kích thước lớn**, hiển thị sắc nét viền bounding box và các hạt point cloud.
   - Thu gọn thành một nút pill siêu gọn `[ 3D ]` ở góc dưới bên phải màn hình khi không dùng tới.

2. **Chỉ Báo Hướng Cuboid (Cuboid Orientation & Axes)**:
   - Hệ trục tọa độ cục bộ 3D chuẩn màu RGB (khớp với CVAT 3D):
     - **Trục X (Đỏ - Red)**: Chiều rộng (+X / Width sang phải).
     - **Trục Y (Xanh lá - Green)**: Chiều dài & Hướng đầu xe (+Y / Heading tiến phía trước).
     - **Trục Z (Xanh dương - Blue)**: Chiều cao (+Z / Height hướng lên trên).
   - Mũi tên chỉ hướng đầu xe (`▲ FRONT (+Y)`) nổi bật ở góc nhìn **Top**.
   - Hiển thị góc quay Yaw tức thì theo độ trên badge thẻ frame: `Yaw: XX.X°` (hoặc `θ: XX.X°`).

3. **Chỉnh Sửa Trực Tiếp Trên UI (In-Place 3D Bounding Box Editing)**:
   - Cho phép chỉnh sửa cuboid ngay trên từng frame card khi phát hiện lỗi gán nhãn:
     - **Vị trí (Position)**: Tăng/giảm tọa độ $X, Y, Z$ từng bước $0.05\text{m}$ (giữ `Shift` để bước nhảy $\times 5 = 0.25\text{m}$).
     - **Kích thước (Size)**: Tăng/giảm chiều rộng $W$, chiều dài $L$, chiều cao $H$ từng bước $0.05\text{m}$ (giữ `Shift` để bước nhảy $\times 5 = 0.25\text{m}$).
     - **Góc quay (Yaw / Rotation)**:
       - Xoay tinh chỉnh: `[↺ -1°]`, `[↻ +1°]`.
       - Xoay nhanh: `[↺ -5°]`, `[↻ +5°]`.
       - **Đảo chiều 180° (`⟲ Đảo 180°`)**: Lật ngược hướng đầu xe chỉ với 1 click khi annotator gán ngược đầu xe.
     - **Hoàn tác (`↺ Hoàn tác / Reset`)**: Khôi phục lại trạng thái ban đầu của frame nếu thao tác nhầm.
   - **Tái kết xuất tức thì (Real-time Re-rendering)**: 3 khung canvas Top, Front, Side tự động chiếu lại các hạt point cloud theo thông số mới ngay lập tức mà không cần tải lại.

4. **Chính sách Không Request Server (Strict Zero-Request Guarantee)**:
   - **Tuyệt đối 0 request mạng**: Không gọi `fetch()`, `XMLHttpRequest` hay WebSocket tới backend CVAT.
   - **Lưu trực tiếp vào RAM Client**: Khi chỉnh sửa cuboid, thay đổi được ghi trực tiếp vào `AnnotationsCollection` trong bộ nhớ CVAT (`state.save()`) và phát sự kiện `canvas.edited` lên Three.js scene để cập nhật màn hình 3D chính mà không hề gửi request lên server cho đến khi người dùng chủ động nhấn Save trong CVAT.

5. **Bộ Zoom Đa Cấp (< 100% Đến 200%)**:
   - Hỗ trợ các mức thu nhỏ dưới 100% để quan sát không gian rộng quanh cuboid:
     - `Zoom 40%`, `Zoom 60%`, `Zoom 80%`, `Zoom 100%`, `Zoom 125%`, `Zoom 150%`, `Zoom 200%`.

6. **Nhảy Nhanh Đến Frame (Click to Jump Frame)**:
   - Bấm vào nút `[ ↗ Nhảy / Jump ]` trên bất kỳ thẻ frame nào, hoặc bấm trực tiếp vào thanh tiêu đề của frame đó để CVAT tự động đồng bộ player chuyển tới frame đó.

---

## 🚀 Hướng Dẫn Cài Đặt (Load Unpacked vào Chrome)

1. Mở trình duyệt Google Chrome và truy cập:
   ```
   chrome://extensions/
   ```
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Bấm vào nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
4. Chọn thư mục repo `VTool` (thư mục chứa `manifest.json`).
   *(Nếu đã nạp phiên bản trước đó, chỉ cần bấm nút biểu tượng mũi tên tròn 🔄 Reload trên thẻ tiện ích).*

---

## Phím tắt CVAT 3D tích hợp

Bộ phím từ `CVAT-3D-Hotkeys-1.6.0` tự chạy cùng Inspector trên các địa chỉ trong `src/config/allowed_sites.js`, kể cả khi mở job 3D sau khi trang đã tải. Chọn đúng một cuboid trước khi chỉnh; phím không can thiệp khi nhập liệu hoặc mở hộp thoại. Dữ liệu point cloud được tính bằng mét.

Trong panel Inspector: đặt con trỏ lên thẻ frame cần sửa ở các ô Top/Side/Front, hoặc bấm trực tiếp vào thẻ/canvas rồi nhấn phím. Phím chỉnh đúng frame của thẻ đó (kể cả frame khác khung CVAT chính), cập nhật cả ba góc nhìn và lưu qua cơ chế chỉnh sửa sẵn có của repo. **Không cần chọn lại box trên CVAT chính.** G/Shift+G đồng bộ/khôi phục kích thước theo box trên thẻ đang chọn; P/Shift+P thao tác Outside của track trong panel. Alt+T vẫn chỉnh bố cục CVAT chính. Bộ tự bật thay thế handler cũ nếu handler đó chưa kết nối với Inspector.

W và E đã hoán đổi chức năng: **Q/W** xoay trái/phải 2° quanh trục Z của point cloud; **E/R** xoay trái/phải 2° trong mặt Side quanh trục Y cục bộ.

| Phím | Chức năng |
| --- | --- |
| ← / → | Tiến / lùi 4 cm theo hướng box trên mặt ngang |
| ↑ / ↓ | Nâng / hạ 4 cm |
| Numpad 1 / 2 | Dịch phải / trái 4 cm theo hướng box |
| Shift + ← | Nới mặt phía ← ra 6 cm, giữ nguyên mặt phía → |
| Shift + → | Thu mặt phía → vào 6 cm, giữ nguyên mặt phía ← |
| Shift + ↑ / ↓ | Nới mặt trên ra / thu mặt dưới vào 6 cm, giữ nguyên mặt đối diện |
| Shift + Numpad 1 / 2 | Nới mặt phải ra / thu mặt trái vào 6 cm, giữ nguyên mặt đối diện |
| Numpad 4 / 5 | Nghiêng ngang phải / trái 3° quanh trục X cục bộ |
| Z | Xoay trái 90° quanh trục Z của point cloud |
| X | Xoay 90° quanh Z cục bộ và đổi Dài/Rộng, giữ nguyên vùng box |
| 1 / 2 / 3 / 4 (hàng trên) | Mẫu Sedan / SUV / xe máy / người đi bộ |
| G / Shift + G | Đồng bộ kích thước các keyframe cùng track trong job / khôi phục lần đồng bộ gần nhất |
| P / Shift + P | Bật/tắt Outside toàn track trong job / khôi phục lần Outside gần nhất |
| Alt + T | Bố cục 3D bên trái, Top trên phải, Side/Front dưới phải; thu gọn bảng ID |

Các tổ hợp Shift đổi kích thước bằng cách **chỉnh một mặt, giữ mặt đối diện đứng yên** và giữ nguyên góc xoay, kể cả khi box đã xoay/nghiêng. Không cho giảm kích thước xuống 0 hoặc âm. Mỗi lần nhấn thực hiện một bước; giữ phím không tự lặp. Numpad 1/2 được nhận theo vị trí kể cả khi Num Lock tắt; số hàng trên vẫn dùng mẫu kích thước.

Ví dụ Shift+←: chỉ mặt phía trái nở ra 6 cm; mặt phía phải đứng yên. Box không tịnh tiến cả khối; tọa độ tâm tự đổi 3 cm vì kích thước thay đổi một phía. Chiều dài tăng tổng cộng 6 cm. Shift+→ chỉ thu mặt phía phải vào 6 cm, giữ mặt trái đứng yên. Các phía dùng cùng hướng cục bộ như bộ phím dịch box của tool gốc.

Kích thước mẫu Dài × Rộng × Cao: Sedan `4.5 × 1.85 × 1.5`, SUV `4.7 × 1.95 × 1.65`, xe máy `1.85 × 0.8 × 1.5`, người đi bộ `0.6 × 0.6 × 1.7`.

Thay đổi đi qua cơ chế chỉnh sửa và lịch sử của CVAT; dùng Undo của CVAT hoặc Ctrl+Z để hoàn tác. G/P chỉ áp dụng Track; bản khôi phục Shift+G/P chỉ tồn tại trong phiên trang. Bấm **Save** trong CVAT để lưu lên server.

Sau khi cập nhật: Reload tiện ích trong `chrome://extensions`, rồi tải lại tab CVAT. Tắt tiện ích hotkey cũ nếu còn bật riêng để tránh hai bộ phím chạy cùng lúc.

## Build và kiểm tra

Yêu cầu Node.js. Sau khi sửa mã nguồn, chạy:

```sh
node build.js
node --test tests/test_hotkeys.cjs
node tests/test_math.js
```

`content/bundle.js` là file Chrome nạp trực tiếp, cần build lại khi thay đổi `src/` hoặc `content/injector.js`.

Để kiểm tra bằng trình duyệt, chạy HTTP server local tại thư mục repo và mở `tests/fixtures/inspector_hotkeys.html`. Trang dùng các thành phần Inspector thật với dữ liệu thử nghiệm trong bộ nhớ, không có box nào được chọn trên canvas CVAT chính, và mô phỏng bộ phím cũ đã chạy trước.

---

## 📖 Hướng Dẫn Thao Tác

1. Mở CVAT local trên trình duyệt Chrome (ví dụ: `http://localhost:8080` hoặc `http://127.0.0.1:8080`).
2. Mở một Job gán nhãn 3D Point Cloud.
3. Nút pill `[ 3D ]` nằm khiêm tốn ở góc dưới bên phải màn hình:
   - Bấm vào nút `[ 3D ]` hoặc nhấn tổ hợp phím **`Alt + Q`** để mở drawer kiểm định.
   - Nhấn **`Alt + Q`** hoặc nút `[ ✕ Ẩn / Hide ]` để thu gọn lại.
4. Khi click chọn một track / cuboid bất kỳ trên CVAT:
   - Panel sẽ nạp và hiển thị toàn bộ chuỗi frame của vật thể đó (hơn 60 frames) theo dạng cuộn dọc.
   - Mỗi frame hiển thị đầy đủ 3 góc chiếu Top, Front, Side kèm góc quay `Yaw: XX.X°` và kích thước.
5. Để chỉnh sửa một frame:
   - Bấm nút **`[ ✎ Sửa / Edit ]`** trên thẻ frame đó.
   - Sử dụng các nút tăng/giảm vị trí, kích thước hoặc xoay góc.
   - Quan sát các hạt point cloud di chuyển ăn khớp hoàn hảo vào viền bounding box trên cả 3 góc chiếu.
   - Thao tác tự động lưu vào RAM client của CVAT (0 request). Khi kiểm định xong, nhấn nút **Save** trên CVAT để lưu kết quả lên cơ sở dữ liệu.

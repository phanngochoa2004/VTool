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
       - Xoay nhanh: `[↺ -3°]`, `[↻ +3°]`.
       - **Đảo chiều 180° (`⟲ Đảo 180°`)**: Lật ngược hướng đầu xe chỉ với 1 click khi annotator gán ngược đầu xe.
     - **Hoàn tác (`↺ Hoàn tác / Reset`)**: Khôi phục lại trạng thái ban đầu của frame nếu thao tác nhầm.
   - **Tái kết xuất tức thì (Real-time Re-rendering)**: 3 khung canvas Top, Front, Side tự động chiếu lại các hạt point cloud theo thông số mới ngay lập tức mà không cần tải lại.

4. **Chính sách Không Request Server (Strict Zero-Request Guarantee)**:
   - **Tuyệt đối 0 request mạng**: Không gọi `fetch()`, `XMLHttpRequest` hay WebSocket tới backend CVAT.
   - **Lưu trực tiếp vào RAM Client**: Khi chỉnh sửa cuboid, thay đổi được ghi trực tiếp vào `AnnotationsCollection` trong bộ nhớ CVAT (`state.save()`) và phát sự kiện `canvas.edited` lên Three.js scene để cập nhật màn hình 3D chính mà không hề gửi request lên server cho đến khi người dùng chủ động nhấn Save trong CVAT.

5. **Bộ Zoom Đa Cấp (< 100% Đến 200%)**:
   - Hỗ trợ các mức thu nhỏ dưới 100% để quan sát không gian rộng quanh cuboid:
     - `Zoom 40%`, `Zoom 60%`, `Zoom 80%`, `Zoom 100%`, `Zoom 125%`, `Zoom 150%`, `Zoom 200%`.
   - Mức 100% chừa vùng nhìn hệ số 1.45 quanh box để thao tác tay nắm và quan sát điểm bên ngoài. Khi zoom out bằng toolbar hoặc bánh xe, vùng lọc điểm mở rộng theo hai trục đang nhìn, tối đa 3 lần kích thước box và thêm không quá 3 m mỗi phía so với vùng gốc. Trục chiều sâu giữ hệ số 1.10. Điểm ngoài box có độ đậm 75% và kích thước tối thiểu 1.5 px; điểm trong box giữ nguyên độ đậm và kích thước đã chọn. Trong lúc zoom dùng lại điểm đã lọc; khi dừng zoom sẽ cập nhật vùng điểm từ PCD trong RAM. Thao tác zoom không gọi tải frame/PCD mới.

6. **Nhảy Nhanh Đến Frame (Click to Jump Frame)**:
   - Bấm trực tiếp vào thanh tiêu đề của card để chuyển player tới frame đó. Các nút Active, Căn nền, Cố định All và Nhảy/Jump đã được bỏ khỏi UI; căn nền và đồng bộ kích thước vẫn có thể dùng qua phím tắt.

---

## 🚀 Hướng Dẫn Cài Đặt (Load Unpacked vào Chrome)

1. Mở trình duyệt Google Chrome và truy cập:
   ```
   chrome://extensions/
   ```
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Bấm vào nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
4. Chọn thư mục `CVAT-QAQC/chrome-extension` (thư mục chứa `manifest.json`). Không chọn thư mục root `CVAT-QAQC`.
   *(Nếu đã nạp phiên bản trước đó, chỉ cần bấm nút biểu tượng mũi tên tròn 🔄 Reload trên thẻ tiện ích).*

---

## Phím tắt CVAT 3D tích hợp

Bấm nút `?` → **Cấu hình phím** để đổi phím tắt. Mỗi lệnh nhận một phím hoặc một phím bổ trợ + một phím chính; cấu hình tự lưu trong `localStorage` của trình duyệt.

Bộ phím tích hợp tự chạy cùng Inspector trên các địa chỉ trong `src/config/allowed_sites.js`, kể cả khi mở job 3D sau khi trang đã tải. Chọn đúng một cuboid trước khi chỉnh; phím không can thiệp khi nhập liệu hoặc mở hộp thoại. Dữ liệu point cloud được tính bằng mét.

Trong panel Inspector: đặt con trỏ lên thẻ frame cần sửa ở các ô Top/Side/Front, hoặc bấm trực tiếp vào thẻ/canvas rồi nhấn phím. Phím chỉnh đúng frame của thẻ đó (kể cả frame khác khung CVAT chính), cập nhật cả ba góc nhìn và lưu qua cơ chế chỉnh sửa sẵn có của repo. **Không cần chọn lại box trên CVAT chính.** G/Shift+G đồng bộ/khôi phục kích thước theo box trên thẻ đang chọn; P/Shift+P thao tác Outside của track trong panel. Alt+T vẫn chỉnh bố cục CVAT chính. Bộ tự bật thay thế handler cũ nếu handler đó chưa kết nối với Inspector.

Phím xoay dùng cùng bước, chiều và trục cục bộ như nút trên view: **Q/W** tương ứng Top ↺/↻ 3°; **E/R** tương ứng Side ↺/↻ 1°; **Numpad 5/4** tương ứng Front ↺/↻ 1°. Kết quả khớp cả khi box đã nghiêng.

| Phím | Chức năng |
| --- | --- |
| ← / → | Tiến / lùi 4 cm theo hướng box trên mặt ngang |
| ↑ / ↓ | Nâng / hạ 4 cm |
| Numpad 1 / 2 | Dịch phải / trái 4 cm theo hướng box |
| Shift + ← | Nới mặt phía ← ra 6 cm, giữ nguyên mặt phía → |
| Shift + → | Thu mặt phía → vào 6 cm, giữ nguyên mặt phía ← |
| Shift + ↑ / ↓ | Nới mặt trên ra / thu mặt dưới vào 6 cm, giữ nguyên mặt đối diện |
| Shift + Numpad 1 / 2 | Nới mặt phải ra / thu mặt trái vào 6 cm, giữ nguyên mặt đối diện |
| Numpad 4 / 5 | Front ↻ / ↺ 1° quanh trục X cục bộ |
| Shift + R | Căn cao độ, Roll và Pitch của box đang chọn theo mặt đường |
| Z | Top ↺ 90° quanh trục Z cục bộ, giống nút UI |
| X | Xoay 90° quanh Z cục bộ và đổi Dài/Rộng, giữ nguyên vùng box |
| 1 / 2 / 3 / 4 (hàng trên) | Mẫu Sedan / SUV / xe máy / người đi bộ |
| G / Shift + G | Đồng bộ kích thước các keyframe cùng track trong job / khôi phục lần đồng bộ gần nhất |
| P / Shift + P | Bật/tắt Outside toàn track trong job / khôi phục lần Outside gần nhất |
| Alt + T | Bật/tắt Split View: 3D trái 52%, Top phải trên 58%, Side/Front phải dưới; tự thu gọn bảng ID |

Các tổ hợp Shift đổi kích thước bằng cách **chỉnh một mặt, giữ mặt đối diện đứng yên** và giữ nguyên góc xoay, kể cả khi box đã xoay/nghiêng. Không cho giảm kích thước xuống 0 hoặc âm. Mỗi lần nhấn thực hiện một bước; giữ phím không tự lặp. Numpad 1/2 được nhận theo vị trí kể cả khi Num Lock tắt; số hàng trên vẫn dùng mẫu kích thước.

Ví dụ Shift+←: chỉ mặt phía trái nở ra 6 cm; mặt phía phải đứng yên. Box không tịnh tiến cả khối; tọa độ tâm tự đổi 3 cm vì kích thước thay đổi một phía. Chiều dài tăng tổng cộng 6 cm. Shift+→ chỉ thu mặt phía phải vào 6 cm, giữ mặt trái đứng yên. Các phía dùng cùng hướng cục bộ như bộ phím dịch box của tool gốc.

Kích thước mẫu Dài × Rộng × Cao: Sedan `4.5 × 1.85 × 1.5`, SUV `4.7 × 1.95 × 1.65`, xe máy `1.85 × 0.8 × 1.5`, người đi bộ `0.6 × 0.6 × 1.7`.

Thay đổi đi qua cơ chế chỉnh sửa và lịch sử của CVAT; dùng Undo của CVAT hoặc Ctrl+Z để hoàn tác. G/P chỉ áp dụng Track; bản khôi phục Shift+G/P chỉ tồn tại trong phiên trang. Bấm **Save** trong CVAT để lưu lên server.

### Căn box theo mặt đường

Trỏ vào card cần chỉnh rồi nhấn **Shift+R** để căn nền bằng PCD cache của đúng frame. Khi thao tác trên canvas CVAT chính, chọn đúng một cuboid trước khi nhấn phím. Công cụ giữ nguyên X/Y, kích thước, hướng đầu xe, ID và trạng thái annotation; tính lại cao độ và độ nghiêng theo mặt đường.

Thuật toán chỉ đọc PCD của frame hiện tại đã được CVAT tải vào RAM. Nó không gọi `fetch`, API frame hoặc request mạng bổ sung. Mặt nền được ước lượng theo các ô không gian quanh đáy box, loại điểm thân xe/vật cản, kiểm tra độ phủ đáy, độ liên tục, sai số và giới hạn độ nghiêng. Nếu dữ liệu mơ hồ, thiếu điểm hoặc độ dịch cao quá giới hạn an toàn, box được giữ nguyên và lỗi xuất hiện ở nút/Console.

Trong **? → Cấu hình phím**, có thể đổi phím `Căn box theo mặt đường` và bật **Tự căn khi chọn box trên canvas CVAT**. Tự căn chỉ được lưu trong tab/phiên hiện tại để tránh thay đổi ngoài ý muốn ở phiên sau. Chức năng này không căn card của frame khác trong Inspector vì các frame đó không phải PCD đang tải trên canvas CVAT chính.

Sau khi cập nhật: Reload tiện ích trong `chrome://extensions`, rồi tải lại tab CVAT. Tắt tiện ích hotkey cũ nếu còn bật riêng để tránh hai bộ phím chạy cùng lúc.

## Cập nhật thuộc tính hàng loạt

Tìm Object ID trong Inspector, bấm **Thuộc tính**, chọn attribute và giá trị mới. Phạm vi gồm **Toàn track** hoặc **Khoảng frame**; mỗi lần sửa một attribute của track đang mở. Chưa hỗ trợ nhiều ID trong cùng một batch.

Thuộc tính cố định chỉ áp dụng toàn track. Thuộc tính thay đổi theo frame chỉ cập nhật keyframe hiện có trong khoảng, kể cả keyframe Outside nhưng không đổi trạng thái Outside. Không tạo keyframe tại đầu/cuối khoảng. CVAT kế thừa giá trị sang các frame sau cho đến mốc đổi thuộc tính tiếp theo, nên giá trị có thể tiếp tục sau cuối khoảng chọn. Khoảng không có keyframe sẽ không được áp dụng. Giá trị input được kiểm tra theo định nghĩa label: select/radio, checkbox, number và text.

Bấm **Xem trước** để xem giá trị cũ/mới, sau đó **Áp dụng** mới ghi vào annotation trong bộ nhớ CVAT. Không có thao tác tải PCD, đổi bộ lọc hoặc tự nhảy frame trong batch. Chỉ gán attribute cần sửa; không gán hình học box và không thêm keyframe. Lịch sử Undo chuẩn của CVAT được sử dụng; có thể cần nhiều bước Undo cho một batch. Bấm Save trong CVAT để lưu, hoặc theo cấu hình Autosave của CVAT.

Nếu annotation/track/job thay đổi sau khi xem trước, cần xem trước lại. Track bị khóa hoặc ground truth không được sửa. Nếu ghi lỗi giữa chừng, hộp thoại báo số bước đã ghi; dùng Undo CVAT để hoàn tác phần đã áp dụng.

Kiểm thử chuyên biệt: `tests/fixtures/attribute_batch.html`.

## Cập nhật và kiểm tra

Extension không cần Node.js và không có bước build. Manifest nạp trực tiếp các file trong `src/` và `content/injector.js` theo đúng thứ tự phụ thuộc.

Sau khi sửa mã nguồn:

1. Mở `chrome://extensions`.
2. Bấm **Reload** trên extension.
3. Nhấn `Ctrl+Shift+R` trong tab CVAT.

Để kiểm tra bằng trình duyệt từ thư mục extension, mở `tests/fixtures/inspector_hotkeys.html` và `tests/fixtures/math.html`. Nếu chạy HTTP server tại root repo, dùng `chrome-extension/tests/fixtures/inspector_hotkeys.html` và `chrome-extension/tests/fixtures/math.html`. Hai trang chạy trực tiếp mã nguồn thật với dữ liệu trong bộ nhớ, không cần Node.js.

---

## 📖 Hướng Dẫn Thao Tác

1. Mở CVAT local trên trình duyệt Chrome (ví dụ: `http://localhost:8080` hoặc `http://127.0.0.1:8080`).
2. Mở một Job gán nhãn 3D Point Cloud.
3. Nút pill `[ ⏻ 3D ]` nằm khiêm tốn ở góc dưới bên phải màn hình:
   - Bấm `[ ⏻ 3D ]` hoặc nhấn **`Alt + Q`** để bật drawer kiểm định.
   - Nhấn **`Alt + Q`** hoặc nút `[ ⏻ UI ]` trên toolbar để tắt nhanh giao diện.
4. Chọn ID trong **lưới Đối tượng bên phải**; tìm nhanh bằng ID hoặc label ở ô search phía trên:
   - Search chỉ thu hẹp danh sách, chưa đổi bộ lọc. Bấm một ô ID để nạp frame của track đó; Enter/Tìm chọn ID chính xác hoặc kết quả duy nhất.
   - Switch **Chọn nhiều ID** mặc định tắt. Bật để chọn nhiều ID bằng checkbox; CVAT lọc theo tất cả ID đã chọn. Bấm tên ID để xem track đó trong framecard mà vẫn giữ nhóm đã chọn. Tắt switch giữ lại ID đang xem. **Bỏ chọn** khôi phục mọi object trên CVAT và làm trống Inspector.
   - Danh sách gồm các track cuboid trong annotation của job đang mở, kể cả track không tồn tại ở frame hiện tại; hiển thị ID và label. Không tải dữ liệu từ các job khác của task. Nút ↻ đọc lại danh sách khi thêm/xóa track hoặc đổi label.
   - Framecard, phím tắt và batch attribute chỉ chỉnh track đang xem. Click object trên CVAT hoặc mở lại UI không tự chọn/nạp object vào Inspector.
   - Bỏ chọn object hoặc chuyển qua đoạn Outside không xóa track đang kiểm tra. Chỉ tìm ID khác mới đổi object trong Inspector; đổi job sẽ xóa track cũ.
   - Mỗi frame hiển thị đầy đủ 3 góc chiếu Top, Front, Side kèm góc quay `Yaw: XX.X°` và kích thước.
5. Để chỉnh sửa một frame:
   - Bấm nút **`[ ✎ Sửa / Edit ]`** trên thẻ frame đó.
   - Sử dụng các nút tăng/giảm vị trí, kích thước hoặc xoay góc.
   - Quan sát các hạt point cloud di chuyển ăn khớp hoàn hảo vào viền bounding box trên cả 3 góc chiếu.
   - Thao tác tự động lưu vào RAM client của CVAT (0 request). Khi kiểm định xong, nhấn nút **Save** trên CVAT để lưu kết quả lên cơ sở dữ liệu.

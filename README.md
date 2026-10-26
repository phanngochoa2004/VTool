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
4. Chọn thư mục dự án:
   ```
   D:\Work\CVAT-module\CVAT-QAQC
   ```
   *(Nếu đã nạp phiên bản trước đó, chỉ cần bấm nút biểu tượng mũi tên tròn 🔄 Reload trên thẻ tiện ích).*

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

# ExifClean — Công Cụ Xóa Metadata Ảnh

Công cụ web **100% chạy trên trình duyệt** giúp xóa metadata (EXIF, IPTC, XMP, GPS) khỏi ảnh trước khi đăng lên mạng.

## Sử dụng

Click vào link GitHub Pages khi đã deploy:

```
https://<username>.github.io/<repo-name>/
```

hoặc chạy local:

```
python -m http.server 8899
# mở http://localhost:8899
```

## Tính năng

- Xóa toàn bộ EXIF/IPTC/XMP + tọa độ GPS, số seri máy ảnh, giờ chụp
- Nhận dạng & cảnh báo ảnh có GPS (kèm link bản đồ)
- Xử lý hàng loạt nhiều ảnh, tải về từng ảnh hoặc ZIP
- Xuất ra định dạng gốc / JPEG / WebP / PNG, chọn chất lượng
- Dữ liệu không bao giờ rời khỏi máy người dùng

## Cấu trúc

```
index.html                  # Trang chính (nguồn gốc: image_metadata_stripper.html)
vendor/                     # Thư viện tải local (tailwind, lucide, exifr, jszip, filesaver)
```

## Deploy lên GitHub Pages

1. Upload 3 mục (`index.html`, `vendor/`, file này) lên repo GitHub (công khai)
2. Vào repo → **Settings → Pages** → Source: **Deploy from a branch** → nhánh `main` → **Save**
3. Chờ 1–2 phút, truy cập link được cấp

> Lưu ý: file gốc `image_metadata_stripper.html` chỉ là bản local tham khảo — GitHub Pages phục vụ đúng file `index.html` (đã chuyển CDN sang vendor local).

## Bảo mật

100% client-side — ảnh được xử lý ngay trong RAM/trình duyệt, không gửi lên bất kỳ server nào.
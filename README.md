# Design Transfer 2

Đưa **design từ ảnh mẫu lên phôi áo/quần trắng** bằng AI, cho Kozmoz Studio (ECZ / Kozmoz / LO).

Cùng stack với `banner-ai` / `shoe-sale`: Vite + React + TS + Tailwind + Electron, gọi AI image-gen qua **OpenRouter**, **Google Gemini** (Nano Banana) hoặc **OpenAI** (GPT Image, gọi thẳng).

## Luồng dùng (2 ô upload bên trái)

| Ô | Ảnh | Vai trò với AI |
|---|-----|----------------|
| **1** | Ảnh tư liệu | Chủ thể/chất liệu thiết kế: xe, nhân vật, theme… → nguồn ý tưởng, **chủ thể + MÀU chủ đạo** của design |
| **2** | Ảnh phôi trắng | Áo/quần trơn → **canvas** để AI in design lên (giữ form, màu, nếp gấp, góc chụp) |

**Phong cách & bố cục: AI tự quyết** (không cần ảnh mẫu) — tham chiếu áo/quần đua, concept áo của các giải đua hiện hành (F1, MotoGP…), áo đua theo xe ở ảnh 1, và các mẫu áo HOT/bán chạy. AI tổng hợp thành thiết kế đua mới rồi in thực tế lên phôi ở ảnh 2. Kết quả là 1 ảnh mockup.

## Chạy nhanh (trình duyệt)

```bash
npm install
npm run dev        # mở http://127.0.0.1:5173
```

Lần đầu chạy app sẽ hỏi **API key** — chọn provider (OpenRouter / Gemini / OpenAI) và dán key. Key lưu trên máy (localStorage), không gửi đi đâu khác.

- OpenRouter key: https://openrouter.ai/keys
- Gemini key: https://aistudio.google.com/apikey
- OpenAI key: https://platform.openai.com/api-keys

## Chạy bản desktop (Electron)

```bash
npm run electron:dev      # dev
npm run dist:win          # build file .exe portable -> release/
```

## Ghi chú

- Đổi provider/model ngay trong app (nút **Đổi API Key** + dropdown **Model AI**). Model mặc định: 🍌 Nano Banana Pro — mạnh nhất cho việc ghép design lên phôi.
- Muốn nhúng sẵn key cho team nội bộ: copy `.env.example` → `.env` và điền key (xem hướng dẫn trong file).
- Ghi chú thêm (ô textarea) để chỉ định vị trí in, giữ màu, thêm chữ… AI sẽ tuân theo.

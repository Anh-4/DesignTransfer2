// ============================================================================
// gemini-runner.cjs — điều khiển Gemini web (gemini.google.com) bằng Playwright.
//
// Dùng TÀI KHOẢN GOOGLE (gói AI Pro/Ultra) để tạo ảnh bằng Nano Banana Pro
// -> đỡ tốn API. Chỉ thao tác như người dùng (click/fill/upload), KHÔNG gọi API nội bộ.
//
// - playwright-core + channel 'chrome', profile RIÊNG (đăng nhập 1 lần, nhớ mãi).
// - Login thì hiện cửa sổ; xong chạy NGẦM (cửa sổ đẩy off-screen — Google cũng chặn headless).
// - Hàng đợi -> các lần generate chạy tuần tự. Ảnh trả về app.
//
// ⚠️ UI Gemini hay đổi -> selector gom ở khối SEL.
// ============================================================================
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----------------------------- CONFIG (chỉnh ở đây) -------------------------
const GEMINI_URL = process.env.GEMINI_WEB_URL || 'https://gemini.google.com/app';
const RUN_HEADLESS = false; // Google chặn headless -> dùng cửa sổ off-screen (có icon taskbar nhưng chạy được)
const ALWAYS_VISIBLE = false; // true = luôn hiện cửa sổ (quan sát khi tạo ảnh); false = chạy ngầm (chỉ hiện khi login)

const SEL = {
  // Ô soạn câu lệnh (rich-textarea contenteditable).
  promptInput: [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  // Dấu hiệu CHƯA đăng nhập (Gemini bắt buộc login).
  signIn: ['a[href*="ServiceLogin"]', 'a[href*="signin"]', 'a:has-text("Sign in")', 'button:has-text("Sign in")', 'a:has-text("Đăng nhập")', 'button:has-text("Đăng nhập")'],
  // Nút "New chat" để bắt đầu cuộc mới (sạch ngữ cảnh).
  newChat: ['button[aria-label*="New chat" i]', 'a[aria-label*="New chat" i]', 'button[aria-label*="trò chuyện mới" i]', 'button:has-text("New chat")'],
  // Nút "Trò chuyện tạm thời" (Temporary chat) -> KHÔNG lưu lịch sử.
  tempChat: [
    '[aria-label*="tạm thời" i]',
    '[aria-label*="temporary chat" i]',
    '[aria-label*="temporary" i]',
    'button:has-text("Trò chuyện tạm thời")',
    'button:has-text("Temporary chat")',
  ],
  // Nút mở menu đổi model (aria-label thật: "Mở công cụ chọn chế độ, hiện tại là Flash").
  modelSwitcher: ['[aria-label*="chọn chế độ" i]', '[aria-label*="choose mode" i]', 'button[aria-label*="model" i]'],
  // Input file để upload ảnh (thường ẩn).
  fileInput: ['input[type="file"]'],
  // Nút "+" mở menu thêm tệp/ảnh.
  attachBtn: [
    'button[aria-label*="Thêm" i]',
    'button[aria-label*="tệp" i]',
    'button[aria-label*="Add files" i]',
    'button[aria-label*="Add" i]',
    'button[aria-label*="upload" i]',
    'button[aria-label*="attach" i]',
    'button[aria-label*="More" i]',
    'button:has-text("add")', // icon Material Symbols "add" (dấu +)
  ],
  // Mục "Tải tệp lên" trong menu "+".
  uploadMenuItem: [
    '[role="menuitem"]:has-text("Tải tệp lên")',
    '[role="menuitem"]:has-text("Tải tệp")',
    '[role="menuitem"]:has-text("Upload files")',
    'button:has-text("Tải tệp lên")',
    'button:has-text("Upload files")',
    '[role="menuitem"]:has-text("tệp")',
  ],
  // Nút gửi.
  sendBtn: ['button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]', 'button.send-button', 'button[mattooltip*="Send" i]'],
  // Ảnh kết quả trong câu trả lời (Gemini render ảnh sinh ra trong response).
  resultImage: [
    'img[src*="googleusercontent"]',
    'message-content img',
    'response-element img',
    'img[alt*="Generated" i]',
  ],
  // Nút tải ảnh (thanh công cụ hiện khi hover ảnh kết quả).
  downloadBtn: ['button[aria-label*="Tải xuống" i]', 'button[aria-label*="Download" i]', 'button[aria-label*="Tải" i]', '[aria-label*="Download" i]', 'a[download]'],
  // Nút mở/hiện panel danh sách cuộc trò chuyện (khi sidebar đang thu gọn).
  mainMenu: ['button[aria-label*="Menu chính" i]', 'button[aria-label*="Main menu" i]', 'button[aria-label*="mở trình đơn" i]', 'button[aria-label*="expand" i]'],
  // 1 mục cuộc trò chuyện trong sidebar (cuộc mới nhất nằm trên cùng).
  convItem: ['[data-test-id="conversation"]', '.conversation-items-container .conversation', '.conversation-list .conversation', 'div[role="listitem"]'],
  // Nút "Tùy chọn khác" (...) của 1 cuộc — hiện khi hover.
  convOptions: ['button[aria-label*="Tùy chọn khác" i]', 'button[aria-label*="More options" i]', 'button[aria-label*="tùy chọn" i]', 'button[aria-label*="options" i]'],
  // Mục "Xoá" trong menu của cuộc.
  deleteItem: ['[role="menuitem"]:has-text("Xoá")', '[role="menuitem"]:has-text("Xóa")', '[role="menuitem"]:has-text("Delete")', 'button:has-text("Xoá")', 'button:has-text("Delete")'],
  // Nút xác nhận trong hộp thoại xoá.
  deleteConfirm: ['[data-test-id="confirm-button"]', 'mat-dialog-container button:has-text("Xoá")', 'mat-dialog-container button:has-text("Delete")', 'button:has-text("Xoá")', 'button:has-text("Xóa")', 'button:has-text("Delete")'],
};

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const RESULT_TIMEOUT_MS = 4 * 60 * 1000;
const SLOW_MO_MS = 120;
const LOGIN_GRACE_MS = 8000; // đã đăng nhập rồi vẫn chờ chừng này để user kịp ĐỔI TÀI KHOẢN
const CLOSE_IDLE_MS = 6000;  // xong hết, hàng đợi rảnh -> tự đóng cửa sổ sau chừng này
// ---------------------------------------------------------------------------

let context = null;
let page = null;
let queue = Promise.resolve();
let closeTimer = null; // hẹn giờ tự đóng cửa sổ khi rảnh
const noop = () => {};

function cancelCloseTimer() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }
function scheduleCloseTimer(log) {
  cancelCloseTimer();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    log('Hoàn tất — tự đóng cửa sổ Chrome.');
    close().catch(() => {});
  }, CLOSE_IDLE_MS);
}

async function firstVisible(scope, candidates, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of candidates) {
      const loc = scope.locator(sel).first();
      try { if (await loc.isVisible()) return loc; } catch {}
    }
    await scope.waitForTimeout(300);
  }
  return null;
}

async function firstPresent(scope, candidates) {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    try { if (await loc.count()) return loc; } catch {}
  }
  return null;
}

/** ĐÃ đăng nhập = không ở accounts.google.com + KHÔNG còn chữ "Sign in" + có ô soạn. */
async function isLoggedIn() {
  if (page.url().includes('accounts.google.com')) return false;
  await page.waitForTimeout(1200); // chờ trang render nút Sign in / ô soạn
  // Logged-out: Gemini luôn có chữ "Sign in" (nút góc phải) hoặc "Sign in to try tools".
  try { if (await page.getByText(/sign\s*in/i).first().isVisible()) return false; } catch {}
  for (const sel of SEL.signIn) {
    try { if (await page.locator(sel).first().isVisible()) return false; } catch {}
  }
  return !!(await firstVisible(page, SEL.promptInput, 2500));
}

async function withRetry(label, fn, log, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      log(`[retry ${i}/${tries}] ${label}: ${e.message || e}`);
      if (page) await page.waitForTimeout(1000 * i);
    }
  }
  throw new Error(`${label} thất bại sau ${tries} lần: ${lastErr?.message || lastErr}`);
}

function writeTempImages(images) {
  const dir = path.join(os.tmpdir(), 'dt2-gemini');
  fs.mkdirSync(dir, { recursive: true });
  return images.map((im, i) => {
    const ext = (im.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const p = path.join(dir, `ref-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(im.base64, 'base64'));
    return p;
  });
}

/** Mở Chrome + profile riêng cho Gemini. visible=true để đăng nhập; false = chạy ngầm. */
async function ensureContext(profileDir, log, visible) {
  if (context) return;
  const wantVisible = visible || ALWAYS_VISIBLE; // (debug) ép hiện cửa sổ
  const headless = !wantVisible && RUN_HEADLESS;
  log(wantVisible ? 'Mở Chrome (hiện cửa sổ)…' : 'Chạy Gemini NGẦM (ẩn cửa sổ)…');
  fs.mkdirSync(profileDir, { recursive: true });
  const args = wantVisible
    ? ['--start-maximized', '--disable-blink-features=AutomationControlled']
    : ['--disable-blink-features=AutomationControlled',
       ...(headless ? [] : ['--window-position=-32000,-32000', '--window-size=1366,900'])];
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      viewport: null,
      acceptDownloads: true,
      slowMo: SLOW_MO_MS,
      chromiumSandbox: true,
      args,
      timeout: 45000,
    });
  } catch (e) {
    log(`❌ Mở Chrome thất bại: ${e.message || e}`);
    log('→ Nếu còn cửa sổ Chrome do app mở trước đó, hãy đóng nó rồi thử lại.');
    throw e;
  }
  page = context.pages()[0] || (await context.newPage());
  context.on('close', () => { context = null; page = null; });
}

/** Mở Gemini + đảm bảo đã đăng nhập. */
async function ensureGeminiReady(log, waitForLogin) {
  try {
    await page.bringToFront();
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`⚠️ Không mở được Gemini: ${e.message || e}`);
  }
  if (await isLoggedIn()) { log('Gemini sẵn sàng (đã đăng nhập).'); return; }

  if (!waitForLogin) {
    throw new Error('Phiên Gemini chưa đăng nhập hoặc đã hết hạn — chọn lại provider Gemini để đăng nhập.');
  }
  log('⚠️ Hãy ĐĂNG NHẬP Google trong cửa sổ Chrome. Đang chờ… (cửa sổ tự đóng khi xác nhận đã đăng nhập)');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isLoggedIn()) { log('✅ Đã xác nhận đăng nhập.'); return; }
    await page.waitForTimeout(2000);
  }
  throw new Error('Hết thời gian chờ đăng nhập Gemini.');
}

/** Chọn model trên Gemini web theo tên (khớp text trong menu). Bỏ qua nếu không thấy. */
async function selectModel(modelText, log) {
  if (!modelText) return;
  try {
    const sw = await firstVisible(page, SEL.modelSwitcher, 4000);
    if (!sw) { log(`Không thấy nút đổi model — dùng model mặc định (cần "${modelText}").`); return; }
    await sw.click();
    await page.waitForTimeout(500);
    const item = page.locator(
      `[role="menuitemradio"]:has-text("${modelText}"), [role="menuitem"]:has-text("${modelText}"), [role="option"]:has-text("${modelText}"), button:has-text("${modelText}")`
    ).first();
    if (await item.isVisible().catch(() => false)) { await item.click(); log(`Đã chọn model: ${modelText}`); }
    else { log(`Không thấy model "${modelText}" trong menu — dùng mặc định.`); await page.keyboard.press('Escape').catch(() => {}); }
  } catch (e) { log(`Bỏ qua chọn model: ${e.message || e}`); }
}

/** Lấy bounding box của ô soạn câu lệnh. */
async function getPromptBox() {
  for (const sel of SEL.promptInput) {
    try { const b = await page.locator(sel).first().boundingBox(); if (b) return b; } catch {}
  }
  return null;
}

/** Bấm nút "+": (a) selector -> (b) nút ngay bên trái ô soạn cùng hàng -> (c) toạ độ. */
async function clickPlusButton(log) {
  const bySel = await firstVisible(page, SEL.attachBtn, 4000);
  if (bySel) { await bySel.click(); log('Đã bấm "+" (selector).'); return true; }

  const okStruct = await page.evaluate((sels) => {
    const input = sels.map((s) => document.querySelector(s)).find(Boolean)
      || document.querySelector('[contenteditable="true"], textarea');
    if (!input) return false;
    const r = input.getBoundingClientRect();
    let best = null, bestDx = 1e9;
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const rb = b.getBoundingClientRect();
      if (!rb.width) continue;
      const sameRow = Math.abs((rb.top + rb.bottom) / 2 - (r.top + r.bottom) / 2) < 40;
      const dx = r.left - rb.right;
      if (sameRow && dx >= -12 && dx < bestDx) { bestDx = dx; best = b; }
    }
    if (best) { best.click(); return true; }
    return false;
  }, SEL.promptInput).catch(() => false);
  if (okStruct) { log('Đã bấm "+" (cấu trúc).'); return true; }

  const box = await getPromptBox();
  if (box) {
    const x = Math.max(8, box.x - 30), y = box.y + box.height / 2;
    log(`Bấm "+" theo toạ độ (${Math.round(x)}, ${Math.round(y)}).`);
    await page.mouse.click(x, y);
    return true;
  }
  return false;
}

/** Đính kèm ảnh vào ô soạn Gemini: input sẵn -> hoặc "+" -> "Tải tệp lên" (bắt cả file dialog). */
async function attachImages(imagePaths, log) {
  // 1) input[type=file] có sẵn?
  let input = await firstPresent(page, SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }

  // 2) Bấm nút "+" (selector -> cấu trúc -> toạ độ).
  if (!(await clickPlusButton(log))) {
    throw new Error('Không bấm được nút "+" để đính kèm.');
  }
  await page.waitForTimeout(800);

  // 3) Click "Tải tệp lên" -> bắt hộp chọn file (filechooser) hoặc input ẩn.
  const uploadItem = await firstVisible(page, SEL.uploadMenuItem, 5000);
  if (uploadItem) {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        uploadItem.click(),
      ]);
      await chooser.setFiles(imagePaths);
      log(`Đã đính kèm ${imagePaths.length} ảnh (hộp chọn file).`);
      return;
    } catch {
      input = await firstPresent(page, SEL.fileInput);
      if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }
    }
  }

  // 4) Fallback: input xuất hiện sau khi mở menu.
  input = await firstPresent(page, SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }
  throw new Error('Không tìm thấy cách đính kèm ảnh (nút "+"/Tải tệp lên).');
}

/**
 * Xoá ĐÚNG cuộc vừa tạo (cuộc mới nhất = item trên cùng sidebar) -> không lưu lịch sử.
 * An toàn cho tài khoản dùng chung: sau khi xoá kiểm tra URL đã rời convId.
 */
async function deleteCurrentChat(log) {
  try {
    const m = page.url().match(/\/app\/([\w-]{6,})/i);
    const convId = m ? m[1] : null;
    if (!convId) { log('Cuộc đang mở không có id (có thể là chat tạm thời) — bỏ qua xoá.'); return; }

    // Mở panel danh sách cuộc nếu đang thu gọn.
    if (!(await firstPresent(page, SEL.convItem))) {
      const menu = await firstVisible(page, SEL.mainMenu, 3000);
      if (menu) { await menu.click(); await page.waitForTimeout(1000); }
    }

    const items = page.locator(SEL.convItem.join(', '));
    const n = await items.count().catch(() => 0);
    if (!n) { log('Không thấy danh sách cuộc trong sidebar — bỏ qua xoá.'); return; }

    // Cuộc vừa tạo là cuộc MỚI NHẤT -> item đầu tiên.
    const first = items.first();
    await first.scrollIntoViewIfNeeded().catch(() => {});
    await first.hover().catch(() => {});
    await page.waitForTimeout(400);
    let opened = false;
    const opt = first.locator(SEL.convOptions.join(', ')).first();
    if (await opt.isVisible().catch(() => false)) { await opt.click(); opened = true; }
    else {
      // fallback: bấm nút cuối trong item (thường là "...").
      opened = await first.evaluate((el) => {
        const b = el.querySelectorAll('button'); if (!b.length) return false;
        b[b.length - 1].click(); return true;
      }).catch(() => false);
    }
    if (!opened) { log('Không mở được menu "..." của cuộc — bỏ qua xoá.'); return; }
    await page.waitForTimeout(500);

    const del = await firstVisible(page, SEL.deleteItem, 3000);
    if (!del) { log('Không thấy mục Xoá.'); await page.keyboard.press('Escape').catch(() => {}); return; }
    await del.click();
    await page.waitForTimeout(500);

    const cf = await firstVisible(page, SEL.deleteConfirm, 3000);
    if (cf) { await cf.click(); await page.waitForTimeout(1000); }
    else { log('Không thấy nút xác nhận Xoá.'); return; }

    // Xoá cuộc đang mở -> Gemini điều hướng rời convId. Nếu URL vẫn còn id -> cảnh báo.
    if (page.url().includes(convId)) log('⚠️ Đã bấm xoá nhưng URL vẫn còn cuộc — kiểm tra lại.');
    else log('Đã xoá cuộc trò chuyện (không lưu lịch sử).');
  } catch (e) { log('Xoá cuộc lỗi: ' + (e.message || e)); }
}

/** 1 lần tạo ảnh: chat mới -> chọn model -> đính kèm ảnh -> prompt -> gửi -> chờ ảnh -> tải về. */
async function generateOnce({ prompt, images, downloadDir, model }, log) {
  await ensureGeminiReady(log, false);
  // Vào TRÒ CHUYỆN TẠM THỜI để KHÔNG lưu lịch sử; không thấy thì chat thường rồi TỰ XOÁ sau khi tạo.
  let inTemp = false;
  try {
    const temp = await firstVisible(page, SEL.tempChat, 4000);
    if (temp) {
      await temp.click();
      await page.waitForTimeout(1200);
      inTemp = true;
      log('Đã vào Trò chuyện tạm thời (không lưu lịch sử).');
    } else {
      log('Không thấy nút Trò chuyện tạm thời — dùng chat thường rồi tự xoá sau khi tạo.');
      try {
        const labels = await page.locator('button, [role="button"]').evaluateAll((els) =>
          Array.from(new Set(els.filter((e) => e.getBoundingClientRect().width > 0)
            .map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))));
          fs.writeFileSync(path.join(downloadDir, 'gemini-buttons.txt'), labels.join('\n'));
      } catch {}
      const nc = await firstVisible(page, SEL.newChat, 3000); if (nc) await nc.click();
    }
  } catch {}
  await selectModel(model, log); // chọn model theo dropdown trong app (vd "3.1 Pro")

  const imagePaths = writeTempImages(images);
  try {
    await withRetry('Đính kèm ảnh', async () => {
      await attachImages(imagePaths, log);
      await page.waitForTimeout(2500); // chờ ảnh upload xong
    }, log);

    await withRetry('Nhập prompt', async () => {
      const box = await firstVisible(page, SEL.promptInput, 8000);
      if (!box) throw new Error('Không thấy ô soạn câu lệnh.');
      await box.scrollIntoViewIfNeeded().catch(() => {});
      await box.focus().catch(() => {});
      await box.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.keyboard.insertText(prompt);
      await page.waitForTimeout(300);
      let txt = ((await box.textContent().catch(() => '')) || '').trim();
      if (txt.length < 5) {
        await box.pressSequentially(prompt, { delay: 0 }).catch(() => {});
        await page.waitForTimeout(300);
        txt = ((await box.textContent().catch(() => '')) || '').trim();
      }
      if (txt.length < 5) throw new Error('Prompt chưa vào được ô soạn.');
      log(`Đã nhập prompt (${txt.length} ký tự).`);
    }, log);

    // Lưu src các ảnh LỚN hiện có (gồm thumbnail ảnh đính kèm) để phát hiện ảnh kết quả MỚI.
    const beforeSrcs = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((i) => { const r = i.getBoundingClientRect(); return r.width > 150 && r.height > 150; })
        .map((i) => i.currentSrc || i.src)
    ).catch(() => []);

    await withRetry('Gửi', async () => {
      const send = await firstVisible(page, SEL.sendBtn, 15000);
      if (send) { await send.click(); log('Đã bấm nút gửi.'); }
      else { await page.keyboard.press('Enter'); log('Đã gửi bằng Enter.'); }
    }, log);

    log('Đang chờ Gemini tạo ảnh…');
    // Chờ tới khi có ảnh LỚN src MỚI xuất hiện (khác mọi src trước khi gửi).
    const appeared = await page.waitForFunction(
      (before) => {
        const set = new Set(before);
        return [...document.querySelectorAll('img')].some((i) => {
          const r = i.getBoundingClientRect();
          const s = i.currentSrc || i.src;
          return r.width > 220 && r.height > 220 && s && !set.has(s);
        });
      },
      beforeSrcs,
      { timeout: RESULT_TIMEOUT_MS, polling: 2000 }
    ).catch(() => null);
    if (!appeared) throw new Error('Hết thời gian chờ ảnh kết quả từ Gemini.');
    await page.waitForTimeout(4000); // chờ Gemini hoàn tất (ảnh loading -> ảnh cuối)

    // Tìm LẠI phần tử ảnh kết quả TƯƠI (tránh tham chiếu cũ bị thay/detach).
    const freshHandle = await page.evaluateHandle((before) => {
      const set = new Set(before);
      let best = null, bestArea = 0;
      for (const i of document.querySelectorAll('img')) {
        const r = i.getBoundingClientRect();
        const s = i.currentSrc || i.src;
        const area = r.width * r.height;
        if (r.width > 200 && r.height > 200 && s && !set.has(s) && area > bestArea) { bestArea = area; best = i; } // ảnh mới LỚN NHẤT = kết quả
      }
      return best;
    }, beforeSrcs);
    const imgEl = freshHandle.asElement();
    if (!imgEl) throw new Error('Không tìm lại được ảnh kết quả.');
    const info = await imgEl.evaluate((e) => ({ tag: e.tagName, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), src: (e.currentSrc || e.src || '').slice(0, 90) })).catch(() => null);
    log('Ảnh phát hiện: ' + JSON.stringify(info));

    const outPath = await withRetry('Tải ảnh', async () => {
      const out = path.join(downloadDir, `gemini-${Date.now()}.png`);

      // 1) FETCH thẳng blob src (ảnh hiển thị là blob same-origin -> lấy được full data, không CORS).
      const src = await imgEl.evaluate((e) => e.currentSrc || e.src).catch(() => '');
      if (src) {
        try {
          const dataUrl = await page.evaluate(async (u) => {
            const r = await fetch(u); if (!r.ok) return null;
            const b = await r.blob();
            return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
          }, src);
          const b64 = dataUrl ? String(dataUrl).split(',')[1] : '';
          if (b64) { fs.writeFileSync(out, Buffer.from(b64, 'base64')); log('Đã tải ảnh qua src (blob).'); return out; }
        } catch (e) { log('fetch src lỗi: ' + (e.message || e)); }
      }

      // 2) HOVER ảnh kết quả -> bấm "Tải hình ảnh có kích thước đầy đủ xuống" (toolbar hover của ảnh inline).
      try {
        const DL_SEL = ['[aria-label*="kích thước đầy đủ" i]', '[aria-label*="full size" i]', '[aria-label*="full-size" i]'];
        await imgEl.scrollIntoViewIfNeeded().catch(() => {});
        await imgEl.hover().catch(() => {});
        await page.waitForTimeout(900);
        let dlBtn = await firstVisible(page, DL_SEL, 4000);
        if (!dlBtn) {
          // chưa thấy -> thử mở khung xem lớn rồi tìm lại
          await imgEl.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1500);
          dlBtn = await firstVisible(page, DL_SEL, 4000);
        }
        if (dlBtn) {
          const waitDl = page.waitForEvent('download', { timeout: 30000 });
          // click thường; nếu bị lớp nền (backdrop) chặn -> dispatch event để bỏ qua.
          try { await dlBtn.click({ timeout: 5000 }); }
          catch { await dlBtn.dispatchEvent('click'); }
          const dl = await waitDl.catch(() => null);
          if (dl) {
            await dl.saveAs(out);
            await page.keyboard.press('Escape').catch(() => {});
            log('Đã tải ảnh qua nút Tải xuống (full-size).');
            return out;
          }
          log('Đã bấm nút tải nhưng không có download event — thử cách khác.');
          await page.keyboard.press('Escape').catch(() => {});
        }
        // Không thấy nút -> ghi danh sách nút ra file để dò.
        try {
          const labels = await page.locator('button, [role="button"]').evaluateAll((els) =>
            Array.from(new Set(els.filter((e) => e.getBoundingClientRect().width > 0)
              .map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))));
          fs.writeFileSync(path.join(downloadDir, 'gemini-buttons.txt'), labels.join('\n'));
          log('Không thấy nút tải — đã ghi gemini-buttons.txt');
        } catch {}
        await page.keyboard.press('Escape').catch(() => {});
      } catch (e) { log('Tải nút lỗi: ' + (e.message || e)); await page.keyboard.press('Escape').catch(() => {}); }

      // 3) cuối cùng: chụp ĐÚNG KHUNG ảnh (clip theo bbox).
      const box = await imgEl.boundingBox();
      if (box) { await page.screenshot({ path: out, clip: box }); log('Đã tải ảnh qua chụp vùng ảnh (clip).'); return out; }
      await imgEl.screenshot({ path: out });
      log('Đã tải ảnh qua chụp phần tử (dự phòng).');
      return out;
    }, log);

    const buf = fs.readFileSync(outPath);
    log(`Xong: ${path.basename(outPath)} (${Math.round(buf.length / 1024)} KB)`);
    // Đã có ảnh rồi -> nếu là chat thường thì xoá để không lưu lịch sử (temp chat thì khỏi).
    if (!inTemp) { try { await deleteCurrentChat(log); } catch {} }
    return { base64: buf.toString('base64'), mimeType: 'image/png', path: outPath };
  } catch (e) {
    try {
      const shot = path.join(downloadDir, `gemini-debug-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      log(`📸 Lỗi "${e.message || e}" — đã lưu ảnh chụp: ${shot}`);
    } catch {}
    throw e;
  } finally {
    for (const p of imagePaths) { try { fs.unlinkSync(p); } catch {} }
  }
}

/** Đọc danh sách model trong menu đổi model của Gemini -> trả mảng tên (cho dropdown app). */
async function readModels(log) {
  try {
    const sw = await firstVisible(page, SEL.modelSwitcher, 5000);
    if (!sw) { log('Không thấy nút đổi model để đọc danh sách.'); return []; }
    await sw.click();
    await page.waitForTimeout(700);
    let items = await page.locator('[role="menuitemradio"]').allTextContents().catch(() => []);
    if (!items.length) items = await page.locator('[role="menuitem"], [role="option"]').allTextContents().catch(() => []);
    await page.keyboard.press('Escape').catch(() => {});
    const seen = new Set();
    const models = items.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !seen.has(t) && seen.add(t));
    log(`Model khả dụng: ${models.join(' | ') || '(trống)'}`);
    return models;
  } catch (e) { log(`Bỏ qua đọc model: ${e.message || e}`); return []; }
}

/**
 * Gọi khi chọn provider: đảm bảo đã đăng nhập (hiện cửa sổ nếu cần, đóng sau khi xác nhận),
 * rồi ĐỌC DANH SÁCH MODEL từ tài khoản -> trả về cho app hiển thị trong dropdown.
 */
function prepare(payload, log = noop) {
  cancelCloseTimer();
  const run = queue.then(async () => {
    cancelCloseTimer();
    // LUÔN mở cửa sổ (kể cả đã login) để user đăng nhập / ĐỔI TÀI KHOẢN; đóng context cũ trước.
    await close();
    await ensureContext(payload.profileDir, log, true); // hiện cửa sổ
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log('Cửa sổ đã mở — đăng nhập hoặc ĐỔI TÀI KHOẢN nếu muốn. Sẽ tự đóng sau khi xác nhận.');

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let confirmedSince = 0;
    while (Date.now() < deadline) {
      if (await isLoggedIn()) {
        if (!confirmedSince) { confirmedSince = Date.now(); log('Đã đăng nhập — chờ vài giây phòng khi bạn muốn đổi tài khoản…'); }
        if (Date.now() - confirmedSince >= LOGIN_GRACE_MS) break; // ổn định -> đóng
      } else {
        confirmedSince = 0; // đang đăng nhập/đổi tài khoản -> chờ tiếp
      }
      await page.waitForTimeout(1500);
    }

    if (confirmedSince) { log('✅ Xác nhận đăng nhập — đóng cửa sổ, từ giờ chạy NGẦM.'); await close(); }
    else log('Hết thời gian chờ đăng nhập — giữ cửa sổ mở để bạn tiếp tục.');
    return [];
  });
  queue = run.catch(() => []);
  return run;
}

/** API chính: tạo 1 ảnh NGẦM (xếp hàng đợi -> chạy tuần tự). Xong hết -> tự đóng cửa sổ. */
function generate(payload, log = noop) {
  cancelCloseTimer();
  const run = queue.then(async () => {
    cancelCloseTimer();
    try {
      await ensureContext(payload.profileDir, log, false);
      return await generateOnce({ prompt: payload.prompt, images: payload.images, downloadDir: payload.downloadDir, model: payload.model }, log);
    } finally {
      scheduleCloseTimer(log); // hết việc -> hẹn đóng; có việc mới sẽ huỷ hẹn
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function close() {
  try { await context?.close(); } catch {}
  context = null; page = null;
}

module.exports = { generate, prepare, close };

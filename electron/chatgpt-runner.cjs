// ============================================================================
// chatgpt-runner.cjs — điều khiển ChatGPT web (chatgpt.com) bằng Playwright.
//
// Dùng TÀI KHOẢN ChatGPT (Plus/Pro) đã đăng nhập để tạo ảnh -> đỡ tốn API.
// Chỉ thao tác như người dùng (click/fill/upload), KHÔNG gọi API nội bộ.
// Cùng khuôn với gemini-runner: login hiện cửa sổ -> chạy NGẦM (off-screen).
// Tạo trong Temporary chat -> KHÔNG lưu lịch sử.
//
// ⚠️ ChatGPT chặn bot mạnh (Cloudflare). UI hay đổi -> selector gom ở khối SEL.
// ============================================================================
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----------------------------- CONFIG (chỉnh ở đây) -------------------------
const CHATGPT_URL = process.env.CHATGPT_URL || 'https://chatgpt.com/';
// Tạo ảnh BÊN TRONG Project này -> chat gọn trong project, không loạn/xoá nhầm lịch sử chung
// (tài khoản dùng chung nhiều người). (Temp chat của ChatGPT không tạo được ảnh nên không dùng.)
const CHATGPT_PROJECT = process.env.CHATGPT_PROJECT || 'Anh4';
// URL project (goto thẳng -> chắc chắn vào đúng, không cần click). Cùng tài khoản chung -> cùng URL.
const CHATGPT_PROJECT_URL = process.env.CHATGPT_PROJECT_URL || 'https://chatgpt.com/g/g-p-6a3f80d395c081919e303a24cc21ec18-anh4/project';
const RUN_HEADLESS = false;   // ChatGPT/Cloudflare chặn headless -> dùng cửa sổ off-screen
const ALWAYS_VISIBLE = false; // true = luôn hiện cửa sổ (debug); false = chạy ngầm (chỉ hiện khi login)

const SEL = {
  // Ô soạn tin (ChatGPT dùng contenteditable #prompt-textarea).
  promptInput: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
  // Dấu hiệu CHƯA đăng nhập.
  signIn: ['[data-testid="login-button"]', '[data-testid="signup-button"]', 'button:has-text("Log in")', 'a:has-text("Log in")', 'button:has-text("Sign up")', 'button:has-text("Đăng nhập")'],
  // Input file để đính kèm ảnh (thường ẩn).
  fileInput: ['input[type="file"]'],
  // Nút "+" mở menu đính kèm.
  attachBtn: [
    'button[data-testid="composer-plus-btn"]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add photos" i]',
    'button[aria-label*="upload" i]',
    'button[aria-label*="đính kèm" i]',
    'button[aria-label*="Thêm" i]',
    'button:has-text("add")',
  ],
  // Mục "Upload from computer" / "Tải lên từ máy tính" trong menu "+".
  uploadMenuItem: [
    '[role="menuitem"]:has-text("Upload from computer")',
    '[role="menuitem"]:has-text("Tải lên từ máy tính")',
    '[role="menuitem"]:has-text("Add photos")',
    '[role="menuitem"]:has-text("Upload")',
    '[role="menuitem"]:has-text("Tải lên")',
  ],
  // Nút gửi.
  sendBtn: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]'],
  // Nút tải ảnh (hover ảnh kết quả).
  downloadBtn: ['[aria-label*="Download" i]', '[aria-label*="Tải xuống" i]', 'button[aria-label*="Tải" i]', 'a[download]'],
  // Mục Project trong sidebar — tên project là <div class="truncate">Anh4</div>.
  project: [
    `nav div.truncate:text-is("${CHATGPT_PROJECT}")`,
    `aside div.truncate:text-is("${CHATGPT_PROJECT}")`,
    `div.truncate:text-is("${CHATGPT_PROJECT}")`,
    `nav a:has-text("${CHATGPT_PROJECT}")`,
  ],
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

/** ĐÃ đăng nhập = không còn nút Log in/Sign up + có ô soạn tin. */
async function isLoggedIn() {
  if (/auth0|login|\/auth/.test(page.url())) return false;
  await page.waitForTimeout(1000);
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
  const dir = path.join(os.tmpdir(), 'dt2-chatgpt');
  fs.mkdirSync(dir, { recursive: true });
  return images.map((im, i) => {
    const ext = (im.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const p = path.join(dir, `ref-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(im.base64, 'base64'));
    return p;
  });
}

/** Mở Chrome + profile riêng cho ChatGPT. visible=true để đăng nhập; false = chạy ngầm. */
async function ensureContext(profileDir, log, visible) {
  if (context) return;
  const wantVisible = visible || ALWAYS_VISIBLE;
  const headless = !wantVisible && RUN_HEADLESS;
  log(wantVisible ? 'Mở Chrome (hiện cửa sổ)…' : 'Chạy ChatGPT NGẦM (ẩn cửa sổ)…');
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

/** Mở ChatGPT + đảm bảo đã đăng nhập. */
async function ensureChatReady(log, waitForLogin, url = CHATGPT_URL) {
  try {
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`⚠️ Không mở được ChatGPT: ${e.message || e}`);
  }
  if (await isLoggedIn()) { log('ChatGPT sẵn sàng (đã đăng nhập).'); return; }

  if (!waitForLogin) {
    throw new Error('Phiên ChatGPT chưa đăng nhập hoặc đã hết hạn — chọn lại provider ChatGPT để đăng nhập.');
  }
  log('⚠️ Hãy ĐĂNG NHẬP ChatGPT trong cửa sổ Chrome (gặp Cloudflare thì tự xác minh). Đang chờ…');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isLoggedIn()) { log('✅ Đã xác nhận đăng nhập.'); return; }
    await page.waitForTimeout(2000);
  }
  throw new Error('Hết thời gian chờ đăng nhập ChatGPT.');
}

/** Lấy bounding box của ô soạn tin. */
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

/** Đính kèm ảnh: input sẵn -> hoặc "+" -> "Upload from computer" (bắt cả file dialog). */
async function attachImages(imagePaths, log) {
  let input = await firstPresent(page, SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }

  if (!(await clickPlusButton(log))) throw new Error('Không bấm được nút "+" để đính kèm.');
  await page.waitForTimeout(800);

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

  input = await firstPresent(page, SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }
  throw new Error('Không tìm thấy cách đính kèm ảnh (nút "+"/Upload).');
}

/** Đã ở trong Project chưa? (URL project dạng /g/g-p-…) */
async function inProject() {
  return /\/g\/g-p-/i.test(page.url());
}

/** Vào Project "Anh4": goto THẲNG URL project (chắc nhất); click JS chỉ là dự phòng. */
async function openProject(log, downloadDir) {
  if (await inProject()) { log(`Đang ở Project "${CHATGPT_PROJECT}".`); return; }

  // 1) Goto thẳng URL project.
  try {
    await page.goto(CHATGPT_PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    if (await inProject()) { log(`✅ Đã vào Project "${CHATGPT_PROJECT}".`); return; }
  } catch (e) { log('Goto Project lỗi: ' + (e.message || e)); }

  // 2) Dự phòng: click JS (phòng khi URL project đổi).
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await page.evaluate((name) => {
      const t = [...document.querySelectorAll('div.truncate, span, a, div')].find((e) => (e.textContent || '').trim() === name);
      if (!t) return false;
      const c = t.closest('a,button,[role="button"],[role="link"]') || t.parentElement || t;
      c.click();
      return true;
    }, CHATGPT_PROJECT).catch(() => false);
    if (ok) {
      for (let w = 0; w < 6; w++) { await page.waitForTimeout(700); if (await inProject()) { log(`✅ Đã vào Project "${CHATGPT_PROJECT}" (click).`); return; } }
    }
    log(`Chưa vào được Project (lần ${attempt}/3), thử lại…`);
    await page.waitForTimeout(800);
  }
  log(`⚠️ Không vào được Project "${CHATGPT_PROJECT}" — tạo ở chat thường.`);
}

/** Xoá ĐÚNG hội thoại vừa tạo (theo id trong URL) -> không lưu lịch sử. An toàn cho tài khoản dùng chung. */
async function deleteCurrentChat(log) {
  try {
    const m = page.url().match(/\/c\/([\w-]{6,})/i); // id hội thoại đang mở
    const convId = m ? m[1] : null;
    if (!convId) { log('Chưa xác định được hội thoại để xoá — bỏ qua.'); return; }
    const item = page.locator(`nav a[href*="${convId}"]`).first();
    if (!(await item.count())) { log('Không thấy hội thoại trong sidebar — bỏ qua xoá.'); return; }
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await item.hover().catch(() => {});
    await page.waitForTimeout(500);
    // Bấm nút "..." — là nút CUỐI trong hàng của hội thoại (sau icon pin). Tìm theo cấu trúc.
    let clicked = await page.evaluate((cid) => {
      const a = document.querySelector(`nav a[href*="${cid}"]`);
      if (!a) return false;
      let row = a;
      for (let i = 0; i < 4 && row.parentElement; i++) {
        row = row.parentElement;
        const btns = row.querySelectorAll('button');
        if (btns.length) { btns[btns.length - 1].click(); return true; }
      }
      return false;
    }, convId).catch(() => false);
    if (!clicked) {
      const opt = await firstVisible(page, ['button[aria-label*="options" i]', 'button[aria-label*="tùy chọn" i]', 'button[aria-haspopup="menu"]'], 3000);
      if (opt) { await opt.click(); clicked = true; }
    }
    if (!clicked) { log('Không bấm được nút "..." của hội thoại.'); return; }
    await page.waitForTimeout(500);
    const del = await firstVisible(page, [
      '[role="menuitem"]:has-text("Delete")',
      '[role="menuitem"]:has-text("Xoá")',
      '[role="menuitem"]:has-text("Xóa")',
    ], 3000);
    if (!del) { log('Không thấy mục Delete.'); await page.keyboard.press('Escape').catch(() => {}); return; }
    await del.click();
    await page.waitForTimeout(500);
    const confirm = await firstVisible(page, [
      '[data-testid="delete-conversation-confirm-button"]',
      'button:has-text("Delete")',
      'button:has-text("Xoá")',
      'button:has-text("Xóa")',
    ], 3000);
    if (confirm) { await confirm.click(); log('Đã xoá hội thoại (không lưu lịch sử).'); }
    else log('Không thấy nút xác nhận Delete.');
  } catch (e) { log('Xoá hội thoại lỗi: ' + (e.message || e)); }
}

/**
 * Dọn Library: xoá ĐÚNG ảnh của mình — ảnh tạo (khớp id) + ảnh upload (khớp tên file).
 * Chỉ xoá item khớp chính xác id/tên -> an toàn cho tài khoản dùng chung.
 */
async function deleteFromLibrary(targets, log, downloadDir) {
  const list = (targets || []).filter(Boolean);
  if (!list.length) return;
  try {
    // Mở Library: click thử, rồi XÁC MINH URL /library — không thì goto thẳng.
    const lib = await firstVisible(page, [
      'nav a:has-text("Library")', 'a[href$="/library"]', 'nav a:has-text("Thư viện")', 'nav button:has-text("Library")',
    ], 4000);
    if (lib) await lib.click().catch(() => {});
    let onLib = false;
    for (let w = 0; w < 5; w++) { await page.waitForTimeout(600); if (/\/library/i.test(page.url())) { onLib = true; break; } }
    if (!onLib) {
      await page.goto('https://chatgpt.com/library', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    await page.waitForTimeout(2000);

    // Chuyển sang DẠNG DANH SÁCH (icon sprite #450c88).
    const listView = await firstVisible(page, ['button:has(use[href*="450c88"])'], 3000);
    if (listView) { await listView.click().catch(() => {}); await page.waitForTimeout(1000); }

    let deleted = 0;
    for (const t of list) {
      // Tìm ảnh khớp (id tạo trong src, hoặc tên file upload trong text) -> bấm "..." (#f6d0e2) của HÀNG đó.
      const opened = await page.evaluate((target) => {
        const isId = /^file[_-]/i.test(target);
        let cand = null;
        if (isId) cand = [...document.querySelectorAll('img')].find((im) => (im.currentSrc || im.src || '').includes(target));
        else cand = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').includes(target));
        if (!cand) return false;
        let row = cand;
        for (let k = 0; k < 8 && row; k++) {
          const u = row.querySelector('use[href*="f6d0e2"]');
          if (u && u.closest('button')) { u.closest('button').click(); return true; }
          const hp = row.querySelector('button[aria-haspopup="menu"], button[aria-label*="ptions"], button[aria-label*="More"]');
          if (hp) { hp.click(); return true; }
          row = row.parentElement;
        }
        return false;
      }, t).catch(() => false);
      if (!opened) { log(`Library: không thấy ảnh khớp "${String(t).slice(0, 28)}" — bỏ qua.`); continue; }
      await page.waitForTimeout(500);
      const del = await firstVisible(page, ['[role="menuitem"]:has-text("Delete")', '[role="menuitem"]:has-text("Xoá")', '[role="menuitem"]:has-text("Xóa")', 'button:has-text("Delete")'], 3000);
      if (!del) { log('Library: không thấy nút Delete trong menu.'); await page.keyboard.press('Escape').catch(() => {}); continue; }
      await del.click().catch(() => {});
      await page.waitForTimeout(500);
      const cf = await firstVisible(page, ['[data-testid*="confirm" i]', 'button:has-text("Delete")', 'button:has-text("Xoá")', 'button:has-text("Xóa")'], 2500);
      if (cf) await cf.click().catch(() => {});
      deleted++;
      await page.waitForTimeout(600);
    }
    log(`Library: đã xoá ${deleted}/${list.length} ảnh.`);
  } catch (e) { log('Dọn Library lỗi: ' + (e.message || e)); }
}

/** 1 lần tạo ảnh: vào Project -> đính kèm -> prompt -> gửi -> chờ ảnh -> tải về -> xoá hội thoại + dọn Library. */
async function generateOnce({ prompt, images, downloadDir }, log) {
  await ensureChatReady(log, false, CHATGPT_URL);
  await openProject(log, downloadDir); // vào Project "Anh4" để chat gọn trong project

  const imagePaths = writeTempImages(images);
  const uploadedNames = imagePaths.map((p) => path.basename(p)); // tên file upload -> dọn Library theo tên
  try {
    await withRetry('Đính kèm ảnh', async () => {
      await attachImages(imagePaths, log);
      await page.waitForTimeout(2500);
    }, log);

    await withRetry('Nhập prompt', async () => {
      const box = await firstVisible(page, SEL.promptInput, 8000);
      if (!box) throw new Error('Không thấy ô soạn tin.');
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

    log('Đang chờ ChatGPT tạo ảnh…');
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
    if (!appeared) throw new Error('Hết thời gian chờ ảnh kết quả từ ChatGPT.');
    await page.waitForTimeout(3000);

    // Lấy phần tử ảnh kết quả — THỬ LẠI vài lần (ảnh có thể đang render/đổi element).
    let imgEl = null;
    for (let i = 0; i < 6 && !imgEl; i++) {
      const h = await page.evaluateHandle((before) => {
        const set = new Set(before);
        let best = null, bestArea = 0;
        for (const im of document.querySelectorAll('img')) {
          const r = im.getBoundingClientRect();
          const s = im.currentSrc || im.src;
          const area = r.width * r.height;
          if (r.width > 180 && r.height > 180 && s && !set.has(s) && area > bestArea) { bestArea = area; best = im; }
        }
        return best;
      }, beforeSrcs);
      imgEl = h.asElement();
      if (!imgEl) { await page.waitForTimeout(1500); }
    }
    if (!imgEl) throw new Error('Không tìm lại được ảnh kết quả.');
    const info = await imgEl.evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), src: (e.currentSrc || e.src || '').slice(0, 90) })).catch(() => null);
    log('Ảnh phát hiện: ' + JSON.stringify(info));
    // id ảnh tạo (để dọn Library theo id).
    const genSrc = await imgEl.evaluate((e) => e.currentSrc || e.src).catch(() => '');
    const genId = (genSrc.match(/file[_-][a-z0-9]+/i) || [])[0] || null;

    const outPath = await withRetry('Tải ảnh', async () => {
      const out = path.join(downloadDir, `chatgpt-${Date.now()}.png`);

      // 1) fetch thẳng src (nếu same-origin/blob).
      const src = await imgEl.evaluate((e) => e.currentSrc || e.src).catch(() => '');
      if (src) {
        try {
          const dataUrl = await page.evaluate(async (u) => {
            const r = await fetch(u); if (!r.ok) return null;
            const b = await r.blob();
            return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
          }, src);
          const b64 = dataUrl ? String(dataUrl).split(',')[1] : '';
          if (b64) { fs.writeFileSync(out, Buffer.from(b64, 'base64')); log('Đã tải ảnh qua src.'); return out; }
        } catch (e) { log('fetch src lỗi: ' + (e.message || e)); }
      }

      // 2) hover ảnh -> nút Download.
      try {
        await imgEl.scrollIntoViewIfNeeded().catch(() => {});
        await imgEl.hover().catch(() => {});
        await page.waitForTimeout(900);
        let dlBtn = await firstVisible(page, SEL.downloadBtn, 4000);
        if (!dlBtn) { await imgEl.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); dlBtn = await firstVisible(page, SEL.downloadBtn, 4000); }
        if (dlBtn) {
          const waitDl = page.waitForEvent('download', { timeout: 30000 });
          try { await dlBtn.click({ timeout: 5000 }); } catch { await dlBtn.dispatchEvent('click'); }
          const dl = await waitDl.catch(() => null);
          if (dl) { await dl.saveAs(out); await page.keyboard.press('Escape').catch(() => {}); log('Đã tải ảnh qua nút Download.'); return out; }
          await page.keyboard.press('Escape').catch(() => {});
        }
        // ghi danh sách nút để dò selector nếu chưa trúng
        try {
          const labels = await page.locator('button, [role="button"]').evaluateAll((els) =>
            Array.from(new Set(els.filter((e) => e.getBoundingClientRect().width > 0)
              .map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))));
          fs.writeFileSync(path.join(downloadDir, 'chatgpt-buttons.txt'), labels.join('\n'));
        } catch {}
        await page.keyboard.press('Escape').catch(() => {});
      } catch (e) { log('Tải nút lỗi: ' + (e.message || e)); await page.keyboard.press('Escape').catch(() => {}); }

      // 3) chụp clip theo bbox.
      const box = await imgEl.boundingBox();
      if (box) { await page.screenshot({ path: out, clip: box }); log('Đã tải ảnh qua chụp vùng ảnh (clip).'); return out; }
      await imgEl.screenshot({ path: out });
      log('Đã tải ảnh qua chụp phần tử (dự phòng).');
      return out;
    }, log);

    const buf = fs.readFileSync(outPath);
    log(`Xong: ${path.basename(outPath)} (${Math.round(buf.length / 1024)} KB)`);
    const result = { base64: buf.toString('base64'), mimeType: 'image/png', path: outPath };
    await deleteCurrentChat(log); // xoá đúng hội thoại vừa tạo -> không lưu lịch sử
    await deleteFromLibrary([...uploadedNames, genId], log, downloadDir); // dọn Library: ảnh upload (tên) + ảnh tạo (id)
    return result;
  } catch (e) {
    try {
      const shot = path.join(downloadDir, `chatgpt-debug-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      log(`📸 Lỗi "${e.message || e}" — đã lưu ảnh chụp: ${shot}`);
    } catch {}
    throw e;
  } finally {
    for (const p of imagePaths) { try { fs.unlinkSync(p); } catch {} }
  }
}

/** Gọi khi chọn provider: đảm bảo đã đăng nhập (hiện cửa sổ nếu cần, đóng sau khi xác nhận). */
function prepare(payload, log = noop) {
  cancelCloseTimer();
  const run = queue.then(async () => {
    cancelCloseTimer();
    // LUÔN mở cửa sổ (kể cả đã login) để user đăng nhập / ĐỔI TÀI KHOẢN; đóng context cũ trước.
    await close();
    await ensureContext(payload.profileDir, log, true); // hiện cửa sổ
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log('Cửa sổ đã mở — đăng nhập hoặc ĐỔI TÀI KHOẢN nếu muốn. Sẽ tự đóng sau khi xác nhận.');

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let confirmedSince = 0;
    while (Date.now() < deadline) {
      if (await isLoggedIn()) {
        if (!confirmedSince) { confirmedSince = Date.now(); log('Đã đăng nhập — chờ vài giây phòng khi bạn muốn đổi tài khoản…'); }
        if (Date.now() - confirmedSince >= LOGIN_GRACE_MS) break;
      } else {
        confirmedSince = 0;
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
      return await generateOnce({ prompt: payload.prompt, images: payload.images, downloadDir: payload.downloadDir }, log);
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

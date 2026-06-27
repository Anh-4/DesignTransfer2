// ============================================================================
// flow-runner.cjs — điều khiển Google Flow bằng Playwright (Chrome thật của máy)
//
// NGUYÊN TẮC: chỉ thao tác như người dùng (click/fill/upload/keyboard), KHÔNG
// gọi API nội bộ của Flow. Tiêu Flow Credits của tài khoản đã đăng nhập.
//
// - Dùng playwright-core + channel 'chrome' -> KHÔNG tải Chromium riêng (.exe nhẹ).
// - Persistent context (profile cố định) -> đăng nhập Google 1 lần, lần sau tái dùng.
// - Headed (hiện cửa sổ) + thao tác chậm -> giống người thật, đỡ bị Google chặn.
// - 1 trang dùng lại, các lần generate chạy TUẦN TỰ (hàng đợi) dù app gọi song song.
//
// ⚠️ SELECTOR Flow hay đổi -> chỉnh tập trung ở khối CONFIG dưới đây.
// ============================================================================
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----------------------------- CONFIG (chỉnh ở đây) -------------------------
// URL Google Flow. ⚠️ Anh4 verify lại đúng URL khi chạy thật (có thể đổi).
const FLOW_URL = process.env.FLOW_URL || 'https://labs.google/fx/tools/flow';

// Mỗi mục là MẢNG ứng viên selector — thử lần lượt tới khi thấy cái tồn tại.
// Ưu tiên aria-label / role / text / placeholder (bền hơn XPath tuyệt đối).
const SEL = {
  // Dấu hiệu ĐÃ đăng nhập + giao diện sẵn sàng (ô nhập prompt).
  promptInput: [
    'textarea[placeholder*="prompt" i]',
    'textarea[aria-label*="prompt" i]',
    '[contenteditable="true"]',
    'textarea',
  ],
  // Dấu hiệu CHƯA đăng nhập.
  signIn: [
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'text=/đăng nhập/i',
  ],
  // Input file để upload ảnh tham chiếu (thường ẩn).
  fileInput: ['input[type="file"]'],
  // Nút mở khung thêm ảnh (nếu input file chưa có sẵn, click cái này trước).
  addImageBtn: [
    'button[aria-label*="ingredient" i]',
    'button[aria-label*="image" i]',
    'button[aria-label*="add" i]',
    'button:has-text("Add")',
  ],
  // Nút Generate / Tạo.
  generateBtn: [
    'button:has-text("Generate")',
    'button[aria-label*="generate" i]',
    'button:has-text("Tạo")',
    'button[aria-label*="create" i]',
  ],
  // Nút download trên ảnh kết quả.
  downloadBtn: [
    'button[aria-label*="download" i]',
    'button:has-text("Download")',
    '[aria-label*="download" i]',
  ],
  // Mục "4K" trong menu download (theo ảnh: 1K / 2K / 4K).
  fourK: [
    '[role="menuitem"]:has-text("4K")',
    'button:has-text("4K")',
    'text=/^\\s*4K/',
  ],
};

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;   // chờ user đăng nhập thủ công
const RESULT_TIMEOUT_MS = 4 * 60 * 1000;  // chờ Flow tạo xong ảnh
const SLOW_MO_MS = 120;                    // chậm như người thật

// ===== CHẾ ĐỘ ĐĂNG NHẬP =====
// false = BẢN CHUẨN: profile automation riêng, ĐĂNG NHẬP 1 LẦN rồi nhớ mãi. (DÙNG CÁI NÀY)
// true  = thử dùng profile Chrome cá nhân (copy). ĐÃ XÁC NHẬN KHÔNG MANG ĐƯỢC LOGIN:
//         Chrome 136 cấm debug profile mặc định + mã hoá App-Bound chặn copy cookie
//         -> bản copy vẫn bị đăng xuất. Để false.
const USE_PERSONAL_CHROME_PROFILE = false;

// (chỉ dùng khi USE_PERSONAL_CHROME_PROFILE = true) Thư mục User Data của Chrome.
const PERSONAL_USER_DATA_DIR = process.env.FLOW_USER_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');

// Chọn profile: ưu tiên env -> profile DÙNG GẦN NHẤT (đọc từ Local State) -> 'Default'.
function resolveProfileName(userDataDir) {
  if (process.env.FLOW_PROFILE_DIR) return process.env.FLOW_PROFILE_DIR;
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'));
    if (ls?.profile?.last_used) return ls.profile.last_used;           // profile mở/đóng sau cùng
    const active = ls?.profile?.last_active_profiles;
    if (Array.isArray(active) && active[0]) return active[0];
  } catch {}
  return 'Default';
}
// ---------------------------------------------------------------------------

let context = null;          // persistent context dùng lại giữa các lần
let page = null;             // 1 trang dùng lại
let queue = Promise.resolve(); // hàng đợi -> generate chạy tuần tự

const noop = () => {};

/** Tìm locator HIỂN THỊ đầu tiên khớp 1 trong các ứng viên (poll tới timeout). */
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

/** Tìm locator TỒN TẠI (kể cả ẩn, vd input file) đầu tiên. */
async function firstPresent(scope, candidates) {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    try { if (await loc.count()) return loc; } catch {}
  }
  return null;
}

/** Bọc retry cho 1 bước hay vỡ. */
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

/** Ghi base64 ra file tạm để upload; trả mảng đường dẫn. */
function writeTempImages(images) {
  const dir = path.join(os.tmpdir(), 'dt2-flow');
  fs.mkdirSync(dir, { recursive: true });
  return images.map((im, i) => {
    const ext = (im.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const p = path.join(dir, `ref-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(im.base64, 'base64'));
    return p;
  });
}

/** Copy 1 file/thư mục, bỏ qua nếu thiếu hoặc bị khoá (không làm vỡ tiến trình). */
function copySafe(src, dst, log) {
  try {
    if (!fs.existsSync(src)) return;
    fs.cpSync(src, dst, { recursive: true, force: true });
  } catch (e) {
    log(`  (bỏ qua ${path.basename(src)}: ${e.code || e.message})`);
  }
}

/**
 * Seed profile copy: copy cookie/login từ profile Chrome cá nhân sang 1 thư mục
 * NON-DEFAULT (lách luật Chrome 136 cấm debug trên thư mục mặc định). Chỉ copy 1 lần.
 * Đặt FLOW_REFRESH_COPY=1 để copy lại (làm mới login).
 */
function seedProfileCopy(copyRoot, log) {
  const srcRoot = PERSONAL_USER_DATA_DIR;
  const profileName = resolveProfileName(srcRoot);
  const srcProfile = path.join(srcRoot, profileName);
  const dstProfile = path.join(copyRoot, 'Default');

  if (process.env.FLOW_REFRESH_COPY) { try { fs.rmSync(copyRoot, { recursive: true, force: true }); } catch {} }

  const seeded = fs.existsSync(path.join(dstProfile, 'Preferences'))
    || fs.existsSync(path.join(dstProfile, 'Network', 'Cookies'))
    || fs.existsSync(path.join(dstProfile, 'Cookies'));
  if (seeded) { log(`Dùng lại profile đã copy: ${copyRoot}`); return; }

  log(`Copy login từ "${profileName}" sang thư mục riêng (1 lần)…`);
  log('⚠️ Lần copy đầu NÊN đóng Chrome để cookie copy đúng. Sau đó không cần đóng nữa.');
  fs.mkdirSync(dstProfile, { recursive: true });

  copySafe(path.join(srcRoot, 'Local State'), path.join(copyRoot, 'Local State'), log); // khoá giải mã cookie
  for (const it of ['Network', 'Cookies', 'Cookies-journal', 'Login Data', 'Web Data', 'Preferences', 'Secure Preferences', 'Local Storage']) {
    copySafe(path.join(srcProfile, it), path.join(dstProfile, it), log);
  }
  log('Copy xong.');
}

/** Mở Chrome (chỉ 1 lần) — profile cá nhân đã login, hoặc profile riêng cố định. */
async function ensureContext(profileDir, log) {
  if (context) return;

  const common = {
    channel: 'chrome',          // dùng Chrome đã cài trên máy
    headless: false,
    viewport: null,
    acceptDownloads: true,
    slowMo: SLOW_MO_MS,
    chromiumSandbox: true,      // bật sandbox -> bỏ cờ --no-sandbox (xoá banner cảnh báo)
  };

  let target, args;
  if (USE_PERSONAL_CHROME_PROFILE) {
    // CHẾ ĐỘ TẠM: Chrome 136+ cấm debug trên thư mục mặc định -> copy login sang
    // thư mục riêng (non-default) rồi chạy automation trên bản copy đó.
    const copyRoot = path.join(path.dirname(profileDir), 'flow-chrome-copy');
    seedProfileCopy(copyRoot, log);
    log('Mở Chrome trên profile ĐÃ COPY (đã có login)…');
    target = copyRoot;
    args = ['--start-maximized', '--disable-blink-features=AutomationControlled', '--profile-directory=Default'];
  } else {
    // BẢN CHUẨN: profile riêng, đăng nhập 1 lần rồi nhớ mãi.
    log('Mở Chrome (profile cố định)…');
    fs.mkdirSync(profileDir, { recursive: true });
    target = profileDir;
    args = ['--start-maximized', '--disable-blink-features=AutomationControlled'];
  }

  try {
    context = await chromium.launchPersistentContext(target, { ...common, args, timeout: 45000 });
  } catch (e) {
    log(`❌ Mở Chrome thất bại: ${e.message || e}`);
    log('→ Nếu còn cửa sổ Chrome do app mở trước đó đang chạy, hãy đóng nó rồi thử lại.');
    throw e;
  }

  page = context.pages()[0] || (await context.newPage());
  log(`✅ Chrome đã mở (${context.pages().length} tab). Bắt đầu điều hướng Flow…`);
  context.on('close', () => { context = null; page = null; });
}

/** Mở Flow + đảm bảo đã đăng nhập (nếu chưa, chờ user tự đăng nhập). */
async function ensureFlowReady(log) {
  log(`Đang mở Flow: ${FLOW_URL}`);
  try {
    await page.bringToFront();
    await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`⚠️ Không mở được Flow: ${e.message || e}`);
  }
  log(`Trang hiện tại: ${page.url()}`); // để biết goto có tới nơi không

  if (await firstVisible(page, SEL.promptInput, 5000)) { log('Flow sẵn sàng.'); return; }

  log('⚠️ Chưa thấy ô prompt — kiểm tra URL Flow đúng chưa / đã đăng nhập chưa. Đang chờ…');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await firstVisible(page, SEL.promptInput, 3000)) { log('Flow sẵn sàng.'); return; }
    await page.waitForTimeout(2000);
  }
  throw new Error('Hết thời gian chờ Flow sẵn sàng.');
}

/** Upload ảnh tham chiếu (input file ẩn -> set trực tiếp; nếu chưa có thì click nút Add). */
async function uploadImages(imagePaths, log) {
  await withRetry('Upload ảnh', async () => {
    let input = await firstPresent(page, SEL.fileInput);
    if (!input) {
      const addBtn = await firstVisible(page, SEL.addImageBtn, 5000);
      if (addBtn) await addBtn.click();
      input = await firstPresent(page, SEL.fileInput);
    }
    if (!input) throw new Error('Không tìm thấy ô upload ảnh.');
    await input.setInputFiles(imagePaths);
    log(`Đã upload ${imagePaths.length} ảnh.`);
    await page.waitForTimeout(1500); // chờ preview ảnh nạp xong
  }, log);
}

/** 1 lần tạo ảnh: lên trang -> upload -> prompt -> generate -> chờ -> tải 4K. */
async function generateOnce({ prompt, images, downloadDir }, log) {
  await ensureFlowReady(log);
  const imagePaths = writeTempImages(images);

  try {
    await uploadImages(imagePaths, log);

    await withRetry('Nhập prompt', async () => {
      const box = await firstVisible(page, SEL.promptInput, 8000);
      if (!box) throw new Error('Không thấy ô prompt.');
      await box.click();
      await box.fill('');
      await box.type(prompt, { delay: 8 });
    }, log);

    await withRetry('Bấm Generate', async () => {
      const gen = await firstVisible(page, SEL.generateBtn, 8000);
      if (!gen) throw new Error('Không thấy nút Generate.');
      await gen.click();
    }, log);

    log('Đang chờ Flow tạo ảnh…');
    const dl = await firstVisible(page, SEL.downloadBtn, RESULT_TIMEOUT_MS);
    if (!dl) throw new Error('Hết thời gian chờ kết quả (không thấy nút Download).');

    // Tải bản 4K: mở menu download -> chọn 4K -> bắt sự kiện download.
    const outPath = await withRetry('Tải 4K', async () => {
      await dl.click();
      const opt4k = await firstVisible(page, SEL.fourK, 4000);
      const waitDl = page.waitForEvent('download', { timeout: 90000 });
      if (opt4k) await opt4k.click(); // nếu không có menu, click download đã tự tải
      const download = await waitDl;
      const out = path.join(downloadDir, `flow-${Date.now()}.png`);
      await download.saveAs(out);
      return out;
    }, log);

    const buf = fs.readFileSync(outPath);
    log(`Xong: ${path.basename(outPath)} (${Math.round(buf.length / 1024)} KB)`);
    return { base64: buf.toString('base64'), mimeType: 'image/png', path: outPath };
  } finally {
    // dọn ảnh tạm
    for (const p of imagePaths) { try { fs.unlinkSync(p); } catch {} }
  }
}

/**
 * API chính: generate 1 ảnh. App gọi nhiều lần (mỗi mẫu 1 lần), nhưng các lần
 * được xếp HÀNG ĐỢI -> chạy tuần tự trên cùng 1 trang, không đụng nhau.
 */
function generate(payload, log = noop) {
  const run = queue.then(async () => {
    await ensureContext(payload.profileDir, log);
    return generateOnce({
      prompt: payload.prompt,
      images: payload.images,
      downloadDir: payload.downloadDir,
    }, log);
  });
  queue = run.catch(() => {}); // lỗi 1 lần không kẹt hàng đợi
  return run;
}

/**
 * Mở sẵn Chrome + vào Flow + chờ đăng nhập — gọi NGAY khi user chọn provider Flow,
 * không cần đợi tới lúc bấm Tạo. Xếp cùng hàng đợi để không đụng generate.
 */
function prepare(payload, log = noop) {
  const run = queue.then(async () => {
    await ensureContext(payload.profileDir, log);
    await ensureFlowReady(log);
    log('Flow sẵn sàng — có thể bấm Tạo.');
  });
  queue = run.catch(() => {});
  return run;
}

/** Đóng trình duyệt khi thoát app. */
async function close() {
  try { await context?.close(); } catch {}
  context = null; page = null;
}

module.exports = { generate, prepare, close };

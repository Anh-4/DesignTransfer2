import React, { useState, useEffect } from 'react';
import { Flow, MODELS_BY_PROVIDER, CUSTOM_MODEL_ID, Provider, DEFAULT_PROVIDER, getProviderInfo } from './flow-sdk';
import { SegmentedToggle, ZoomModal, Dropdown } from './components/Primitives';
import { ApiKeyModal } from './components/ApiKeyModal';
import { InputState, GeneratedResult, AspectRatio, MediaItem } from './types';

const NUM_OPTIONS = 2;

/** Ghép prompt chuyển design lên phôi từ 2 ảnh tham chiếu (theo đúng thứ tự truyền vào). */
function buildPrompt(notes: string, variant: number): string {
  const base = `You are a professional print-on-demand apparel mockup generator specialized in racing-style apparel.

You are given two reference images, in this EXACT order:
- IMAGE 1 — THEME & COLOR SOURCE: the motorsport theme, identity and color palette the new design must be based on (typically a vehicle/car or racing machine, but it may also be a character or team). Use it ONLY as inspiration for the theme, mood and — above all — the COLORS; it is NOT something to draw on the apparel. IMPORTANT — COLOR: take the DOMINANT color palette of the new design from this subject's real colors. If it is a vehicle/car, the car's main body color MUST be the leading, dominant color of the whole design. You may add a few tasteful accent/secondary colors, but that dominant color must clearly lead. NEVER paste, draw, render or depict the car/vehicle (or its photo) on the product — translate it into colors and motorsport theme only.
- IMAGE 2 — BLANK PRODUCT: a plain blank apparel product (e.g. a hoodie, jogger/pants, polo shirt or t-shirt). This is the canvas you print the design onto.

PRESERVE THE BLANK PRODUCT — CRITICAL: You may ONLY add a printed graphic on top of the existing blank product. You MUST NOT alter the product itself. Keep the EXACT SAME garment type, shape, silhouette, cut, collar, sleeves, fabric, base color, folds and wrinkles, and keep the EXACT SAME background/scene, lighting, shadows, pose and camera angle as IMAGE 2. Do NOT swap the garment for a different type (e.g. do not turn a polo into a t-shirt), do NOT redraw, reshape, recolor or replace the product, and do NOT change the background. The ONLY difference between IMAGE 2 and your output must be the newly printed design, applied so it follows the fabric's folds and curvature like a real print.

DESIGN STYLE — DECIDE IT YOURSELF (no style-reference image is provided). FIRST identify the GARMENT TYPE of the blank product in IMAGE 2, then design appropriately for that exact garment. Compose the layout, graphic placement, typography and art style on your own. PRIORITIZE referencing the actual apparel and outfits worn by current, popular, best-selling racing drivers; then also draw inspiration from:
- the design concepts of current, active racing series and their teams (e.g. F1, MotoGP, WEC, 24h Le Mans) — jerseys, team wear and race kits,
- popular, trending ("hot"), best-selling racing-apparel and driver merch designs,
- the motorsport theme and COLORS of IMAGE 1 (theme and colors only — never a picture of the car).

GARMENT-SPECIFIC GUIDANCE:
- HOODIE / JOGGER / PANTS: bolder, larger graphics work well — paneled racing graphics, all-over or large back/leg prints, in the spirit of full race-team kits.
- POLO SHIRT / T-SHIRT: design like the polos and t-shirts actually worn by racing drivers, by pit crew / paddock & logistics staff, and by official team & sponsor merchandise (e.g. McLaren, Aston Martin, Red Bull, WEC, 24h Le Mans). Use the tasteful, restrained placement typical of these shirts — a left-chest crest/logo, small sleeve accents, sponsor-style wordmarks and clean collar-appropriate styling — rather than one huge full-front print. Keep it clean and wearable like real team/sponsor apparel.

Synthesize these influences into a fresh, modern, market-ready racing-apparel design. Do NOT copy any single existing jersey, team kit or sponsor design 1:1 — create something new.

TASK: Create a brand-new graphic design themed on the subject of IMAGE 1, using that subject's colors (the car's body color) as the DOMINANT palette, in a racing-apparel style and layout that YOU compose and that suits the garment type in IMAGE 2, and print it realistically onto that blank product — as if it were truly screen-printed on it, following the fabric folds, curvature and lighting so the result looks like a real product photo.

STRICT RULES:
- COLOR PRIORITY: the design's dominant/primary color MUST come from the subject in IMAGE 1 (e.g. the car's color).
- NO VEHICLE IMAGERY: ABSOLUTELY do NOT put any image, photo, illustration or rendering of the car/vehicle onto the apparel. The car is a theme and color source ONLY. The printed design must look like real racing-driver apparel (livery-style stripes, team/sponsor wordmarks, crests, racing typography), inspired by what current, hot, best-selling drivers actually wear.
- PRINT ONLY: only add the design; never change the garment, its shape, or the background of IMAGE 2 (see "PRESERVE THE BLANK PRODUCT" above).
- The final image shows ONLY the product from IMAGE 2. Do NOT show IMAGE 1 anywhere in the output.
- Output ONE single high-resolution, photorealistic product mockup image.`;
  const variantHint = `\n\nThis is creative VARIATION #${variant + 1} of ${NUM_OPTIONS}. Make it visibly DIFFERENT from the other variations — vary the artwork's composition, framing, accent colors and graphic arrangement — but KEEP the subject's (car's) color as the dominant palette, and strictly obey every rule above.`;
  const extra = notes.trim()
    ? `\n\nADDITIONAL INSTRUCTIONS FROM USER (must also follow): "${notes.trim()}"`
    : '';
  return base + variantHint + extra;
}

// Version hiển thị: dùng define lúc build; nếu chưa thay (vd. dev) thì fallback an toàn
// (typeof trên biến chưa khai báo KHÔNG ném lỗi -> tránh trắng trang).
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

/** 1 ô upload (có số thứ tự, tiêu đề, mô tả; xem trước + xoá ảnh). */
const UploadBox: React.FC<{
  index: number;
  title: string;
  desc: string;
  image: MediaItem | null;
  onPick: () => void;
  onRemove: () => void;
  onZoom: (src: string) => void;
}> = ({ index, title, desc, image, onPick, onRemove, onZoom }) => {
  const src = image ? `data:${image.mimeType};base64,${image.base64}` : '';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#969696] text-black text-[11px] font-semibold shrink-0">
          {index}
        </span>
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold text-white leading-tight">{title}</span>
          <span className="text-[10px] text-white/40 leading-tight">{desc}</span>
        </div>
      </div>
      {image ? (
        <div className="relative rounded-xl overflow-hidden border border-white/10 aspect-[4/3] bg-[#141414]">
          <img
            src={src}
            className="w-full h-full object-contain cursor-zoom-in"
            onClick={() => onZoom(src)}
          />
          <button
            onClick={onRemove}
            className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center bg-black/60 hover:bg-black/80 rounded-full text-white transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      ) : (
        <button
          onClick={onPick}
          className="flex flex-col items-center justify-center gap-1 aspect-[4/3] rounded-xl border border-dashed border-[#595959] hover:border-[#969696] hover:bg-white/5 transition-colors text-white/40 hover:text-white/70"
        >
          <span className="material-symbols-outlined text-[26px]">add_photo_alternate</span>
          <span className="text-[10px] font-medium">Tải ảnh lên</span>
        </button>
      )}
    </div>
  );
};

/** 1 ô kết quả (1 trong 3 mẫu): loading / ảnh / lỗi / trống. */
const OptionCard: React.FC<{
  index: number;
  result: GeneratedResult | null;
  loading: boolean;
  error: string | null;
  onZoom: (src: string) => void;
  onDownload: (r: GeneratedResult) => void;
}> = ({ index, result, loading, error, onZoom, onDownload }) => {
  const src = result ? `data:${result.mimeType};base64,${result.base64}` : '';
  return (
    <div className="relative flex flex-col rounded-xl border border-white/10 bg-[#141414] overflow-hidden min-h-0">
      <div className="px-2.5 py-1.5 text-[10px] font-medium text-white/50 border-b border-white/10 flex items-center justify-between shrink-0">
        <span>Mẫu {index + 1}</span>
        {result && (
          <button
            onClick={() => onDownload(result)}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            Tải
          </button>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center p-2 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-white/40 animate-shimmer">
            <span className="material-symbols-outlined text-[28px]">apparel</span>
            <span className="text-[10px]">Đang tạo…</span>
          </div>
        ) : result ? (
          <img
            src={src}
            className="max-w-full max-h-full object-contain rounded-md cursor-zoom-in"
            onClick={() => onZoom(src)}
          />
        ) : error ? (
          <div className="text-[10px] text-red-400/80 text-center px-2 leading-relaxed">{error}</div>
        ) : (
          <span className="material-symbols-outlined text-[28px] text-white/15">imagesmode</span>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [inputs, setInputs] = useState<InputState>({
    sourceImage: null,
    blankImage: null,
    notes: '',
    aspectRatio: '1:1',
  });

  // 3 mẫu kết quả + lỗi từng mẫu + tập index đang tạo (chạy song song).
  const [results, setResults] = useState<(GeneratedResult | null)[]>(Array(NUM_OPTIONS).fill(null));
  const [slotErrors, setSlotErrors] = useState<(string | null)[]>(Array(NUM_OPTIONS).fill(null));
  const [loadingIndices, setLoadingIndices] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);

  // Đọc key đã lưu của một provider.
  const readKeyFor = (p: Provider): string => {
    try { return localStorage.getItem(getProviderInfo(p).storageKey) || ''; } catch { return ''; }
  };

  // Provider AI đang dùng (OpenRouter / Gemini) — chọn ở popup API key.
  const [provider, setProvider] = useState<Provider>(() => {
    try {
      const p = localStorage.getItem('AI_PROVIDER');
      return p === 'gemini' || p === 'openrouter' ? p : DEFAULT_PROVIDER;
    } catch { return DEFAULT_PROVIDER; }
  });

  // Model AI dùng để sinh ảnh (theo provider). 'Khác' -> nhập model ID thủ công.
  const [model, setModel] = useState<string>(MODELS_BY_PROVIDER[provider][0].id);
  const [customModel, setCustomModel] = useState('');

  // Đổi provider: đảm bảo model thuộc danh sách của provider mới.
  useEffect(() => {
    const list = MODELS_BY_PROVIDER[provider];
    setModel((cur) => (cur === CUSTOM_MODEL_ID || list.some((m) => m.id === cur) ? cur : list[0].id));
  }, [provider]);

  // Mỗi khi mở app: hiện popup nếu provider hiện tại chưa có key (env hoặc localStorage).
  useEffect(() => {
    const info = getProviderInfo(provider);
    const envKey = (import.meta as any).env?.[info.envKey];
    if (!envKey && !readKeyFor(provider)) setApiKeyModalOpen(true);
  }, []);

  // Inject style nền tối + scrollbar + hiệu ứng shimmer (giống các app khác của studio).
  useEffect(() => {
    if (document.getElementById('dt-app-styles')) return;
    const style = document.createElement('style');
    style.id = 'dt-app-styles';
    style.textContent = `
      html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; background: #0e0e0e; font-family: 'Google Sans Text', sans-serif; overflow: hidden; }
      .dark-scrollbar::-webkit-scrollbar { width: 4px; }
      .dark-scrollbar::-webkit-scrollbar-track { background: transparent; }
      .dark-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
      @keyframes shimmer { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }
      .animate-shimmer { animation: shimmer 1.5s infinite ease-in-out; }
    `;
    document.head.appendChild(style);
  }, []);

  const saveApiKey = (p: Provider, key: string) => {
    try {
      localStorage.setItem(getProviderInfo(p).storageKey, key);
      localStorage.setItem('AI_PROVIDER', p);
    } catch {}
    setProvider(p);
    setApiKeyModalOpen(false);
  };

  // Chọn ảnh cho 1 trong 3 ô.
  const pick = async (slot: keyof Pick<InputState, 'sourceImage' | 'blankImage'>) => {
    try {
      const m = await Flow.media.select({ filter: 'image' });
      setInputs((prev) => ({ ...prev, [slot]: { mediaId: m.mediaId, base64: m.base64, mimeType: m.mimeType } }));
    } catch {
      // người dùng huỷ chọn file -> bỏ qua
    }
  };

  const clearSlot = (slot: keyof Pick<InputState, 'sourceImage' | 'blankImage'>) =>
    setInputs((prev) => ({ ...prev, [slot]: null }));

  const loading = loadingIndices.size > 0;
  const canGenerate = !!(inputs.sourceImage && inputs.blankImage) && !loading;
  const hasOutput = loading || results.some(Boolean) || slotErrors.some(Boolean);

  const generate = () => {
    const src = inputs.sourceImage, blk = inputs.blankImage;
    if (!src || !blk) {
      setError('Cần đủ 2 ảnh: tư liệu (1) và phôi trắng (2).');
      return;
    }
    const effectiveModel = model === CUSTOM_MODEL_ID ? customModel.trim() : model;
    if (!effectiveModel) { setError('Hãy nhập Model ID khi chọn "Khác".'); return; }

    setError(null);
    setResults(Array(NUM_OPTIONS).fill(null));
    setSlotErrors(Array(NUM_OPTIONS).fill(null));
    setLoadingIndices(new Set(Array.from({ length: NUM_OPTIONS }, (_, i) => i)));

    // Thứ tự PHẢI là: tư liệu -> phôi trắng (prompt tham chiếu IMAGE 1/2).
    const refs = [src.mediaId, blk.mediaId];
    const notes = inputs.notes;
    const aspectRatio = inputs.aspectRatio;

    // Tạo 3 mẫu SONG SONG — mẫu nào xong hiện trước, lỗi 1 mẫu không chặn 2 mẫu kia.
    for (let i = 0; i < NUM_OPTIONS; i++) {
      const idx = i;
      const prompt = buildPrompt(notes, idx);
      Flow.generate.image({ prompt, model: effectiveModel, provider, referenceImageMediaIds: refs, aspectRatio })
        .then((out) => {
          setResults((prev) => {
            const next = [...prev];
            next[idx] = { id: out.mediaId, mediaId: out.mediaId, base64: out.base64, mimeType: out.mimeType, prompt };
            return next;
          });
        })
        .catch((e: any) => {
          setSlotErrors((prev) => {
            const next = [...prev];
            next[idx] = e?.message || 'Tạo ảnh thất bại.';
            return next;
          });
        })
        .finally(() => {
          setLoadingIndices((prev) => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        });
    }
  };

  const download = (r: GeneratedResult) => {
    const ext = (r.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
    Flow.download({ base64: r.base64, mimeType: r.mimeType, filename: `design-${Date.now()}.${ext}` });
  };

  const modelItems = [
    ...MODELS_BY_PROVIDER[provider].map((m) => ({ value: m.id, label: m.label })),
    { value: CUSTOM_MODEL_ID, label: 'Khác (nhập model ID)…' },
  ];

  return (
    <div className="flex h-screen w-screen bg-[#0e0e0e] text-white overflow-hidden">
      {/* ===== Panel trái: đầu vào ===== */}
      <aside className="w-[380px] shrink-0 h-full border-r border-white/10 flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-400">apparel</span>
            <h1 className="text-[14px] font-semibold">Design Transfer 2</h1>
          </div>
          <span className="text-[10px] text-white/30">v{APP_VERSION}</span>
        </header>

        <div className="flex-1 overflow-y-auto dark-scrollbar p-4 flex flex-col gap-4">
          <UploadBox
            index={1}
            title="Ảnh tư liệu"
            desc="Chủ thể/chất liệu: xe, nhân vật, theme…"
            image={inputs.sourceImage}
            onPick={() => pick('sourceImage')}
            onRemove={() => clearSlot('sourceImage')}
            onZoom={setZoomImage}
          />
          <UploadBox
            index={2}
            title="Ảnh phôi trắng"
            desc="Áo/quần trơn để AI in design lên"
            image={inputs.blankImage}
            onPick={() => pick('blankImage')}
            onRemove={() => clearSlot('blankImage')}
            onZoom={setZoomImage}
          />

          <div className="flex flex-col gap-1 w-full">
            <span className="text-[10px] text-white/40 ml-2 font-medium uppercase tracking-wider">Ghi chú thêm (tuỳ chọn)</span>
            <textarea
              value={inputs.notes}
              onChange={(e) => setInputs((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="VD: in chính giữa ngực áo, giữ nguyên màu áo, thêm tên đội bên dưới…"
              style={{ height: '80px' }}
              className="border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 resize-none bg-transparent text-[11px] font-medium text-white placeholder-[rgba(218,220,224,0.3)] tracking-[0.1px] focus:outline-none transition-colors dark-scrollbar"
            />
          </div>

          <SegmentedToggle
            label="Tỉ lệ ảnh"
            value={inputs.aspectRatio}
            items={[
              { value: '1:1', label: '1:1' },
              { value: '4:5', label: '4:5' },
              { value: '3:4', label: '3:4' },
              { value: '9:16', label: '9:16' },
            ]}
            onChange={(v: AspectRatio) => setInputs((prev) => ({ ...prev, aspectRatio: v }))}
          />

          <Dropdown
            label="Model AI"
            value={model}
            items={modelItems}
            onChange={setModel}
          />
          {model === CUSTOM_MODEL_ID && (
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="VD: google/gemini-2.5-flash-image"
              className="border border-[#595959] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 bg-transparent text-[11px] text-white placeholder-white/25 focus:outline-none transition-colors"
            />
          )}

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 leading-relaxed">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex flex-col gap-2">
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-2 h-[42px] rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-black text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">{loading ? 'progress_activity' : 'auto_awesome'}</span>
            {loading ? `Đang tạo ${NUM_OPTIONS} mẫu…` : `Tạo ${NUM_OPTIONS} mẫu lên phôi`}
          </button>
          <button
            onClick={() => setApiKeyModalOpen(true)}
            className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
          >
            Provider: <span className="text-white/60">{getProviderInfo(provider).label}</span> · Đổi API Key
          </button>
        </div>
      </aside>

      {/* ===== Panel phải: 3 mẫu kết quả ===== */}
      <main className="flex-1 h-full flex flex-col min-w-0">
        {hasOutput ? (
          <>
            <div className="px-5 pt-4 pb-1 text-[11px] text-white/40">
              Chọn mẫu ưng ý → bấm <span className="text-amber-400">Tải</span> ở góc mỗi mẫu. Bấm vào ảnh để phóng to.
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3 p-4 pt-2 min-h-0">
              {Array.from({ length: NUM_OPTIONS }, (_, i) => (
                <OptionCard
                  key={i}
                  index={i}
                  result={results[i]}
                  loading={loadingIndices.has(i)}
                  error={slotErrors[i]}
                  onZoom={setZoomImage}
                  onDownload={download}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-white/25 max-w-[340px] text-center">
              <span className="material-symbols-outlined text-[44px]">imagesmode</span>
              <span className="text-[13px] leading-relaxed">
                Tải đủ 2 ảnh bên trái rồi bấm <span className="text-white/50">Tạo {NUM_OPTIONS} mẫu lên phôi</span>. AI sẽ tạo {NUM_OPTIONS} mẫu để Anh4 chọn.
              </span>
            </div>
          </div>
        )}
      </main>

      <ApiKeyModal
        isOpen={apiKeyModalOpen}
        required={!readKeyFor(provider) && !(import.meta as any).env?.[getProviderInfo(provider).envKey]}
        provider={provider}
        getKeyFor={readKeyFor}
        onSave={saveApiKey}
        onClose={() => setApiKeyModalOpen(false)}
      />
      <ZoomModal isOpen={!!zoomImage} imageSrc={zoomImage || ''} onClose={() => setZoomImage(null)} />
    </div>
  );
}

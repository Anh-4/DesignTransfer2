import React, { useEffect, useState } from 'react';
import { PillButton, Dropdown } from './Primitives';
import { Provider, availableProviders, getProviderInfo } from '../flow-sdk';

/**
 * Popup chọn nhà cung cấp (OpenRouter / Gemini) và nhập/đổi API key.
 * Mỗi provider lưu key riêng trong localStorage (đổi provider không mất key cũ).
 */
export const ApiKeyModal: React.FC<{
  isOpen: boolean;
  required: boolean;                 // chưa có key cho provider đang chọn -> bắt buộc nhập
  provider: Provider;                // provider đang dùng
  getKeyFor: (p: Provider) => string; // đọc key đã lưu của 1 provider
  onSave: (provider: Provider, key: string) => void;
  onClose: () => void;
}> = ({ isOpen, required, provider, getKeyFor, onSave, onClose }) => {
  const [selProvider, setSelProvider] = useState<Provider>(provider);
  const [val, setVal] = useState('');
  const [show, setShow] = useState(false);

  // Mỗi lần mở popup: đồng bộ provider + key đang lưu của provider đó.
  useEffect(() => {
    if (isOpen) {
      setSelProvider(provider);
      setVal(getKeyFor(provider));
    }
  }, [isOpen, provider]);

  if (!isOpen) return null;

  const info = getProviderInfo(selProvider);
  const canClose = !required;

  // Đổi provider trong dropdown -> nạp key đã lưu của provider mới.
  const changeProvider = (p: string) => {
    const np = p as Provider;
    setSelProvider(np);
    setVal(getKeyFor(np));
  };

  const save = () => {
    if (info.noKey) { onSave(selProvider, ''); return; } // provider không cần key (vd Google Flow)
    const k = val.trim();
    if (!k) return;
    onSave(selProvider, k);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-6"
      onClick={() => canClose && onClose()}
    >
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" />
      <div
        className="relative w-full max-w-[420px] bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-amber-400">key</span>
          <h2 className="text-[15px] font-semibold text-white">API Key</h2>
        </div>

        <Dropdown
          label="Nhà cung cấp"
          value={selProvider}
          items={availableProviders().map((p) => ({ value: p.id, label: p.label }))}
          onChange={changeProvider}
        />

        {info.noKey ? (
          // Provider điều khiển web (Google Flow): không cần key, dùng đăng nhập trình duyệt.
          <p className="text-[11px] text-white/50 leading-relaxed">
            <span className="text-white/80">{info.label}</span> không dùng API key. App sẽ mở
            một cửa sổ Chrome để bạn <span className="text-white/80">đăng nhập Google một lần</span>,
            rồi tự thao tác trên{' '}
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-amber-400 underline">
              {info.keyUrl.replace(/^https?:\/\//, '')}
            </a>{' '}
            để tạo ảnh — tiêu Flow Credits của tài khoản đó. Chỉ chạy trên bản desktop.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-white/50 leading-relaxed">
              App dùng key của bạn để tạo ảnh qua <span className="text-white/80">{info.label}</span> (cho mọi model). Lấy key tại{' '}
              <a
                href={info.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 underline"
              >
                {info.keyUrl.replace(/^https?:\/\//, '')}
              </a>
              . Key chỉ lưu trên máy bạn.
            </p>

            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder={`Dán API key ${info.label} vào đây...`}
                autoFocus
                className="w-full border border-[#595959] focus:border-amber-400 rounded-xl px-3 py-2.5 pr-10 bg-transparent text-[12px] text-white placeholder-white/25 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {show ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {canClose && (
            <PillButton variant="outline" onClick={onClose}>
              Đóng
            </PillButton>
          )}
          <PillButton variant="solid" onClick={save}>
            Lưu &amp; dùng
          </PillButton>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center px-2">
    <span className="text-[11px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px] normal-case">
      {children}
    </span>
  </div>
);

export const PillButton: React.FC<{
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'filled' | 'outline' | 'solid';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ icon, children, variant = 'filled', onClick, disabled, className = '' }) => {
  const base = 'flex items-center gap-[2px] justify-center h-[34px] rounded-xl font-medium tracking-[0.1px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    filled: 'bg-[#969696] hover:bg-[#a6a6a6] active:bg-[#868686] text-black text-[11px] px-4 py-1 select-none',
    outline: 'border border-[#595959] hover:bg-white/5 active:bg-white/10 backdrop-blur-[40px] text-[12px] px-4 py-2 text-white select-none',
    solid: 'bg-white hover:bg-gray-200 active:bg-gray-300 text-black text-[12px] px-4 py-2 select-none',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="flex items-center justify-center w-6 h-6">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};

export const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ label, value, onChange, placeholder, rows = 2 }) => (
  <div className="flex flex-col gap-1 w-full">
    <span className="text-[10px] text-white/40 ml-2 font-medium uppercase tracking-wider">{label}</span>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ height: rows * 25 + 25 + 'px' }}
      className="border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl w-full px-3 py-2.5 resize-none bg-transparent text-[11px] font-medium text-white placeholder-[rgba(218,220,224,0.3)] tracking-[0.1px] focus:outline-none transition-colors dark-scrollbar"
    />
  </div>
);

export const SegmentedToggle: React.FC<{
  value: string;
  items: { value: string; label: string; icon?: React.ReactNode }[];
  onChange: (val: any) => void;
  label?: string;
}> = ({ value, items, onChange, label }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <span className="text-[10px] text-white/40 ml-2 font-medium uppercase tracking-wider">{label}</span>}
    <div className="flex w-full items-center border border-[#595959] rounded-xl overflow-hidden bg-transparent">
      {items.map((item) => (
        <button key={item.value} type="button" onClick={() => onChange(item.value)}
          className={`flex-1 flex items-center justify-center gap-1 h-[34px] px-3 py-2 text-[11px] font-medium tracking-[0.1px] transition-all cursor-pointer ${
            value === item.value ? 'bg-[#969696] text-black' : 'text-[rgba(218,220,224,0.75)] hover:text-white hover:bg-white/5'
          }`}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </div>
  </div>
);

export const Dropdown: React.FC<{
  label?: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (val: string) => void;
}> = ({ label, value, items, onChange }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <span className="text-[10px] text-white/40 ml-2 font-medium uppercase tracking-wider">{label}</span>}
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-[40px] appearance-none border border-[#595959] hover:border-[#7a7a7a] focus:border-[#969696] rounded-xl pl-3 pr-9 bg-[#141414] text-[12px] font-medium text-white tracking-[0.1px] focus:outline-none transition-colors cursor-pointer"
      >
        {items.map((it) => (
          <option key={it.value} value={it.value} className="bg-[#141414] text-white">{it.label}</option>
        ))}
      </select>
      <span className="material-symbols-outlined text-[18px] text-white/40 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
    </div>
  </div>
);

export const ZoomModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
}> = ({ isOpen, onClose, imageSrc }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12" onClick={onClose}>
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />
      <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <img src={imageSrc} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  );
};

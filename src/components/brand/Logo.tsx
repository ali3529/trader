/** لوگوی تریدبان: کندل‌استیک درون سپر — SVG درون‌خطی برای هدر و صفحه تنظیمات */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="لوگوی تریدبان">
      <defs>
        <linearGradient id="tb-shield" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10B981" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
      <path
        d="M24 3 L41 9 V24 C41 34 33.5 41.5 24 45 C14.5 41.5 7 34 7 24 V9 L24 3 Z"
        fill="#0B1220"
        stroke="url(#tb-shield)"
        strokeWidth="2.5"
      />
      {/* کندل نزولی */}
      <line x1="17" y1="13" x2="17" y2="33" stroke="#F43F5E" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="14" y="18" width="6" height="10" rx="1.5" fill="#F43F5E" />
      {/* کندل صعودی */}
      <line x1="31" y1="10" x2="31" y2="31" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="28" y="14" width="6" height="12" rx="1.5" fill="#10B981" />
      {/* خط روند صعودی */}
      <path d="M12 34 L24 27 L36 19" stroke="url(#tb-shield)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
    </svg>
  );
}

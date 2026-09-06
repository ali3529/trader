/** پس‌زمینه تزئینی هدر: کندل‌های محو و خطوط حمایت/مقاومت روی سرمه‌ای تیره */
export function HeaderBanner() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 1200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="1200" height="200" fill="#0B1220" />
      {/* خطوط افقی سطوح */}
      {[40, 85, 130, 170].map((y, i) => (
        <line key={y} x1="0" y1={y} x2="1200" y2={y} stroke={i % 2 ? "#0D9488" : "#10B981"} strokeWidth="1" opacity="0.08" />
      ))}
      {/* کندل‌های محو */}
      {Array.from({ length: 30 }, (_, i) => {
        const x = 20 + i * 40;
        const up = i % 3 !== 0;
        const h = 30 + ((i * 37) % 70);
        const y = 100 - h / 2 + ((i * 13) % 30) - 15;
        return (
          <g key={i} opacity="0.10">
            <line x1={x} y1={y - 12} x2={x} y2={y + h + 12} stroke={up ? "#10B981" : "#F43F5E"} strokeWidth="2" />
            <rect x={x - 5} y={y} width="10" height={h} rx="2" fill={up ? "#10B981" : "#F43F5E"} />
          </g>
        );
      })}
      {/* درخشش ملایم */}
      <ellipse cx="950" cy="60" rx="220" ry="90" fill="#10B981" opacity="0.05" />
      <ellipse cx="200" cy="150" rx="200" ry="80" fill="#0D9488" opacity="0.05" />
    </svg>
  );
}

/** تصویر حالت خالی: ذره‌بین در حال پایش آرام نمودار بدون سیگنال */
export function EmptyOpportunities({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 240 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* کندل‌های کم‌رمق */}
      {[
        { x: 30, y: 95, h: 34, up: false },
        { x: 55, y: 88, h: 40, up: true },
        { x: 80, y: 92, h: 30, up: false },
        { x: 105, y: 84, h: 44, up: true },
        { x: 130, y: 90, h: 36, up: false },
        { x: 155, y: 86, h: 42, up: true },
      ].map((c, i) => (
        <g key={i} opacity="0.55">
          <line x1={c.x} y1={c.y - 14} x2={c.x} y2={c.y + c.h + 14} stroke={c.up ? "#10B981" : "#F43F5E"} strokeWidth="2.5" strokeLinecap="round" />
          <rect x={c.x - 7} y={c.y} width="14" height={c.h} rx="3" fill={c.up ? "#10B981" : "#F43F5E"} opacity="0.8" />
        </g>
      ))}
      {/* خط افقی پایش */}
      <line x1="14" y1="150" x2="226" y2="150" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
      {/* ذره‌بین */}
      <g transform="translate(148,18)">
        <circle cx="38" cy="38" r="30" stroke="#10B981" strokeWidth="6" fill="#0F172A" opacity="0.95" />
        <circle cx="38" cy="38" r="30" stroke="#14B8A6" strokeWidth="2" fill="none" opacity="0.4" />
        <line x1="60" y1="60" x2="82" y2="82" stroke="#10B981" strokeWidth="8" strokeLinecap="round" />
        <path d="M26 42 L34 34 L42 40 L52 28" stroke="#64748B" strokeWidth="3" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

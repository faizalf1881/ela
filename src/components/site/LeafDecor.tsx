export function Leaf({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 100 140" className={className} style={style} aria-hidden="true">
      <path d="M50 5 C15 30, 10 90, 50 135 C90 90, 85 30, 50 5 Z" fill="currentColor" opacity="0.9" />
      <path d="M50 10 L50 130" stroke="rgba(0,0,0,0.15)" strokeWidth="1" fill="none" />
      {[25, 45, 65, 85, 105].map((y) => (
        <g key={y} stroke="rgba(0,0,0,0.12)" strokeWidth="1" fill="none">
          <path d={`M50 ${y} Q30 ${y + 8}, 18 ${y + 20}`} />
          <path d={`M50 ${y} Q70 ${y + 8}, 82 ${y + 20}`} />
        </g>
      ))}
    </svg>
  );
}

export function FloatingLeaves() {
  const leaves = [
    { top: "10%", left: "6%", size: 60, delay: "0s", rotate: -20, opacity: 0.15 },
    { top: "20%", right: "8%", size: 90, delay: "1.5s", rotate: 25, opacity: 0.12 },
    { top: "55%", left: "3%", size: 70, delay: "3s", rotate: 40, opacity: 0.18 },
    { top: "70%", right: "5%", size: 55, delay: "2s", rotate: -15, opacity: 0.14 },
    { top: "35%", left: "48%", size: 40, delay: "4s", rotate: 60, opacity: 0.1 },
  ] as const;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {leaves.map((l, i) => (
        <div
          key={i}
          className="absolute animate-float-leaf text-forest"
          style={{
            top: l.top,
            left: "left" in l ? (l as { left?: string }).left : undefined,
            right: "right" in l ? (l as { right?: string }).right : undefined,
            width: l.size,
            height: l.size * 1.4,
            opacity: l.opacity,
            transform: `rotate(${l.rotate}deg)`,
            animationDelay: l.delay,
          }}
        >
          <Leaf className="h-full w-full" />
        </div>
      ))}
    </div>
  );
}

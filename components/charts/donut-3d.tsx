"use client";

type Slice = {
  name: string;
  value: number;
  color: string;
  soft: string;
};

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  start: number,
  end: number,
) {
  const large = end - start > 180 ? 1 : 0;
  const os = polar(cx, cy, outer, start);
  const oe = polar(cx, cy, outer, end);
  const is = polar(cx, cy, inner, end);
  const ie = polar(cx, cy, inner, start);
  return [
    `M ${os.x} ${os.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${is.x} ${is.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${ie.x} ${ie.y}`,
    "Z",
  ].join(" ");
}

export function Donut3D({
  successful,
  failed,
}: {
  successful: number;
  failed: number;
}) {
  const total = successful + failed;
  if (total <= 0) return null;

  const slices: Slice[] = [
    { name: "Successful", value: successful, color: "#2563eb", soft: "#60a5fa" },
    { name: "Failed", value: failed, color: "#f43f5e", soft: "#fb7185" },
  ].filter((s) => s.value > 0);

  // Continuous ring — no angular gaps between segments.
  let cursor = 0;
  const segments = slices.map((slice, index) => {
    const sweep = (slice.value / total) * 360;
    const start = cursor;
    // Keep a hairline join without a visible empty wedge.
    const end = index === slices.length - 1 ? 360 : cursor + sweep;
    cursor = end;
    return { ...slice, start, end };
  });

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 86;
  const inner = 58;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
          <defs>
            {segments.map((s) => (
              <linearGradient
                key={`grad-${s.name}`}
                id={`donut-2d-${s.name}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor={s.soft} />
                <stop offset="100%" stopColor={s.color} />
              </linearGradient>
            ))}
            <filter id="donut-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* Track ring */}
          <circle
            cx={cx}
            cy={cy}
            r={(outer + inner) / 2}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={outer - inner}
          />

          <g filter="url(#donut-soft-shadow)">
            {segments.map((s) => (
              <path
                key={s.name}
                d={arcPath(cx, cy, inner, outer, s.start, s.end)}
                fill={`url(#donut-2d-${s.name})`}
                stroke="none"
              />
            ))}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-semibold tracking-tight text-slate-900">{total}</div>
          <div className="text-xs font-medium text-slate-500">Total tasks</div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
          Successful {successful}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f43f5e]" />
          Failed {failed}
        </span>
      </div>
    </div>
  );
}

import { useCallback, useRef } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (v: number) => void;
  label: string;
  color?: string;
  size?: number;
  format?: (v: number) => string;
}

export function Knob({
  value,
  min,
  max,
  defaultValue,
  onChange,
  label,
  color = '#6b7280',
  size = 54,
  format,
}: KnobProps) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const range = max - min;
  const normalized = (value - min) / range;
  const angle = -135 + normalized * 270;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startVal: value };
    },
    [value],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - e.clientY;
      const sensitivity = range * 0.005;
      const newVal = Math.max(min, Math.min(max, dragRef.current.startVal + dy * sensitivity));
      onChange(newVal);
    },
    [min, max, range, onChange],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const handleDoubleClick = useCallback(() => onChange(defaultValue), [defaultValue, onChange]);
  const display = format ? format(value) : value.toFixed(2);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        className="relative cursor-grab active:cursor-grabbing"
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <svg width={size} height={size} viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="26" fill="none" stroke="#2a2d38" strokeWidth="3" />
          <circle
            cx="30"
            cy="30"
            r="26"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${normalized * 122} 200`}
            transform="rotate(135 30 30)"
            style={{ transition: 'stroke-dasharray 0.05s' }}
          />
          <circle cx="30" cy="30" r="20" fill="#1b1d24" stroke="#0a0b0e" strokeWidth="1.5" />
          <circle cx="30" cy="30" r="18" fill="#22252e" />
          <line
            x1="30"
            y1="30"
            x2="30"
            y2="14"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            transform={`rotate(${angle} 30 30)`}
          />
          <circle cx="30" cy="30" r="3" fill="#4b5563" />
        </svg>
      </div>
      <span className="text-[9px] font-mono text-rbox-dim uppercase tracking-wider">{label}</span>
      <span className="text-[10px] font-mono" style={{ color }}>
        {display}
      </span>
    </div>
  );
}

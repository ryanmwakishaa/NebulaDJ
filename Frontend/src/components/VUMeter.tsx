import { useEffect, useRef } from 'react';

interface VUMeterProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  volume: number;
  width?: number;
  height?: number;
  orientation?: 'vertical' | 'horizontal';
}

export function VUMeter({
  analyser,
  isPlaying,
  volume,
  height = 56,
  orientation = 'vertical',
}: VUMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser) return;
    let raf = 0;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(buffer);
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, rect.width, rect.height);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) sum += buffer[i];
          const avg = sum / buffer.length / 255;
          const level = isPlaying ? Math.min(1, avg * 2.5 * volume) : 0;
          const segments = 16;
          if (orientation === 'vertical') {
            const segH = rect.height / segments;
            for (let i = 0; i < segments; i++) {
              const lit = level * segments > i;
              ctx.fillStyle = lit
                ? i > segments * 0.8
                  ? '#ef4444'
                  : i > segments * 0.55
                    ? '#fbbf24'
                    : '#22c55e'
                : '#1b1d24';
              ctx.fillRect(0, rect.height - (i + 1) * segH + 1, rect.width, segH - 2);
            }
          } else {
            const segW = rect.width / segments;
            for (let i = 0; i < segments; i++) {
              const lit = level * segments > i;
              ctx.fillStyle = lit
                ? i > segments * 0.8
                  ? '#ef4444'
                  : i > segments * 0.55
                    ? '#fbbf24'
                    : '#22c55e'
                : '#1b1d24';
              ctx.fillRect(i * segW + 1, 0, segW - 2, rect.height);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, isPlaying, volume, height, orientation]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height }}
      className="rounded bg-rbox-panel2"
    />
  );
}

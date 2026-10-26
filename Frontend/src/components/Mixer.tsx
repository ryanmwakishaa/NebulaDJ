import { Volume2, Headphones, Crosshair } from 'lucide-react';
import { useDJStore } from '@/store/djStore';
import { useAutoDJ } from '@/store/autoDJStore';

export function Mixer() {
  const dj = useDJStore();
  const auto = useAutoDJ();
  const { crossfade, masterVolume } = dj;

  // Amber ring + AUTO tag while the Auto-DJ is moving the crossfader
  const xDriven = auto.running && auto.driving.includes('xfade');

  return (
    <div className="flex flex-col bg-rbox-panel rounded-xl border border-rbox-line shadow-inset-deep w-[170px] shrink-0">
      {/* Header */}
      <div className="px-3 py-2 bg-rbox-panel2 border-b border-rbox-line rounded-t-xl flex items-center justify-between">
        <span className="text-sm font-display tracking-wider text-rbox-dim">MIXER</span>
        {auto.running && (
          <span className="px-1.5 py-0.5 text-[8px] font-mono rounded bg-rbox-amber/15 text-rbox-amber border border-rbox-amber/40">
            AUTO
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 p-3 flex-1">
        {/* Master volume */}
        <div className="w-full bg-rbox-panel2 rounded-lg p-2 border border-rbox-line">
          <div className="flex items-center gap-2 mb-1.5">
            <Volume2 size={13} className="text-rbox-dim" />
            <span className="text-[10px] font-mono text-rbox-dim tracking-wider">MASTER</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="dj-fader"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '8px', height: '80px' }}
              min={0} max={1} step={0.01}
              value={masterVolume}
              onChange={(e) => dj.setMasterVolume(parseFloat(e.target.value))}
            />
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: 12 }).map((_, i) => {
                const lit = masterVolume * 12 > i + 1;
                return (
                  <div
                    key={i}
                    className="w-1.5 h-2 rounded-sm"
                    style={{
                      background: lit ? (i > 9 ? '#ef4444' : i > 6 ? '#fbbf24' : '#22c55e') : '#1b1d24',
                      boxShadow: lit ? `0 0 4px ${i > 9 ? '#ef4444' : i > 6 ? '#fbbf24' : '#22c55e'}` : 'none',
                    }}
                  />
                );
              })}
            </div>
          </div>
          <div className="text-center text-[9px] font-mono text-rbox-text mt-1">
            {Math.round(masterVolume * 100)}
          </div>
        </div>

        {/* Headphone cue (visual indicator) */}
        <div className="w-full bg-rbox-panel2 rounded-lg p-2 border border-rbox-line flex items-center gap-2">
          <Headphones size={13} className="text-rbox-dim" />
          <span className="text-[10px] font-mono text-rbox-dim tracking-wider">CUE</span>
          <div className="flex gap-1 ml-auto">
            <span className="px-1.5 py-0.5 text-[8px] font-mono rounded bg-deck-a/20 text-deck-a border border-deck-a/40">A</span>
            <span className="px-1.5 py-0.5 text-[8px] font-mono rounded bg-deck-b/20 text-deck-b border border-deck-b/40">B</span>
          </div>
        </div>

        {/* Crossfader */}
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1.5 mb-3">
            <Crosshair size={13} className="text-rbox-dim" />
            <span className="text-[10px] font-mono text-rbox-dim tracking-wider">CROSSFADER</span>
          </div>

          <div className="flex items-center justify-between w-full px-1 mb-1">
            <span className="text-sm font-display text-deck-a">A</span>
            <span
              className="text-[9px] font-mono"
              style={{ color: crossfade < 0.48 ? '#2dd4bf' : crossfade > 0.52 ? '#fb7185' : '#6b7280' }}
            >
              {crossfade < 0.48 ? '◀ A' : crossfade > 0.52 ? 'B ▶' : 'CENTER'}
            </span>
            <span className="text-sm font-display text-deck-b">B</span>
          </div>

          <div
            className={`relative w-full px-2 py-4 bg-rbox-panel2 rounded-lg border border-rbox-line transition-shadow ${
              xDriven ? 'ring-1 ring-rbox-amber/80 shadow-[0_0_10px_rgba(251,191,36,0.35)]' : ''
            }`}
          >
            <input
              type="range"
              className="dj-cross w-full"
              min={0} max={1} step={0.01}
              value={crossfade}
              onChange={(e) => dj.setCrossfade(parseFloat(e.target.value))}
            />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-7 bg-rbox-dim/40 pointer-events-none" />
          </div>

          <div className="w-full mt-2 flex items-center justify-between text-[8px] font-mono text-rbox-dim">
            <span>{Math.round((1 - crossfade) * 100)}</span>
            <span>POWER</span>
            <span>{Math.round(crossfade * 100)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
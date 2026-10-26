import { Play, Square, Loader2, Radio } from 'lucide-react';
import { useAutoDJ } from '@/store/autoDJStore';
import { useAIStore } from '@/store/aiStore';

const FADE_OPTIONS = [8, 16, 24, 32];

export function AutoDJControls() {
  const currentSet = useAIStore((s) => s.currentSet);
  const { running, phase, message, queue, index, liveDeck, fadeSeconds, setFadeSeconds, start, stop } =
    useAutoDJ();

  if (!currentSet) return null;

  const busy = phase === 'loading' || phase === 'preparing';
  const nowPlaying = running ? queue[index] : undefined;

  return (
    <div className="bg-rbox-panel2/60 rounded-lg border border-rbox-amber/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={14} className={running ? 'text-rbox-amber pulse-glow' : 'text-rbox-dim'} />
          <span className="text-xs font-semibold text-rbox-text">AUTO-DJ</span>
          {running && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-rbox-amber/15 text-rbox-amber border border-rbox-amber/30">
              {phase === 'fading' ? 'MIXING' : 'LIVE'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-rbox-dim">FADE</span>
          <select
            value={fadeSeconds}
            onChange={(e) => setFadeSeconds(Number(e.target.value))}
            disabled={running}
            className="text-[10px] font-mono bg-rbox-panel3 text-rbox-text border border-rbox-line rounded px-1 py-0.5 disabled:opacity-50"
          >
            {FADE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
        </div>
      </div>

      {nowPlaying && (
        <div className="text-[10px] font-mono text-rbox-dim truncate">
          <span style={{ color: liveDeck === 'A' ? '#2dd4bf' : '#fb7185' }}>DECK {liveDeck}</span>
          {' · '}
          <span className="text-rbox-text">{nowPlaying.track.title}</span>
          {' · '}
          {index + 1}/{queue.length}
        </div>
      )}

      {message && (
        <div
          className={`text-[10px] font-mono truncate ${phase === 'error' ? 'text-rbox-red' : 'text-rbox-dim'}`}
        >
          {message}
        </div>
      )}

      {running ? (
        <button
          onClick={stop}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-rbox-red/15 border border-rbox-red/40 text-rbox-red text-xs font-mono hover:bg-rbox-red/25 transition-all"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />} Stop Auto-DJ
        </button>
      ) : (
        <button
          onClick={() => void start()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-gradient-to-r from-deck-a/20 to-deck-b/20 border border-rbox-amber/40 text-rbox-amber text-xs font-mono hover:from-deck-a/30 hover:to-deck-b/30 transition-all"
        >
          <Play size={13} /> Play this set automatically
        </button>
      )}
    </div>
  );
}
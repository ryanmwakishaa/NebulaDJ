import { Play, Pause, Square, Music2, ArrowLeftRight, Disc3, Clock } from 'lucide-react';
import { useDJStore } from '@/store/djStore';
import { useAutoDJ } from '@/store/autoDJStore';
import type { DeckId } from '@/types';
import { Knob } from './Knob';
import { VUMeter } from './VUMeter';
import { formatTime } from '@/lib/format';

interface DeckPanelProps {
  deck: DeckId;
}

export function DeckPanel({ deck }: DeckPanelProps) {
  const dj = useDJStore();
  const auto = useAutoDJ();
  const state = dj.decks[deck];
  const accent = deck === 'A' ? '#2dd4bf' : '#fb7185';
  const { track, isPlaying, isReady, volume, rate, positionSec, durationSec, eqHigh, eqMid, eqLow, filter, bpm } = state;

  const analyser = dj.getAnalyser(deck);

  const handleLoadClick = () => {
    dj.setPendingDeck(deck);
    window.dispatchEvent(new Event('nebula:open-library')); // un-collapse the library if it's hidden
  };

  // ---- Auto-DJ indicators ----
  // A control gets an amber ring while the Auto-DJ is moving it.
  const driven = (control: string) => auto.running && auto.driving.includes(`${deck}.${control}`);
  const driveClass = (control: string) =>
    driven(control) ? 'ring-1 ring-rbox-amber/80 shadow-[0_0_10px_rgba(251,191,36,0.35)]' : '';
  const autoRole = auto.running ? (auto.liveDeck === deck ? 'AUTO · LIVE' : 'AUTO · NEXT') : null;

  return (
    <div className="flex flex-col bg-rbox-panel rounded-xl border border-rbox-line shadow-inset-deep overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-rbox-panel2 border-b border-rbox-line">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-display tracking-wider" style={{ color: accent }}>
            DECK {deck}
          </span>
          <span
            className={`px-1.5 py-0.5 text-[9px] font-mono rounded ${isPlaying ? 'pulse-glow' : ''}`}
            style={{
              background: isPlaying ? accent + '22' : '#22252e',
              color: isPlaying ? accent : '#6b7280',
              border: `1px solid ${isPlaying ? accent + '55' : '#2a2d38'}`,
            }}
          >
            {isPlaying ? 'PLAYING' : isReady ? 'PAUSED' : track ? 'LOADING' : 'EMPTY'}
          </span>
          {autoRole && (
            <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-rbox-amber/15 text-rbox-amber border border-rbox-amber/40">
              {autoRole}
            </span>
          )}
        </div>
        {track && (
          <button
            onClick={handleLoadClick}
            className="text-[10px] font-mono text-rbox-dim hover:text-rbox-text transition-colors flex items-center gap-1 px-2 py-1 rounded border border-rbox-line hover:border-rbox-dim"
          >
            <Music2 size={11} /> EJECT
          </button>
        )}
      </div>

      <div className="flex flex-row gap-3 p-3">
        {/* Left: Artwork + Vinyl + Transport */}
        <div className="flex flex-col items-center gap-2 w-[170px] shrink-0">
          {/* Album artwork / vinyl */}
          <div className="relative w-[150px] h-[150px] flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle at 50% 50%, #1b1d24, #0a0b0e)',
                border: `2px solid ${isPlaying ? accent + '66' : '#2a2d38'}`,
                boxShadow: isPlaying
                  ? `0 0 20px ${accent}33, inset 0 0 30px rgba(0,0,0,0.8)`
                  : 'inset 0 0 30px rgba(0,0,0,0.8)',
                transition: 'border-color 0.3s, box-shadow 0.3s',
              }}
            />
            {track?.artwork_url ? (
              <img
                src={track.artwork_url}
                alt={track.title}
                className={`w-[130px] h-[130px] rounded-full object-cover ${isPlaying ? 'spin-33' : ''}`}
                style={{ animationDuration: `${2.0 / rate}s` }}
                crossOrigin="anonymous"
              />
            ) : (
              <div
                className={`w-[130px] h-[130px] rounded-full flex items-center justify-center ${isPlaying ? 'spin-33' : ''}`}
                style={{
                  background: `repeating-radial-gradient(circle at 50% 50%, #111 0px, #111 1px, #1a1a1a 2px, #1a1a1a 3px)`,
                  animationDuration: `${2.0 / rate}s`,
                }}
              >
                <div
                  className="w-[50px] h-[50px] rounded-full flex items-center justify-center"
                  style={{
                    background: `radial-gradient(circle, ${accent}33, #0a0b0e)`,
                    border: `1px solid ${accent}44`,
                  }}
                >
                  {track ? (
                    <Disc3 size={20} style={{ color: accent }} />
                  ) : (
                    <span className="text-[10px] font-display" style={{ color: accent }}>{deck}</span>
                  )}
                </div>
              </div>
            )}
            {/* spindle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-gray-500 z-10" />
          </div>

          {/* Transport buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => dj.cue(deck)}
              className="w-9 h-9 rounded-lg bg-rbox-panel3 border border-rbox-line hover:border-rbox-red hover:text-rbox-red text-rbox-dim flex items-center justify-center transition-colors"
              title="Cue"
            >
              <Square size={14} fill="currentColor" />
            </button>
            <button
              onClick={() => dj.togglePlay(deck)}
              disabled={!track}
              className="w-12 h-12 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: isPlaying
                  ? `linear-gradient(135deg, ${accent}33, ${accent}11)`
                  : '#22252e',
                border: `1px solid ${isPlaying ? accent : '#2a2d38'}`,
                color: isPlaying ? accent : '#9ca3af',
                boxShadow: isPlaying ? `0 0 12px ${accent}44` : 'none',
              }}
              title="Play / Pause"
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button
              onClick={() => dj.sync(deck === 'A' ? 'B' : 'A', deck)}
              disabled={!dj.decks[deck === 'A' ? 'B' : 'A'].track || !track}
              className="w-9 h-9 rounded-lg bg-rbox-panel3 border border-rbox-line hover:border-rbox-amber hover:text-rbox-amber text-rbox-dim flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Sync from other deck"
            >
              <ArrowLeftRight size={14} />
            </button>
            <button
  onClick={() =>
    dj.seek(
      deck,
      Math.max(0, positionSec - 10)
    )
  }
>
  -10s
</button>

<button
  onClick={() =>
    dj.seek(
      deck,
      Math.min(
        durationSec,
        positionSec + 10
      )
    )
  }
>
  +10s
</button>
          </div>

          {/* VU meter */}
          <VUMeter analyser={analyser} isPlaying={isPlaying} volume={volume} height={48} />
        </div>

        {/* Right: Track info + waveform + BPM + controls */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {/* Track info */}
          <div className="bg-rbox-panel2 rounded-lg px-3 py-2 border border-rbox-line">
            {track ? (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-rbox-text truncate">{track.title}</div>
                  <div className="text-xs text-rbox-dim truncate">{track.artist}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rbox-panel3 text-rbox-dim">
                      {track.genre}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rbox-panel3 text-rbox-amber">
                      {track.key}
                    </span>
                    <span className="text-[9px] font-mono text-rbox-dim flex items-center gap-0.5">
                      <Clock size={9} /> {track.first_downbeat_sec?.toFixed(1) ?? '--'}s beat
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-rbox-dim">TIME</div>
                  <div className="text-sm font-mono text-rbox-text">
                    {formatTime(positionSec)} <span className="text-rbox-dim">/ {formatTime(durationSec || track.duration_sec)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={handleLoadClick}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-rbox-dim hover:text-rbox-text transition-colors"
              >
                <Music2 size={14} /> Select a track from the browser
              </button>
            )}
          </div>

          {/* Waveform container */}
          <div id={`waveform-${deck}`} className="rounded-md bg-rbox-panel2 border border-rbox-line min-h-[72px] flex items-center justify-center overflow-hidden">
            {!track && (
              <span className="text-[10px] font-mono text-rbox-dim">No track loaded</span>
            )}
          </div>

          {/* Progress Bar */}
{track && (
  <div className="px-1">
    <input
      type="range"
      className="w-full"
      min={0}
      max={durationSec || track.duration_sec}
      value={positionSec}
      onChange={(e) =>
        dj.seek(
          deck,
          Number(e.target.value)
        )
      }
    />

    <div className="flex justify-between text-[10px] text-rbox-dim font-mono mt-1">
      <span>{formatTime(positionSec)}</span>
      <span>
        {formatTime(durationSec || track.duration_sec)}
      </span>
    </div>
  </div>
)}

          {/* BPM + Pitch + Vol + EQ */}
          <div className="flex items-stretch gap-2">
            {/* BPM display */}
            <div
              className="rounded-lg px-3 py-1.5 flex flex-col items-center justify-center border shrink-0"
              style={{ background: '#0a0b0e', borderColor: accent + '44' }}
            >
              <span className="text-[8px] font-mono text-rbox-dim tracking-widest">BPM</span>
              <span
                className="text-2xl font-display leading-none"
                style={{ color: rate !== 1.0 && track ? accent : '#e5e7eb' }}
              >
                {bpm || '---'}
              </span>
              {track && rate !== 1.0 && (
                <span className="text-[8px] font-mono text-rbox-dim">{track.bpm} base</span>
              )}
            </div>

            {/* Pitch fader */}
            <div className={`flex flex-col items-center bg-rbox-panel2 rounded-lg px-2 py-1 border border-rbox-line shrink-0 transition-shadow ${driveClass('rate')}`}>
              <span className="text-[8px] font-mono text-rbox-dim mb-1">PITCH</span>
              <div className="flex items-center gap-2 h-[64px]">
                <div className="flex flex-col justify-between h-full text-[7px] font-mono text-rbox-dim">
                  <span>+8%</span><span>0</span><span>-8%</span>
                </div>
                <input
                  type="range"
                  className="dj-fader"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '6px', height: '56px' }}
                  min={0.92} max={1.08} step={0.001}
                  value={rate}
                  onChange={(e) => dj.setRate(deck, parseFloat(e.target.value))}
                  disabled={!track}
                />
              </div>
              <span className="text-[8px] font-mono mt-1" style={{ color: accent }}>
                {((rate - 1) * 100).toFixed(1)}%
              </span>
            </div>

            {/* Volume fader */}
            <div className="flex flex-col items-center bg-rbox-panel2 rounded-lg px-2 py-1 border border-rbox-line shrink-0">
              <span className="text-[8px] font-mono text-rbox-dim mb-1">VOL</span>
              <div className="flex items-center gap-2 h-[64px]">
                <input
                  type="range"
                  className="dj-fader"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '6px', height: '56px' }}
                  min={0} max={1} step={0.01}
                  value={volume}
                  onChange={(e) => dj.setVolume(deck, parseFloat(e.target.value))}
                />
              </div>
              <span className="text-[8px] font-mono text-rbox-dim mt-1">{Math.round(volume * 100)}</span>
            </div>

            {/* EQ + Filter knobs */}
            <div className="flex-1 grid grid-cols-4 gap-1 bg-rbox-panel2 rounded-lg px-2 py-1 border border-rbox-line items-center min-w-0">
              <div className="flex items-center justify-center rounded-md">
                <Knob
                  label="HI" value={eqHigh} min={0} max={2} defaultValue={1}
                  onChange={(v) => dj.setEQ(deck, 'high', v)} color={accent} size={44}
                  format={(v) => `${v > 1 ? '+' : ''}${((v - 1) * 12).toFixed(0)}dB`}
                />
              </div>
              <div className="flex items-center justify-center rounded-md">
                <Knob
                  label="MID" value={eqMid} min={0} max={2} defaultValue={1}
                  onChange={(v) => dj.setEQ(deck, 'mid', v)} color={accent} size={44}
                  format={(v) => `${v > 1 ? '+' : ''}${((v - 1) * 12).toFixed(0)}dB`}
                />
              </div>
              <div className={`flex items-center justify-center rounded-md transition-shadow ${driveClass('low')}`}>
                <Knob
                  label="LOW" value={eqLow} min={0} max={2} defaultValue={1}
                  onChange={(v) => dj.setEQ(deck, 'low', v)} color={accent} size={44}
                  format={(v) => `${v > 1 ? '+' : ''}${((v - 1) * 12).toFixed(0)}dB`}
                />
              </div>
              <div className={`flex items-center justify-center rounded-md transition-shadow ${driveClass('filter')}`}>
                <Knob
                  label="FILTER" value={filter} min={-1} max={1} defaultValue={0}
                  onChange={(v) => dj.setFilter(deck, v)}
                  color={filter < 0 ? '#fbbf24' : filter > 0 ? '#22c55e' : '#6b7280'}
                  size={44}
                  format={(v) => (Math.abs(v) < 0.05 ? 'OFF' : v < 0 ? 'LP' : 'HP')}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
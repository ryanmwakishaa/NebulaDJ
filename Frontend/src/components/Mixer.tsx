import { Volume2, Headphones, Crosshair, SlidersHorizontal, Zap } from 'lucide-react';
import { useDJStore } from '@/store/djStore';
import { useAutoDJ } from '@/store/autoDJStore';
import { VUMeter } from './VUMeter';

export function Mixer() {
  const dj = useDJStore();
  const auto = useAutoDJ();
  const { crossfade, masterVolume } = dj;
  const xDriven = auto.running && auto.driving.includes('xfade');
  const deckA = dj.decks.A;
  const deckB = dj.decks.B;

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-rbox-line bg-gradient-to-br from-[#101b2b] via-rbox-panel to-[#171426] shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rbox-line bg-black/20 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-400/10 text-sky-300">
            <SlidersHorizontal size={20} />
          </div>
          <div>
            <h2 className="font-display text-lg tracking-widest text-rbox-text">PRO MIXER</h2>
            <p className="text-[10px] font-mono tracking-[0.18em] text-rbox-dim">LIVE CHANNEL CONTROL</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {auto.running && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] font-mono text-amber-300">
              <Zap size={12} /> AUTO DJ ACTIVE
            </span>
          )}
          <span className="rounded-full border border-rbox-line bg-black/20 px-3 py-1 text-[10px] font-mono text-rbox-dim">48 kHz · STEREO</span>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.85fr)_minmax(0,1fr)]">
        {/* Deck A channel */}
        <div className="min-w-0 rounded-xl border border-teal-400/25 bg-gradient-to-br from-teal-400/[0.09] to-transparent p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-400 text-sm font-bold text-slate-950">A</span>
              <div>
                <div className="text-sm font-semibold text-teal-200">CHANNEL A</div>
                <div className="text-[10px] text-rbox-dim">{deckA.track?.title ?? 'No track loaded'}</div>
              </div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[9px] font-mono ${deckA.isPlaying ? 'bg-teal-400/15 text-teal-300' : 'bg-white/5 text-rbox-dim'}`}>{deckA.isPlaying ? 'PLAYING' : 'STANDBY'}</span>
          </div>
          <VUMeter analyser={dj.getAnalyser('A')} isPlaying={deckA.isPlaying} volume={deckA.volume} height={22} orientation="horizontal" />
          <div className="mt-4 rounded-lg border border-teal-300/15 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-rbox-dim"><span className="flex items-center gap-2"><Headphones size={14} /> CHANNEL LEVEL</span><span className="font-mono text-teal-200">{Math.round(deckA.volume * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-300 shadow-[0_0_12px_rgba(45,212,191,.4)]" style={{ width: `${deckA.volume * 100}%` }} /></div>
            <div className="mt-2 flex justify-between text-[9px] font-mono text-rbox-dim"><span>LOW</span><span>0 dB</span><span>PEAK</span></div>
          </div>
        </div>

        {/* Main master and crossfader section */}
        <div className="min-w-0 rounded-xl border border-sky-300/20 bg-gradient-to-b from-sky-400/[0.08] to-violet-500/[0.07] p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2 text-sky-200"><Volume2 size={17} /><span className="text-sm font-semibold tracking-wide">MASTER OUTPUT</span></div>
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-rbox-dim"><span>Master volume</span><span className="font-mono text-white">{Math.round(masterVolume * 100)}%</span></div>
            <input type="range" aria-label="Master volume" className="dj-fader w-full" min={0} max={1} step={0.01} value={masterVolume} onChange={(e) => dj.setMasterVolume(parseFloat(e.target.value))} />
            <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-rbox-dim"><span>−∞</span><span>−6 dB</span><span>0 dB</span></div>
          </div>
          <div className="mb-2 mt-4 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-violet-200"><Crosshair size={15} /> CROSSFADER</span>
            <span className={`rounded-md px-2 py-1 text-[10px] font-mono ${xDriven ? 'bg-amber-400/15 text-amber-300' : 'bg-white/5 text-rbox-dim'}`}>{xDriven ? 'AUTO' : crossfade < 0.48 ? 'A FOCUS' : crossfade > 0.52 ? 'B FOCUS' : 'CENTER'}</span>
          </div>
          <div className={`rounded-xl border bg-black/30 p-3 transition-shadow ${xDriven ? 'border-amber-300/70 shadow-[0_0_18px_rgba(251,191,36,.18)]' : 'border-white/10'}`}>
            <div className="mb-2 flex items-center justify-between text-sm font-display"><span className="text-teal-300">A</span><span className="text-pink-300">B</span></div>
            <input type="range" aria-label="Crossfader" className="dj-cross w-full" min={0} max={1} step={0.01} value={crossfade} onChange={(e) => dj.setCrossfade(parseFloat(e.target.value))} />
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-rbox-dim"><span>{Math.round((1 - crossfade) * 100)}% A</span><span>{Math.round(crossfade * 100)}% B</span></div>
          </div>
        </div>

        {/* Deck B channel */}
        <div className="min-w-0 rounded-xl border border-pink-400/25 bg-gradient-to-br from-pink-400/[0.09] to-transparent p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500 text-sm font-bold text-slate-950">B</span>
              <div>
                <div className="text-sm font-semibold text-pink-200">CHANNEL B</div>
                <div className="text-[10px] text-rbox-dim">{deckB.track?.title ?? 'No track loaded'}</div>
              </div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[9px] font-mono ${deckB.isPlaying ? 'bg-pink-400/15 text-pink-300' : 'bg-white/5 text-rbox-dim'}`}>{deckB.isPlaying ? 'PLAYING' : 'STANDBY'}</span>
          </div>
          <VUMeter analyser={dj.getAnalyser('B')} isPlaying={deckB.isPlaying} volume={deckB.volume} height={22} orientation="horizontal" />
          <div className="mt-4 rounded-lg border border-pink-300/15 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-rbox-dim"><span className="flex items-center gap-2"><Headphones size={14} /> CHANNEL LEVEL</span><span className="font-mono text-pink-200">{Math.round(deckB.volume * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-300 shadow-[0_0_12px_rgba(244,114,182,.4)]" style={{ width: `${deckB.volume * 100}%` }} /></div>
            <div className="mt-2 flex justify-between text-[9px] font-mono text-rbox-dim"><span>LOW</span><span>0 dB</span><span>PEAK</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

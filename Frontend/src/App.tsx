import { useEffect, useState } from 'react';
import { Radio, Activity, Headphones, Zap, Wifi, WifiOff } from 'lucide-react';
import { useDJStore } from '@/store/djStore';
import { useAIStore } from '@/store/aiStore';
import { api } from '@/lib/api';
import { DeckPanel } from '@/components/DeckPanel';
import { Mixer } from '@/components/Mixer';
import { TrackBrowser } from '@/components/TrackBrowser';
import { AIPanel } from '@/components/AIPanel';

function App() {
  const dj = useDJStore();
  const ai = useAIStore();
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [backendVersion, setBackendVersion] = useState<string>('');

  // Track library can be collapsed; remember the choice between visits
  const [libraryOpen, setLibraryOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nebuladj.libraryOpen') !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('nebuladj.libraryOpen', String(libraryOpen));
    } catch {
      /* storage unavailable: ignore */
    }
  }, [libraryOpen]);

  // Deck buttons ("Select a track", "Eject") ask for the library to open if it's hidden
  useEffect(() => {
    const open = () => setLibraryOpen(true);
    window.addEventListener('nebula:open-library', open);
    return () => window.removeEventListener('nebula:open-library', open);
  }, []);

  // Check backend health on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const health = await api.healthCheck();
        setBackendOnline(health.status === 'ok' || health.status === 'healthy');
        setBackendVersion(health.version);
      } catch {
        setBackendOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const playingA = dj.decks.A.isPlaying;
  const playingB = dj.decks.B.isPlaying;
  const anyPlaying = playingA || playingB;

  return (
    // The page scrolls normally now (no overflow-y-auto / overflow-hidden trap here).
    <div className="min-h-screen flex flex-col bg-rbox-bg text-rbox-text">
      {/* ===== Top Bar ===== */}
      <header className="flex items-center justify-between px-4 py-2 bg-rbox-panel border-b border-rbox-line shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-deck-a to-deck-b flex items-center justify-center shadow-lg">
            <Radio size={20} className="text-rbox-bg" />
          </div>
          <div>
            <h1 className="text-xl font-display tracking-wider leading-none">
              NEBULA<span className="text-deck-a">DJ</span>
            </h1>
            <p className="text-[8px] font-mono text-rbox-dim tracking-widest">AI-POWERED DJ PLATFORM</p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-4">
          {/* Backend status */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-rbox-line">
            {backendOnline === null ? (
              <Activity size={13} className="text-rbox-dim animate-pulse" />
            ) : backendOnline ? (
              <Wifi size={13} className="text-rbox-green" />
            ) : (
              <WifiOff size={13} className="text-rbox-red" />
            )}
            <span className="text-[10px] font-mono text-rbox-dim">
              {backendOnline === null ? 'CONNECTING...' : backendOnline ? `BACKEND ${backendVersion || 'ONLINE'}` : 'BACKEND OFFLINE'}
            </span>
          </div>

          {/* Live status */}
          <div className="flex items-center gap-1.5">
            <Activity size={13} className={anyPlaying ? 'text-deck-a pulse-glow' : 'text-rbox-dim'} />
            <span className="text-[10px] font-mono text-rbox-dim">{anyPlaying ? 'LIVE' : 'STANDBY'}</span>
          </div>

          {/* Deck indicators */}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${playingA ? 'bg-deck-a shadow-glow-a' : 'bg-rbox-line'}`} />
            <span className="text-[10px] font-mono text-rbox-dim">A {playingA ? 'ON' : 'OFF'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${playingB ? 'bg-deck-b shadow-glow-b' : 'bg-rbox-line'}`} />
            <span className="text-[10px] font-mono text-rbox-dim">B {playingB ? 'ON' : 'OFF'}</span>
          </div>

          <div className="flex items-center gap-1.5 border-l border-rbox-line pl-4">
            <Headphones size={13} className="text-rbox-dim" />
            <span className="text-[10px] font-mono text-rbox-dim">48kHz</span>
          </div>

          {/* AI status */}
          <div className="flex items-center gap-1.5 border-l border-rbox-line pl-4">
            <Zap size={13} className={ai.isGenerating ? 'text-rbox-amber animate-pulse' : 'text-rbox-amber'} />
            <span className="text-[10px] font-mono text-rbox-amber">
              {ai.isGenerating ? 'AI THINKING...' : ai.currentSet ? 'AI SET READY' : 'AI READY'}
            </span>
          </div>
        </div>
      </header>

      {/* ===== Main Workspace =====
          Wide screens (2xl and up): decks on the left, AI panel on the right.
          Smaller screens: AI panel drops underneath so nothing gets squeezed. */}
      <main className="flex-1 flex flex-col 2xl:flex-row gap-2 p-2 min-h-0">
        {/* Left: Decks + Mixer + Library */}
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {/* Decks + Mixer row. Scrolls sideways on narrow windows instead of
              clipping the pitch / volume / level meters. */}
          <div className="flex items-start gap-2 shrink-0 overflow-x-auto scroll-thin pb-1">
            <div className="flex-1 min-w-[640px]">
              <DeckPanel deck="A" />
            </div>
            <div className="shrink-0">
              <Mixer />
            </div>
            <div className="flex-1 min-w-[640px]">
              <DeckPanel deck="B" />
            </div>
          </div>

          {/* Track library: click its header to collapse / expand. It stays mounted
              when collapsed, so your search and filters are kept. */}
          <div className={libraryOpen ? 'flex-1 min-h-[340px]' : 'shrink-0'}>
            <TrackBrowser
              collapsed={!libraryOpen}
              onToggleCollapsed={() => setLibraryOpen((open) => !open)}
            />
          </div>
        </div>

        {/* AI Panel: absolutely positioned inside its box on wide screens so its
            content can never stretch the rest of the layout. */}
        <div className="relative w-full 2xl:w-[360px] h-[560px] 2xl:h-auto 2xl:min-h-[560px] shrink-0">
          <div className="h-full 2xl:absolute 2xl:inset-0">
            <AIPanel />
          </div>
        </div>
      </main>

      {/* ===== Status Bar ===== */}
      <footer className="flex items-center justify-between px-4 py-1.5 bg-rbox-panel border-t border-rbox-line shrink-0 text-[9px] font-mono text-rbox-dim">
        <div className="flex items-center gap-4">
          <span>CROSSFADER: {Math.round(dj.crossfade * 100)}%</span>
          <span>MASTER: {Math.round(dj.masterVolume * 100)}%</span>
          {dj.decks.A.track && (
            <span className="text-deck-a/70">A: {dj.decks.A.bpm} BPM · {dj.decks.A.track.key}</span>
          )}
          {dj.decks.B.track && (
            <span className="text-deck-b/70">B: {dj.decks.B.bpm} BPM · {dj.decks.B.track.key}</span>
          )}
          {ai.currentSet && (
            <span className="text-rbox-amber/70">AI SET: {ai.currentSet.tracks.length} tracks</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span>Drag knobs vertically · Double-click to reset</span>
          {backendOnline && <span className="text-rbox-green">● Connected</span>}
          {!backendOnline && backendOnline !== null && (
            <span className="text-rbox-red">● Disconnected — start backend on :8000</span>
          )}
          <span className="text-rbox-amber">NebulaDJ v2.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
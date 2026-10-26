import { create } from 'zustand';
import { useDJStore } from '@/store/djStore';
import { useAIStore } from '@/store/aiStore';
import type { AISetTrack, DeckId, Track } from '@/types';

/**
 * Auto-DJ v2: plays the current AI set by itself.
 *
 * What it does for each transition:
 *  1. Loads the next track on the idle deck, tempo-matches it and cues it at
 *     its first downbeat.
 *  2. Picks a transition style from how well the two tracks fit:
 *       - "blend"  tempo + key fit            -> long blend (16-64 beats)
 *       - "short"  tempo fits, keys clash     -> short blend (16 beats)
 *       - "cut"    tempo gap too big to match -> quick cut (4 beats) with a
 *                                                high-pass sweep on the old track
 *  3. Starts the new track exactly on a PHRASE boundary (every 16 beats) of the
 *     outgoing track, chosen so the transition ends near the end of that track.
 *  4. Locks the new track's beat phase to the old one (hard seek at the start,
 *     then tiny playback-rate nudges, like a DJ riding the pitch fader).
 *  5. Crossfades with a bass swap, stops the old deck, and repeats.
 *
 * It relies on `bpm` and `first_downbeat_sec` in your library. If a track has
 * no downbeat, that transition falls back to simple time-based mixing.
 */

type Phase = 'idle' | 'loading' | 'playing' | 'preparing' | 'fading' | 'done' | 'error';
type TransitionType = 'blend' | 'short' | 'cut';

interface Plan {
  type: TransitionType;
  label: string;
  beats: number;              // length of the overlap, in beats
  rate: number;               // playback rate for the incoming deck
  startMedia: number | null;  // outgoing-track time (sec) where the new track should start
  lock: boolean;              // beat-lock the incoming deck during the overlap
  bOut: number;               // seconds per beat, outgoing track (media time)
  bIn: number;                // seconds per beat, incoming track (media time)
  dIn: number;                // incoming cue point (its first downbeat, or 0)
}

interface AutoDJState {
  running: boolean;
  phase: Phase;
  message: string;
  queue: AISetTrack[];
  index: number; // index in `queue` of the track currently live
  liveDeck: DeckId | null;
  fadeSeconds: number;
  driving: string[]; // controls the Auto-DJ is moving right now, e.g. 'A.low', 'B.rate', 'xfade'
  setFadeSeconds: (s: number) => void;
  start: () => Promise<void>;
  stop: () => void;
}

const PHRASE_BEATS = 16;
const EASE_BARS = 16; // after a mix, ease the new track back to its own tempo over this many bars

const other = (d: DeckId): DeckId => (d === 'A' ? 'B' : 'A');
const sideValue = (d: DeckId): number => (d === 'A' ? 0 : 1); // crossfader: 0 = A, 1 = B
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const clamp01 = (x: number): number => clamp(x, 0, 1);

// ---- Module-level run state (kept out of zustand so timers don't cause renders) ----
let runId = 0;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;
let easeTimer: ReturnType<typeof setInterval> | null = null;
let prepared = false;
let preparing = false;
let armed = false;
let fading = false;
let plan: Plan | null = null;
let lastPos = 0;
let savedLow: Record<DeckId, number> = { A: 1, B: 1 };
let savedFilter: Record<DeckId, number> = { A: 0, B: 0 };
let activeFade: { from: DeckId; to: DeckId; rate: number } | null = null;

// Manual-takeover tracking: controls the user touched mid-transition are left alone.
let selfDepth = 0;                      // > 0 while the Auto-DJ itself is writing to the store
const manual = new Set<string>();       // e.g. 'A.low', 'B.filter', 'B.rate'
let unwatch: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitReady(deck: DeckId, timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      if (useDJStore.getState().decks[deck].isReady) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

/** Current media time of a deck, read straight from the player (more precise than store state). */
function mediaPos(deck: DeckId): number {
  const dj = useDJStore.getState();
  return dj.wavesurfers[deck]?.getCurrentTime() ?? dj.decks[deck].positionSec;
}

function downbeatOf(track: Track): number | null {
  const v = (track as unknown as { first_downbeat_sec?: number | null }).first_downbeat_sec;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function camelot(key?: string | null): { n: number; l: string } | null {
  const m = /^\s*(\d{1,2})\s*([ABab])\s*$/.exec(key ?? '');
  return m ? { n: Number(m[1]), l: m[2].toUpperCase() } : null;
}

/** Harmonic compatibility on the Camelot wheel (same, +/-1, or relative major/minor). */
function keysCompatible(a?: string | null, b?: string | null): boolean {
  const ca = camelot(a);
  const cb = camelot(b);
  if (!ca || !cb) return true; // unknown key: assume fine
  if (ca.n === cb.n) return true;
  if (ca.l === cb.l) {
    const diff = Math.min((ca.n - cb.n + 12) % 12, (cb.n - ca.n + 12) % 12);
    return diff <= 1;
  }
  return false;
}

/** Playback rate that makes `trackBpm` land on `targetBpm` (also tries half/double time), within +/-8%. */
function matchRate(targetBpm: number, trackBpm: number): number {
  if (!targetBpm || !trackBpm) return 1;
  const candidates = [targetBpm / trackBpm, targetBpm / (trackBpm * 2), targetBpm / (trackBpm / 2)];
  const best = candidates.reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
  return clamp(best, 0.92, 1.08);
}

/** Decide how to mix `outTrack` (playing at `rateOut`) into `incoming`. */
function buildPlan(live: DeckId, incoming: Track, fadeSeconds: number): Plan {
  const dj = useDJStore.getState();
  const out = dj.decks[live];
  const outTrack = out.track as Track;
  const rateOut = out.rate || 1;
  const effOut = outTrack.bpm * rateOut;

  const matched = matchRate(effOut, incoming.bpm);
  const residual = effOut > 0 && incoming.bpm > 0
    ? Math.abs(incoming.bpm * matched - effOut) / effOut
    : 0;
  const keyOk = keysCompatible(outTrack.key, incoming.key);

  let type: TransitionType;
  if (residual > 0.015) type = 'cut';
  else if (!keyOk) type = 'short';
  else type = 'blend';

  let beats: number;
  let label: string;
  if (type === 'blend') {
    const wanted = (fadeSeconds * effOut) / 60;
    beats = clamp(Math.round(wanted / 16) * 16, 16, 64);
    label = `Long blend · ${beats} beats`;
  } else if (type === 'short') {
    beats = 16;
    label = 'Short blend (key clash) · 16 beats';
  } else {
    beats = 4;
    label = 'Quick cut (tempo gap) · 4 beats';
  }

  const rate = type === 'cut' ? 1 : matched;
  const dOut = downbeatOf(outTrack);
  const dInRaw = downbeatOf(incoming);
  const bOut = outTrack.bpm > 0 ? 60 / outTrack.bpm : 0;
  const bIn = incoming.bpm > 0 ? 60 / incoming.bpm : 0;

  // Pick the phrase boundary of the outgoing track to start on: the last one
  // that still lets the whole transition finish before the track ends.
  let startMedia: number | null = null;
  if (dOut !== null && bOut > 0 && out.durationSec > 0) {
    const phrase = PHRASE_BEATS * bOut;
    const latest = out.durationSec - beats * bOut - 0.5;
    let t = dOut + Math.floor((latest - dOut) / phrase) * phrase;
    const earliest = mediaPos(live) + 1.5;
    if (t < earliest) t = dOut + Math.ceil((earliest - dOut) / phrase) * phrase;
    if (t < out.durationSec - 1) startMedia = t;
  }

  const lock = type !== 'cut' && dOut !== null && dInRaw !== null && bOut > 0 && bIn > 0 && startMedia !== null;

  return { type, label, beats, rate, startMedia, lock, bOut, bIn, dIn: dInRaw ?? 0 };
}

/** Run store writes that come from the Auto-DJ (so the watcher doesn't mistake them for the user). */
function withSelf(fn: () => void) {
  selfDepth++;
  try {
    fn();
  } finally {
    selfDepth--;
  }
}

/** Put EQ low / filter / tempo back to the user's values, except controls the user took over. */
function restoreControls() {
  const dj = useDJStore.getState();
  withSelf(() => {
    for (const dk of ['A', 'B'] as DeckId[]) {
      if (!manual.has(`${dk}.low`)) dj.setEQ(dk, 'low', savedLow[dk]);
      if (!manual.has(`${dk}.filter`)) dj.setFilter(dk, savedFilter[dk]);
    }
    if (activeFade && !manual.has(`${activeFade.to}.rate`)) dj.setRate(activeFade.to, activeFade.rate);
  });
}

function stopWatching() {
  if (unwatch) unwatch();
  unwatch = null;
}

/** Called when the user grabs the crossfader mid-transition: hand everything back to them. */
function handoff(message: string) {
  runId++;
  clearTimers();
  useAutoDJ.setState({ running: false, phase: 'idle', message });
}

/** While a transition runs, notice if the user moves a control we are driving. */
function watchManual(run: number) {
  stopWatching();
  unwatch = useDJStore.subscribe((s, prev) => {
    if (selfDepth > 0 || run !== runId) return;
    for (const dk of ['A', 'B'] as DeckId[]) {
      const now = s.decks[dk];
      const before = prev.decks[dk];
      if (now.eqLow !== before.eqLow) manual.add(`${dk}.low`);
      if (now.filter !== before.filter) manual.add(`${dk}.filter`);
      if (now.rate !== before.rate) manual.add(`${dk}.rate`);
    }
    if (s.crossfade !== prev.crossfade) {
      queueMicrotask(() => {
        if (run === runId) handoff('You took over the crossfader. Auto-DJ stopped.');
      });
    }
  });
}

function clearTimers() {
  if (monitorTimer) clearInterval(monitorTimer);
  if (fadeTimer) clearInterval(fadeTimer);
  if (armTimer) clearTimeout(armTimer);
  if (easeTimer) clearInterval(easeTimer);
  easeTimer = null;
  monitorTimer = null;
  fadeTimer = null;
  armTimer = null;

  // Aborted mid-transition: put the user's EQ / filter / tempo back
  if (fading && activeFade) restoreControls();

  stopWatching();
  manual.clear();
  activeFade = null;
  prepared = false;
  preparing = false;
  armed = false;
  fading = false;
  plan = null;
  useAutoDJ.setState({ driving: [] });
}

function fail(message: string) {
  runId++;
  clearTimers();
  useAutoDJ.setState({ running: false, phase: 'error', message });
}

function finishSet() {
  runId++;
  clearTimers();
  useAutoDJ.setState({ running: false, phase: 'done', message: 'Set finished' });
}

function stopEase() {
  if (easeTimer) clearInterval(easeTimer);
  easeTimer = null;
  if (!fading) useAutoDJ.setState({ driving: [] });
}

/**
 * After a transition the new track is still running at the tempo it borrowed from the
 * old one. A DJ eases the pitch fader back toward zero over the next phrases so the set
 * doesn't drift away from every track's natural speed. Do the same, slowly.
 * It backs off if you move the pitch fader, or as soon as the next transition starts.
 */
function startEase(run: number, deck: DeckId, fromRate: number) {
  if (Math.abs(fromRate - 1) < 0.002) return;
  const track = useDJStore.getState().decks[deck].track;
  if (!track || !(track.bpm > 0)) return;

  const totalMs = ((EASE_BARS * 240) / (track.bpm * fromRate)) * 1000;
  const t0 = performance.now();
  let last = fromRate;
  useAutoDJ.setState({ driving: [`${deck}.rate`] });

  easeTimer = setInterval(() => {
    if (run !== runId) return;
    const dj = useDJStore.getState();
    const d = dj.decks[deck];
    const userMovedIt = Math.abs(d.rate - last) > 0.0015;
    if (userMovedIt || preparing || prepared || fading || d.track?.id !== track.id) {
      stopEase();
      return;
    }
    const p = clamp01((performance.now() - t0) / totalMs);
    const r = fromRate + (1 - fromRate) * (p * p * (3 - 2 * p)); // smooth start and finish
    withSelf(() => dj.setRate(deck, r));
    last = r;
    if (p >= 1) stopEase();
  }, 500);
}

// ---------------------------------------------------------------------------
// Preparing the next track
// ---------------------------------------------------------------------------

async function prepareNext(run: number) {
  const st = useAutoDJ.getState();
  const next = st.queue[st.index + 1];
  const live = st.liveDeck;
  if (!next || !live) return;

  preparing = true;
  useAutoDJ.setState({ phase: 'preparing', message: `Cueing next: ${next.track.title}` });

  const nd = other(live);
  useDJStore.getState().pause(nd);
  await useDJStore.getState().loadTrack(nd, next.track);
  const ok = await waitReady(nd);
  if (run !== runId) return;
  if (!ok) {
    fail(`Could not load "${next.track.title}"`);
    return;
  }

  // Everything below must happen AFTER the track is ready: the store resets the
  // rate when a track finishes loading.
  const newPlan = buildPlan(live, next.track, useAutoDJ.getState().fadeSeconds);
  const dj = useDJStore.getState();
  dj.setRate(nd, newPlan.rate);
  dj.seek(nd, newPlan.dIn); // cue at the first downbeat
  useAutoDJ.setState({ driving: [`${nd}.rate`] });
  setTimeout(() => {
    if (run === runId && !fading) useAutoDJ.setState({ driving: [] });
  }, 2500);

  plan = newPlan;
  prepared = true;
  preparing = false;
  if (!fading) {
    useAutoDJ.setState({ phase: 'playing', message: `Next: ${next.track.title} · ${newPlan.label}` });
  }
}

// ---------------------------------------------------------------------------
// The transition itself
// ---------------------------------------------------------------------------

function startFade(run: number, allowLock = true) {
  const st = useAutoDJ.getState();
  const from = st.liveDeck;
  const plan0 = plan;
  if (!from || !plan0 || fading || run !== runId) return;

  const to = other(from);
  const dj = useDJStore.getState();
  const wsIn = dj.wavesurfers[to];
  const wsOut = dj.wavesurfers[from];
  const lock = allowLock && plan0.lock && plan0.startMedia !== null;
  const cut = plan0.type === 'cut';

  fading = true;
  armed = false;
  activeFade = { from, to, rate: plan0.rate };
  savedLow = { A: dj.decks.A.eqLow, B: dj.decks.B.eqLow };
  savedFilter = { A: dj.decks.A.filter, B: dj.decks.B.filter };
  manual.clear();
  watchManual(run);

  const outDeck = dj.decks[from];
  const rateOut = outDeck.rate || 1;
  const effOut = (outDeck.track?.bpm ?? 0) * rateOut;
  const remainingReal = outDeck.durationSec > 0 ? (outDeck.durationSec - mediaPos(from)) / rateOut : Infinity;
  const fadeReal = effOut > 0 ? (plan0.beats * 60) / effOut : st.fadeSeconds;
  const totalMs = Math.max(1.5, Math.min(fadeReal, remainingReal)) * 1000;

  useAutoDJ.setState({
    phase: 'fading',
    message: `Mixing: ${plan0.label}${lock ? ' · beat-locked' : ''}`,
    driving: ['xfade', `${from}.low`, `${to}.low`, `${to}.rate`, ...(cut ? [`${from}.filter`] : [])],
  });

  // Where the incoming track SHOULD be right now, so its beats sit on the old track's beats
  const desiredIn = (): number | null => {
    if (!lock || !wsOut || plan0.startMedia === null) return null;
    return plan0.dIn + ((wsOut.getCurrentTime() - plan0.startMedia) / plan0.bOut) * plan0.bIn;
  };

  if (!cut) withSelf(() => dj.setEQ(to, 'low', savedLow[to] * 0.3)); // new track comes in without bass
  dj.play(to);

  // First alignment right away (the new deck is silent at this point)
  const first = desiredIn();
  if (first !== null && first >= 0) dj.seek(to, first);

  const fromVal = sideValue(from);
  const toVal = sideValue(to);
  const t0 = performance.now();
  let lastCheck = t0;

  fadeTimer = setInterval(() => {
    if (run !== runId) return;
    const now = performance.now();
    const p = clamp01((now - t0) / totalMs);
    const d = useDJStore.getState();

    withSelf(() => {
      d.setCrossfade(fromVal + (toVal - fromVal) * p);

      if (cut) {
        if (!manual.has(`${from}.filter`)) d.setFilter(from, 0.9 * p); // high-pass sweep thins out the old track
      } else {
        const inStart = plan0.type === 'short' ? 0.3 : 0.4;
        const inLen = plan0.type === 'short' ? 0.15 : 0.2;
        const outStart = plan0.type === 'short' ? 0.35 : 0.5;
        const outLen = plan0.type === 'short' ? 0.15 : 0.3;
        if (!manual.has(`${to}.low`)) d.setEQ(to, 'low', savedLow[to] * (0.3 + 0.7 * clamp01((p - inStart) / inLen)));
        if (!manual.has(`${from}.low`)) d.setEQ(from, 'low', savedLow[from] * (1 - 0.85 * clamp01((p - outStart) / outLen)));
      }
    });

    // Beat lock: hard re-seek early (while the new track is still quiet), then
    // tiny pitch nudges for the rest of the overlap. Skipped if you grabbed the pitch fader.
    if (lock && wsIn && !manual.has(`${to}.rate`) && now - lastCheck > 200) {
      lastCheck = now;
      const want = desiredIn();
      if (want !== null && want >= 0) {
        const err = wsIn.getCurrentTime() - want; // seconds; positive = new track is ahead
        if (Math.abs(err) > 0.03 && p < 0.15) {
          d.seek(to, want);
        } else {
          const adj = clamp(-err * 0.15, -0.008, 0.008);
          wsIn.setPlaybackRate(plan0.rate * (1 + adj), true);
        }
      }
    }

    if (p >= 1) {
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = null;

      withSelf(() => {
        d.setCrossfade(toVal);
        d.stop(from);
      });
      restoreControls(); // respects anything you took over
      stopWatching();
      manual.clear();

      fading = false;
      prepared = false;
      armed = false;
      plan = null;
      activeFade = null;
      lastPos = 0;

      const s = useAutoDJ.getState();
      const newIndex = s.index + 1;
      const after = s.queue[newIndex + 1];
      useAutoDJ.setState({
        index: newIndex,
        liveDeck: to,
        phase: 'playing',
        message: after ? `Next up: ${after.track.title}` : 'Last track',
        driving: [],
      });
      startEase(run, to, plan0.rate);
    }
  }, 50);
}

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

function tick(run: number) {
  if (run !== runId || fading) return;
  const st = useAutoDJ.getState();
  const live = st.liveDeck;
  if (!live) return;

  const d = useDJStore.getState().decks[live];
  const dur = d.durationSec;
  const rate = d.rate || 1;
  const hasNext = st.index + 1 < st.queue.length;

  if (d.isPlaying) lastPos = d.positionSec;
  // The player resets to 0 and stops when a track finishes, so detect that:
  const ended = !d.isPlaying && dur > 0 && lastPos > 0 && dur - lastPos < 3;
  const remaining = dur > 0 ? (dur - d.positionSec) / rate : Infinity;

  if (!hasNext) {
    if (ended) finishSet();
    return;
  }

  if (!prepared && !preparing && (remaining <= st.fadeSeconds * 2 + 30 || ended)) {
    void prepareNext(run);
    return;
  }

  if (prepared && plan) {
    if (ended) {
      startFade(run, false); // track already finished: start now, no phase lock
      return;
    }
    if (plan.startMedia !== null) {
      // Arm a precise timer a moment before the phrase boundary
      const secsToStart = (plan.startMedia - mediaPos(live)) / rate;
      if (secsToStart <= 0.6 && !armed) {
        armed = true;
        armTimer = setTimeout(() => {
          armTimer = null;
          startFade(run);
        }, Math.max(0, secsToStart * 1000));
      }
    } else if (remaining <= st.fadeSeconds) {
      startFade(run, false); // no beat grid: plain time-based mix
    }
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAutoDJ = create<AutoDJState>((set) => ({
  running: false,
  phase: 'idle',
  message: '',
  queue: [],
  index: 0,
  liveDeck: null,
  fadeSeconds: 16,
  driving: [],

  setFadeSeconds: (s) => set({ fadeSeconds: s }),

  start: async () => {
    const items = useAIStore.getState().currentSet?.tracks;
    if (!items || items.length === 0) {
      set({ phase: 'error', message: 'Generate an AI set first' });
      return;
    }

    runId++;
    clearTimers();
    const run = runId;
    lastPos = 0;

    const deck: DeckId = 'A';
    set({
      running: true,
      phase: 'loading',
      message: `Loading ${items[0].track.title}...`,
      queue: [...items], // snapshot, so regenerating a set mid-run doesn't disturb this one
      index: 0,
      liveDeck: deck,
    });

    const dj = useDJStore.getState();
    dj.pause('A');
    dj.pause('B');
    dj.setCrossfade(sideValue(deck));
    await dj.loadTrack(deck, items[0].track);
    const ok = await waitReady(deck);
    if (run !== runId) return;
    if (!ok) {
      fail(`Could not load "${items[0].track.title}"`);
      return;
    }

    // Start the first track on its first downbeat when we know it
    const firstDown = downbeatOf(items[0].track);
    if (firstDown && firstDown > 0.05) useDJStore.getState().seek(deck, firstDown);
    useDJStore.getState().play(deck);

    set({
      phase: 'playing',
      message: items[1] ? `Next up: ${items[1].track.title}` : 'Last track',
    });
    monitorTimer = setInterval(() => tick(run), 250);
  },

  stop: () => {
    runId++;
    clearTimers();
    // Decks keep playing whatever is live; only the automation stops.
    set({ running: false, phase: 'idle', message: 'Auto-DJ stopped' });
  },
}));
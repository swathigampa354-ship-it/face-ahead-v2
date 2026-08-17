import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  scanPrepared, prepareImages, hasKey, friendlyTaskError, scanSourceImage,
  type ScanResult,
} from './lib/youcam';
import { runAging, frameAt, type AgeFrame } from './lib/aging';
import { Pipeline, JOURNEY_DEFS } from './lib/pipeline';
import { buildComparison, rankHabits, type ComparisonReport, type Habit } from './lib/compare';
import { buildShareCard, type ShareCardData } from './lib/share';
import { demoScan, demoFutureScan, demoFrames } from './lib/demo';
import { loadJourneys, saveJourney, clearJourneys, newId, type JourneyEntry } from './lib/store';
import { BUILD_VERSION, BUILD_DATE } from './version';

import { Hero } from './components/Hero';
import { Scanning } from './components/Scanning';
import { TimeMachine } from './components/TimeMachine';
import { MetricsTable } from './components/MetricsTable';
import { HabitsGrid } from './components/HabitsGrid';
import { ShareModal } from './components/ShareModal';
import { JourneyLog } from './components/JourneyLog';

type Phase = 'landing' | 'scanning' | 'journey';

function App() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgBlob, setImgBlob] = useState<File | null>(null);

  // journey state
  const [stages, setStages] = useState<Pipeline | null>(null);
  const [frames, setFrames] = useState<AgeFrame[]>([]);
  const [targetAge, setTargetAge] = useState(50);
  const [today, setToday] = useState<ScanResult | null>(null);
  const [future, setFuture] = useState<ScanResult | null>(null);
  const [comparison, setComparison] = useState<ComparisonReport | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [provider, setProvider] = useState<'youcam' | 'demo'>('demo');
  const [shareOpen, setShareOpen] = useState(false);
  const [history, setHistory] = useState<JourneyEntry[]>([]);
  const [scannedAge, setScannedAge] = useState<number | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ metric: string; spread: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false); }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { setHistory(loadJourneys()); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const onFile = (f: File | undefined | null) => {
    if (!f) return;
    setError(null);
    setImgBlob(f);
    setImgUrl(URL.createObjectURL(f));
  };

  const currentFrame = useMemo(() => {
    if (!frames.length) return null;
    return frameAt(frames, targetAge);
  }, [frames, targetAge]);

  const startDemo = () => {
    setError(null);
    setImgBlob(null); setImgUrl(null);
    setPhase('scanning');
    setProvider('demo');
    const pipe = new Pipeline(JOURNEY_DEFS);
    setStages(pipe);
    pipe.markRunning('prep');
    setTimeout(() => {
      pipe.markSuccess('prep', 'demo data prepared', 0);
      pipe.markRunning('aging');
      setTimeout(() => {
        const f = demoFrames();
        pipe.markSuccess('aging', '16 frames · 12→70 (GENERATED)', 0);
        setFrames(f);
        pipe.markRunning('today');
        setTimeout(() => {
          const t = demoScan();
          pipe.markSuccess('today', '14 concerns · GENERATED', 0);
          setToday(t);
          pipe.markRunning('future');
          setTimeout(() => {
            const fu = demoFutureScan();
            pipe.markSuccess('future', '14 concerns · GENERATED', 0);
            setFuture(fu);
            const cmp = buildComparison(t, fu);
            setComparison(cmp);
            setHabits(rankHabits(cmp));
            pipe.markSuccess('compare', 'deltas ranked', 0);
            pipe.markRunning('compose');
            setTimeout(() => {
              pipe.markSuccess('compose', 'report ready', 0);
              setStages(pipe);
              setPhase('journey');
              const entry: JourneyEntry = {
                id: newId(), at: new Date().toISOString(),
                today: t, future: fu, frames: f, targetAge: 50,
                comparison: cmp, provider: 'demo',
              };
              saveJourney(entry);
              setHistory(loadJourneys());
            }, 400);
          }, 900);
        }, 900);
      }, 900);
    }, 500);
  };

  const runJourney = useCallback(async (file: File) => {
    if (busy) return;
    setBusy(true); setError(null);
    setPhase('scanning'); setProvider('youcam');
    const pipe = new Pipeline(JOURNEY_DEFS);
    setStages(pipe);
    const key = (import.meta.env.VITE_YOUCAM_KEY as string).trim();
    try {
      // 1 — prep
      pipe.markRunning('prep');
      const blobs = await prepareImages(file);
      pipe.markSuccess('prep', `${blobs.length} crop candidates · 1024²`, 0);
      setStages(pipe);

      // 2 — aging (try crops; errors free)
      pipe.markRunning('aging');
      let ageFrames: AgeFrame[] | null = null;
      let lastErr = '';
      for (const b of blobs) {
        try { ageFrames = await runAging(key, b); break; }
        catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          if (/error_face_angle/.test(lastErr)) break;
        }
      }
      if (!ageFrames) {
        pipe.markFailed('aging', friendlyTaskError(lastErr || 'aging failed'));
        setStages(pipe);
        throw new Error(friendlyTaskError(lastErr || 'aging failed'));
      }
      pipe.markSuccess('aging', `${ageFrames.length} frames · ${ageFrames[0].age}→${ageFrames[ageFrames.length - 1].age}`, 2);
      setFrames(ageFrames);
      setStages(pipe);

      // 3 — today (skin + tone + fitz in one lane with fallback)
      pipe.markRunning('today');
      const t0 = await scanPrepared(blobs);
      pipe.markSuccess('today', '14 concerns + tone + Fitzpatrick', 46);
      setToday(t0);
      setStages(pipe);

      // 4 — future (scan the age-50 frame; fall back to neighbor ages if the
      //     aged face trips YouCam's quality gate — verified live)
      pipe.markRunning('future');
      const target = frameAt(ageFrames, 50);
      const fallbacks = [...ageFrames]
        .sort((a, b) => Math.abs(a.age - target.age) - Math.abs(b.age - target.age))
        .slice(1, 6)
        .map((f) => f.url);
      const futRes = await scanSourceImage(key, target.url, fallbacks);
      const scannedFrame = frameAt(ageFrames, 50);
      const usedAge = ageFrames.find((f) => f.url === futRes.usedSource)?.age ?? target.age;
      pipe.markSuccess('future', `14 concerns on age-${Math.round(usedAge)} frame`, 16);
      setFuture({ ...futRes.analysis, provider: 'youcam', tone: null, colors: {}, fitzpatrick: null, tookMs: 0 });
      setTargetAge(usedAge);
      setScannedAge(Math.round(usedAge));
      setStages(pipe);

      // 5 — compare
      pipe.markRunning('compare');
      const fullToday: ScanResult = t0;
      const fullFuture: ScanResult = { ...futRes.analysis, provider: 'youcam', tone: null, colors: {}, fitzpatrick: null, tookMs: 0 };
      const cmp = buildComparison(fullToday, fullFuture);
      setComparison(cmp);
      setHabits(rankHabits(cmp));
      pipe.markSuccess('compare', 'deltas + impact ranking', 0);
      setStages(pipe);

      // 6 — compose
      pipe.markRunning('compose');
      const entry: JourneyEntry = {
        id: newId(), at: new Date().toISOString(),
        today: fullToday, future: fullFuture, frames: ageFrames,
        targetAge: Math.round(usedAge), comparison: cmp, provider: 'youcam',
      };
      saveJourney(entry);
      setHistory(loadJourneys());
      pipe.markSuccess('compose', 'report · habits · share card', 0);
      setStages(pipe);
      setPhase('journey');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('landing');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // verify: re-scan the future frame → honest error bar on one metric
  const verify = async () => {
    if (verifyBusy || !currentFrame?.url || !future) return;
    setVerifyBusy(true); setError(null); setVerdict(null);
    try {
      const key = (import.meta.env.VITE_YOUCAM_KEY as string).trim();
      const second = await scanSourceImage(key, currentFrame.url);
      const key0 = future.scores[comparison?.biggestDrop?.key ?? 'wrinkle'];
      const key1 = second.analysis.scores[comparison?.biggestDrop?.key ?? 'wrinkle'];
      const metric = comparison?.biggestDrop?.key ?? 'wrinkle';
      const spread = key0 != null && key1 != null ? Math.abs(key1 - key0) : 0;
      setVerdict({ metric, spread });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setVerifyBusy(false); }
  };

  // re-scan a different slider age (power feature, 16u)
  const scanThisAge = async () => {
    if (!currentFrame?.url || !hasKey() || busy) return;
    setBusy(true); setError(null);
    try {
      const key = (import.meta.env.VITE_YOUCAM_KEY as string).trim();
      const fut = await scanSourceImage(key, currentFrame.url);
      const fullFuture: ScanResult = { ...fut.analysis, provider: 'youcam', tone: null, colors: {}, fitzpatrick: null, tookMs: 0 };
      setFuture(fullFuture);
      if (today) {
        const cmp = buildComparison(today, fullFuture);
        setComparison(cmp);
        setHabits(rankHabits(cmp));
      }
      setToast(`Scanned your face at ${currentFrame.age} · report updated`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const reset = () => {
    setPhase('landing'); setError(null); setStages(null);
    setFrames([]); setToday(null); setFuture(null); setComparison(null);
    setHabits([]); setImgUrl(null); setImgBlob(null); setVerdict(null); setShareOpen(false); setScannedAge(null);
  };

  const shareData: ShareCardData | null = useMemo(() => {
    if (!currentFrame || !comparison) return null;
    return buildShareCard(currentFrame, comparison, habits.length ? habits : rankHabits(comparison), provider);
  }, [currentFrame, comparison, habits, provider]);

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">FACE<span className="brand-em">AHEAD</span></span>
        <span className="tag">MEET THE FACE YOU'RE BUILDING</span>
        <span className="top-right">
          {!hasKey() && <span className="demo-badge">🎬 demo</span>}
          <button className="icon-btn" onClick={() => setDark((d) => !d)} aria-label="Toggle theme">{dark ? '☀️' : '🌙'}</button>
        </span>
      </header>

      <main className="wrap">
        {error && <div className="error">⚠ {error}</div>}

        {phase === 'landing' && (
          <Hero onStart={(f) => { if (f) void runJourney(f); else if (imgBlob) void runJourney(imgBlob); }} onDemo={startDemo} onFile={onFile} />
        )}

        {phase === 'scanning' && (
          <Scanning stages={stages} imgUrl={imgUrl} provider={provider} />
        )}

        {phase === 'journey' && today && future && comparison && currentFrame && (
          <section className="journey">
            {/* Header */}
            <div className="journey-head">
              <div>
                <div className="provider-row">
                  <span className={`provider-badge ${provider === 'youcam' ? 'youcam' : 'demo'}`}>
                    {provider === 'youcam' ? '✨ Real YouCam AI' : '🎬 GENERATED demo'} · {stages?.unitsUsed ?? 0}u
                  </span>
                </div>
                <h1 className="journey-title">Your face at {targetAge}</h1>
                {scannedAge != null && provider === 'youcam' && (
                  <p className="muted small">Future skin report scanned at age {scannedAge} (nearest frame YouCam accepted)</p>
                )}
              </div>
              <div className="head-actions">
                <button className="btn-primary small" disabled={!shareData} onClick={() => setShareOpen(true)}>🃏 Share card</button>
                <button className="btn-ghost small" onClick={reset}>+ New journey</button>
              </div>
            </div>

            {/* Time machine — age slider on the real aged face */}
            <TimeMachine
              frames={frames}
              targetAge={targetAge}
              onAgeChange={setTargetAge}
              onScanAge={scanThisAge}
              onVerify={verify}
              busy={busy}
              verifyBusy={verifyBusy}
              verdict={verdict}
            />

            {/* Comparison — today vs future */}
            <MetricsTable comparison={comparison} targetAge={targetAge} />

            {/* Habits */}
            <HabitsGrid habits={habits} />

            {/* Progress loop */}
            <JourneyLog history={history} onClear={() => { clearJourneys(); setHistory([]); }} />

            {toast && <div className="toast">{toast}</div>}
          </section>
        )}
      </main>

      {shareOpen && shareData && (
        <ShareModal data={shareData} onClose={() => setShareOpen(false)} onToast={setToast} />
      )}

      <footer className="footer">
        <span>FACE AHEAD v{BUILD_VERSION} · {BUILD_DATE} · YouCam API Hackathon · {provider === 'youcam' ? 'real mode' : 'demo mode'}</span>
      </footer>
    </div>
  );
}

export default App;

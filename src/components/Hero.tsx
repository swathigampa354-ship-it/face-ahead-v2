import { useRef } from 'react';
import { hasKey } from '../lib/youcam';

interface HeroProps {
  onStart: (f?: File) => void;
  onDemo: () => void;
  onFile: (f: File) => void;
}

export function Hero({ onStart, onDemo, onFile }: HeroProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onFile(f);
      onStart(f);
    }
  };

  return (
    <section className="hero">
      <h1 className="hero-title">
        Meet the face<br />
        <em>you're building.</em>
      </h1>
      <p className="hero-sub">
        Upload a selfie. Watch your real face age to 20, 40, 60 — then get a full
        AI skin report on your future self, the honest deltas vs today, and the 3
        evidence-backed habits that change the curve.
      </p>
      <div className="steps">
        <span>📸 Selfie</span>
        <span>→</span>
        <span>⏳ Age it (12→70)</span>
        <span>→</span>
        <span>🔬 Scan today + future</span>
        <span>→</span>
        <span>🛡️ Your 3 moves</span>
      </div>
      <div className="cta-row">
        <button className="btn-primary" onClick={() => inputRef.current?.click()}>
          Start your journey
        </button>
        <button className="btn-ghost" onClick={onDemo}>
          Try demo (no photo)
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />
      </div>
      <div className="chips">
        <span>🔒 Nothing stored server-side</span>
        <span>⚡ ~60s</span>
        <span>🧬 4 YouCam APIs</span>
        <span>📏 Error bars, not guesses</span>
      </div>
      <div className="honesty-contract">
        <strong>Honesty contract</strong> — this is an AI <em>projection</em> of
        photoaging trends, not a medical prediction. Every score shows its
        uncertainty; demo values are always labeled.
      </div>
      {!hasKey() && (
        <div className="demo-badge" style={{ marginTop: 16 }}>
          🎬 demo mode — add VITE_YOUCAM_KEY for real results
        </div>
      )}
    </section>
  );
}

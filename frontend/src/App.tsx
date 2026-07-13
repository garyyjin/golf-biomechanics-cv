import { useEffect, useState } from "react";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import { loadBenchmarks } from "./benchmarks";
import type { BenchmarkTable } from "./benchmarks";
import { LibraryScreen } from "./LibraryScreen";
import { PlayerScreen } from "./PlayerScreen";
import { UploadScreen } from "./UploadScreen";
import type { AnalysisResponse } from "./types";

type Screen = "upload" | "player" | "library";

interface Session {
  videoUrl: string;
  analysis: AnalysisResponse;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [session, setSession] = useState<Session | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkTable>(DEFAULT_BENCHMARKS);

  useEffect(() => {
    void refreshBenchmarks();
  }, []);

  async function refreshBenchmarks() {
    setBenchmarks(await loadBenchmarks());
  }

  function handleAnalyzed(file: File, analysis: AnalysisResponse) {
    setSession({ videoUrl: URL.createObjectURL(file), analysis });
    setScreen("player");
  }

  function handleReset() {
    if (session) URL.revokeObjectURL(session.videoUrl);
    setSession(null);
    setScreen("upload");
  }

  return (
    <>
      <div className="top-nav-bar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Golf Swing Analyzer
        </span>
        <nav className="top-nav toggle-group" role="radiogroup" aria-label="Screen">
          <button
            type="button"
            className={screen !== "library" ? "toggle selected" : "toggle"}
            onClick={() => setScreen(session ? "player" : "upload")}
          >
            Analyze
          </button>
          <button
            type="button"
            className={screen === "library" ? "toggle selected" : "toggle"}
            onClick={() => setScreen("library")}
          >
            Library
          </button>
        </nav>
      </div>

      {screen === "library" ? (
        <LibraryScreen onBenchmarksChanged={refreshBenchmarks} />
      ) : screen === "player" && session ? (
        <PlayerScreen
          videoUrl={session.videoUrl}
          analysis={session.analysis}
          benchmarks={benchmarks}
          onReset={handleReset}
        />
      ) : (
        <UploadScreen onAnalyzed={handleAnalyzed} />
      )}
    </>
  );
}

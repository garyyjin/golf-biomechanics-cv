import { useEffect, useState } from "react";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import { DEFAULT_BENCHMARKS_VERSION, loadBenchmarks } from "./benchmarks";
import type { LoadedBenchmarks } from "./benchmarks";
import { saveSwingSummary } from "./historyApi";
import { LibraryScreen } from "./LibraryScreen";
import { PlayerScreen } from "./PlayerScreen";
import { computeSwingSummary } from "./swingSummary";
import { useTheme } from "./theme";
import { UploadScreen } from "./UploadScreen";
import type { AnalysisResponse } from "./types";

type Screen = "upload" | "player" | "library";

interface Session {
  videoUrl: string;
  /** Object URLs must be revoked on teardown; a URL served by the backend
   * must not be. Tracking which kind this is keeps a future stored-swing
   * playback from being revoked out from under itself. */
  videoUrlIsObjectUrl: boolean;
  analysis: AnalysisResponse;
  /** The history entry the backend stored this swing as. */
  swingId: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [session, setSession] = useState<Session | null>(null);
  const [benchmarks, setBenchmarks] = useState<LoadedBenchmarks>({
    table: DEFAULT_BENCHMARKS,
    version: DEFAULT_BENCHMARKS_VERSION,
  });
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    void refreshBenchmarks();
  }, []);

  async function refreshBenchmarks() {
    setBenchmarks(await loadBenchmarks());
  }

  async function handleAnalyzed(file: File, analysis: AnalysisResponse, swingId: string) {
    setSession((previous) => {
      if (previous?.videoUrlIsObjectUrl) URL.revokeObjectURL(previous.videoUrl);
      return {
        videoUrl: URL.createObjectURL(file),
        videoUrlIsObjectUrl: true,
        analysis,
        swingId,
      };
    });
    setScreen("player");

    // The backend stored the swing but can't score it — scoring lives here.
    // A failure is deliberately swallowed: the user is looking at their
    // analysis, and an unscored swing is recoverable later from its stored
    // analysis.
    try {
      await saveSwingSummary(
        swingId,
        computeSwingSummary(analysis, benchmarks.table, benchmarks.version),
      );
    } catch {
      // recoverable — the summary can be recomputed from the stored analysis
    }
  }

  function handleReset() {
    if (session?.videoUrlIsObjectUrl) URL.revokeObjectURL(session.videoUrl);
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
        <div className="top-nav-right">
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
          <button
            type="button"
            className="icon-button theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      {screen === "library" ? (
        <LibraryScreen onBenchmarksChanged={refreshBenchmarks} />
      ) : screen === "player" && session ? (
        <PlayerScreen
          videoUrl={session.videoUrl}
          analysis={session.analysis}
          benchmarks={benchmarks.table}
          onReset={handleReset}
        />
      ) : (
        <UploadScreen onAnalyzed={handleAnalyzed} />
      )}
    </>
  );
}

const THEME_ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function SunIcon() {
  return (
    <svg {...THEME_ICON_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...THEME_ICON_PROPS}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

import { useEffect, useState } from "react";
import { DEFAULT_BENCHMARKS } from "./benchmarks.default";
import { DEFAULT_BENCHMARKS_VERSION, loadBenchmarks } from "./benchmarks";
import type { LoadedBenchmarks } from "./benchmarks";
import { HistoryScreen } from "./HistoryScreen";
import { saveSwingSummary, swingVideoUrl } from "./historyApi";
import type { HistoryEntry } from "./historyApi";
import { fetchSwingAnalysis } from "./historyApi";
import { LibraryScreen } from "./LibraryScreen";
import { PlayerScreen } from "./PlayerScreen";
import { computeSwingSummary } from "./swingSummary";
import { useTheme } from "./theme";
import { UploadScreen } from "./UploadScreen";
import type { AnalysisResponse } from "./types";

type Screen = "upload" | "player" | "library" | "history";

interface Session {
  videoUrl: string;
  /** Object URLs must be revoked on teardown; a stored swing's http URL must
   * not be. Tracking which kind this is avoids revoking the wrong one, which
   * would silently break playback of a history swing reopened twice. */
  videoUrlIsObjectUrl: boolean;
  analysis: AnalysisResponse;
  /** The history entry this session came from — set both for a freshly
   * analyzed swing (the backend stored it) and for one reopened from
   * history. Lets the player exclude the swing from its own compare picker. */
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

  function replaceSession(next: Session) {
    setSession((previous) => {
      if (previous?.videoUrlIsObjectUrl) URL.revokeObjectURL(previous.videoUrl);
      return next;
    });
    setScreen("player");
  }

  async function handleAnalyzed(file: File, analysis: AnalysisResponse, swingId: string) {
    replaceSession({
      videoUrl: URL.createObjectURL(file),
      videoUrlIsObjectUrl: true,
      analysis,
      swingId,
    });

    // The backend stored the swing but can't score it — scoring lives here.
    // A failure is deliberately swallowed: the user is looking at their
    // analysis, and the history screen recomputes any missing summary anyway.
    try {
      await saveSwingSummary(swingId, computeSwingSummary(analysis, benchmarks.table, benchmarks.version));
    } catch {
      // history will fill this in on its next visit
    }
  }

  /** Reopens a stored swing in the player. Its video streams from the backend
   * rather than a local file, so there's no object URL to revoke. */
  async function handleOpenSwing(entry: HistoryEntry) {
    const analysis = await fetchSwingAnalysis(entry.id);
    replaceSession({
      videoUrl: swingVideoUrl(entry.id),
      videoUrlIsObjectUrl: false,
      analysis,
      swingId: entry.id,
    });
  }

  function handleReset() {
    if (session?.videoUrlIsObjectUrl) URL.revokeObjectURL(session.videoUrl);
    setSession(null);
    setScreen("upload");
  }

  const navTabs: { screen: Screen; label: string; active: boolean }[] = [
    { screen: session ? "player" : "upload", label: "Analyze", active: screen === "upload" || screen === "player" },
    { screen: "history", label: "History", active: screen === "history" },
    { screen: "library", label: "Library", active: screen === "library" },
  ];

  return (
    <>
      <div className="top-nav-bar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Golf Swing Analyzer
        </span>
        <div className="top-nav-right">
          <nav className="top-nav toggle-group" role="radiogroup" aria-label="Screen">
            {navTabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                className={tab.active ? "toggle selected" : "toggle"}
                aria-pressed={tab.active}
                onClick={() => setScreen(tab.screen)}
              >
                {tab.label}
              </button>
            ))}
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
      ) : screen === "history" ? (
        <HistoryScreen benchmarks={benchmarks} onOpenSwing={handleOpenSwing} />
      ) : screen === "player" && session ? (
        <PlayerScreen
          videoUrl={session.videoUrl}
          analysis={session.analysis}
          benchmarks={benchmarks.table}
          currentSwingId={session.swingId}
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

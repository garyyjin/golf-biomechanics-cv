import { useState } from "react";
import { PlayerScreen } from "./PlayerScreen";
import { UploadScreen } from "./UploadScreen";
import type { AnalysisResponse } from "./types";

interface Session {
  videoUrl: string;
  analysis: AnalysisResponse;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  function handleAnalyzed(file: File, analysis: AnalysisResponse) {
    setSession({ videoUrl: URL.createObjectURL(file), analysis });
  }

  function handleReset() {
    if (session) URL.revokeObjectURL(session.videoUrl);
    setSession(null);
  }

  return session ? (
    <PlayerScreen
      videoUrl={session.videoUrl}
      analysis={session.analysis}
      onReset={handleReset}
    />
  ) : (
    <UploadScreen onAnalyzed={handleAnalyzed} />
  );
}

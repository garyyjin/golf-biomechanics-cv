import { useEffect, useRef } from "react";
import { drawComparisonSkeletons } from "./draw";
import { clubSegmentForComparison, normalizeLandmarksForComparison } from "./geometry";
import type { Handedness, Landmark } from "./types";

interface Props {
  userLandmarks: Landmark[] | null;
  userAspect: number;
  userHandedness: Handedness;
  referenceLandmarks: Landmark[] | null;
  referenceAspect: number | null;
  referenceHandedness: Handedness | null;
}

/** Small canvas: user skeleton (solid) over a reference "ghost" skeleton
 * (dashed), both hip-centered/torso-scaled so differing camera framing
 * doesn't distort the comparison. Renders whatever side is available — a
 * missing reference phase still shows the user's skeleton alone. Also draws
 * an approximate club position (hands to estimated club-tip) for each side,
 * since MediaPipe doesn't detect the club itself. */
export function ComparisonDiagram({
  userLandmarks,
  userAspect,
  userHandedness,
  referenceLandmarks,
  referenceAspect,
  referenceHandedness,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const user = normalizeLandmarksForComparison(userLandmarks, userAspect);
    const reference =
      referenceAspect !== null ? normalizeLandmarksForComparison(referenceLandmarks, referenceAspect) : null;
    const userClub = clubSegmentForComparison(userLandmarks, userHandedness, userAspect);
    const referenceClub =
      referenceAspect !== null && referenceHandedness !== null
        ? clubSegmentForComparison(referenceLandmarks, referenceHandedness, referenceAspect)
        : null;
    drawComparisonSkeletons(ctx, cssWidth, cssHeight, user, reference, userClub, referenceClub);
  }, [
    userLandmarks,
    userAspect,
    userHandedness,
    referenceLandmarks,
    referenceAspect,
    referenceHandedness,
  ]);

  return <canvas ref={canvasRef} className="comparison-canvas" />;
}

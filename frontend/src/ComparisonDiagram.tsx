import { useEffect, useRef } from "react";
import { drawComparisonSkeletons } from "./draw";
import { clubSegmentForComparison, normalizeLandmarksForComparison } from "./geometry";
import type { Point } from "./geometry";
import type { Handedness, Landmark } from "./types";

interface Props {
  userLandmarks: Landmark[] | null;
  userAspect: number;
  userHandedness: Handedness;
  userDetectedTip?: Point | null;
  referenceLandmarks: Landmark[] | null;
  referenceAspect: number | null;
  referenceHandedness: Handedness | null;
  referenceDetectedTip?: Point | null;
}

/** Small canvas: user skeleton (solid) over a reference "ghost" skeleton
 * (dashed), both hip-centered/torso-scaled so differing camera framing
 * doesn't distort the comparison. Renders whatever side is available — a
 * missing reference phase still shows the user's skeleton alone. Also draws
 * the club position (hands to tip) for each side, preferring the backend's
 * detected tip and falling back to the body-pose estimate. */
export function ComparisonDiagram({
  userLandmarks,
  userAspect,
  userHandedness,
  userDetectedTip,
  referenceLandmarks,
  referenceAspect,
  referenceHandedness,
  referenceDetectedTip,
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
    const userClub = clubSegmentForComparison(userLandmarks, userHandedness, userAspect, userDetectedTip);
    const referenceClub =
      referenceAspect !== null && referenceHandedness !== null
        ? clubSegmentForComparison(referenceLandmarks, referenceHandedness, referenceAspect, referenceDetectedTip)
        : null;
    drawComparisonSkeletons(ctx, cssWidth, cssHeight, user, reference, userClub, referenceClub);
  }, [
    userLandmarks,
    userAspect,
    userHandedness,
    userDetectedTip,
    referenceLandmarks,
    referenceAspect,
    referenceHandedness,
    referenceDetectedTip,
  ]);

  return <canvas ref={canvasRef} className="comparison-canvas" />;
}

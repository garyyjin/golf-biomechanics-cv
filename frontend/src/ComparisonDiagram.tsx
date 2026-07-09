import { useEffect, useRef } from "react";
import { drawComparisonSkeletons } from "./draw";
import { normalizeLandmarksForComparison } from "./geometry";
import type { Landmark } from "./types";

interface Props {
  userLandmarks: Landmark[] | null;
  userAspect: number;
  referenceLandmarks: Landmark[] | null;
  referenceAspect: number | null;
}

/** Small canvas: user skeleton (solid) over a reference "ghost" skeleton
 * (dashed), both hip-centered/torso-scaled so differing camera framing
 * doesn't distort the comparison. Renders whatever side is available — a
 * missing reference phase still shows the user's skeleton alone. */
export function ComparisonDiagram({ userLandmarks, userAspect, referenceLandmarks, referenceAspect }: Props) {
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
    drawComparisonSkeletons(ctx, cssWidth, cssHeight, user, reference);
  }, [userLandmarks, userAspect, referenceLandmarks, referenceAspect]);

  return <canvas ref={canvasRef} className="comparison-canvas" />;
}

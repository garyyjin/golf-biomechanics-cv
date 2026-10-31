import {
  LEFT_ANKLE,
  RIGHT_ANKLE,
  downTheLineAlignmentRatio,
  findAddressFrame,
} from "./geometry.ts";
import type { SwingPhases } from "./phases.ts";
import { VISIBILITY_THRESHOLD } from "./pose.ts";
import type { AnalysisResponse, Landmark } from "./types.ts";

/**
 * Whether the clip itself was filmed in a way the analysis can trust.
 *
 * Every number this app reports is only as good as the footage going in, and
 * the failure modes are consistent and recognisable: a golfer cropped at the
 * ankles, a camera so far away the pose is a few dozen pixels tall, a clip
 * shot at 20fps (which can't resolve a downswing), or a down-the-line video
 * taken from 30 degrees off the target line. Rather than silently returning
 * shakier readings, each of those becomes a named check with a concrete fix —
 * the same "is your setup good?" gate paid analyzers put in front of their
 * measurements.
 */

export type CaptureCheckLevel = "pass" | "warn" | "fail";

export interface CaptureCheck {
  id: "pose" | "framing" | "subject-size" | "frame-rate" | "swing" | "alignment";
  label: string;
  level: CaptureCheckLevel;
  /** What was measured, in plain language. */
  detail: string;
  /** What to change next time, when the check isn't a pass. */
  advice: string | null;
}

export type CaptureGrade = "good" | "usable" | "poor";

export interface CaptureReport {
  checks: CaptureCheck[];
  grade: CaptureGrade;
}

const NOSE = 0;

const POSE_COVERAGE_PASS = 0.9;
const POSE_COVERAGE_WARN = 0.7;

// Height of the golfer in frame, as a fraction of frame height. Below the
// warn threshold the pose is small enough that joint positions quantise to
// several centimetres of real movement; above the pass ceiling the follow
// through is likely to leave the frame.
const SUBJECT_HEIGHT_PASS = 0.3;
const SUBJECT_HEIGHT_WARN = 0.18;

// Frame edges, as a fraction of the frame, where a body part is considered
// too close to the border to be reliably tracked through a swing.
const EDGE_MARGIN = 0.02;

const MIN_USABLE_FPS = 24;
const GOOD_FPS = 30;

function visible(landmarks: Landmark[] | null, index: number): Landmark | null {
  if (!landmarks) return null;
  const landmark = landmarks[index];
  return landmark && landmark.visibility >= VISIBILITY_THRESHOLD ? landmark : null;
}

function poseCoverageCheck(analysis: AnalysisResponse): CaptureCheck {
  const total = analysis.frames.length;
  const tracked = analysis.frames.filter((f) => f.landmarks !== null).length;
  const coverage = total === 0 ? 0 : tracked / total;
  const percent = Math.round(coverage * 100);

  if (coverage >= POSE_COVERAGE_PASS) {
    return {
      id: "pose",
      label: "Body tracking",
      level: "pass",
      detail: `Tracked your pose in ${percent}% of frames.`,
      advice: null,
    };
  }
  return {
    id: "pose",
    label: "Body tracking",
    level: coverage >= POSE_COVERAGE_WARN ? "warn" : "fail",
    detail: `Tracked your pose in only ${percent}% of frames.`,
    advice:
      "Film against a plain, uncluttered background with even lighting — strong backlight, shadows, and busy backgrounds are what make the detector lose you mid-swing.",
  };
}

function framingCheck(analysis: AnalysisResponse): CaptureCheck {
  const address = findAddressFrame(analysis.frames);
  if (!address?.landmarks) {
    return {
      id: "framing",
      label: "Framing",
      level: "fail",
      detail: "Couldn't find a clear pose at address to judge framing from.",
      advice:
        "Start recording a moment before you take your stance, back far enough that your head and feet are both visible.",
    };
  }

  const nose = visible(address.landmarks, NOSE);
  const lead = visible(address.landmarks, LEFT_ANKLE);
  const trail = visible(address.landmarks, RIGHT_ANKLE);
  const ankle = lead && trail ? (lead.y > trail.y ? lead : trail) : (lead ?? trail);

  if (!nose || !ankle) {
    return {
      id: "framing",
      label: "Framing",
      level: "warn",
      detail: "Your head or feet weren't both clearly visible at address.",
      advice:
        "Set the camera back far enough to show your whole body, head to feet, with a little space above and below.",
    };
  }

  if (nose.y < EDGE_MARGIN) {
    return {
      id: "framing",
      label: "Framing",
      level: "warn",
      detail: "Your head is touching the top edge of the frame at address.",
      advice: "Tilt the camera up slightly or step back so there's room above your head.",
    };
  }
  if (ankle.y > 1 - EDGE_MARGIN) {
    return {
      id: "framing",
      label: "Framing",
      level: "warn",
      detail: "Your feet are touching the bottom edge of the frame at address.",
      advice: "Tilt the camera down slightly or step back so your feet sit fully inside the frame.",
    };
  }

  return {
    id: "framing",
    label: "Framing",
    level: "pass",
    detail: "Head and feet both sit inside the frame at address.",
    advice: null,
  };
}

function subjectSizeCheck(analysis: AnalysisResponse): CaptureCheck {
  const address = findAddressFrame(analysis.frames);
  const landmarks = address?.landmarks ?? null;
  const nose = visible(landmarks, NOSE);
  const lead = visible(landmarks, LEFT_ANKLE);
  const trail = visible(landmarks, RIGHT_ANKLE);
  const ankle = lead && trail ? (lead.y > trail.y ? lead : trail) : (lead ?? trail);
  if (!nose || !ankle || ankle.y <= nose.y) {
    return {
      id: "subject-size",
      label: "Distance",
      level: "warn",
      detail: "Couldn't measure how much of the frame you fill.",
      advice: "Keep your whole body in frame from a comfortable distance.",
    };
  }

  const height = ankle.y - nose.y;
  const percent = Math.round(height * 100);
  if (height >= SUBJECT_HEIGHT_PASS) {
    return {
      id: "subject-size",
      label: "Distance",
      level: "pass",
      detail: `You fill ${percent}% of the frame's height.`,
      advice: null,
    };
  }
  return {
    id: "subject-size",
    label: "Distance",
    level: height >= SUBJECT_HEIGHT_WARN ? "warn" : "fail",
    detail: `You fill only ${percent}% of the frame's height.`,
    advice:
      "Move the camera closer or zoom in so your body fills roughly a third to a half of the frame — at this distance joint angles are being read from too few pixels.",
  };
}

function frameRateCheck(analysis: AnalysisResponse): CaptureCheck {
  const fps = Math.round(analysis.fps);
  if (fps >= GOOD_FPS) {
    return {
      id: "frame-rate",
      label: "Frame rate",
      level: "pass",
      detail: `Recorded at ${fps}fps.`,
      advice: null,
    };
  }
  return {
    id: "frame-rate",
    label: "Frame rate",
    level: fps >= MIN_USABLE_FPS ? "warn" : "fail",
    detail: `Recorded at ${fps}fps.`,
    advice:
      "Film at 30fps or higher (or use your phone's slow-motion mode) — a downswing lasts about a quarter of a second, so a low frame rate can miss the moment of impact and under-read speed.",
  };
}

function swingCheck(phases: SwingPhases): CaptureCheck {
  if (phases.address !== null && phases.top !== null && phases.impact !== null) {
    return {
      id: "swing",
      label: "Swing detected",
      level: "pass",
      detail: "Found your address, top of backswing, and impact.",
      advice: null,
    };
  }
  if (phases.address !== null) {
    return {
      id: "swing",
      label: "Swing detected",
      level: "warn",
      detail: "Found your setup, but couldn't pin down the whole swing.",
      advice:
        "Record a little stillness before you start, then the full swing through to your finish — clipping the start or end of the motion is the usual cause.",
    };
  }
  return {
    id: "swing",
    label: "Swing detected",
    level: "fail",
    detail: "Couldn't find a swing in this clip.",
    advice:
      "Check that the clip actually contains a full swing, that the camera isn't moving, and that you're visible from head to feet.",
  };
}

function alignmentCheck(analysis: AnalysisResponse): CaptureCheck | null {
  if (analysis.view !== "down_the_line") return null;
  const address = findAddressFrame(analysis.frames);
  const ratio =
    address && analysis.height > 0
      ? downTheLineAlignmentRatio(address.landmarks, analysis.width / analysis.height)
      : null;
  if (ratio === null) return null;

  // Mirrors isDownTheLineMisaligned's threshold; kept as a check (rather than
  // the boolean warning in the player) so it sits beside the other setup
  // problems instead of on its own line.
  if (ratio <= 0.35) {
    return {
      id: "alignment",
      label: "Camera alignment",
      level: "pass",
      detail: "Camera looks lined up with the target line.",
      advice: null,
    };
  }
  return {
    id: "alignment",
    label: "Camera alignment",
    level: "warn",
    detail: "Your stance looks open to the camera, so it may be off the target line.",
    advice:
      "For down-the-line video, stand directly behind the ball looking down the target line — a camera off to the side skews every angle in this view.",
  };
}

/**
 * Runs every check. Order is deliberate: tracking first (without it nothing
 * else means much), then framing/distance/frame rate, then whether a swing
 * was found at all, then view-specific alignment.
 */
export function checkCapture(analysis: AnalysisResponse, phases: SwingPhases): CaptureReport {
  const checks: CaptureCheck[] = [
    poseCoverageCheck(analysis),
    framingCheck(analysis),
    subjectSizeCheck(analysis),
    frameRateCheck(analysis),
    swingCheck(phases),
  ];
  const alignment = alignmentCheck(analysis);
  if (alignment) checks.push(alignment);

  const grade: CaptureGrade = checks.some((c) => c.level === "fail")
    ? "poor"
    : checks.some((c) => c.level === "warn")
      ? "usable"
      : "good";

  return { checks, grade };
}

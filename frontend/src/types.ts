export type View = "face_on" | "down_the_line";
export type Handedness = "right" | "left";
export type Quality = "fast" | "accurate";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  index: number;
  t: number;
  landmarks: Landmark[] | null;
  // Normalized [0,1] point from the backend's Hough-line club detection
  // (see backend/app/pose.py's _detect_club_tip), or null/absent when no
  // confident line was found — callers fall back to a body-pose-based
  // estimate (geometry.ts's clubTipEstimate) in that case. Optional so
  // test fixtures that predate this field don't all need updating.
  club_tip?: { x: number; y: number } | null;
  // Normalized [0,1] point from a separate, still-experimental per-frame
  // YOLOv8n clubhead detector (see backend/app/club.py) — additive data for
  // evaluating against club_tip, not a replacement for it yet. Always
  // null/absent until backend/app/models/clubhead.pt exists (no trained
  // weights yet). Optional for the same reason as club_tip.
  club_tip_yolo?: { x: number; y: number } | null;
}

export interface AnalysisResponse {
  fps: number;
  width: number;
  height: number;
  frame_count: number;
  view: View;
  handedness: Handedness;
  quality: Quality;
  frames: PoseFrame[];
}

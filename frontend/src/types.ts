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
  //
  // confidence is a [0,1] *quality score* for the detected line, not a
  // probability, and deliberately not on the same scale as club_tip_yolo's
  // — never compare the two numerically (see club.ts's fuseClubTrack).
  // Optional on its own: analyses stored in the library before the backend
  // reported it have the point but no score, and an absent score must read
  // as "unknown" (i.e. pass every threshold) rather than as a weak one, or
  // those entries would silently lose their club track.
  club_tip?: { x: number; y: number; confidence?: number } | null;
  // Normalized [0,1] point from a separate per-frame YOLOv8n clubhead
  // detector (see backend/app/club.py). Reports the clubhead *toe*, where
  // club_tip reports a point along the shaft — club.ts reconciles the two
  // into one track. Always null/absent until backend/app/models/clubhead.pt
  // exists. confidence is the model's own class probability; it is optional
  // for the same back-compat reason as club_tip's.
  club_tip_yolo?: { x: number; y: number; confidence?: number } | null;
  // Normalized [0,1] ball box from a per-frame YOLOv8n ball detector (see
  // backend/app/ball.py). Position (x, y) is only meaningful around and
  // after impact -- the ball isn't a moving target before then. width/height
  // (the box's normalized size) are usable anywhere the ball is visible,
  // including at address -- a golf ball's real diameter is a known constant,
  // so its box size doubles as a distance-calibration reference (see
  // stats.ts's inchesPerNormalizedUnitFromBall). Null/absent when no model is
  // installed or nothing was detected this frame; width/height are further
  // optional so fixtures/analyses from before this field existed still
  // typecheck.
  ball_tip?: { x: number; y: number; width?: number; height?: number } | null;
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

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

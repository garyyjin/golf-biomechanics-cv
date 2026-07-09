import type { Landmark } from "./types";

export function makeLandmarks(overrides: Record<number, Partial<Landmark>>): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }));
  for (const [index, patch] of Object.entries(overrides)) {
    Object.assign(landmarks[Number(index)], patch);
  }
  return landmarks;
}

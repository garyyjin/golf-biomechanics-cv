import type { MetricId, Phase } from "./benchmarks.ts";
import type { View } from "./types.ts";

type Direction = "below" | "above";
type TipKey = `${View}:${Phase}:${MetricId}:${Direction}`;

/**
 * Beginner-friendly, plain-English coaching cues — one per (view, phase,
 * metric, direction) combination that actually appears in
 * benchmarks.default.ts. These replace raw angle numbers as the primary
 * feedback: a new golfer can act on "turn your hips more at the top" in a
 * way they can't act on "hipTurn was 22°, target 35-55°."
 */
const TIPS: Partial<Record<TipKey, string>> = {
  // face-on / address
  "face_on:address:spineTilt:below":
    "You're standing a little too upright at address — bend forward slightly more from your hips.",
  "face_on:address:spineTilt:above":
    "You're bent over a bit too much at address — stand a little taller.",
  "face_on:address:shoulderTurn:below":
    "Your shoulders are too level at address — let your back shoulder sit a little lower to set a natural tilt.",
  "face_on:address:shoulderTurn:above":
    "Your shoulders are tilted more than usual at address — try leveling them out a bit.",
  "face_on:address:hipTurn:below":
    "Your hips are tilted the wrong way at address — try to keep them close to level.",
  "face_on:address:hipTurn:above":
    "Your hips are tilted more than they should be at address — try to keep them closer to level.",

  // face-on / top of backswing
  "face_on:top:shoulderTurn:below":
    "You're not turning your shoulders enough at the top — try rotating your chest further away from the target until you feel a full stretch.",
  "face_on:top:shoulderTurn:above":
    "You're turning your shoulders more than usual at the top — focus on a more controlled backswing turn.",
  "face_on:top:hipTurn:below":
    "Your hips aren't turning enough at the top — let your back hip rotate away from the target a bit more as you swing back.",
  "face_on:top:hipTurn:above":
    "Your hips are turning more than your shoulders can support at the top — try making a bigger shoulder turn to match.",
  "face_on:top:xFactor:below":
    "There's not much separation between your shoulders and hips at the top — try turning your shoulders more while keeping your hips a bit quieter.",
  "face_on:top:xFactor:above":
    "Your shoulders and hips are twisting apart more than usual at the top — a slightly shorter, more connected turn may feel more repeatable.",

  // face-on / impact
  "face_on:impact:spineTilt:below":
    "You're too upright through impact — keep some forward bend in your posture as you strike the ball.",
  "face_on:impact:spineTilt:above":
    "You're bent over more than you should be at impact — try to stay a bit taller through the strike.",
  "face_on:impact:shoulderTurn:below":
    "Your shoulders haven't rotated through enough at impact — keep turning through the ball instead of stalling.",
  "face_on:impact:shoulderTurn:above":
    "Your shoulders are ahead of where they should be at impact — try letting the club catch up before you rotate through.",
  "face_on:impact:hipTurn:below":
    "Your hips aren't opening enough through impact — really turn and clear your hips toward the target as you swing down.",
  "face_on:impact:hipTurn:above":
    "Your hips are opening very fast through impact — make sure your upper body and arms are keeping pace.",
  "face_on:impact:xFactor:below":
    "Your shoulders and hips are moving together at impact instead of your hips leading — try letting your hips open first as you start down.",
  "face_on:impact:xFactor:above":
    "Your hips are way ahead of your shoulders at impact — let your upper body catch up a bit more before you finish rotating.",

  // down-the-line / address
  "down_the_line:address:spineTilt:below":
    "You're too upright at address — bend forward more from your hips to get into a solid setup posture.",
  "down_the_line:address:spineTilt:above":
    "You're bent over too much at address — stand up a little taller.",
  "down_the_line:address:hipTurn:below":
    "Your hips look turned open at address — try squaring them up toward the target line.",
  "down_the_line:address:hipTurn:above":
    "Your hips look turned closed at address — try squaring them up toward the target line.",
  "down_the_line:address:planeAngle:below":
    "Your hands are set lower relative to your shoulders than usual at address — check you're not reaching down for the ball.",
  "down_the_line:address:planeAngle:above":
    "Your hands are set higher relative to your shoulders than usual at address — make sure your arms aren't too tense or raised.",

  // down-the-line / top of backswing
  "down_the_line:top:hipTurn:below":
    "Your hips aren't turning enough on the way to the top — let them rotate back a bit more.",
  "down_the_line:top:hipTurn:above":
    "Your hips are turning more than usual on the way to the top — try keeping them a little quieter.",
  "down_the_line:top:spineRetention:above":
    "You're losing the forward bend you started with by the top of your backswing — try to keep the same spine angle you set at address.",

  // down-the-line / impact
  "down_the_line:impact:spineTilt:below":
    "You're standing up too early — keep your forward bend through impact instead of straightening up.",
  "down_the_line:impact:spineTilt:above":
    "You're bent over more than usual at impact — try to stay a bit taller through the strike.",
  "down_the_line:impact:hipTurn:below":
    "Your hips aren't opening enough through impact — keep rotating them toward the target as you swing down.",
  "down_the_line:impact:hipTurn:above":
    "Your hips are opening very quickly through impact — make sure the rest of your body is keeping up.",
  "down_the_line:impact:spineRetention:above":
    "You're losing your spine angle through impact — focus on keeping the same posture you had at address all the way to the ball.",
};

/**
 * Plain-English cue for a flagged metric, or null when the metric is within
 * range, undetected, or (rarely) a direction with no authored copy — callers
 * fall back to a generic message in that case rather than showing nothing.
 */
export function getCoachingTip(
  view: View,
  phase: Phase,
  metric: MetricId,
  direction: Direction,
): string | null {
  return TIPS[`${view}:${phase}:${metric}:${direction}`] ?? null;
}

import type { MetricId } from "./benchmarks.ts";
import type { FeedbackItem, FeedbackResult } from "./feedback.ts";
import { MIN_SCORE_CONFIDENCE } from "./measurement.ts";

export type DrillDirection = "below" | "above";

export interface Drill {
  name: string;
  /** One line to hold in mind while doing it. */
  cue: string;
  /** Two or three concrete steps, in order. */
  steps: string[];
}

/**
 * A drill for each way a metric can miss its range.
 *
 * Keyed on metric + direction rather than on view/phase/metric: the same
 * physical fault needs the same correction whether it showed up at the top of
 * the backswing in one camera view or at impact in the other, and duplicating
 * the prose per view would just let the copies drift. coachingTips.ts already
 * handles the diagnosis in the golfer's words; this is the "what do I
 * practise about it" step, which is the part a lesson would otherwise
 * provide.
 */
const DRILLS: Record<`${MetricId}:${DrillDirection}`, Drill> = {
  "spineTilt:below": {
    name: "Hip-hinge posture reset",
    cue: "Bend from the hips, not the waist.",
    steps: [
      "Stand with a club held across your hips, then push your hips back until your chest drops toward the ball.",
      "Keep a soft knee and a straight lower back — you should feel tension in your hamstrings, not your lower back.",
      "Hold that posture for five slow breaths, then step into a shot keeping the same shape.",
    ],
  },
  "spineTilt:above": {
    name: "Club-across-the-shoulders posture check",
    cue: "Tall spine, arms hanging free.",
    steps: [
      "Hold a club across your shoulders and set up with the shaft pointing slightly above the ball.",
      "Stand a little taller until your arms hang without reaching for the ball.",
      "Make half-speed swings keeping the shaft's angle through the ball.",
    ],
  },
  "shoulderTurn:below": {
    name: "Wall turn",
    cue: "Turn your chest, not just your arms.",
    steps: [
      "Stand with your back to a wall, a club across your shoulders.",
      "Turn your chest away from the target until your lead shoulder points at the ball and your back almost touches the wall.",
      "Pause at the top, then turn through slowly — 10 reps, no ball.",
    ],
  },
  "shoulderTurn:above": {
    name: "Connected half-turn",
    cue: "A turn you can repeat beats a turn that's bigger.",
    steps: [
      "Set up with a glove or headcover held under your lead armpit.",
      "Swing to the top stopping at roughly three-quarters of your usual turn, keeping the glove in place.",
      "Hit 10 half-speed shots, then let the turn grow back only as far as you can hold it.",
    ],
  },
  "hipTurn:below": {
    name: "Step-through drill",
    cue: "Let the hips lead the turn.",
    steps: [
      "Set up with your feet together and the ball slightly forward.",
      "Step your lead foot out as you start down, letting the pelvis open toward the target.",
      "Finish balanced on your lead foot — 10 reps, then repeat with a normal stance.",
    ],
  },
  "hipTurn:above": {
    name: "Quiet-hips backswing",
    cue: "Shoulders turn, hips resist.",
    steps: [
      "Set up with a club across your hips and your feet slightly wider than usual.",
      "Make a backswing while keeping the club across your hips almost still — the turn comes from your chest.",
      "Feel the stretch in your trail hip, then turn through at normal speed.",
    ],
  },
  "xFactor:below": {
    name: "Separation stretch",
    cue: "Chest turns, hips hold.",
    steps: [
      "Set up with a club across your shoulders and your feet planted.",
      "Turn your chest to the top while deliberately keeping your belt buckle facing the ball.",
      "Hold for two seconds, feel the stretch, then unwind — 8 reps.",
    ],
  },
  "xFactor:above": {
    name: "One-piece takeaway",
    cue: "Keep your chest and hips connected early.",
    steps: [
      "Set up with a club across your chest and hips at the same time.",
      "Start the backswing moving both together until your hands pass your trail thigh.",
      "Then let the chest keep turning while the hips settle — half-speed swings with a ball.",
    ],
  },
  "planeAngle:below": {
    name: "Alignment-rod gate",
    cue: "Swing under the rod, not at it.",
    steps: [
      "Push an alignment rod into the ground at your trail side, angled along your shaft at address.",
      "Make slow backswings keeping the club under the rod on the way back.",
      "If you hit the rod, your arms are lifting rather than swinging around your body.",
    ],
  },
  "planeAngle:above": {
    name: "Shallow-to-steep plane check",
    cue: "Let the club fall into the slot.",
    steps: [
      "Put a headcover just outside the ball on your trail side.",
      "Make half-speed swings from the top with the club moving down and slightly away from you.",
      "Missing the headcover means you're coming down on a playable plane instead of over the top.",
    ],
  },
  "spineRetention:below": {
    name: "Chest-over-the-ball holds",
    cue: "Keep your chest covering the ball through impact.",
    steps: [
      "Set up normally, then place a club across your chest pointing at the ball.",
      "Make half-speed swings and keep the club pointing at the ball through impact.",
      "Add speed only once the club stays pointed at the ball all the way through.",
    ],
  },
  "spineRetention:above": {
    name: "Wall backswing",
    cue: "Keep the posture you set.",
    steps: [
      "Stand with your backside just touching a wall, in your setup posture.",
      "Make a full backswing without letting your hips move toward the wall — that move is early extension.",
      "Hold the top for a beat, then swing through keeping your chest over the ball.",
    ],
  },
};

export function getDrill(metric: MetricId, direction: DrillDirection): Drill | null {
  return DRILLS[`${metric}:${direction}`] ?? null;
}

export const MAX_PRACTICE_FOCUSES = 3;

export interface PracticeFocus {
  item: FeedbackItem;
  drill: Drill;
}

/**
 * The two or three things worth practising, drawn from the flagged feedback.
 *
 * Low-confidence readings are left out: telling someone to rebuild their hip
 * turn from a metric the detector barely saw is how a tool loses trust. Order
 * is the swing's own order (address, then top, then impact), which keeps a
 * setup fault ahead of a mid-swing one, and each metric only appears once
 * even when it's flagged at more than one phase.
 */
export function buildPracticePlan(result: FeedbackResult, limit = MAX_PRACTICE_FOCUSES): PracticeFocus[] {
  const focuses: PracticeFocus[] = [];
  const seen = new Set<MetricId>();

  for (const item of result.items) {
    if (item.status !== "below" && item.status !== "above") continue;
    if (item.confidence < MIN_SCORE_CONFIDENCE) continue;
    if (seen.has(item.metric)) continue;
    const drill = getDrill(item.metric, item.status);
    if (!drill) continue;
    seen.add(item.metric);
    focuses.push({ item, drill });
    if (focuses.length >= limit) break;
  }
  return focuses;
}

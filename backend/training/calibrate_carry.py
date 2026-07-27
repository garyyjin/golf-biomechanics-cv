"""One-time offline calibration for the estimated-carry formula in
frontend/src/stats.ts.

Not called at runtime -- run manually, whenever the constants need
regenerating:

    python training/calibrate_carry.py

Downloads the CSV from CaddieSet (https://github.com/damilab/CaddieSet,
MIT licensed), a public dataset of 1,757 real golf shots captured with a
camera-based launch monitor, and fits carry distance (yards) as a linear
function of ball speed (mph) for driver ("W1") shots only -- matching this
app's existing driver-length assumption (ASSUMED_CLUB_LENGTH_INCHES in
stats.ts). Prints the slope/intercept/bounds to paste into
DRIVER_CARRY_REGRESSION in stats.ts.

CaddieSet has no clubhead-speed column, so it can't calibrate
ASSUMED_SMASH_FACTOR -- only the ball-speed-to-carry relationship.
"""

import csv
import urllib.request

CSV_URL = "https://raw.githubusercontent.com/damilab/CaddieSet/main/data/CaddieSet.csv"
MPS_TO_MPH = 2.2369362921
M_TO_YD = 1.0936132983


def linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r2 = 1 - ss_res / ss_tot
    return slope, intercept, r2


def main() -> None:
    with urllib.request.urlopen(CSV_URL) as resp:
        rows = list(csv.DictReader(line.decode("utf-8") for line in resp))

    driver_shots = [r for r in rows if r["ClubType"] == "W1" and r["BallSpeed"] and r["Carry"]]
    ball_speed_mph = [float(r["BallSpeed"]) * MPS_TO_MPH for r in driver_shots]
    carry_yards = [float(r["Carry"]) * M_TO_YD for r in driver_shots]

    slope, intercept, r2 = linreg(ball_speed_mph, carry_yards)

    print(f"n = {len(driver_shots)}, r^2 = {r2:.4f}")
    print(f"ballSpeedMph range: [{min(ball_speed_mph):.1f}, {max(ball_speed_mph):.1f}]")
    print(f"carryYards range:   [{min(carry_yards):.1f}, {max(carry_yards):.1f}]")
    print()
    print("export const DRIVER_CARRY_REGRESSION = {")
    print(f"  slopeYardsPerMph: {slope:.4f},")
    print(f"  interceptYards: {intercept:.3f},")
    print(f"  minBallSpeedMph: {min(ball_speed_mph):.1f},")
    print(f"  maxBallSpeedMph: {max(ball_speed_mph):.1f},")
    print("};")


if __name__ == "__main__":
    main()

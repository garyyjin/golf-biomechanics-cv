// Standard MediaPipe Pose topology (mp.solutions.pose.POSE_CONNECTIONS).
export const POSE_CONNECTIONS: [number, number][] = [
  // face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // left arm + hand
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // right arm + hand
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // left leg + foot
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // right leg + foot
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

export const VISIBILITY_THRESHOLD = 0.5;

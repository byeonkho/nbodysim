// Plain-language explanation shared by the reference toggle and readout.
export const DRIFT_CHIP_TOOLTIP =
  "Compare the simulated path with space-agency ephemeris data. The gap includes simplified physics and accumulated numerical error. The scene is smoothed between saved snapshots.";

export const DRIFT_READOUT_COPY =
  "This compares the last saved simulation snapshot with a reference sample at the same time. The gap includes both simplified physics and numerical error; it is not a pure accuracy score for the integrator. For Mars and the outer planets, the comparison uses the combined planetary system, including its selected massive moons. The scene is smoothed between snapshots, while these numbers update at saved snapshots.";

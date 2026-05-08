"use client";

import React from "react";
import { Box, Paper, Slider, Typography } from "@mui/material";
import {
  setDevSetting,
  useDevSettings,
} from "@/app/dev/devSettingsStore";
import theme from "@/muiTheme";

/**
 * User-facing camera tuning panel — same backing store as the dev tunables,
 * but with friendlier labels and surfaced via the MiniDrawer alongside
 * Sim Params / Info Overview.
 */
const CameraSettings: React.FC = () => {
  const { zoomSensitivity, orbitDampingFactor, cameraZoomLerpRate } =
    useDevSettings();

  return (
    <Paper
      sx={{
        width: "100%",
        padding: 2,
        backgroundColor: theme.palette.background.default,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        boxSizing: "border-box",
      }}
    >
      <Typography variant="subtitle2" color="text.primary">
        Camera Settings
      </Typography>

      <Box>
        <Typography variant="caption" color="text.secondary">
          Zoom speed: {zoomSensitivity.toFixed(4)}
        </Typography>
        <Slider
          size="small"
          value={zoomSensitivity}
          min={0.0001}
          max={0.01}
          step={0.0001}
          onChange={(_, v) => setDevSetting("zoomSensitivity", v as number)}
        />
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary">
          Camera damping: {orbitDampingFactor.toFixed(3)}
        </Typography>
        <Slider
          size="small"
          value={orbitDampingFactor}
          min={0.001}
          max={0.5}
          step={0.001}
          onChange={(_, v) =>
            setDevSetting("orbitDampingFactor", v as number)
          }
        />
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary">
          Tracking responsiveness: {cameraZoomLerpRate.toFixed(2)}
        </Typography>
        <Slider
          size="small"
          value={cameraZoomLerpRate}
          min={0.01}
          max={0.5}
          step={0.01}
          onChange={(_, v) =>
            setDevSetting("cameraZoomLerpRate", v as number)
          }
        />
      </Box>
    </Paper>
  );
};

export default CameraSettings;

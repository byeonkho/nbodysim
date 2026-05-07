import React from "react";
import { Box } from "@mui/material";
import { useSelector } from "react-redux";

// Import your components
import Scene from "@/app/components/scene/Scene";
import MiniDrawer from "@/app/components/interface/drawer/MiniDrawer";
import UpdateModal from "@/app/components/interface/misc/UpdateModal";
import BodySelector from "@/app/components/interface/misc/BodySelector";
import CurrentTimeStep from "@/app/components/interface/misc/CurrentTimeStep";
import ControlsContainer from "@/app/components/interface/controls/ControlsContainer";
import FadeNotification from "@/app/components/interface/misc/FadeNotification";
import {
  selectShowAxes,
  selectShowGrid,
  selectShowPlanetInfoOverlay,
  selectSimulationScale,
} from "@/app/store/slices/SimulationSlice";

const Layout: React.FC = () => {
  const simulationScale = useSelector(selectSimulationScale);
  const showAxes = useSelector(selectShowAxes);
  const showGrid = useSelector(selectShowGrid);
  const showPlanetInfoOverlay = useSelector(selectShowPlanetInfoOverlay);

  return (
    <Box
      sx={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          flexGrow: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 3D Scene */}
        <Box
          sx={{
            position: "absolute",
            zIndex: 0,
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "black",
          }}
        >
          <Scene />
        </Box>

        {/* UI Overlays */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1, // above the scene
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <ControlsContainer />
          <UpdateModal />
          <Box
            sx={{
              pointerEvents: "auto",
            }}
          >
            <BodySelector />
          </Box>

          <Box
            sx={{
              pointerEvents: "auto",
            }}
          >
            <MiniDrawer />
          </Box>

          <Box>
            <FadeNotification
              key={simulationScale.name}
              message={`Scale: ${simulationScale.name}`}
              trigger={simulationScale}
            />
            <FadeNotification
              key={`axes-${showAxes}`}
              message={`Axes: ${showAxes ? "On" : "Off"}`}
              trigger={showAxes}
            />
            <FadeNotification
              key={`grid-${showGrid}`}
              message={`Grid: ${showGrid ? "On" : "Off"}`}
              trigger={showGrid}
            />
            <FadeNotification
              key={`overlay-${showPlanetInfoOverlay}`}
              message={`Show all planets: ${showPlanetInfoOverlay ? "On" : "Off"}`}
              trigger={showPlanetInfoOverlay}
            />
          </Box>

          <Box sx={{ position: "absolute", top: 20, right: 50 }}>
            <CurrentTimeStep />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Layout;

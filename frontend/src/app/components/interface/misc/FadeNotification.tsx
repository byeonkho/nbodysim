import React, { useEffect, useState } from "react";
import { Box, Fade, Typography } from "@mui/material";
import { selectSimulationDataSize } from "@/app/store/slices/SimulationSlice";
import { useSelector } from "react-redux";

interface FadeNotificationProps {
  message: string;
  trigger: unknown;
  key?: string;
}

const FadeNotification: React.FC<FadeNotificationProps> = ({
  message,
  trigger,
}) => {
  const [visible, setVisible] = useState(false);
  const [float, setFloat] = useState(false); // controls vertical movement
  const simulationData = useSelector(selectSimulationDataSize); // only allow visibility if data loaded

  // Show the notification, then schedule a fade-out — legitimate use of
  // setState in an effect (transient UI tied to prop changes).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (message && simulationData) {
      setVisible(true);
      setFloat(false);
      const floatTimer = setTimeout(() => setFloat(true), 500);
      const timer = setTimeout(() => setVisible(false), 1000);
      return () => {
        clearTimeout(timer);
        clearTimeout(floatTimer);
      };
    }
  }, [trigger, message, simulationData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Fade in={visible} timeout={{ enter: 100, exit: 1500 }}>
      <Box
        sx={{
          position: "absolute",
          top: 200,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
          backgroundColor: "transparent",
          p: 0,
        }}
      >
        <Box
          sx={{
            // Initially, no vertical offset. After 500ms, move upward by 50px.
            transform: float ? "translateY(-50px)" : "translateY(0)",
            transition: "transform 1500ms ease-out",
          }}
        >
          <Typography
            variant="h6"
            sx={{ color: "#fff", backgroundColor: "transparent", p: 0 }}
          >
            {message}
          </Typography>
        </Box>
      </Box>
    </Fade>
  );
};

export default FadeNotification;

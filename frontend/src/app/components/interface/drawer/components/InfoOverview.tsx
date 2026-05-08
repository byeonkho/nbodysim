import React, { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { RootState } from "@/app/store/Store";
import {
  CelestialBody,
  selectCurrentTimeStepKey,
} from "@/app/store/slices/SimulationSlice";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import theme from "@/muiTheme";

// Debug panel — refresh at 5 Hz, well below frame rate. Subscribing to Redux
// per frame would force a render of this whole MUI table on every animation
// tick, which is wasteful for a panel a human is reading.
const REFRESH_INTERVAL_MS = 200;

const InfoOverview: React.FC = () => {
  const store = useStore<RootState>();
  const [snapshot, setSnapshot] = useState<CelestialBody[]>([]);

  useEffect(() => {
    const tick = () => {
      const state = store.getState();
      const simulationData = state.simulation.simulationData;
      const key = selectCurrentTimeStepKey(state);
      if (simulationData && key && simulationData[key]) {
        setSnapshot(simulationData[key]);
      } else {
        setSnapshot([]);
      }
    };
    tick();
    const id = window.setInterval(tick, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [store]);

  return (
    <Paper
      sx={{
        width: "100%",
        height: "100%",
        padding: 2,
        backgroundColor: theme.palette.background.default,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: theme.palette.text.primary,
          marginBottom: 2,
        }}
      >
        Current Snapshot Information
      </Typography>
      {snapshot.length > 0 ? (
        <TableContainer
          component={Paper}
          sx={{ backgroundColor: theme.palette.background.default }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Planet Name</strong>
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Position</strong>
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Velocity</strong>
                  </Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.map((body: CelestialBody) => (
                <TableRow key={body.name}>
                  <TableCell>
                    <Typography variant="body2">{body.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body3">
                      ({body.position.x.toExponential(2)},{" "}
                      {body.position.y.toExponential(2)},{" "}
                      {body.position.z.toExponential(2)})
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body3">
                      ({body.velocity.x.toFixed(2)},{" "}
                      {body.velocity.y.toFixed(2)},{" "}
                      {body.velocity.z.toFixed(2)})
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body1" color="text.secondary">
          No snapshot data available.
        </Typography>
      )}
    </Paper>
  );
};

export default InfoOverview;

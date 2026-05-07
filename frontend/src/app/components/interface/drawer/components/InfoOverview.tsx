import React from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/app/store/Store";
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

const InfoOverview: React.FC = () => {
  const currentSnapshot = useSelector(
    (state: RootState) => state.simulation.currentSimulationSnapshot,
  );

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
      {currentSnapshot && currentSnapshot.length > 0 ? (
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
              {currentSnapshot.map((body: any) => (
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
                      {body.velocity.y.toFixed(2)}, {body.velocity.z.toFixed(2)}
                      )
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

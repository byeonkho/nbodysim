import React, { useState } from "react";
import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  TextField,
} from "@mui/material";
import { useDispatch } from "react-redux";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import theme from "@/muiTheme";
import { store } from "@/app/store/Store";
import {
  connect,
  requestRunSimulation,
} from "@/app/store/middleware/webSocketMiddleware";

const SimParams: React.FC = () => {
  const dispatch = useDispatch();
  const [celestialBodyNames, setCelestialBodyNames] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState<boolean>(false);
  const celestialBodies = [
    "Sun",
    "Earth",
    "Moon",
    "Mars",
    "Venus",
    "Jupiter",
    "Mercury",
    "Saturn",
    "Uranus",
    "Neptune",
  ];

  const [date, setDate] = useState<string>("2024-06-05T00:00:00.000");
  const [frame, setFrame] = useState<string>("Heliocentric");
  const [integrator, setIntegrator] = useState<string>("euler");
  const [timeStepUnit, setTimeStepUnit] = useState<string>("Hours");

  const handleCelestialBodyNamesChange = (
    event: SelectChangeEvent<string[]>,
  ) => {
    const {
      target: { value },
    } = event;
    setCelestialBodyNames(typeof value === "string" ? value.split(",") : value);
  };

  const handleSelectAllChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const checked = event.target.checked;
    setSelectAll(checked);
    setCelestialBodyNames(checked ? celestialBodies : []);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      validateString(timeStepUnit);

      const requestBody = {
        celestialBodyNames,
        date,
        frame,
        integrator,
        timeStepUnit,
      };

      await initializeCelestialBodies(dispatch, requestBody);

      const sessionID =
        store.getState().simulation.simulationParameters?.simulationMetaData
          ?.sessionID;

      await initializeWebSocket();

      const requestData = {
        sessionID,
      };

      dispatch(requestRunSimulation(requestData));
    } catch (error) {
      if (error instanceof Error) {
        console.error("Form submission error:", error.message);
        alert(error.message);
      } else {
        console.error("An unknown error occurred during form submission.");
      }
    }
  };

  const validateString = (input: string) => {
    const validOptions = ["Seconds", "Hours", "Days", "Weeks"];
    if (!validOptions.includes(input)) {
      throw new Error(
        `Invalid time step. Please select one of: ${validOptions.join(", ")}.`,
      );
    }
    return true;
  };

  const initializeWebSocket = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const url = "ws://localhost:8080/ws";
      dispatch(connect(url));

      const interval = setInterval(() => {
        const isConnected = store.getState().webSocket.isConnected;
        if (isConnected) {
          clearInterval(interval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        const isConnected = store.getState().webSocket.isConnected;
        clearInterval(interval);
        if (!isConnected) {
          reject(
            new Error(
              "Failed to establish WebSocket connection within the timeout period.",
            ),
          );
        }
      }, 5000);
    });
  };

  return (
    <Paper
      sx={{
        width: "100%",
        padding: 2,
        backgroundColor: theme.palette.background.default,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        // overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <FormControl>
        <InputLabel>Celestial Bodies</InputLabel>
        <Select
          multiple
          value={celestialBodyNames}
          onChange={handleCelestialBodyNamesChange}
          label="Celestial Bodies"
          MenuProps={{
            disablePortal: true, // Renders dropdown within the same container
            anchorOrigin: { vertical: "bottom", horizontal: "left" },
            transformOrigin: { vertical: "top", horizontal: "center" },
          }}
        >
          {celestialBodies.map((body) => (
            <MenuItem key={body} value={body}>
              {body}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControlLabel
        control={
          <Checkbox checked={selectAll} onChange={handleSelectAllChange} />
        }
        label="Select All"
      />

      <TextField
        label="Date"
        type="datetime-local"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
      />

      <TextField
        label="Frame"
        value={frame}
        onChange={(e) => setFrame(e.target.value)}
      />

      <FormControl fullWidth>
        <InputLabel id="integrator-label">Integrator</InputLabel>
        <Select
          labelId="integrator-label"
          value={integrator}
          onChange={(e: SelectChangeEvent) => setIntegrator(e.target.value)}
          MenuProps={{
            disablePortal: true,
            anchorOrigin: { vertical: "bottom", horizontal: "left" },
            transformOrigin: { vertical: "top", horizontal: "center" },
          }}
        >
          <MenuItem value="euler">Euler</MenuItem>
          <MenuItem value="rk4">RK4</MenuItem>
          <MenuItem value="dp853">DormandPrince853</MenuItem>
        </Select>
        <FormHelperText>
          Euler: simple, drifts visibly · RK4: balanced · DP853: adaptive, high
          accuracy
        </FormHelperText>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel id="time-unit-label">Time Unit</InputLabel>
        <Select
          labelId="time-unit-label"
          value={timeStepUnit}
          onChange={(e: SelectChangeEvent) => setTimeStepUnit(e.target.value)}
          MenuProps={{
            disablePortal: true, // Renders dropdown within the same container
            anchorOrigin: { vertical: "bottom", horizontal: "left" },
            transformOrigin: { vertical: "top", horizontal: "center" },
          }}
        >
          <MenuItem value="Seconds">Seconds</MenuItem>
          <MenuItem value="Hours">Hours</MenuItem>
          <MenuItem value="Days">Days</MenuItem>
          <MenuItem value="Weeks">Weeks</MenuItem>
        </Select>
      </FormControl>

      <Button
        variant="contained"
        color="primary"
        type="submit"
        sx={{ width: "100%" }}
        onClick={handleSubmit}
      >
        Submit
      </Button>
    </Paper>
  );
};

export default SimParams;

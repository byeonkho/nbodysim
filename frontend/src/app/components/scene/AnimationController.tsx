"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  selectCurrentTimeStepIndex,
  selectIsPaused,
  selectSpeedMultiplier,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch, RootState } from "@/app/store/Store";

const FRAME_INTERVAL = 1 / SimConstants.FPS;

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);
  const currentTimeStepIndex = useSelector(selectCurrentTimeStepIndex);

  const currentIndexRef = useRef(currentTimeStepIndex);
  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);
  const accRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentTimeStepIndex;
  }, [currentTimeStepIndex]);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    accRef.current += delta;
    if (accRef.current < FRAME_INTERVAL) return;
    accRef.current = 0;
    if (isPausedRef.current) return;

    const buffer = store.getState().simulation.chunkBuffer;
    if (!buffer || buffer.totalTimesteps === 0) return;

    const stepsToMove = Math.abs(speedMultiplierRef.current);
    const direction = speedMultiplierRef.current > 0 ? 1 : -1;
    const proposed = currentIndexRef.current + direction * stepsToMove;
    // Clamp to [0, totalTimesteps - 1] so the playback head never outruns
    // the buffer. Speed-aware prefetch keeps the buffer ahead so this clamp
    // is rarely the limiting factor in practice — but it's the safety net.
    const nextIndex = Math.max(
      0,
      Math.min(buffer.totalTimesteps - 1, proposed),
    );

    if (nextIndex !== currentIndexRef.current) {
      currentIndexRef.current = nextIndex;
      dispatch(setCurrentTimeStepIndex(nextIndex));
    }
  });

  return null;
};

export default AnimationController;

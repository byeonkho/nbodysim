"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  deleteExcessData,
  selectCurrentTimeStepIndex,
  selectIsPaused,
  selectSpeedMultiplier,
  selectTimeStepKeys,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch } from "@/app/store/Store";

const FRAME_INTERVAL = 1 / SimConstants.FPS;

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);
  const timeStepKeys = useSelector(selectTimeStepKeys);
  const currentTimeStepIndex = useSelector(selectCurrentTimeStepIndex);

  const currentIndexRef = useRef(currentTimeStepIndex);
  const timeStepKeysRef = useRef(timeStepKeys);
  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);
  const accRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentTimeStepIndex;
  }, [currentTimeStepIndex]);
  useEffect(() => {
    timeStepKeysRef.current = timeStepKeys;
  }, [timeStepKeys]);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    if (timeStepKeysRef.current.length > SimConstants.MAX_TIMESTEPS) {
      dispatch(
        deleteExcessData({
          excessCount: SimConstants.TIMESTEP_CHUNK_SIZE,
          timeStepKeys: timeStepKeysRef.current,
        }),
      );
      currentIndexRef.current = Math.max(
        0,
        currentIndexRef.current - SimConstants.TIMESTEP_CHUNK_SIZE,
      );
    }

    accRef.current += delta;
    if (accRef.current >= FRAME_INTERVAL) {
      accRef.current = 0;
      if (!isPausedRef.current && timeStepKeysRef.current.length > 0) {
        const stepsToMove = Math.abs(speedMultiplierRef.current);
        const direction = speedMultiplierRef.current > 0 ? 1 : -1;
        const nextIndex = Math.max(
          0,
          currentIndexRef.current + direction * stepsToMove,
        );
        currentIndexRef.current = nextIndex;
        dispatch(setCurrentTimeStepIndex(nextIndex));
      }
    }
  });

  return null;
};

export default AnimationController;

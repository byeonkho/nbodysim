"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  selectIsPaused,
  selectSpeedMultiplier,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch, RootState } from "@/app/store/Store";
import { computeNextIndex } from "@/app/utils/animationStep";

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  // Note: NOT subscribing to currentTimeStepIndex via useSelector — this
  // component dispatches that value every frame, so a selector subscription
  // would re-render every frame (the known offender flagged in
  // frontend-render-loop.md). We read it imperatively from store.getState()
  // inside useFrame instead.
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);

  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    if (isPausedRef.current) return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    if (!buffer || buffer.totalTimesteps === 0) return;

    const currentIndex = state.simulation.timeState.currentTimeStepIndex;
    const nextIndex = computeNextIndex({
      currentIndex,
      delta,
      speedMultiplier: speedMultiplierRef.current,
      fps: SimConstants.FPS,
      totalTimesteps: buffer.totalTimesteps,
    });

    if (nextIndex !== currentIndex) {
      dispatch(setCurrentTimeStepIndex(nextIndex));
    }
  });

  return null;
};

export default AnimationController;

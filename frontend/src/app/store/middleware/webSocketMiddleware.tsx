import { Middleware, MiddlewareAPI } from "redux";
import {
  selectCurrentTimeStepIndex,
  setCurrentTimeStepIndex,
  setIsUpdating,
  updateDataReceived,
} from "@/app/store/slices/SimulationSlice";
import {
  connected,
  disconnected,
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/WebSocketSlice";
import { ZSTDDecoder } from "zstddec";

interface ConnectAction {
  type: "webSocket/connect";
  payload: string; // The WebSocket URL
}

interface DisconnectAction {
  type: "webSocket/disconnect";
}

interface RequestRunSimulationAction {
  type: "webSocket/requestRunSimulation";
  payload: any; // The message to send (consider typing this more specifically)
}

export const connect = (url: string) => ({
  type: "webSocket/connect",
  payload: url,
});

export const disconnect = () => ({
  type: "webSocket/disconnect",
});

export const requestRunSimulation = (message: any) => ({
  type: "webSocket/requestRunSimulation",
  payload: message,
});

type WebSocketAction =
  | ConnectAction
  | DisconnectAction
  | RequestRunSimulationAction;

let socket: WebSocket | null = null;

export const webSocketMiddleware: Middleware =
  (store: MiddlewareAPI) =>
  (next) =>
  async (action: unknown) => {
    // Middleware receives any action; we only care about our WS-flavored ones.
    // Cast to the discriminated union and let switch narrow within each case.
    const wsAction = action as WebSocketAction;
    switch (wsAction.type) {
      case "webSocket/connect": {
        if (socket) {
          socket.close(); // Close any existing connection
        }

        socket = new WebSocket(wsAction.payload);

        socket.binaryType = "arraybuffer"; // Enable binary handling

        socket.onopen = () => {
          console.log("WebSocket connection established.");
          store.dispatch(connected());
        };

        socket.onmessage = async (event: MessageEvent) => {
          try {
            if (typeof event.data === "string") {
              // Handle text messages
              const messageData = JSON.parse(event.data);
              if (messageData.messageType === "CONNECTION_SUCCESSFUL") {
                console.log("Connection acknowledged by server.");
              } else {
                console.warn(
                  `Unhandled message type: ${messageData.messageType}`,
                );
              }
            } else if (event.data instanceof ArrayBuffer) {
              // Handle binary messages
              const decoder = new ZSTDDecoder();
              await decoder.init();

              const arrayBuffer = event.data;
              const dataView = new DataView(arrayBuffer);
              const uncompressedSize = dataView.getUint32(0, true);
              const compressedData = new Uint8Array(arrayBuffer, 4);

              const decompressedArray = decoder.decode(
                compressedData,
                uncompressedSize,
              );
              const decompressedString = new TextDecoder("utf-8").decode(
                decompressedArray,
              );

              const messageData = JSON.parse(decompressedString);

              if (messageData.messageType === "SIM_DATA") {
                store.dispatch(setRequestInProgress(false));
                store.dispatch(updateDataReceived({ data: messageData.data }));

                //  trigger first rendering iteration via simulationSnapshot side effect
                // of this dispatch
                const updatedState = store.getState();

                if (selectCurrentTimeStepIndex(updatedState) == 0) {
                  store.dispatch(setCurrentTimeStepIndex(0));
                }
              } else {
                console.warn(
                  `Unhandled binary message type: ${messageData.messageType}`,
                );
              }
            }
          } catch (error) {
            console.error("Failed to process WebSocket message:", error);
          }
        };

        socket.onerror = (event: Event) => {
          // Browser WebSocket onerror dispatches a plain Event without details;
          // detailed reasons (when available) come via onclose's CloseEvent.
          console.error("WebSocket error:", event);
          store.dispatch(setErrorMessage("WebSocket error"));
        };

        socket.onclose = () => {
          console.log("WebSocket connection closed.");
          store.dispatch(disconnected());
          socket = null;
        };
        break;
      }

      case "webSocket/disconnect": {
        if (socket) {
          socket.close();
          socket = null;
        }
        break;
      }

      case "webSocket/requestRunSimulation": {
        if (socket && socket.readyState === WebSocket.OPEN) {
          console.log("Sending WebSocket simulation request...");
          store.dispatch(setIsUpdating(true));
          store.dispatch(setRequestInProgress(true));
          socket.send(JSON.stringify(wsAction.payload));
        } else {
          console.warn(
            "Cannot send simulation request: WebSocket is not open.",
          );
        }
        break;
      }

      default:
        // Pass other actions down the middleware chain
        return next(action);
    }
  };

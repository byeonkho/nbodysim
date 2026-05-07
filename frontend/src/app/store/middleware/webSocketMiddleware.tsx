import { Middleware, MiddlewareAPI } from "redux";
import {
  selectCurrentTimeStepIndex,
  setCurrentTimeStepIndex,
  setIsUpdating,
  updateDataReceived,
} from "@/app/store/slices/SimulationSlice";
import {
  clearErrorMessage,
  connected,
  disconnected,
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/WebSocketSlice";
import { ZSTDDecoder } from "zstddec";

interface ConnectAction {
  type: "webSocket/connect";
  payload: string;
}

interface DisconnectAction {
  type: "webSocket/disconnect";
}

interface RequestRunSimulationAction {
  type: "webSocket/requestRunSimulation";
  payload: any;
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
let lastUrl: string | null = null;
let lastSimPayload: any = null;
let reconnectAttempts = 0;
let intentionalDisconnect = false;
const MAX_RECONNECT_ATTEMPTS = 5;

function scheduleReconnect(store: MiddlewareAPI) {
  if (intentionalDisconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (!intentionalDisconnect) {
      store.dispatch(
        setErrorMessage("Connection lost. Please refresh the page."),
      );
    }
    return;
  }
  const delayMs = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;
  store.dispatch(
    setErrorMessage(
      `Connection lost — reconnecting in ${delayMs / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    ),
  );
  setTimeout(() => {
    if (!intentionalDisconnect && lastUrl) {
      createSocket(store, lastUrl, true);
    }
  }, delayMs);
}

function createSocket(
  store: MiddlewareAPI,
  url: string,
  isReconnect: boolean,
) {
  if (socket) {
    socket.close();
  }

  socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    console.log("WebSocket connection established.");
    store.dispatch(connected());
    reconnectAttempts = 0;

    if (isReconnect && lastSimPayload) {
      store.dispatch(clearErrorMessage());
      // Brief delay to let the server send its CONNECTION_SUCCESSFUL ack first.
      setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          store.dispatch(setIsUpdating(true));
          store.dispatch(setRequestInProgress(true));
          socket.send(JSON.stringify(lastSimPayload));
        }
      }, 150);
    }
  };

  socket.onmessage = async (event: MessageEvent) => {
    try {
      if (typeof event.data === "string") {
        const messageData = JSON.parse(event.data);
        if (messageData.messageType === "CONNECTION_SUCCESSFUL") {
          console.log("Connection acknowledged by server.");
        } else {
          console.warn(`Unhandled message type: ${messageData.messageType}`);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const decoder = new ZSTDDecoder();
        await decoder.init();

        const arrayBuffer = event.data;
        const dataView = new DataView(arrayBuffer);
        const uncompressedSize = dataView.getUint32(0, true);
        const compressedData = new Uint8Array(arrayBuffer, 4);

        const decompressedArray = decoder.decode(compressedData, uncompressedSize);
        const decompressedString = new TextDecoder("utf-8").decode(decompressedArray);
        const messageData = JSON.parse(decompressedString);

        if (messageData.messageType === "SIM_DATA") {
          store.dispatch(setRequestInProgress(false));
          store.dispatch(updateDataReceived({ data: messageData.data }));

          const updatedState = store.getState();
          if (selectCurrentTimeStepIndex(updatedState) == 0) {
            store.dispatch(setCurrentTimeStepIndex(0));
          }
        } else {
          console.warn(`Unhandled binary message type: ${messageData.messageType}`);
        }
      }
    } catch (error) {
      console.error("Failed to process WebSocket message:", error);
      store.dispatch(setErrorMessage("Failed to decode simulation data."));
    }
  };

  socket.onerror = (event: Event) => {
    // Browser WebSocket onerror dispatches a plain Event without details;
    // detailed reasons come via onclose's CloseEvent.
    console.error("WebSocket error:", event);
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed.");
    store.dispatch(disconnected());
    socket = null;
    scheduleReconnect(store);
  };
}

export const webSocketMiddleware: Middleware =
  (store: MiddlewareAPI) =>
  (next) =>
  async (action: unknown) => {
    const wsAction = action as WebSocketAction;
    switch (wsAction.type) {
      case "webSocket/connect": {
        intentionalDisconnect = false;
        lastUrl = wsAction.payload;
        createSocket(store, wsAction.payload, false);
        break;
      }

      case "webSocket/disconnect": {
        intentionalDisconnect = true;
        if (socket) {
          socket.close();
          socket = null;
        }
        break;
      }

      case "webSocket/requestRunSimulation": {
        lastSimPayload = wsAction.payload;
        if (socket && socket.readyState === WebSocket.OPEN) {
          console.log("Sending WebSocket simulation request...");
          store.dispatch(setIsUpdating(true));
          store.dispatch(setRequestInProgress(true));
          socket.send(JSON.stringify(wsAction.payload));
        } else {
          console.warn("Cannot send simulation request: WebSocket is not open.");
        }
        break;
      }

      default:
        return next(action);
    }
  };

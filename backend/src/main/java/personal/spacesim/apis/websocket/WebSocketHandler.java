package personal.spacesim.apis.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import personal.spacesim.dtos.WebSocketResponseDTO;
import personal.spacesim.dtos.WebsocketRequestDTO;
import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.compressor.ZstdCompressor;

import java.io.IOException;

@Component
public class WebSocketHandler extends TextWebSocketHandler {

    private final Logger logger = LoggerFactory.getLogger(WebSocketHandler.class);

    private final String CONNECTION_SUCCESSFUL = "CONNECTION_SUCCESSFUL";
    private final String CONNECTION_FAILED = "CONNECTION_FAILED";
    private final SimulationSessionService simulationSessionService;
    private final ObjectMapper objectMapper;
    private final ZstdCompressor zstdCompressor;


    // TODO fill this up
    /**
     *
     * @param simulationSessionService
     * @param objectMapper
     */
    @Autowired
    public WebSocketHandler(
            SimulationSessionService simulationSessionService,
            ObjectMapper objectMapper,
            ZstdCompressor zstdCompressor
    ) {
        this.simulationSessionService = simulationSessionService;
        this.objectMapper = objectMapper;
        this.zstdCompressor = zstdCompressor;
    }

    /**
     * The websocket currently handles a single responsibility: to receive the command parameters and run
     * the respective simulation.
     *
     * @param session JSON response payload is a LinkedHashMap with keys of type {@link WebSocketResponseKey} and
     *                values of
     *                type ArrayList of {@link CelestialBodySnapshot}. Each key-value pair encapsulates the information
     *                required for the frontend to render the simulation at each time step, namely:
     *                <ul>
     *                  <li>timestamp</li>
     *                  <li>position and velocity of each celestial body</li>
     *                </ul>
     *                {@link CelestialBodySnapshot} is a stripped-down copy of {@link CelestialBodyWrapper} that holds only the
     *                salient attributes required for the frontend.
     *
     * @param message JSON request payload {@link WebsocketRequestDTO} consists of:
     *                <ul>
     *                  <li>sessionID</li>
     *                  <li>time delta per step</li>
     *                  <li>total time to run for - this must be a multiple of the time delta</li>
     *                </ul>
     * @throws Exception if an error occurs during the simulation.
     */
    @Override
    public void handleTextMessage(
            WebSocketSession session,
            TextMessage message
    ) throws Exception {
        try {
            // deserialize and get the request params
            WebsocketRequestDTO request = objectMapper.readValue(
                    message.getPayload(),
                    WebsocketRequestDTO.class
            );

            String sessionID = request.getSessionID();

            if (sessionID == null) {
                session.sendMessage(new TextMessage("Invalid payload"));
                return;
            }

            // Bind the sim sessionID to this WS session so afterConnectionClosed can clean up.
            // The WS session.getId() is unrelated to the UUID from /initialize.
            session.getAttributes().put("sessionID", sessionID);

            // Cancel any pending grace-period removal — this handles reconnects
            // where the client re-attaches before the 30s window expires.
            simulationSessionService.cancelScheduledRemoval(sessionID);

            // run the simulation and construct the response
            WebSocketResponseDTO responseDTO = simulationSessionService.runSimulation(
                    sessionID
            );

            responseDTO.setMessageType("SIM_DATA");

            String jsonString = objectMapper.writeValueAsString(responseDTO);
            byte[] compressedData = zstdCompressor.compress(jsonString);
            session.sendMessage(new BinaryMessage(compressedData));
        } catch (Exception e) {
            e.printStackTrace();
            session.sendMessage(new TextMessage("Error processing request"));
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        System.out.println("WebSocket connection established: " + session.getId());

        // Construct a connection acknowledgment message
        WebSocketResponseDTO connectionAck = new WebSocketResponseDTO();
        connectionAck.setMessageType(CONNECTION_SUCCESSFUL);

        try {
            // Send the acknowledgment message to the client
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(connectionAck)));
        } catch (IOException e) {
            System.err.println("Failed to send connection acknowledgment: " + e.getMessage());
            e.printStackTrace();
        }
    }
    @Override
    public void afterConnectionClosed(
            WebSocketSession session,
            CloseStatus status
    ) {
        logger.info("WebSocket connection closed: {} with status: {}", session.getId(), status);
        String sessionID = (String) session.getAttributes().get("sessionID");
        if (sessionID != null) {
            simulationSessionService.scheduleSimulationRemoval(sessionID);
        }
    }
}
package personal.spacesim.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import personal.spacesim.apis.websocket.WebSocketHandler;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final WebSocketHandler webSocketHandler;
    private final String[] allowedOrigins;

    public WebSocketConfig(
            WebSocketHandler webSocketHandler,
            @Value("${ALLOWED_ORIGINS:http://localhost:3000}") String allowedOriginsRaw
    ) {
        this.webSocketHandler = webSocketHandler;
        this.allowedOrigins = allowedOriginsRaw.split(",");
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(webSocketHandler, "/ws").setAllowedOrigins(allowedOrigins);
    }
}
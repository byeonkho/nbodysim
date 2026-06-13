package personal.spacesim.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final String[] allowedOriginPatterns;

    public CorsConfig(
            @Value("${ALLOWED_ORIGINS:http://localhost:[*],http://127.0.0.1:[*]}") String allowedOriginsRaw
    ) {
        this.allowedOriginPatterns = parseOrigins(allowedOriginsRaw);
    }

    static String[] parseOrigins(String raw) {
        // Trim each entry so a list written the natural way ("a, b") matches the
        // real Origin header; drop blanks left by stray or trailing commas.
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOriginPatterns)
                .allowedMethods("GET", "POST")
                .allowedHeaders("*");
    }
}

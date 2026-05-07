package personal.spacesim.config;

import jakarta.annotation.PostConstruct;
import org.orekit.data.DataContext;
import org.orekit.data.DataProvidersManager;
import org.orekit.data.DirectoryCrawler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import java.io.File;

@Configuration
@ComponentScan(basePackages = "personal.spacesim")
public class AppConfig {

    private static final Logger logger = LoggerFactory.getLogger(AppConfig.class);

    /**
     * Initializes Orekit at start
     */
    @PostConstruct
    public void initializeOrekit() {
        logger.info("Initializing Orekit data...");

        File orekitData;
        String envPath = System.getenv("OREKIT_DATA_PATH");

        if (envPath != null && !envPath.isBlank()) {
            // Explicit path set by Docker / production env
            orekitData = new File(envPath);
            logger.info("Loading Orekit data from OREKIT_DATA_PATH: {}", envPath);
        } else {
            // Classpath fallback for local dev (works with exploded classpath, not inside a fat JAR)
            String classpathPath = "orekit-data-master";
            try {
                orekitData = new File(getClass().getClassLoader().getResource(classpathPath).toURI());
            } catch (Exception e) {
                logger.error("Error locating Orekit data. Set OREKIT_DATA_PATH env var in production.", e);
                throw new IllegalStateException("Orekit data not found. Set OREKIT_DATA_PATH.", e);
            }
        }

        if (!orekitData.exists() || !orekitData.isDirectory()) {
            throw new IllegalStateException("Orekit data directory not found: " + orekitData.getAbsolutePath());
        }

        DataProvidersManager manager = DataContext.getDefault().getDataProvidersManager();
        manager.addProvider(new DirectoryCrawler(orekitData));
        logger.info("Orekit data initialized from: {}", orekitData.getAbsolutePath());
    }


}

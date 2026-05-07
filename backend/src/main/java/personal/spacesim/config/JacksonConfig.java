package personal.spacesim.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import personal.spacesim.utils.serializers.AbsoluteDateDeserializer;
import personal.spacesim.utils.serializers.AbsoluteDateSerializer;
import personal.spacesim.utils.serializers.Vector3DSerializer;

@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        SimpleModule module = new SimpleModule();
        module.addSerializer(Vector3D.class, new Vector3DSerializer());
        module.addSerializer(AbsoluteDate.class, new AbsoluteDateSerializer());
        module.addDeserializer(AbsoluteDate.class, new AbsoluteDateDeserializer());
        mapper.configure(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN, true);
        mapper.registerModule(module);
        return mapper;
    }
}
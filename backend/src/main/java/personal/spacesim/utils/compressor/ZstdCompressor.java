package personal.spacesim.utils.compressor;

import com.github.luben.zstd.Zstd;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

@Component
public class ZstdCompressor {

    public byte[] compress(byte[] uncompressedBytes) {
        byte[] compressedBytes = Zstd.compress(uncompressedBytes);

        ByteBuffer buffer = ByteBuffer.allocate(4 + compressedBytes.length);
        buffer.order(ByteOrder.LITTLE_ENDIAN); // endianness applies to primitive types only; raw compressed bytes pass through as-is
        buffer.putInt(uncompressedBytes.length);
        buffer.put(compressedBytes);

        return buffer.array();
    }

    public byte[] compress(String data) {
        return compress(data.getBytes(StandardCharsets.UTF_8));
    }
}

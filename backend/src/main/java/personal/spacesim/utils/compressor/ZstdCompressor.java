package personal.spacesim.utils.compressor;

import com.github.luben.zstd.Zstd;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

@Component
public class ZstdCompressor {

    public byte[] compress(byte[] uncompressedBytes) {
        int len = uncompressedBytes.length;
        // 4-byte little-endian uncompressed-size prefix + worst-case compressed
        // frame in one buffer. Compress straight into offset 4 so there is no
        // separate prefix-prepend copy and no hidden trim from Zstd.compress —
        // one allocation per chunk instead of three. Output bytes are identical
        // to the old prefix-then-compress path (same default level).
        byte[] out = new byte[4 + (int) Zstd.compressBound(len)];
        out[0] = (byte) len;
        out[1] = (byte) (len >>> 8);
        out[2] = (byte) (len >>> 16);
        out[3] = (byte) (len >>> 24);

        long written = Zstd.compressByteArray(
                out, 4, out.length - 4,
                uncompressedBytes, 0, len,
                Zstd.defaultCompressionLevel());
        if (Zstd.isError(written)) {
            throw new IllegalStateException(
                    "zstd compression failed: " + Zstd.getErrorName(written));
        }

        return Arrays.copyOf(out, 4 + (int) written);
    }

    public byte[] compress(String data) {
        return compress(data.getBytes(StandardCharsets.UTF_8));
    }
}

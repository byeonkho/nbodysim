package personal.spacesim.utils.compressor;

import com.github.luben.zstd.Zstd;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins the compressor's wire contract: a 4-byte little-endian uncompressed-size
 * prefix followed by the raw zstd frame. The single-allocation rewrite must keep
 * these bytes identical, so this round-trip is the guard against it changing the
 * format while reducing copies.
 */
class ZstdCompressorTest {

    @Test
    void compressPrependsLittleEndianUncompressedLengthAndRoundTrips() {
        // A non-trivial, partly-compressible buffer (not all-zeros, not random).
        byte[] original = new byte[4096];
        for (int i = 0; i < original.length; i++) {
            original[i] = (byte) ((i * 31 + i / 7) & 0xFF);
        }

        byte[] out = new ZstdCompressor().compress(original);

        // Bytes 0..3: little-endian uncompressed length.
        int prefix = ByteBuffer.wrap(out, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
        assertEquals(original.length, prefix,
                "4-byte LE prefix must equal the uncompressed length");

        // Strip the prefix; the remainder is a standalone zstd frame.
        byte[] frame = Arrays.copyOfRange(out, 4, out.length);
        byte[] restored = Zstd.decompress(frame, original.length);
        assertArrayEquals(original, restored,
                "decompressing the prefixed frame must reproduce the original bytes");
    }
}

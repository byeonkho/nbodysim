package personal.spacesim.dtos;

import java.util.List;

/** Millisecond sample keys from J2000 (continuous SI time); bounded and validated by the endpoint. */
public record GroundTruthSampleRequest(String body, String frame, List<Long> referenceEpochs,
                                       boolean subtractSun) {}

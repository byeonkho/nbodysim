# Independent Horizons checks

The `pluto-center-ut.txt`, `pluto-barycenter-ut.txt`, and `charon-ut.txt`
responses (with trailing whitespace removed) were retrieved from NASA/JPL Horizons on 2026-09-23 UTC.
Targets are 999, 9, and 901 respectively, with CENTER=@10, EPHEM_TYPE=VECTORS,
REF_PLANE=FRAME, REF_SYSTEM=ICRF, OUT_UNITS=KM-S, VEC_TABLE=2,
TIME_TYPE=UT, START_TIME=2024-06-05 00:00:00, STOP_TIME=2024-06-05 00:01:00,
and STEP_SIZE=1. They provide an independent UTC check on TDB query conversion
and distinguish the physical Pluto center from its system barycenter.

Source: https://ssd.jpl.nasa.gov/api/horizons.api
API documentation: https://ssd-api.jpl.nasa.gov/doc/horizons.html

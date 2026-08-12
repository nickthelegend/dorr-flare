#!/usr/bin/env bash
# Phase 4 — capture only the app rect, cropped DURING capture, not after.
#
# Cropping afterwards means recording the whole desktop first, so a notification
# that fires mid-take is already in the file. Crop at the source and it never
# exists. Geometry is fixed by env so the driver and the crop agree.
set -euo pipefail
W=${DEMO_W:-1440} H=${DEMO_H:-900} X=${DEMO_X:-0} Y=${DEMO_Y:-0}
TAKE=${1:-a}
OUT=${DEMO_OUT:-raw-take-$TAKE.mp4}

# Pre-flight: prove the recorder sees real content before spending a take on it.
ffmpeg -y -f avfoundation -capture_cursor 0 -framerate 30 -i "0:none" -t 2 \
  -vf "crop=$W:$H:$X:$Y" -pix_fmt yuv420p /tmp/__probe.mp4 -loglevel error
ffmpeg -y -sseof -0.5 -i /tmp/__probe.mp4 -vframes 1 /tmp/__probe.png -loglevel error
SZ=$(wc -c < /tmp/__probe.png)
[ "$SZ" -gt 40000 ] || { echo "PREFLIGHT_BLANK_CAPTURE: frame is ${SZ}B — screen recording permission?"; exit 1; }
echo "recorder sees real content (${SZ}B frame)"

ffmpeg -y -f avfoundation -capture_cursor 0 -framerate 30 -i "0:none" \
  -vf "crop=$W:$H:$X:$Y" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$OUT" &
FF=$!
trap 'kill -INT $FF 2>/dev/null || true; wait $FF 2>/dev/null || true' EXIT
sleep 2
node tools/demo/driver.mjs --take "$TAKE"
sleep 1
echo "raw footage -> $OUT"

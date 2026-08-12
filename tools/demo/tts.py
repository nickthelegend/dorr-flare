#!/usr/bin/env python3
"""Phase 2 — one audio file per narration line, durations MEASURED from the file.

The whole one-clock method rests on this being measured rather than estimated.
An estimate that is 200ms short on every line compounds into the driver moving
before the sentence lands, and by beat twenty the voice is describing something
that left the screen.
"""
import json, os, sys, wave

SRC = sys.argv[1] if len(sys.argv) > 1 else "narration.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "audio"
os.makedirs(OUT, exist_ok=True)

spec = json.load(open(SRC))
voice = spec.get("voice", "af_heart")

from kokoro import KPipeline
import soundfile as sf
import numpy as np

pipe = KPipeline(lang_code="a")
SR = 24000
durations = {}

for line in spec["lines"]:
    lid, text = line["id"], line["text"]
    chunks = [audio for _, _, audio in pipe(text, voice=voice)]
    if not chunks:
        print(f"  !! {lid}: no audio produced")
        continue
    audio = np.concatenate([np.asarray(c) for c in chunks])
    path = os.path.join(OUT, f"{lid}.wav")
    sf.write(path, audio, SR)

    # Measure from the written file, not from len(audio) — the file is what the
    # driver will actually play, and a wrong sample rate would go unnoticed.
    with wave.open(path) as w:
        secs = w.getnframes() / float(w.getframerate())
    durations[lid] = round(secs, 3)
    print(f"  {lid:16} {secs:6.2f}s  {os.path.getsize(path)//1024:>5} KB")

json.dump(durations, open(os.path.join(OUT, "durations.json"), "w"), indent=1)
total = sum(durations.values())
print(f"\n{len(durations)} lines, {total:.1f}s narration total ({total/60:.1f} min)")
print(f"durations -> {OUT}/durations.json")

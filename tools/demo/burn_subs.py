#!/usr/bin/env python3
"""Burn the .srt into the master as white text on a black plate.

This ffmpeg has neither libass nor freetype, so there is no `subtitles` filter
and no `drawtext` — the caption plates are drawn with PIL (the same way every
other card in this pipeline is drawn) and overlaid on a time window each.

One PNG per cue, one `overlay ... enable='between(t,a,b)'` per PNG. Thirty-odd
overlays in a single filter chain is unremarkable for ffmpeg and keeps the whole
burn to one pass.
"""
import os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "out")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "dorr-flare-demo.mp4")
SRT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT, "dorr-flare-demo.srt")
DST = sys.argv[3] if len(sys.argv) > 3 else os.path.join(OUT, "dorr-flare-demo-subtitled.mp4")

W, H = 1440, 900
FONT = ImageFont.truetype(os.path.join(HERE, "fonts", "Inter-Regular.ttf"), 21)
PAD_X, PAD_Y, LINE_H, BOTTOM = 18, 11, 28, 28
MAX_TEXT_W = 880
MAX_CHUNK = 88          # characters per caption — two lines at this width


def cues(path):
    """(start, end, text) from an .srt, times in seconds."""
    def secs(t):
        h, m, rest = t.split(":")
        s, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
    out = []
    for block in re.split(r"\n\s*\n", open(path).read().strip()):
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if len(lines) < 3:
            continue
        a, b = lines[1].split(" --> ")
        out.append((secs(a.strip()), secs(b.strip()), " ".join(lines[2:]).strip()))
    return out


def split_cue(a, b, text):
    """One caption per phrase, not one per narration line.

    A whole line of narration is up to twenty seconds of speech; rendered as a
    single plate it was four lines tall and sat over the slide it was explaining.
    Break at sentence ends first, then at clause commas, then on words, and give
    each chunk a share of the cue proportional to its length.
    """
    parts, cur = [], ""
    tokens = re.split(r"(?<=[.!?:]) +", text)
    for tok in tokens:
        while len(tok) > MAX_CHUNK:
            cut = tok.rfind(",", 0, MAX_CHUNK) + 1 or tok.rfind(" ", 0, MAX_CHUNK)
            if cut <= 0:
                cut = MAX_CHUNK
            parts.append(tok[:cut].strip())
            tok = tok[cut:].strip()
        if not cur:
            cur = tok
        elif len(cur) + len(tok) + 1 <= MAX_CHUNK:
            cur = f"{cur} {tok}"
        else:
            parts.append(cur)
            cur = tok
    if cur:
        parts.append(cur)
    total = sum(len(x) for x in parts) or 1
    out, t = [], a
    for i, x in enumerate(parts):
        share = (b - a) * len(x) / total
        end = b if i == len(parts) - 1 else min(b, t + share)
        out.append((t, end, x))
        t = end
    return out


def wrap(text, draw):
    """Greedy wrap to MAX_TEXT_W, measured rather than guessed at a char count."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textbbox((0, 0), trial, font=FONT)[2] <= MAX_TEXT_W:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    # Never silently truncate a caption. Dropping the tail of a sentence is the
    # kind of quiet loss that looks fine in a spot check and is wrong everywhere
    # else — if the splitter ever hands over something too long, say so.
    if len(lines) > 2:
        raise SystemExit(f"CAPTION_TOO_LONG ({len(lines)} lines): {text!r}")
    return lines


def plate(text, path):
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    lines = wrap(text, probe)
    tw = max(probe.textbbox((0, 0), l, font=FONT)[2] for l in lines)
    bw, bh = tw + PAD_X * 2, len(lines) * LINE_H + PAD_Y * 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0 = (W - bw) // 2, H - BOTTOM - bh
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=10, fill=(0, 0, 0, 216))
    for i, l in enumerate(lines):
        lw = d.textbbox((0, 0), l, font=FONT)[2]
        d.text(((W - lw) / 2, y0 + PAD_Y + i * LINE_H), l, font=FONT, fill=(255, 255, 255, 255))
    img.save(path)


def main():
    cs = [c for cue in cues(SRT) for c in split_cue(*cue)]
    if not cs:
        raise SystemExit(f"NO_CUES: {SRT} parsed to nothing")
    # Rewrite the sidecar too — short cues are better on YouTube for the same reason.
    def fmt(x):
        h, m, sec = int(x // 3600), int(x % 3600 // 60), x % 60
        return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
    open(SRT, "w").write("\n".join(
        f"{i+1}\n{fmt(a)} --> {fmt(b)}\n{t}\n" for i, (a, b, t) in enumerate(cs)))
    tmp = tempfile.mkdtemp(prefix="dorr-subs-")
    args = ["ffmpeg", "-y", "-i", SRC]
    for i, (_, _, txt) in enumerate(cs):
        p = os.path.join(tmp, f"c{i:03d}.png")
        plate(txt, p)
        args += ["-i", p]

    chain, last = [], "[0:v]"
    for i, (a, b, _) in enumerate(cs):
        lbl = f"[v{i}]"
        chain.append(f"{last}[{i+1}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'{lbl}")
        last = lbl
    args += ["-filter_complex", ";".join(chain), "-map", last, "-map", "0:a",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "copy", "-movflags", "+faststart", DST, "-loglevel", "error"]
    print(f"burning {len(cs)} cues → {os.path.basename(DST)}")
    subprocess.run(args, check=True)
    dur = subprocess.run(["ffprobe", "-v", "0", "-show_entries", "format=duration",
                          "-of", "csv=p=0", DST], capture_output=True, text=True).stdout.strip()
    print(f"done: {DST}  {float(dur):.1f}s")


main()

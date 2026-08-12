#!/usr/bin/env python3
"""Phase B–E — cut from the beat log, never by eye.

Each line's audio plays over the footage between its own mark and the next.
Footage longer than its narration is speed-ramped; shorter is padded by cloning
the last frame. The pad is clamped at zero because the arithmetic lands a
millisecond negative when the two are nearly equal, and ffmpeg rejects a
negative tpad outright rather than treating it as no-op.
"""
import json, os, subprocess, sys, wave, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO = os.path.join(ROOT, "audio")
OUT = os.path.join(ROOT, "out")
os.makedirs(OUT, exist_ok=True)
DUR = json.load(open(os.path.join(AUDIO, "durations.json")))

def sh(*a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"ffmpeg failed:\n{' '.join(a[:6])}…\n{r.stderr[-900:]}")

def vdur(p):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
        capture_output=True, text=True).stdout.strip())

def beats(take):
    rows = []
    for ln in open(os.path.join(ROOT, f"beat-log-{take}.txt")):
        p = ln.split()
        if len(p) >= 3 and p[0] == "DEMO_LINE":
            rows.append({"ms": int(p[1]), "id": p[2], "signing": "SIGNING" in ln})
    return rows

def cut(take, tmp):
    """One clip per beat, narration muxed, returned in order."""
    src = os.path.join(ROOT, f"raw-take-{take}.mp4")
    total = vdur(src)
    rows = beats(take)
    # Derive the offset instead of assuming it.
    #
    # Playwright starts writing the video when the context is created, which is
    # before t0 — and how long before varies with preflight and the first
    # navigation (measured: 1.6s for take a, 15.3s for take c). Hard-coding it
    # desynced every beat. The last beat's end is known exactly (its mark plus
    # its own narration plus the breath), so the lead-in is what remains.
    last = rows[-1]
    tail = last["ms"] / 1000.0 + DUR.get(last["id"], 0) + 0.45
    offset = max(0.0, total - tail)
    print(f"  lead-in {offset:.1f}s (video {total:.1f}s, beats end {tail:.1f}s)")
    clips = []
    for i, b in enumerate(rows):
        start = offset + b["ms"] / 1000.0
        end = offset + (rows[i + 1]["ms"] / 1000.0) if i + 1 < len(rows) else total
        span = max(0.4, end - start)
        narr = DUR.get(b["id"])
        if narr is None:
            print(f"  ! {b['id']}: no narration, skipped")
            continue
        wav = os.path.join(AUDIO, f"{b['id']}.wav")
        clip = os.path.join(tmp, f"{take}-{i:02d}-{b['id']}.mp4")

        if span > narr + 0.25:
            # Ramp the footage down to the narration length rather than cutting
            # it — the scroll keeps moving, it just moves faster.
            speed = span / narr
            vf = f"setpts=PTS/{speed:.6f},fps=30"
            pad = 0.0
        else:
            vf = "fps=30"
            pad = max(0.0, narr - span)   # clamp: ffmpeg rejects negative tpad
        if pad > 0.01:
            vf += f",tpad=stop_mode=clone:stop_duration={pad:.3f}"

        sh("ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{span:.3f}", "-i", src,
           "-i", wav, "-filter_complex", f"[0:v]{vf}[v]",
           "-map", "[v]", "-map", "1:a", "-af", "apad", "-shortest",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", "-r", "30",
           clip, "-loglevel", "error")
        clips.append(clip)
        print(f"  {b['id']:16} span {span:6.1f}s  narr {narr:5.1f}s  "
              f"{'ramp x%.2f' % (span/narr) if span > narr + .25 else 'pad %.1fs' % pad}"
              f"{'  [SIGNING]' if b['signing'] else ''}")
    return clips

def title_card(path, lines, secs, tmp):
    """Kinetic type, rendered frame by frame.

    This ffmpeg has no drawtext (built without freetype), and a crossfade is not
    an animation anyway. Each line rises 30px on an ease-out cubic and fades in
    on its own beat; the whole card eases out at the end. Real motion, drawn.
    """
    from PIL import Image, ImageDraw, ImageFont
    W, H, FPS = 1440, 900, 30
    BG = (11, 18, 32)
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_" + os.path.basename(path).replace(".mp4", ""))
    os.makedirs(fdir, exist_ok=True)
    FONT = "/System/Library/Fonts/Helvetica.ttc"
    fonts = {sz: ImageFont.truetype(FONT, sz) for _, sz, _, _ in lines}

    ease = lambda p: 1 - (1 - p) ** 3           # easeOutCubic
    for n in range(frames):
        t = n / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        for i, (txt, sz, dy, col) in enumerate(lines):
            t0 = 0.30 + i * 0.50
            p_in = max(0.0, min(1.0, (t - t0) / 0.70))
            if p_in <= 0:
                continue
            # fade the whole card out over the last 0.6s
            p_out = max(0.0, min(1.0, (secs - 0.6 - t) / 0.45))
            a = ease(p_in) * p_out
            if a <= 0.01:
                continue
            e = ease(p_in)
            y = H / 2 + dy + 30 * (1 - e)
            f = fonts[sz]
            w = d.textbbox((0, 0), txt, font=f)[2]
            fg = tuple(int(BG[k] + (col[k] - BG[k]) * a) for k in range(3))
            d.text(((W - w) / 2, y), txt, font=f, fill=fg)
        img.save(os.path.join(fdir, f"{n:05d}.png"))

    sh("ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(fdir, "%05d.png"),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
       path, "-loglevel", "error")


def main():
    tmp = tempfile.mkdtemp(prefix="dorr-cut-")
    all_clips = []

    intro = os.path.join(tmp, "intro.mp4")
    title_card(intro, [
        ("dorr  ·  hadal  ·  molfi", 62, -150, (255, 255, 255)),
        ("Confidential compute on Flare", 34, -50, (157, 180, 255)),
        ("Coston2 testnet  ·  three submissions", 24, 30, (127, 142, 163)),
    ], 5.0, tmp)
    all_clips.append(intro)

    for take in ("a", "b", "c"):
        if not os.path.exists(os.path.join(ROOT, f"beat-log-{take}.txt")):
            print(f"take {take}: no log, skipped"); continue
        print(f"take {take}:")
        all_clips += cut(take, tmp)

    outro = os.path.join(tmp, "outro.mp4")
    title_card(outro, [
        ("Thanks for watching", 58, -110, (255, 255, 255)),
        ("github.com/nickthelegend/dorr-flare", 28, -10, (157, 180, 255)),
        ("every claim is checkable on-chain", 22, 60, (127, 142, 163)),
    ], 5.5, tmp)
    all_clips.append(outro)

    # Concat needs identical streams; the two cards have no audio, so give them
    # silence rather than letting concat drop the audio track for everything after.
    normed = []
    for i, c in enumerate(all_clips):
        n = os.path.join(tmp, f"n{i:03d}.mp4")
        has_audio = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=index", "-of", "csv=p=0", c], capture_output=True, text=True).stdout.strip()
        # Re-encode audio to one layout for every clip. Concat with -c copy
        # blew up with "Rematrix is needed between 13 channels and stereo" —
        # the demuxer will not reconcile differing layouts, and Kokoro's output
        # is not what the silent cards carry. Normalise, do not copy.
        if has_audio:
            sh("ffmpeg", "-y", "-i", c, "-c:v", "copy",
               "-af", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
               "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", n, "-loglevel", "error")
        else:
            sh("ffmpeg", "-y", "-i", c, "-f", "lavfi", "-i",
               "anullsrc=channel_layout=stereo:sample_rate=48000",
               "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
               "-ar", "48000", "-ac", "2", n, "-loglevel", "error")
        normed.append(n)

    lst = os.path.join(tmp, "list.txt")
    open(lst, "w").write("".join(f"file '{c}'\n" for c in normed))
    master = os.path.join(OUT, "dorr-flare-demo.mp4")
    sh("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst,
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", master, "-loglevel", "error")

    # Subtitles from the measured durations — real .srt, nothing burned in.
    srt, t, n = [], 0.0, 1
    def ts(x):
        h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60
        return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")
    t = 5.0  # intro
    spec = json.load(open(os.path.join(ROOT, "narration.json")))
    for take in ("a", "b", "c"):
        if not os.path.exists(os.path.join(ROOT, f"beat-log-{take}.txt")): continue
        for b in beats(take):
            d = DUR.get(b["id"])
            if d is None: continue
            txt = next((l["text"] for l in spec["lines"] if l["id"] == b["id"]), "")
            srt.append(f"{n}\n{ts(t)} --> {ts(t + d)}\n{txt}\n")
            t += d; n += 1
    open(os.path.join(OUT, "dorr-flare-demo.srt"), "w").write("\n".join(srt))

    print(f"\nmaster : {master}  {vdur(master):.1f}s")
    print(f"srt    : {os.path.join(OUT, 'dorr-flare-demo.srt')}  ({n-1} cues)")

main()

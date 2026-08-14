#!/usr/bin/env python3
"""Phase B–E — cut from the beat log, never by eye.

Each line's audio plays over the footage between its own mark and the next.
Footage longer than its narration is speed-ramped; shorter is padded by cloning
the last frame. The pad is clamped at zero because the arithmetic lands a
millisecond negative when the two are nearly equal, and ffmpeg rejects a
negative tpad outright rather than treating it as no-op.
"""
import glob, json, os, subprocess, sys, wave, tempfile

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

def source_video(take):
    """The recording this beat log belongs to.

    raw-take-a.mp4 used to be produced by hand, and two "final" cuts were
    assembled from a three-takes-old file while the fresh recording sat in the
    video dir untouched — the app copy on screen was stale and nothing said so.
    Transcode the newest capture whenever it is newer, and refuse outright if
    the source predates the beat log it is being cut against.
    """
    mp4 = os.path.join(ROOT, f"raw-take-{take}.mp4")
    vdir = os.environ.get("DEMO_VIDEO_DIR") or f"/tmp/dorr-video/{take}"
    webms = sorted(glob.glob(os.path.join(vdir, "*.webm")), key=os.path.getmtime)
    log = os.path.join(ROOT, f"beat-log-{take}.txt")
    if webms:
        w = webms[-1]
        if not os.path.exists(mp4) or os.path.getmtime(w) > os.path.getmtime(mp4):
            print(f"  transcoding {os.path.basename(w)} → raw-take-{take}.mp4")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w,
                            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                            "-pix_fmt", "yuv420p", mp4], check=True)
    if not os.path.exists(mp4):
        raise SystemExit(f"NO_SOURCE_VIDEO: no {mp4} and no .webm in {vdir}")
    if os.path.exists(log) and os.path.getmtime(mp4) < os.path.getmtime(log) - 120:
        raise SystemExit(
            f"STALE_SOURCE: {os.path.basename(mp4)} is older than {os.path.basename(log)} — "
            "it is from a previous take. Re-record, or delete the stale mp4.")
    return mp4


def cut(take, tmp):
    """One clip per beat, narration muxed, returned in order."""
    src = source_video(take)
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
            # Cap the ramp at 2.1x — the value that lands this cut at ~7 minutes. Beyond that the cursor teleports and a
            # scroll reads as a jump-cut — and the footage worth watching (a
            # settlement landing, a feed filling in) is exactly the footage
            # these long spans contain. Anything above the cap keeps its own
            # pace and the beat simply runs longer than its line.
            speed = min(2.1, span / narr)
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

def narrate(clip, beat_id, tmp):
    """Mux a slide's own narration onto it.

    The cards were built silent and the concat step handed every silent clip a
    bed of silence — so intro, the three attestation panels, honest and outro
    all played mute while their audio sat unused in audio/. The narration was
    generated and measured; it just never reached the file.
    """
    wav = os.path.join(AUDIO, f"{beat_id}.wav")
    if not os.path.exists(wav):
        raise SystemExit(f"NO_SLIDE_AUDIO: {beat_id}.wav missing — regenerate Phase 2")
    out = clip.replace(".mp4", "_a.mp4")
    sh("ffmpeg", "-y", "-i", clip, "-i", wav, "-c:v", "copy",
       "-af", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad",
       "-shortest", "-c:a", "aac", "-b:a", "160k", out, "-loglevel", "error")
    return out


def live_attestation():
    """Read the real quote for the slides. Typeset from the machine, not typed."""
    import urllib.request
    # Ask for a quote over a payload hash. /tee/attestation with no argument
    # returns report_data of all zeros, and the slide says report_data IS the
    # batch payload hash — so the panel was arguing with itself on screen.
    base = ("https://59b7ffee2f565bdebf0ff4b076b0f1c0ba4152e4-8795"
            ".dstack-pha-prod5.phala.network")
    payload = "0x" + "".join(f"{b:02x}" for b in os.urandom(32))
    req = urllib.request.Request(f"{base}/t/dorr/sign", method="POST",
                                 data=json.dumps({"payloadHash": payload}).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            h = json.load(r)["hardwareAttestation"]
        return {"head": h["quote"][:40], "hash": h.get("quoteHash", ""),
                "report": h.get("reportData", "")}
    except Exception as e:
        raise SystemExit(f"SLIDE_DATA_UNAVAILABLE: {e} — the CVM must be up to cut the TEE panels")


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
    FONT = os.path.join(os.path.dirname(__file__), "fonts", "Inter-SemiBold.ttf")
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


def draw_lock(d, cx, cy, scale, alpha, bg):
    """The dorr mark, drawn.

    A padlock whose shackle deliberately does not close — the gap is the product
    in one shape: the order is sealed, and the venue is the thing left outside.
    Redrawn here rather than rasterised from the SVG so it can be animated: the
    shackle sweeps closed as the mark lands.
    """
    def mix(col):
        return tuple(int(bg[k] + (col[k] - bg[k]) * alpha) for k in range(3))
    BLUE, LIGHT, WHITE = (44, 107, 255), (122, 166, 255), (255, 255, 255)
    S = scale
    # body
    d.rounded_rectangle([cx - 88 * S, cy - 8 * S, cx + 88 * S, cy + 112 * S],
                        radius=int(34 * S), fill=mix(BLUE))
    # keyhole
    d.ellipse([cx - 15 * S, cy + 26 * S, cx + 15 * S, cy + 56 * S], fill=mix(WHITE))
    d.polygon([(cx - 9 * S, cy + 52 * S), (cx + 9 * S, cy + 52 * S),
               (cx + 6 * S, cy + 86 * S), (cx - 6 * S, cy + 86 * S)], fill=mix(WHITE))


def draw_shackle(d, cx, cy, scale, alpha, bg, sweep):
    """The shackle, swept 0→1. Stops short of closing on the left, always."""
    def mix(col):
        return tuple(int(bg[k] + (col[k] - bg[k]) * alpha) for k in range(3))
    S = scale
    box = [cx - 44 * S, cy - 82 * S, cx + 44 * S, cy + 6 * S]
    # 200°..340° is the closed arc; the left leg is cut short by design
    start, end = 190, 190 + int(155 * sweep)
    if end > start:
        d.arc(box, start, end, fill=mix((122, 166, 255)), width=int(24 * S))


def logo_card(path, secs, tmp):
    """Animated intro: the mark draws itself, then the wordmark rises."""
    from PIL import Image, ImageDraw, ImageFont
    W, H, FPS = 1440, 900, 30
    BG = (11, 18, 32)
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_logo"); os.makedirs(fdir, exist_ok=True)
    FONT = os.path.join(os.path.dirname(__file__), "fonts", "Inter-SemiBold.ttf")
    f_word = ImageFont.truetype(FONT, 92)
    f_sub = ImageFont.truetype(FONT, 34)
    f_tag = ImageFont.truetype(FONT, 24)
    ease = lambda p: 1 - (1 - p) ** 3

    for n in range(frames):
        t = n / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        out = max(0.0, min(1.0, (secs - 0.6 - t) / 0.45))

        # 0.0–1.1s the body lands and the shackle sweeps closed
        p_lock = max(0.0, min(1.0, (t - 0.15) / 0.85))
        if p_lock > 0:
            a = ease(p_lock) * out
            cy = 300 + 40 * (1 - ease(p_lock))
            draw_shackle(d, W / 2, cy, 1.05, a, BG, ease(p_lock))
            draw_lock(d, W / 2, cy, 1.05, a, BG)

        for i, (txt, f, dy, col, t0) in enumerate([
            ("dorr", f_word, 190, (255, 255, 255), 1.05),
            ("Private perps on Flare", f_sub, 300, (122, 166, 255), 1.45),
            ("Coston2 testnet  ·  FXRP margin  ·  Intel TDX", f_tag, 360, (150, 163, 184), 1.85),
        ]):
            p_in = max(0.0, min(1.0, (t - t0) / 0.7))
            if p_in <= 0:
                continue
            a = ease(p_in) * out
            if a <= 0.01:
                continue
            y = 300 + dy + 26 * (1 - ease(p_in))
            w = d.textbbox((0, 0), txt, font=f)[2]
            d.text(((W - w) / 2, y), txt, font=f,
                   fill=tuple(int(BG[k] + (col[k] - BG[k]) * a) for k in range(3)))
        img.save(os.path.join(fdir, f"{n:05d}.png"))

    sh("ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(fdir, "%05d.png"),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
       path, "-loglevel", "error")


def data_card(path, heading, rows, secs, tmp, highlight=None):
    """A key/value panel for real data — the attestation and the settlement tx.

    The quote is 5,010 bytes and unreadable at video bitrate, but its meaning
    lives in three fields. Those get typeset in monospace at a size that survives
    compression, with the one that matters picked out in green. Rows arrive in
    sequence so the eye is led rather than dumped on.
    """
    from PIL import Image, ImageDraw, ImageFont
    W, H, FPS = 1440, 900, 30
    BG, PANEL = (11, 18, 32), (17, 26, 44)
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_" + os.path.basename(path).replace(".mp4", ""))
    os.makedirs(fdir, exist_ok=True)
    HERE = os.path.dirname(__file__)
    HEL = os.path.join(HERE, "fonts", "Inter-SemiBold.ttf")
    HELR = os.path.join(HERE, "fonts", "Inter-Regular.ttf")
    MONO = os.path.join(HERE, "fonts", "RobotoMono.ttf")
    f_h = ImageFont.truetype(HEL, 44)
    f_k = ImageFont.truetype(HELR, 23)
    f_v = ImageFont.truetype(MONO, 23)
    ease = lambda p: 1 - (1 - p) ** 3

    for n in range(frames):
        t = n / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        out = max(0.0, min(1.0, (secs - 0.6 - t) / 0.45))

        p_h = max(0.0, min(1.0, (t - 0.2) / 0.6))
        if p_h > 0:
            a = ease(p_h) * out
            y = 120 + 22 * (1 - ease(p_h))
            d.text((110, y), heading, font=f_h,
                   fill=tuple(int(BG[k] + (255 - BG[k]) * a) for k in range(3)))

        top = 230
        for i, (k, v) in enumerate(rows):
            t0 = 0.7 + i * 0.42
            p = max(0.0, min(1.0, (t - t0) / 0.55))
            if p <= 0:
                continue
            a = ease(p) * out
            if a <= 0.01:
                continue
            y = top + i * 78 + 20 * (1 - ease(p))
            d.rounded_rectangle([100, y - 14, W - 100, y + 52], radius=12,
                                fill=tuple(int(BG[j] + (PANEL[j] - BG[j]) * a) for j in range(3)))
            d.text((128, y - 6), k, font=f_k,
                   fill=tuple(int(BG[j] + (148 - BG[j]) * a) for j in range(3)))
            col = (52, 211, 153) if (highlight and k == highlight) else (226, 232, 240)
            d.text((128, y + 22), v, font=f_v,
                   fill=tuple(int(BG[j] + (col[j] - BG[j]) * a) for j in range(3)))
        img.save(os.path.join(fdir, f"{n:05d}.png"))

    sh("ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(fdir, "%05d.png"),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
       path, "-loglevel", "error")


def main():
    tmp = tempfile.mkdtemp(prefix="dorr-cut-")
    all_clips = []

    intro = os.path.join(tmp, "intro.mp4")
    logo_card(intro, DUR.get("intro", 17.0) + 0.6, tmp)
    all_clips.append(narrate(intro, "intro", tmp))

    # The app footage, split so the attestation panels land where the narration
    # puts them — straight after the order, not bolted onto the end.
    clips = cut("a", tmp) if os.path.exists(os.path.join(ROOT, "beat-log-a.txt")) else []
    ids = [r["id"] for r in beats("a")] if clips else []

    mid = {}
    live = live_attestation()
    mid["tee-attest"] = lambda o: data_card(o, "Who matches the order?", [
        ("a sealed area inside an Intel processor", "software outside it cannot look in"),
        ("rented from", "Phala Cloud  ·  dstack  ·  prod5"),
        ("live at", "59b7ffee\u2026.dstack-pha-prod5.phala.network"),
        ("chip is signing", "yes  \u00b7  5,010-byte receipt per batch"),
    ], DUR["tee-attest"] + 0.6, tmp)
    mid["tee-bound"] = lambda o: data_card(o, "The receipt is tied to your trades", [
        ("the chip signs this", live["report"][:44] + "\u2026"),
        ("which is a fingerprint of", "the exact trades in this batch"),
        ("so the receipt", "cannot be reused for a different batch"),
        ("anyone can check it against", "Intel\u2019s own records"),
    ], DUR["tee-bound"] + 0.6, tmp, highlight="the chip signs this")
    mid["tx-details"] = lambda o: data_card(o, "And Flare checks us too", [
        ("before accepting a settlement", "the contract reads Flare\u2019s own price oracle"),
        ("if our price is more than 2% off", "the transaction is rejected"),
        ("so even if we wanted to cheat", "the chain would not let us"),
        ("contract", "0x047478DE7d2ed6B41dEFC14223764411288Db845"),
    ], DUR["tx-details"] + 0.6, tmp)

    for i, c in enumerate(clips):
        all_clips.append(c)
        after = ids[i] if i < len(ids) else None
        if after == "positions":
            for sid in ("tee-attest", "tee-bound", "tx-details"):
                o = os.path.join(tmp, f"{sid}.mp4"); mid[sid](o)
                all_clips.append(narrate(o, sid, tmp))

    honest = os.path.join(tmp, "honest.mp4")
    title_card(honest, [
        ("What is not proven", 46, -170, (255, 255, 255)),
        ("v1 runs a trusted operator for matching", 26, -80, (203, 213, 225)),
        ("liquidity is a vAMM, not an external book", 26, -30, (203, 213, 225)),
        ("testnet  ·  unaudited", 26, 20, (203, 213, 225)),
    ], DUR.get("honest", 18.0) + 0.6, tmp)
    all_clips.append(narrate(honest, "honest", tmp))

    outro = os.path.join(tmp, "outro.mp4")
    title_card(outro, [
        ("Thanks for watching", 58, -110, (255, 255, 255)),
        ("github.com/nickthelegend/dorr-flare", 28, -10, (157, 180, 255)),
        ("every claim is checkable on-chain", 22, 60, (127, 142, 163)),
    ], DUR.get("outro", 14.0) + 0.6, tmp)
    all_clips.append(narrate(outro, "outro", tmp))

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

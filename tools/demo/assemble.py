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
            # Cap the ramp at 2.8x. At 1.3x narration the dead stretches — explorer
            # scrolls, the attack lab thinking, page loads — need to move faster or
            # the cut runs long with nothing being said over them. Beyond ~3x the
            # cursor teleports and a
            # scroll reads as a jump-cut — and the footage worth watching (a
            # settlement landing, a feed filling in) is exactly the footage
            # these long spans contain. Anything above the cap keeps its own
            # pace and the beat simply runs longer than its line.
            speed = min(2.8, span / narr)
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


def _ease(p):
    return 1 - (1 - max(0.0, min(1.0, p))) ** 3


def _fonts():
    from PIL import ImageFont
    HERE = os.path.dirname(__file__)
    I = lambda n, sz: ImageFont.truetype(os.path.join(HERE, "fonts", n), sz)
    return {"h": I("Inter-SemiBold.ttf", 40), "b": I("Inter-Regular.ttf", 24),
            "s": I("Inter-Regular.ttf", 19), "m": I("RobotoMono.ttf", 20),
            "ms": I("RobotoMono.ttf", 16), "n": I("Inter-SemiBold.ttf", 22)}


def _mix(bg, col, a):
    return tuple(int(bg[k] + (col[k] - bg[k]) * max(0.0, min(1.0, a))) for k in range(3))


def _render(fdir, path, FPS=30):
    sh("ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(fdir, "%05d.png"),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
       path, "-loglevel", "error")


def flow_card(path, secs, tmp):
    """The path an order takes, drawn as it happens.

    Five stages light up in sequence with a pulse travelling the connector
    between them, so a judge who reads nothing else still sees where the order
    goes and who checks it. Frame-by-frame because this ffmpeg has no drawtext.
    """
    from PIL import Image, ImageDraw
    W, H, FPS = 1440, 900, 30
    BG, PANEL = (11, 18, 32), (17, 26, 44)
    BLUE, LIGHT, GREEN, WHITE, DIM = (44, 107, 255), (122, 166, 255), (52, 211, 153), (240, 245, 255), (110, 125, 150)
    F = _fonts()
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_" + os.path.basename(path).replace(".mp4", ""))
    os.makedirs(fdir, exist_ok=True)

    stages = [
        ("Your browser", ["you sign the order", "only a hash leaves"], BLUE),
        ("The public feed", ["a commitment", "no side / size / price"], LIGHT),
        ("Intel TDX enclave", ["matches it sealed", "signs the batch"], GREEN),
        ("Flare contract", ["re-reads FTSO v2", "verifies the receipt"], LIGHT),
        ("Settled", ["one price for the epoch", "margin locked on-chain"], BLUE),
    ]
    n = len(stages)
    box_w, box_h, gap = 232, 200, 24
    total = n * box_w + (n - 1) * gap
    x0 = (W - total) // 2
    y = 330
    per = max(0.55, (secs - 1.4) / n)

    for fr in range(frames):
        t = fr / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        out = max(0.0, min(1.0, (secs - 0.5 - t) / 0.4))
        head_a = _ease((t - 0.1) / 0.5) * out
        d.text((x0, 190), "How one order travels", font=F["h"], fill=_mix(BG, WHITE, head_a))

        for i, (title, subs, col) in enumerate(stages):
            t0 = 0.45 + i * per
            a = _ease((t - t0) / 0.55) * out
            if a <= 0.01:
                continue
            bx = x0 + i * (box_w + gap)
            rise = int(22 * (1 - _ease((t - t0) / 0.55)))
            d.rounded_rectangle([bx, y + rise, bx + box_w, y + box_h + rise], radius=16,
                                fill=_mix(BG, PANEL, a), outline=_mix(BG, col, a * 0.8), width=2)
            d.text((bx + 20, y + 26 + rise), str(i + 1), font=F["n"], fill=_mix(BG, col, a))
            d.text((bx + 20, y + 66 + rise), title, font=F["b"], fill=_mix(BG, WHITE, a))
            for j, sub in enumerate(subs):
                d.text((bx + 20, y + 108 + j * 28 + rise), sub, font=F["s"], fill=_mix(BG, DIM, a))

            if i < n - 1:
                cx0, cx1 = bx + box_w, bx + box_w + gap
                cy = y + box_h // 2
                # connector fills as the next stage arrives, with a travelling pulse
                p = max(0.0, min(1.0, (t - t0 - per * 0.55) / (per * 0.45)))
                d.line([cx0, cy, cx0 + int(gap * p), cy], fill=_mix(BG, col, a * 0.9), width=3)
                if 0 < p < 1:
                    px = cx0 + int(gap * p)
                    d.ellipse([px - 5, cy - 5, px + 5, cy + 5], fill=_mix(BG, WHITE, a))

        foot_a = _ease((t - (0.45 + n * per)) / 0.6) * out
        if foot_a > 0.01:
            d.text((x0, y + box_h + 56),
                   "The venue never reads the order. The chain checks the result anyway.",
                   font=F["b"], fill=_mix(BG, GREEN, foot_a))
        img.save(os.path.join(fdir, f"{fr:05d}.png"))
    _render(fdir, path)


def tx_compare_card(path, secs, tmp, txs):
    """The two real transactions, side by side.

    Hashes come from submission/take-txs.json, which the driver writes from the
    take that was actually recorded — there is no constant to fall back to, so a
    missing file fails the cut rather than inventing a transaction.
    """
    from PIL import Image, ImageDraw
    W, H, FPS = 1440, 900, 30
    BG, PANEL = (11, 18, 32), (17, 26, 44)
    WHITE, DIM, GREEN, AMBER, LIGHT = (240, 245, 255), (110, 125, 150), (52, 211, 153), (251, 191, 36), (122, 166, 255)
    F = _fonts()
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_" + os.path.basename(path).replace(".mp4", ""))
    os.makedirs(fdir, exist_ok=True)

    def panel(kind):
        t = txs[kind]
        return [("tx", t["hash"][:22] + "\u2026"), ("method", t["method"]),
                ("block", str(t["block"])), ("contract", t["to"][:16] + "\u2026"),
                ("status", "success")]
    cols = [("The order everyone could read", panel("public"), AMBER),
            ("The order nobody could read", panel("private"), GREEN)]
    absent = ["side", "size", "price", "leverage"]

    pw, ph, px0 = 600, 330, 96
    for fr in range(frames):
        t = fr / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        out = max(0.0, min(1.0, (secs - 0.5 - t) / 0.4))
        d.text((px0, 120), "Both trades, on Flare", font=F["h"], fill=_mix(BG, WHITE, _ease((t - 0.1) / 0.5) * out))

        for c, (title, rows, col) in enumerate(cols):
            t0 = 0.4 + c * 0.5
            a = _ease((t - t0) / 0.6) * out
            if a <= 0.01:
                continue
            bx = px0 + c * (pw + 48)
            slide = int(30 * (1 - _ease((t - t0) / 0.6))) * (1 if c else -1)
            d.rounded_rectangle([bx + slide, 200, bx + pw + slide, 200 + ph], radius=18,
                                fill=_mix(BG, PANEL, a), outline=_mix(BG, col, a * 0.7), width=2)
            d.text((bx + 28 + slide, 226), title, font=F["b"], fill=_mix(BG, col, a))
            for j, (k, v) in enumerate(rows):
                ra = _ease((t - t0 - 0.35 - j * 0.16) / 0.4) * out
                if ra <= 0.01:
                    continue
                ry = 278 + j * 40
                d.text((bx + 28 + slide, ry), k, font=F["s"], fill=_mix(BG, DIM, ra))
                d.text((bx + 168 + slide, ry - 2), v, font=F["ms"], fill=_mix(BG, WHITE, ra))

        t1 = 0.4 + 2 * 0.5 + 1.5
        a2 = _ease((t - t1) / 0.6) * out
        if a2 > 0.01:
            d.text((px0, 556), "What neither transaction carries", font=F["b"], fill=_mix(BG, WHITE, a2))
            for j, word in enumerate(absent):
                t2 = t1 + 0.25 + j * 0.22
                wa = _ease((t - t2) / 0.45) * out
                if wa <= 0.01:
                    continue
                bx = px0 + j * 250
                # The field name stays legible. A line drawn through the middle of
                # the word fought the letterforms and read as a rendering fault —
                # the absence is carried by a mark beside the name instead.
                d.rounded_rectangle([bx, 606, bx + 214, 666], radius=12,
                                    fill=_mix(BG, PANEL, wa), outline=_mix(BG, DIM, wa * 0.45), width=1)
                d.text((bx + 24, 624), word, font=F["b"], fill=_mix(BG, WHITE, wa * 0.9))
                # the mark lands a beat after the chip, and scales as it lands
                mp = _ease((t - t2 - 0.18) / 0.32)
                if mp > 0.02:
                    ma = mp * out
                    cx, cy, r = bx + 178, 636, 5 + 8 * mp
                    red = (239, 68, 68)
                    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=_mix(BG, red, ma * 0.9), width=2)
                    k = r * 0.42
                    d.line([cx - k, cy - k, cx + k, cy + k], fill=_mix(BG, red, ma), width=2)
                    d.line([cx - k, cy + k, cx + k, cy - k], fill=_mix(BG, red, ma), width=2)
            fa = _ease((t - t1 - 1.3) / 0.6) * out
            if fa > 0.01:
                d.text((px0, 700), "Same proof. None of the exposure.", font=F["h"], fill=_mix(BG, GREEN, fa))
        img.save(os.path.join(fdir, f"{fr:05d}.png"))
    _render(fdir, path)


def attack_card(path, secs, tmp):
    """Why the sandwich cannot be built — the two inputs it needs, and what it gets.

    Two lanes race: on a readable order the bot assembles direction and size and
    lands the sandwich; on a hash both inputs stay empty and the lane dead-ends.
    """
    from PIL import Image, ImageDraw
    W, H, FPS = 1440, 900, 30
    BG, PANEL = (11, 18, 32), (17, 26, 44)
    WHITE, DIM, GREEN, RED = (240, 245, 255), (110, 125, 150), (52, 211, 153), (239, 68, 68)
    F = _fonts()
    frames = int(secs * FPS)
    fdir = os.path.join(tmp, "f_" + os.path.basename(path).replace(".mp4", ""))
    os.makedirs(fdir, exist_ok=True)

    lanes = [
        ("Order is readable", RED, [("direction", "LONG"), ("size", "1,669,496 FLR")],
         "sandwich assembled  \u2192  $204.95 taken"),
        ("Order is a hash", GREEN, [("direction", "\u2014"), ("size", "\u2014")],
         "nothing to assemble  \u2192  $0.00"),
    ]
    for fr in range(frames):
        t = fr / FPS
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        out = max(0.0, min(1.0, (secs - 0.5 - t) / 0.4))
        d.text((120, 130), "A sandwich needs two inputs", font=F["h"], fill=_mix(BG, WHITE, _ease((t - 0.1) / 0.5) * out))
        for i, (title, col, fields, verdict) in enumerate(lanes):
            t0 = 0.5 + i * 0.9
            a = _ease((t - t0) / 0.55) * out
            if a <= 0.01:
                continue
            y = 214 + i * 236
            d.rounded_rectangle([120, y, 1320, y + 196], radius=18, fill=_mix(BG, PANEL, a),
                                outline=_mix(BG, col, a * 0.7), width=2)
            d.text((156, y + 28), title, font=F["b"], fill=_mix(BG, col, a))
            for j, (k, v) in enumerate(fields):
                fa = _ease((t - t0 - 0.4 - j * 0.3) / 0.45) * out
                if fa <= 0.01:
                    continue
                bx = 156 + j * 330
                d.text((bx, y + 88), k, font=F["s"], fill=_mix(BG, DIM, fa))
                d.text((bx, y + 118), v, font=F["m"], fill=_mix(BG, WHITE if v != "\u2014" else DIM, fa))
            va = _ease((t - t0 - 1.15) / 0.5) * out
            if va > 0.01:
                d.text((830, y + 108), verdict, font=F["b"], fill=_mix(BG, col, va))
        fa = _ease((t - 3.1) / 0.6) * out
        if fa > 0.01:
            d.text((120, 700), "0 / 25,000 real SHA-256 preimages recovered. The attack has no input.",
                   font=F["b"], fill=_mix(BG, GREEN, fa))
        img.save(os.path.join(fdir, f"{fr:05d}.png"))
    _render(fdir, path)


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
    TIMELINE = []   # (beat id, clip path) in final order — the srt's source of truth

    intro = os.path.join(tmp, "intro.mp4")
    logo_card(intro, DUR.get("intro", 17.0) + 0.6, tmp)
    TIMELINE.append(("intro", narrate(intro, "intro", tmp)))
    all_clips.append(TIMELINE[-1][1])

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

    # The two transactions this take actually produced. No constant fallback:
    # a missing file means the cut cannot honestly claim "here they are".
    txpath = os.path.join(ROOT, "submission", "take-txs.json")
    if not os.path.exists(txpath):
        raise SystemExit("NO_TAKE_TXS: submission/take-txs.json missing — re-record so the "
                         "compare slide shows this take's real transactions")
    take_txs = json.load(open(txpath))

    mid["tx-compare"] = lambda o: tx_compare_card(o, DUR["tx-compare"] + 0.6, tmp, take_txs)
    mid["flow-explain"] = lambda o: flow_card(o, DUR["flow-explain"] + 0.6, tmp)
    mid["attack-explain"] = lambda o: attack_card(o, DUR["attack-explain"] + 0.6, tmp)

    for i, c in enumerate(clips):
        all_clips.append(c); TIMELINE.append((ids[i] if i < len(ids) else None, c))
        after = ids[i] if i < len(ids) else None
        for sid in {"explorer-private": ["tx-compare"],
                    "attack-run": ["attack-explain"],
                    "positions": ["tee-attest", "tee-bound", "tx-details", "flow-explain"]}.get(after, []):
            o = os.path.join(tmp, f"{sid}.mp4"); mid[sid](o)
            nc = narrate(o, sid, tmp)
            all_clips.append(nc); TIMELINE.append((sid, nc))

    honest = os.path.join(tmp, "honest.mp4")
    title_card(honest, [
        ("What is not proven", 46, -170, (255, 255, 255)),
        ("v1 runs a trusted operator for matching", 26, -80, (203, 213, 225)),
        ("liquidity is a vAMM, not an external book", 26, -30, (203, 213, 225)),
        ("testnet  ·  unaudited", 26, 20, (203, 213, 225)),
    ], DUR.get("honest", 18.0) + 0.6, tmp)
    TIMELINE.append(("honest", narrate(honest, "honest", tmp)))
    all_clips.append(TIMELINE[-1][1])

    outro = os.path.join(tmp, "outro.mp4")
    title_card(outro, [
        ("Thanks for watching", 58, -110, (255, 255, 255)),
        ("github.com/nickthelegend/dorr-flare", 28, -10, (157, 180, 255)),
        ("every claim is checkable on-chain", 22, 60, (127, 142, 163)),
    ], DUR.get("outro", 14.0) + 0.6, tmp)
    TIMELINE.append(("outro", narrate(outro, "outro", tmp)))
    all_clips.append(TIMELINE[-1][1])

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

    # Subtitles from what was actually concatenated.
    #
    # This used to walk the beat log, which does not know about slides — so every
    # caption after the first spliced panel drifted by the length of that panel,
    # and by the end it was a minute out. Walk the assembled timeline instead and
    # measure each clip.
    def ts(x):
        h, m, s_ = int(x // 3600), int(x % 3600 // 60), x % 60
        return f"{h:02d}:{m:02d}:{s_:06.3f}".replace(".", ",")
    spec = json.load(open(os.path.join(ROOT, "narration.json")))
    texts = {l["id"]: l["text"] for l in spec["lines"]}
    srt, t, n = [], 0.0, 1
    # Measure the NORMALISED clips, not the ones handed to the muxer. The
    # normalise step runs `-shortest`, which trims a card to its narration and
    # takes ~0.6s off every slide — measuring before that put the captions six
    # seconds ahead of the picture by the attack scene.
    if len(TIMELINE) != len(normed):
        raise SystemExit(f"TIMELINE_DESYNC: {len(TIMELINE)} tracked vs {len(normed)} concatenated")
    for (bid, _), clip in zip(TIMELINE, normed):
        dur_c = vdur(clip)
        txt = texts.get(bid)
        if txt:
            srt.append(f"{n}\n{ts(t)} --> {ts(t + min(dur_c, DUR.get(bid, dur_c)))}\n{txt}\n")
            n += 1
        t += dur_c
    open(os.path.join(OUT, "dorr-flare-demo.srt"), "w").write("\n".join(srt))

    print(f"\nmaster : {master}  {vdur(master):.1f}s")
    print(f"srt    : {os.path.join(OUT, 'dorr-flare-demo.srt')}  ({n-1} cues)")

main()

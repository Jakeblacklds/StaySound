"""Renders the installer window background (660x400 @1x/@2x) and bundles it as a
HiDPI TIFF. Icon positions must match bundle.macOS.dmg in src-tauri/tauri.conf.json."""
import math, random, subprocess, os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 660, 400
APP, APPS = (170, 168), (490, 168)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src-tauri', 'dmg')
FONT = '/System/Library/Fonts/HelveticaNeue.ttc'
ICON = os.path.join(HERE, '..', 'src-tauri', 'icons', 'icon.png')
AMBER, CORAL = (255, 163, 26), (255, 92, 122)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def render(S):
    w, h = W * S, H * S
    base = Image.new('RGB', (w, h), (6, 7, 11))

    # --- light: warm bloom on the drop target, cool counter-light on the app side
    light = Image.new('RGB', (w, h), (0, 0, 0))
    g = ImageDraw.Draw(light)
    def bloom(cx, cy, rx, ry, col, peak):
        for i in range(60, 0, -1):
            t = 1 - i / 60
            k = peak * t ** 2.4
            g.ellipse((cx - rx * i / 60, cy - ry * i / 60, cx + rx * i / 60, cy + ry * i / 60),
                      fill=tuple(int(c * k) for c in col))
    bloom(APPS[0] * S, APPS[1] * S, 230 * S, 170 * S, AMBER, 0.34)
    bloom(APP[0] * S, APP[1] * S, 190 * S, 140 * S, (90, 110, 255), 0.13)
    base = ImageChops.add(base, light.filter(ImageFilter.GaussianBlur(26 * S)))

    # --- dot matrix, brighter near the centre line
    dots = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(dots)
    step = 13 * S
    for y in range(step // 2, h, step):
        for x in range(step // 2, w, step):
            dx, dy = (x - w / 2) / (w / 2), (y - APP[1] * S) / (h * 0.55)
            a = max(0.0, 1 - (dx * dx * 0.55 + dy * dy)) ** 1.3
            r = 1.0 * S
            d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, int(8 + 52 * a)))
    base = Image.alpha_composite(base.convert('RGBA'), dots)

    # --- concentric rings (the app's circular language) around both drop points
    rings = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    r_ = ImageDraw.Draw(rings)
    for (cx, cy), col, n, a0 in ((APPS, AMBER, 5, 70), (APP, (170, 180, 255), 3, 26)):
        for i in range(n):
            rad = (66 + i * 30) * S
            a = int(a0 * (1 - i / (n + 0.5)))
            r_.ellipse((cx * S - rad, cy * S - rad, cx * S + rad, cy * S + rad),
                       outline=col + (a,), width=max(1, int(1.2 * S)))
    base = Image.alpha_composite(base, rings)

    # --- waveform floor: the player's own bar language, fading up and out
    wave = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wave)
    rnd = random.Random(7)
    pitch, bw = 7 * S, 3.2 * S
    n = w // pitch
    for i in range(n):
        x = i * pitch + pitch / 2
        env = 0.5 + 0.5 * math.sin(i * 0.21) * math.sin(i * 0.063 + 1.2)
        amp = (0.18 + 0.82 * env * (0.55 + 0.45 * rnd.random())) * 62 * S
        t = i / n
        col = lerp(AMBER, CORAL, min(1, max(0, (t - 0.35) / 0.65)))
        base_y = h - 14 * S
        for j in range(8):
            y0 = base_y - amp * (j + 1) / 8
            wd.rounded_rectangle((x - bw / 2, y0, x + bw / 2, base_y - amp * j / 8),
                                 radius=bw / 2, fill=col + (int(190 * (1 - j / 8) ** 0.9),))
    base = Image.alpha_composite(base, wave)

    # --- curved arrow with a travelling glow (quadratic bezier from app to target)
    arrow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arrow)
    p0 = ((APP[0] + 74) * S, (APP[1] - 8) * S)
    p2 = ((APPS[0] - 80) * S, (APPS[1] - 8) * S)
    p1 = ((p0[0] + p2[0]) / 2, (APP[1] - 70) * S)
    def bez(t):
        return ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
    dashes = 16
    for i in range(dashes):
        t0, t1 = (i + 0.12) / dashes, (i + 0.62) / dashes
        col = lerp((255, 220, 150), AMBER, i / dashes)
        pts = [bez(t0 + (t1 - t0) * k / 5) for k in range(6)]
        ad.line(pts, fill=col + (int(110 + 145 * i / dashes),), width=int(2.6 * S), joint='curve')
    # arrowhead along the final tangent
    ex, ey = bez(1.0)
    bx, by = bez(0.96)
    ang = math.atan2(ey - by, ex - bx)
    hl = 11 * S
    head = [(ex, ey), (ex - hl * math.cos(ang - 0.5), ey - hl * math.sin(ang - 0.5)),
            (ex - hl * math.cos(ang + 0.5), ey - hl * math.sin(ang + 0.5))]
    ad.polygon(head, fill=AMBER + (255,))
    glow = arrow.filter(ImageFilter.GaussianBlur(7 * S))
    base = Image.alpha_composite(base, glow)
    base = Image.alpha_composite(base, glow)
    base = Image.alpha_composite(base, arrow)

    # --- brand header: real app icon + wordmark
    d = ImageDraw.Draw(base)
    f_brand = ImageFont.truetype(FONT, int(19 * S), index=1)
    f_tag = ImageFont.truetype(FONT, int(11.5 * S), index=0)
    f_hint = ImageFont.truetype(FONT, int(12.5 * S), index=0)
    icon = Image.open(ICON).convert('RGBA').resize((int(30 * S), int(30 * S)), Image.LANCZOS)
    mask = Image.new('L', icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, icon.width - 1, icon.height - 1), radius=icon.width * 0.225, fill=255)
    icon.putalpha(ImageChops.multiply(icon.getchannel('A'), mask))
    name = 'StaySound'
    nb = d.textbbox((0, 0), name, font=f_brand)
    total = icon.width + 10 * S + (nb[2] - nb[0])
    x0 = (w - total) / 2
    base.alpha_composite(icon, (int(x0), int(24 * S)))
    d.text((x0 + icon.width + 10 * S, 25 * S), name, font=f_brand, fill=(244, 244, 248, 255))
    tag = 'Música en alta calidad'
    tb = d.textbbox((0, 0), tag, font=f_tag)
    d.text(((w - (tb[2] - tb[0])) / 2, 64 * S), tag, font=f_tag, fill=(150, 153, 168, 255))

    # --- hint pill
    hint = 'Arrastra a Aplicaciones para instalar'
    hb = d.textbbox((0, 0), hint, font=f_hint)
    pw, ph = hb[2] - hb[0] + 34 * S, 30 * S
    px, py = (w - pw) / 2, 296 * S
    pill = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pill)
    pd.rounded_rectangle((px, py, px + pw, py + ph), radius=ph / 2, fill=(255, 255, 255, 16),
                         outline=(255, 255, 255, 40), width=max(1, S))
    base = Image.alpha_composite(base, pill)
    d = ImageDraw.Draw(base)
    d.text((px + 17 * S, py + (ph - (hb[3] - hb[1])) / 2 - hb[1]), hint, font=f_hint, fill=(232, 233, 240, 255))

    # vignette
    vig = Image.new('L', (w, h), 0)
    vd = ImageDraw.Draw(vig)
    vd.rectangle((0, 0, w, h), fill=140)
    vd.ellipse((-w * 0.12, -h * 0.25, w * 1.12, h * 1.25), fill=0)
    vig = vig.filter(ImageFilter.GaussianBlur(60 * S))
    black = Image.new('RGBA', (w, h), (0, 0, 0, 255))
    base = Image.composite(black, base, vig)
    return base.convert('RGB')

os.makedirs(OUT, exist_ok=True)
p1, p2 = os.path.join(OUT, 'background.png'), os.path.join(OUT, 'background@2x.png')
big = render(4)
big.resize((W * 2, H * 2), Image.LANCZOS).save(p2)
big.resize((W, H), Image.LANCZOS).save(p1)
subprocess.run(['tiffutil', '-cathidpicheck', p1, p2, '-out', os.path.join(OUT, 'background.tiff')], check=True)

"""Builds README art from the headless screenshots in docs/screens/*.png.

1. Capture: run `npm run dev`, then open http://localhost:1420/?shot=1&page=<page>&theme=<theme>
   at 1320x880 with device scale 2 (see docs/README section in the main README).
2. Run: python docs/make_readme_art.py
Outputs docs/banner.png, docs/themes.jpg and compressed docs/img/*.jpg.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

DOCS = Path(__file__).parent
SCREENS = DOCS / "screens"
IMG = DOCS / "img"
IMG.mkdir(exist_ok=True)

BOLD = "C:/Windows/Fonts/segoeuib.ttf"
REG = "C:/Windows/Fonts/segoeui.ttf"
CRIMSON = (255, 30, 39)
VOID = (11, 11, 14)


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, (0, 0), mask)
    return out


def shadowed(card, radius, blur=40, offset=24, alpha=170):
    """Card with a soft drop shadow, on a transparent canvas."""
    pad = blur * 2
    canvas = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([pad, pad + offset, pad + card.width, pad + card.height + offset], radius, fill=(0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh)
    canvas.alpha_composite(rounded(card.convert("RGBA"), radius), (pad, pad))
    return canvas, pad


def glow_bg(w, h, color, spots):
    bg = Image.new("RGB", (w, h), VOID)
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for cx, cy, r, s in spots:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(int(c * s) for c in color))
    layer = layer.filter(ImageFilter.GaussianBlur(max(w, h) // 9))
    return ImageChops.screen(bg, layer)


def logo(draw, cx, cy, size, fill=CRIMSON, hole=VOID):
    k = size / 1024
    ox, oy = cx - 512 * k, cy - 512 * k
    p = lambda x, y: (ox + x * k, oy + y * k)
    draw.polygon([p(170, 262), p(450, 262), p(450, 352), p(270, 352), p(270, 468), p(420, 468), p(420, 556), p(270, 556), p(270, 762), p(170, 762)], fill=fill)
    c = p(660, 512)
    ro, ri = 244 * k, 148 * k
    draw.ellipse([c[0] - ro, c[1] - ro, c[0] + ro, c[1] + ro], fill=fill)
    draw.ellipse([c[0] - ri, c[1] - ri, c[0] + ri, c[1] + ri], fill=hole)


# ---------------------------------------------------------------- compressed screenshots
for png in sorted(SCREENS.glob("*.png")):
    im = Image.open(png).convert("RGB")
    im.thumbnail((1760, 1760), Image.LANCZOS)
    im.save(IMG / f"{png.stem}.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    print("img", png.stem)

# ---------------------------------------------------------------- banner (2400 x 1200)
W, H = 2400, 1200
banner = glow_bg(W, H, CRIMSON, [(2050, 120, 620, 0.55), (300, 1150, 520, 0.25), (1500, 900, 400, 0.18)]).convert("RGBA")

# Subtle tactical grid, fading out to the left.
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grid)
for x in range(0, W, 60):
    gd.line([(x, 0), (x, H)], fill=(255, 255, 255, 9))
for y in range(0, H, 60):
    gd.line([(0, y), (W, y)], fill=(255, 255, 255, 9))
fade = Image.linear_gradient("L").rotate(90).resize((W, H))
grid.putalpha(ImageChops.multiply(grid.getchannel("A"), fade))
banner.alpha_composite(grid)

# App screenshot, tilted card on the right.
shot = Image.open(SCREENS / "home.png").convert("RGB")
shot = shot.resize((1320, 880), Image.LANCZOS)
card, pad = shadowed(shot, 28, blur=50, offset=30, alpha=200)
card = card.rotate(-4, resample=Image.BICUBIC, expand=True)
banner.alpha_composite(card, (1080 - pad, 170 - pad))

# Left text block on a gradient so it stays readable over the card edge.
shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shade)
for x in range(1300):
    a = int(235 * max(0.0, 1 - x / 1300) ** 1.4)
    sd.line([(x, 0), (x, H)], fill=VOID + (a,))
banner.alpha_composite(shade)

d = ImageDraw.Draw(banner)
logo(d, 205, 300, 190)
fb = ImageFont.truetype(BOLD, 128)
d.text((130, 430), "Fresh", font=fb, fill="white")
d.text((130 + d.textlength("Fresh", font=fb), 430), "Optimizer", font=fb, fill=CRIMSON)
d.text((136, 610), "One-click Windows tuning for", font=ImageFont.truetype(REG, 50), fill=(200, 203, 214))
d.text((136, 676), "smoother, lower-lag competitive games.", font=ImageFont.truetype(REG, 50), fill=(200, 203, 214))

# Pills
fp = ImageFont.truetype(BOLD, 34)
pills = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(pills)
x = 136
for label in ["Anti-cheat safe", "1-click undo", "Free, no ads"]:
    tw = d.textlength(label, font=fp)
    pd.rounded_rectangle([x, 800, x + tw + 56, 868], 34, fill=(255, 255, 255, 16), outline=(255, 255, 255, 56), width=2)
    x += tw + 56 + 18
banner.alpha_composite(pills)
d = ImageDraw.Draw(banner)
x = 136
for label in ["Anti-cheat safe", "1-click undo", "Free, no ads"]:
    tw = d.textlength(label, font=fp)
    d.text((x + 28, 812), label, font=fp, fill="white")
    x += tw + 56 + 18
x = 136
for game in ["VALORANT", "CS2", "APEX", "OVERWATCH 2"]:
    fg = ImageFont.truetype(BOLD, 28)
    tw = d.textlength(game, font=fg)
    d.text((x, 930), game, font=fg, fill=(143, 148, 166))
    x += tw + 46

banner.convert("RGB").resize((1600, 800), Image.LANCZOS).save(DOCS / "banner.png", optimize=True)
print("banner")

# ---------------------------------------------------------------- theme gallery (4 x 2)
themes = [
    ("theme-abyss", "Abyss"),
    ("theme-synthwave", "Synthwave"),
    ("theme-toxic", "Toxic"),
    ("theme-tactical", "Tactical"),
    ("theme-amethyst", "Amethyst"),
    ("theme-sakura", "Sakura"),
    ("theme-amoled", "AMOLED"),
    ("theme-mono", "Mono"),
]
COLS = 4
TW, TH, GAP, LBL = 860, 573, 40, 70
G = Image.new("RGB", (COLS * TW + (COLS + 1) * GAP, 2 * (TH + LBL) + 3 * GAP), (8, 8, 10)).convert("RGBA")
gd = ImageDraw.Draw(G)
fl = ImageFont.truetype(BOLD, 34)
for i, (stem, name) in enumerate(themes):
    im = Image.open(SCREENS / f"{stem}.png").convert("RGB").resize((TW, TH), Image.LANCZOS)
    col, row = i % COLS, i // COLS
    x = GAP + col * (TW + GAP)
    y = GAP + row * (TH + LBL + GAP)
    G.alpha_composite(rounded(im.convert("RGBA"), 18), (x, y))
    edge = Image.new("RGBA", G.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([x, y, x + TW - 1, y + TH - 1], 18, outline=(255, 255, 255, 34), width=2)
    G.alpha_composite(edge)
    gd.text((x + 4, y + TH + 16), name, font=fl, fill="white")
G.convert("RGB").save(DOCS / "img" / "themes.jpg", "JPEG", quality=86, optimize=True, progressive=True)
print("themes")

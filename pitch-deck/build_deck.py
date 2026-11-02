#!/usr/bin/env python3
"""Rebuild MODUS pre-seed pitch deck (14 slides). House style: no em/en dash, no Oxford comma, no emoji."""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# Palette
CHARCOAL = RGBColor(0x16, 0x16, 0x18)
CARD     = RGBColor(0x1E, 0x1E, 0x22)
CARD2    = RGBColor(0x26, 0x26, 0x2C)
VIOLET   = RGBColor(0x8B, 0x5C, 0xF6)
VIOLET_D = RGBColor(0x7C, 0x3A, 0xED)
WHITE    = RGBColor(0xF5, 0xF5, 0xF7)
GREY     = RGBColor(0xA1, 0xA1, 0xAA)
GREY_D   = RGBColor(0x71, 0x71, 0x7A)
GREEN    = RGBColor(0x34, 0xD3, 0x99)

HEAD = "Space Grotesk"
BODY = "Inter"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
SW, SH = prs.slide_width, prs.slide_height
BLANK = prs.slide_layouts[6]

def slide(bg=CHARCOAL):
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SW, SH)
    r.fill.solid(); r.fill.fore_color.rgb = bg
    r.line.fill.background()
    r.shadow.inherit = False
    return s

def txt(s, text, left, top, width, height, size=18, color=WHITE, bold=False,
        font=BODY, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, italic=False):
    tb = s.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame; tf.word_wrap = True
    tf.vertical_anchor = anchor
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        r = p.add_run(); r.text = ln
        f = r.font
        f.size = Pt(size); f.bold = bold; f.italic = italic
        f.name = font; f.color.rgb = color
    return tb

def rect(s, left, top, width, height, fill=CARD, line=None, radius=True):
    shp = s.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
        left, top, width, height)
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line: shp.line.color.rgb = line; shp.line.width = Pt(1)
    else: shp.line.fill.background()
    shp.shadow.inherit = False
    return shp

def kicker(s, text, left=Inches(0.9), top=Inches(0.62)):
    txt(s, text.upper(), left, top, Inches(11), Inches(0.4), size=13,
        color=VIOLET, bold=True, font=HEAD)

def title(s, text, left=Inches(0.9), top=Inches(1.02), width=Inches(11.5), size=40):
    txt(s, text, left, top, width, Inches(1.4), size=size, color=WHITE, bold=True,
        font=HEAD, spacing=1.02)

def pageno(s, n):
    txt(s, f"{n:02d}", Inches(12.4), Inches(6.95), Inches(0.7), Inches(0.35),
        size=11, color=GREY_D, font=HEAD, align=PP_ALIGN.RIGHT)

def add_img_cover(s, path, left, top, width, height):
    """Place image scaled to fit inside box, centered, keeping aspect."""
    im = Image.open(path); iw, ih = im.size
    box_ar = width / height; img_ar = iw / ih
    if img_ar > box_ar:
        w = width; h = int(width / img_ar)
    else:
        h = height; w = int(height * img_ar)
    l = left + (width - w) // 2; t = top + (height - h) // 2
    return s.shapes.add_picture(path, l, t, w, h)

def dot(s, left, top, color=VIOLET, d=Inches(0.14)):
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, left, top, d, d)
    c.fill.solid(); c.fill.fore_color.rgb = color; c.line.fill.background()
    c.shadow.inherit = False

P = os.path.join(HERE, "%s")

# ---------------------------------------------------------------- 1 TITLE
s = slide()
# accent bar
rect(s, 0, 0, Inches(0.18), SH, fill=VIOLET, radius=False)
s.shapes.add_picture(P % "logo-dark.png", Inches(0.9), Inches(0.85), height=Inches(0.9))
txt(s, "MODUS", Inches(1.95), Inches(0.95), Inches(4), Inches(0.7), size=30, bold=True, font=HEAD)
txt(s, "Every model, one software.", Inches(0.9), Inches(2.9), Inches(11.5), Inches(1.4),
    size=54, bold=True, font=HEAD, color=WHITE, spacing=1.0)
txt(s, "One subscription for every frontier model, that also knows your\ninbox, calendar, files and memory.",
    Inches(0.92), Inches(4.35), Inches(10.5), Inches(1.2), size=22, color=GREY, spacing=1.15)
txt(s, "Pre-seed  ·  2026", Inches(0.92), Inches(6.6), Inches(6), Inches(0.5),
    size=15, color=VIOLET, bold=True, font=HEAD)
txt(s, "Jeremiah Maximo", Inches(9.0), Inches(6.6), Inches(3.4), Inches(0.5),
    size=15, color=GREY, font=HEAD, align=PP_ALIGN.RIGHT)

# ---------------------------------------------------------------- 2 PROBLEM
s = slide(); kicker(s, "The problem"); title(s, "The best AI is fragmented, and\nyou pay for all of it.")
pageno(s, 2)
items = [
    ("Four subscriptions", "ChatGPT, Claude, Gemini and Perplexity each want about $20 a month. The serious user pays roughly $80 for four tabs."),
    ("No single best model", "The leader changes every few weeks. Locking into one lab means using a worse model the moment someone else ships."),
    ("None of them know you", "Every chat starts cold. Your inbox, calendar and files live somewhere else, so the AI answers without any of your context."),
]
x = Inches(0.9); w = Inches(3.72); gap = Inches(0.18); top = Inches(2.7); h = Inches(3.6)
for i, (head, body) in enumerate(items):
    lx = x + i * (w + gap)
    rect(s, lx, top, w, h, fill=CARD)
    dot(s, lx + Inches(0.35), top + Inches(0.42))
    txt(s, head, lx + Inches(0.35), top + Inches(0.7), w - Inches(0.7), Inches(0.8),
        size=21, bold=True, font=HEAD)
    txt(s, body, lx + Inches(0.35), top + Inches(1.5), w - Inches(0.7), h - Inches(1.7),
        size=15, color=GREY, spacing=1.22)

# ---------------------------------------------------------------- 3 SOLUTION
s = slide(); kicker(s, "The solution"); pageno(s, 3)
title(s, "MODUS is the answer engine that\nruns every model and knows you.")
pts = [
    ("Every model, one price", "Frontier models from every lab under a single $24 a month subscription. Always the newest, no per lab lock in."),
    ("Auto or ask them all", "MODUS routes each task to the best model, or asks up to three at once so you can compare answers side by side."),
    ("Connected context", "Plugs into your inbox, calendar, files and memory, so answers use what you actually have, not a blank slate."),
]
top = Inches(2.55)
for i, (head, body) in enumerate(pts):
    ly = top + i * Inches(1.42)
    dot(s, Inches(0.95), ly + Inches(0.12), d=Inches(0.2))
    txt(s, head, Inches(1.4), ly, Inches(5.1), Inches(0.5), size=20, bold=True, font=HEAD)
    txt(s, body, Inches(1.4), ly + Inches(0.5), Inches(5.2), Inches(0.9), size=14.5,
        color=GREY, spacing=1.18)
# product shot on right
rect(s, Inches(7.05), Inches(2.35), Inches(5.4), Inches(4.35), fill=CARD, line=CARD2)
add_img_cover(s, P % "screenshot-models.png", Inches(7.25), Inches(2.55), Inches(5.0), Inches(3.95))

# ---------------------------------------------------------------- 4 PRODUCT
s = slide(); kicker(s, "Product"); pageno(s, 4)
title(s, "One workspace. Chat, compare,\nand your daily briefing.")
# big screenshot
rect(s, Inches(0.9), Inches(2.45), Inches(8.0), Inches(4.4), fill=CARD, line=CARD2)
add_img_cover(s, P % "screenshot-briefing.png", Inches(1.05), Inches(2.6), Inches(7.7), Inches(4.1))
feats = [
    ("Web, desktop and iPhone", "The same workspace everywhere, already shipped and in daily use."),
    ("Compare mode", "Fire one prompt at multiple models and read the answers next to each other."),
    ("Briefing and workspace", "Goals, reminders and a daily briefing built from your connected context."),
]
fx = Inches(9.2); fw = Inches(3.25); ftop = Inches(2.55)
for i, (head, body) in enumerate(feats):
    ly = ftop + i * Inches(1.45)
    rect(s, fx, ly, fw, Inches(1.25), fill=CARD)
    txt(s, head, fx + Inches(0.28), ly + Inches(0.18), fw - Inches(0.5), Inches(0.4),
        size=15.5, bold=True, font=HEAD, color=VIOLET)
    txt(s, body, fx + Inches(0.28), ly + Inches(0.6), fw - Inches(0.5), Inches(0.6),
        size=12.5, color=GREY, spacing=1.15)

# ---------------------------------------------------------------- 5 WHY NOW
s = slide(); kicker(s, "Why now"); pageno(s, 5)
title(s, "The model race is speeding up,\nnot settling down.")
cols = [
    ("No permanent winner", "The frontier lead flips between labs every few weeks. Users who commit to one are always one release behind."),
    ("Consumer AI is proven", "ChatGPT has over 900 million weekly users and more than 50 million paying subscribers. The habit exists."),
    ("Fragmentation is the tax", "The more good models ship, the more a single neutral layer over all of them is worth. The problem grows with the market."),
]
w = Inches(3.72); gap = Inches(0.18); top = Inches(2.75); h = Inches(3.5)
for i, (head, body) in enumerate(cols):
    lx = Inches(0.9) + i * (w + gap)
    rect(s, lx, top, w, h, fill=CARD)
    txt(s, f"0{i+1}", lx + Inches(0.35), top + Inches(0.35), w, Inches(0.6),
        size=26, bold=True, font=HEAD, color=VIOLET_D)
    txt(s, head, lx + Inches(0.35), top + Inches(1.1), w - Inches(0.7), Inches(0.8),
        size=19, bold=True, font=HEAD)
    txt(s, body, lx + Inches(0.35), top + Inches(1.85), w - Inches(0.7), h - Inches(2.0),
        size=14.5, color=GREY, spacing=1.2)

# ---------------------------------------------------------------- 6 MOAT
s = slide(); kicker(s, "The moat"); pageno(s, 6)
title(s, "The Switzerland of AI.")
txt(s, "MODUS wins by being the one player that is never owned by a single lab.",
    Inches(0.9), Inches(2.05), Inches(11), Inches(0.6), size=20, color=GREY)
moat = [
    ("Neutral by design", "OpenAI will never ship Claude. Google will never ship GPT. Only a neutral layer can offer the best of all of them."),
    ("Newest model, day one", "Whoever takes the lead, our users get it immediately, without switching apps or paying again."),
    ("Reinforcing context", "Routing, one price everywhere and connected context all compound. The more you use MODUS, the better it knows you."),
]
w = Inches(3.72); gap = Inches(0.18); top = Inches(2.95); h = Inches(3.3)
for i, (head, body) in enumerate(moat):
    lx = Inches(0.9) + i * (w + gap)
    rect(s, lx, top, w, h, fill=CARD, line=(VIOLET_D if i == 0 else None))
    dot(s, lx + Inches(0.35), top + Inches(0.42), color=(VIOLET if i==0 else GREY))
    txt(s, head, lx + Inches(0.35), top + Inches(0.7), w - Inches(0.7), Inches(0.8),
        size=19, bold=True, font=HEAD)
    txt(s, body, lx + Inches(0.35), top + Inches(1.5), w - Inches(0.7), h - Inches(1.7),
        size=14.5, color=GREY, spacing=1.2)

# ---------------------------------------------------------------- 7 MARKET
s = slide(); kicker(s, "Market"); pageno(s, 7)
title(s, "The spend already exists.\nWe consolidate it.")
# left: stacked cost
lx = Inches(0.9); lw = Inches(5.6)
rect(s, lx, Inches(2.55), lw, Inches(4.2), fill=CARD)
txt(s, "What the serious user pays today", lx + Inches(0.4), Inches(2.85), lw - Inches(0.8),
    Inches(0.5), size=16, bold=True, font=HEAD, color=GREY)
stack = [("ChatGPT Plus", "$20"), ("Claude Pro", "$20"), ("Perplexity Pro", "$20"), ("Google AI Pro", "$20")]
sy = Inches(3.5)
for i, (name, price) in enumerate(stack):
    ly = sy + i * Inches(0.62)
    txt(s, name, lx + Inches(0.4), ly, Inches(3.2), Inches(0.5), size=15.5, color=WHITE)
    txt(s, price, lx + Inches(3.6), ly, lw - Inches(4.0), Inches(0.5), size=15.5,
        color=GREY, align=PP_ALIGN.RIGHT, font=HEAD)
txt(s, "About $80 a month for four tabs", lx + Inches(0.4), Inches(6.05), lw - Inches(0.8),
    Inches(0.5), size=15, color=GREY_D, italic=True)
# right: MODUS
rx = Inches(6.85); rw = Inches(5.6)
rect(s, rx, Inches(2.55), rw, Inches(4.2), fill=CARD, line=VIOLET_D)
txt(s, "MODUS", rx + Inches(0.4), Inches(2.9), rw - Inches(0.8), Inches(0.6), size=20,
    bold=True, font=HEAD, color=VIOLET)
txt(s, "$24", rx + Inches(0.4), Inches(3.7), rw - Inches(0.8), Inches(1.2), size=72,
    bold=True, font=HEAD, color=WHITE)
txt(s, "a month, every model included", rx + Inches(0.4), Inches(5.0), rw - Inches(0.8),
    Inches(0.5), size=17, color=GREY)
txt(s, "Same spend, one bill, more capability.", rx + Inches(0.4), Inches(5.9), rw - Inches(0.8),
    Inches(0.6), size=15, color=GREEN, bold=True, font=HEAD)

# ---------------------------------------------------------------- 8 BUSINESS MODEL
s = slide(); kicker(s, "Business model"); pageno(s, 8)
title(s, "Simple subscriptions, healthy\nunit economics.")
tiers = [
    ("Free", "Open models,\nusage windowed", "Costs about $2\na month at worst"),
    ("MODUS", "$24 a month\n$240 a year", "Every frontier\nmodel, one price"),
    ("Pilot", "$59 a month\n$588 a year", "Power features\nand higher limits"),
]
w = Inches(3.72); gap = Inches(0.18); top = Inches(2.75); h = Inches(3.4)
for i, (name, price, note) in enumerate(tiers):
    lx = Inches(0.9) + i * (w + gap)
    hl = (i == 1)
    rect(s, lx, top, w, h, fill=(CARD2 if hl else CARD), line=(VIOLET_D if hl else None))
    txt(s, name, lx + Inches(0.35), top + Inches(0.35), w - Inches(0.7), Inches(0.5),
        size=20, bold=True, font=HEAD, color=(VIOLET if hl else WHITE))
    txt(s, price, lx + Inches(0.35), top + Inches(1.15), w - Inches(0.7), Inches(1.0),
        size=22, bold=True, font=HEAD, spacing=1.05)
    txt(s, note, lx + Inches(0.35), top + Inches(2.45), w - Inches(0.7), Inches(0.9),
        size=14.5, color=GREY, spacing=1.15)
txt(s, "Free tier runs open models on a rolling window, so cost is bounded. Paid tiers carry the frontier models. Limits add-on stacks on top.",
    Inches(0.9), Inches(6.4), Inches(11.5), Inches(0.7), size=14, color=GREY_D, spacing=1.15)

# ---------------------------------------------------------------- 9 TRACTION
s = slide(); kicker(s, "Traction"); pageno(s, 9)
title(s, "Built and shipped, by one\nfounder.")
stats = [
    ("3", "platforms live", "Web, desktop and iPhone, all shipped with billing."),
    ("10", "models wired", "Every major lab, routed and priced under one account."),
    ("Warm", "paying users", "Real subscribers on the paid plan, plus daily engagement."),
]
w = Inches(3.72); gap = Inches(0.18); top = Inches(2.7); h = Inches(2.7)
for i, (big, lab, body) in enumerate(stats):
    lx = Inches(0.9) + i * (w + gap)
    rect(s, lx, top, w, h, fill=CARD)
    txt(s, big, lx + Inches(0.35), top + Inches(0.3), w - Inches(0.7), Inches(1.1),
        size=52, bold=True, font=HEAD, color=VIOLET)
    txt(s, lab, lx + Inches(0.37), top + Inches(1.35), w - Inches(0.7), Inches(0.5),
        size=17, bold=True, font=HEAD)
    txt(s, body, lx + Inches(0.37), top + Inches(1.85), w - Inches(0.7), Inches(0.8),
        size=13.5, color=GREY, spacing=1.15)
txt(s, "Product risk is behind us. The raise funds distribution, not the build.",
    Inches(0.9), Inches(5.8), Inches(11.5), Inches(0.7), size=18, color=WHITE, bold=True, font=HEAD)

# ---------------------------------------------------------------- 10 GTM
s = slide(); kicker(s, "Go to market"); pageno(s, 10)
title(s, "A distribution plan, not a\nbuild plan.")
gtm = [
    ("Affiliates and creators", "AI creators and newsletters earn on annual plans. Our likely strongest channel, aligned on incentive."),
    ("Content engine", "Branded pages and a steady publishing cadence that ranks for the multi model comparison intent."),
    ("Desktop wedge", "The desktop app and screen assist give a native surface that lives next to the work, not in a browser tab."),
]
top = Inches(2.6)
for i, (head, body) in enumerate(gtm):
    ly = top + i * Inches(1.35)
    txt(s, f"0{i+1}", Inches(0.95), ly, Inches(0.9), Inches(0.7), size=26, bold=True,
        font=HEAD, color=VIOLET_D)
    txt(s, head, Inches(1.9), ly, Inches(9.5), Inches(0.5), size=20, bold=True, font=HEAD)
    txt(s, body, Inches(1.9), ly + Inches(0.5), Inches(9.8), Inches(0.7), size=15,
        color=GREY, spacing=1.18)

# ---------------------------------------------------------------- 11 COMPETITION
s = slide(); kicker(s, "Competition"); pageno(s, 11)
title(s, "Nobody else is neutral and\nknows you.")
# 2x2 matrix
mx, my = Inches(3.4), Inches(2.55)
mw, mh = Inches(7.2), Inches(4.2)
rect(s, mx, my, mw, mh, fill=CARD, radius=False)
# quadrant lines
ln1 = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, mx + mw/2 - Emu(6350), my, Emu(12700), mh)
ln1.fill.solid(); ln1.fill.fore_color.rgb = CARD2; ln1.line.fill.background(); ln1.shadow.inherit=False
ln2 = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, mx, my + mh/2 - Emu(6350), mw, Emu(12700))
ln2.fill.solid(); ln2.fill.fore_color.rgb = CARD2; ln2.line.fill.background(); ln2.shadow.inherit=False
# axis labels
txt(s, "Just chat", mx, my - Inches(0.05), mw/2, Inches(0.4), size=12.5, color=GREY_D,
    align=PP_ALIGN.CENTER, font=HEAD)
txt(s, "Knows you", mx + mw/2, my - Inches(0.05), mw/2, Inches(0.4), size=12.5, color=GREY_D,
    align=PP_ALIGN.CENTER, font=HEAD)
txt(s, "SINGLE LAB", mx - Inches(2.35), my + Inches(0.9), Inches(2.2), Inches(0.4), size=12.5,
    color=GREY_D, align=PP_ALIGN.RIGHT, font=HEAD, bold=True)
txt(s, "EVERY MODEL", mx - Inches(2.35), my + mh - Inches(1.3), Inches(2.2), Inches(0.4),
    size=12.5, color=VIOLET, align=PP_ALIGN.RIGHT, font=HEAD, bold=True)
# quadrant contents
def quad(cx, cy, label, col=GREY):
    txt(s, label, cx, cy, mw/2 - Inches(0.3), Inches(1.2), size=14, color=col,
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.1, font=HEAD)
quad(mx + Inches(0.15), my + Inches(0.35), "ChatGPT\nClaude\nGemini")
quad(mx + mw/2 + Inches(0.15), my + Inches(0.35), "Copilot\nAssistants")
quad(mx + Inches(0.15), my + mh/2 + Inches(0.35), "OpenRouter\nPoll")
# MODUS quadrant highlighted
hl = rect(s, mx + mw/2 + Inches(0.25), my + mh/2 + Inches(0.25), mw/2 - Inches(0.5),
          mh/2 - Inches(0.5), fill=VIOLET_D)
txt(s, "MODUS", mx + mw/2 + Inches(0.25), my + mh/2 + Inches(0.25), mw/2 - Inches(0.5),
    mh/2 - Inches(0.5), size=22, color=WHITE, bold=True, align=PP_ALIGN.CENTER,
    anchor=MSO_ANCHOR.MIDDLE, font=HEAD)

# ---------------------------------------------------------------- 12 TEAM
s = slide(); kicker(s, "Team"); pageno(s, 12)
title(s, "Solo founder who ships.")
rect(s, Inches(0.9), Inches(2.6), Inches(11.5), Inches(2.6), fill=CARD)
try:
    add_img_cover(s, P % "logo-dark.png", Inches(1.25), Inches(3.0), Inches(1.5), Inches(1.5))
except Exception:
    pass
txt(s, "Jeremiah Maximo", Inches(3.1), Inches(2.95), Inches(8.8), Inches(0.6), size=26,
    bold=True, font=HEAD)
txt(s, "Founder. Built and shipped MODUS across web, desktop and iPhone, including billing, routing across every major lab, and connected context. Also runs a marketing agency and a second live product, so distribution and revenue are the day job.",
    Inches(3.1), Inches(3.65), Inches(8.9), Inches(1.4), size=16, color=GREY, spacing=1.25)
txt(s, "What this raise adds", Inches(0.9), Inches(5.55), Inches(11), Inches(0.5), size=16,
    bold=True, font=HEAD, color=VIOLET)
txt(s, "A part time growth partner and a real distribution budget, so the product that is already built reaches the people who want it.",
    Inches(0.9), Inches(6.1), Inches(11.5), Inches(0.8), size=15, color=GREY, spacing=1.2)

# ---------------------------------------------------------------- 13 ASK
s = slide(); kicker(s, "The ask"); pageno(s, 13)
rect(s, 0, 0, Inches(0.18), SH, fill=VIOLET, radius=False)
txt(s, "Raising $125k", Inches(0.9), Inches(1.5), Inches(11.5), Inches(1.1), size=52,
    bold=True, font=HEAD)
txt(s, "Post money SAFE, $4M cap, about 3.1 percent.", Inches(0.92), Inches(2.7),
    Inches(11), Inches(0.6), size=22, color=GREY)
use = [
    ("Runway", "12 to 15 months of focused build and growth."),
    ("Distribution", "Budget for affiliates, content and paid tests."),
    ("Growth partner", "A part time hire to own the channels."),
    ("Infra and models", "Model and infrastructure costs as usage grows."),
]
w = Inches(2.78); gap = Inches(0.18); top = Inches(3.85); h = Inches(2.4)
for i, (head, body) in enumerate(use):
    lx = Inches(0.9) + i * (w + gap)
    rect(s, lx, top, w, h, fill=CARD)
    dot(s, lx + Inches(0.3), top + Inches(0.35))
    txt(s, head, lx + Inches(0.3), top + Inches(0.62), w - Inches(0.6), Inches(0.5),
        size=17, bold=True, font=HEAD, color=VIOLET)
    txt(s, body, lx + Inches(0.3), top + Inches(1.15), w - Inches(0.6), Inches(1.1),
        size=13.5, color=GREY, spacing=1.2)

# ---------------------------------------------------------------- 14 CLOSE
s = slide()
rect(s, 0, 0, Inches(0.18), SH, fill=VIOLET, radius=False)
s.shapes.add_picture(P % "logo-dark.png", Inches(0.9), Inches(0.9), height=Inches(0.8))
txt(s, "Every model, one software.", Inches(0.9), Inches(2.8), Inches(11.5), Inches(1.4),
    size=48, bold=True, font=HEAD, spacing=1.0)
txt(s, "The neutral answer engine that runs every model and knows you.\nThe product is built. Let us fund the distribution.",
    Inches(0.92), Inches(4.25), Inches(10.8), Inches(1.2), size=21, color=GREY, spacing=1.2)
txt(s, "Jeremiah Maximo", Inches(0.92), Inches(6.5), Inches(6), Inches(0.5), size=16,
    bold=True, font=HEAD, color=WHITE)
txt(s, "jeremiahdianaa@gmail.com", Inches(6.5), Inches(6.5), Inches(5.9), Inches(0.5),
    size=16, color=VIOLET, font=HEAD, align=PP_ALIGN.RIGHT)

out = os.path.join(HERE, "Modus-Pitch-Deck.pptx")
prs.save(out)
print("SAVED", out, os.path.getsize(out), "bytes,", len(prs.slides._sldIdLst), "slides")

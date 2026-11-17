"""Builds batch-02 MODUS Meta ads as HTML, then renders PNGs with headless Chrome.

  python3 build.py            -> ../feed-4x5/*.png and ../story-9x16/*.png

Every model answer on H1 is copied verbatim from compare-captures.json
(real /api/chat/compare output, PILOT test account, Nov 16 2026).
"""
import json, os, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SIZES = {'4x5': (1080, 1350), '9x16': (1080, 1920)}

caps = json.loads((OUT / 'compare-captures.json').read_text())
hotdog = next(c for c in caps if c['prompt'].startswith('Is a hot dog'))
ans = {a['model']: a for a in hotdog['answers']}

OPENAI = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A5.98 5.98 0 0 0 10.75 0a6.05 6.05 0 0 0-5.77 4.19 5.98 5.98 0 0 0-4 2.9 6.050 6.05 0 0 0 .75 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.25 24a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 4-2.9 6.05 6.05 0 0 0-.74-7.08zM13.25 22.430a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.64zM2.34 7.9a4.48 4.48 0 0 1 2.35-1.970v5.68a.78.78 0 0 0 .39.68l5.83 3.36-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.8A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86-5.84-3.37 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.78a4.5 4.5 0 0 1-.68 8.12v-5.69a.78.78 0 0 0-.4-.68zm2.01-3.02-.14-.09-4.77-2.77a.78.78 0 0 0-.79 0L9.42 7.2V4.87a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.32 12.87 6.3 11.7a.07.07 0 0 1-.04-.05V6.08a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.72 5.47a.78.78 0 0 0-.4.68zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>'
CLAUDE = '<svg viewBox="0 0 24 24" fill="#D97757"><path d="M12 1.5l1.3 7.2 5.7-4.6-3.6 6.4 7.1-.3-6.7 2.6 6 3.9-7-1.4 2.4 6.9-4.6-5.6-.6 7.3-1.5-7.2-4.4 5.8 2.1-7-6.9 1.7 5.9-4.1-6.8-2.4 7.2.1-3.8-6.2 5.9 4.4z"/></svg>'
GEMINI = '<svg viewBox="0 0 24 24"><path d="M12 2c.3 4.4 2.4 8 7.6 8-5.2 0-7.3 3.6-7.6 8-.3-4.4-2.4-8-7.6-8C9.6 10 11.7 6.4 12 2z" fill="#4285F4"/></svg>'

BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112..125,700;112..125,800&family=Instrument+Serif:ital@0;1&family=Figtree:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%(w)dpx;height:%(h)dpx;overflow:hidden}
body{font-family:Figtree,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.wrap{position:absolute;inset:0;padding:%(pt)dpx 84px %(pb)dpx;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px}
.brand img{width:64px}
.brand b{font-family:Archivo;font-stretch:125%%;font-weight:800;font-size:34px;letter-spacing:.18em;display:block;line-height:1}
.brand i{font-style:normal;font-size:15px;letter-spacing:.35em;opacity:.7;display:block;margin-top:6px}
.big{font-family:Archivo;font-stretch:112%%;font-weight:800;letter-spacing:-.025em;line-height:.98}
.serif{font-family:'Instrument Serif';font-style:italic;font-weight:400;letter-spacing:-.01em}
.cta{display:inline-flex;align-items:center;gap:14px;border-radius:999px;padding:24px 36px;font-weight:700;font-size:30px;white-space:nowrap}
.row{display:flex;align-items:center;justify-content:space-between;gap:30px}
"""

def page(css, body, size):
    w, h = SIZES[size]
    story = size == '9x16'
    base = BASE_CSS % {'w': w, 'h': h, 'pt': 250 if story else 84, 'pb': 360 if story else 84}
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{base}{css}</style></head><body class="s{size}">{body}</body></html>'

BRAND = lambda color, logo='logo.png': f'<div class="brand" style="color:{color}"><img src="{logo}"><div><b>MODUS</b><i>PILOT</i></div></div>'

# ---------- H1: Is a hot dog a sandwich? (real compare output) ----------
def h1(size):
    css = """
body{background:#1e0f3a;color:#f0eee6}
h1{font-size:84px;margin-top:44px}
.sub{font-size:54px;color:#c4b5fd;margin-top:12px}
.cards{display:flex;flex-direction:column;gap:18px;margin-top:40px;flex:1}
.card{background:#f0eee6;color:#16131f;border-radius:28px;padding:22px 30px}
.hd{display:flex;align-items:center;gap:14px;font-weight:700;font-size:30px}
.hd svg{width:34px;height:34px}
.hd .t{margin-left:auto;font-weight:500;color:#6b6578;font-size:26px}
.v{font-family:Archivo;font-stretch:112%;font-weight:800;font-size:22px;letter-spacing:.08em;padding:8px 16px;border-radius:999px}
.yes{background:#dcfce7;color:#166534}.no{background:#fee2e2;color:#991b1b}
.a{font-size:28px;line-height:1.36;margin-top:12px;padding-top:12px;border-top:1px solid #dcd7cc}
.foot{font-size:28px;line-height:1.4;color:#d8d2e6}
.foot b{color:#fff}
.cta{background:#f0eee6;color:#16131f}
.s9x16 h1{font-size:104px}.s9x16 .cards{margin-top:60px;gap:26px}.s9x16 .a{font-size:32px}
"""
    def card(model, name, icon, iconcolor):
        a = ans[model]; text = a['text']
        verdict = text.split('.')[0].strip().upper()
        rest = text[len(text.split('.')[0]) + 1:].strip()
        cls = 'yes' if verdict == 'YES' else 'no'
        return f'<div class="card"><div class="hd"><span style="color:{iconcolor};display:flex">{icon}</span>{name}<span class="v {cls}">{verdict}</span><span class="t">{a["secs"]}s</span></div><div class="a">{rest}</div></div>'
    body = f"""<div class="wrap">{BRAND('#f0eee6','logo-dark.png')}
<h1 class="big">Is a hot dog a sandwich?</h1>
<div class="sub serif">We asked three AIs at once.</div>
<div class="cards">
{card('gpt-6.1-sol','GPT-6.1 Sol',OPENAI,'#10a37f')}
{card('claude-sonnet-5-5','Claude Sonnet 5.5',CLAUDE,'#D97757')}
{card('gemini-3.8-flash','Gemini 3.8 Flash',GEMINI,'#4285F4')}
</div>
<div class="row" style="margin-top:28px"><div class="foot">They don't always agree.<br><b>MODUS shows you all three.</b></div><span class="cta">Try MODUS &rarr;</span></div>
</div>"""
    return page(css, body, size)

# ---------- H2: Already paying for ChatGPT? (objection / price anchor) ----------
def h2(size):
    css = """
body{background:#f0eee6;color:#16131f}
.tag{font-family:Archivo;font-stretch:125%;font-weight:800;font-size:22px;letter-spacing:.3em;color:#6b6578;margin-top:70px}
h1{font-size:104px;margin-top:22px}
h1 .serif{color:#6d28d9;font-size:118px;letter-spacing:-.02em}
.math{margin-top:64px;border-top:3px solid #16131f}
.li{display:flex;justify-content:space-between;align-items:baseline;padding:28px 0;border-bottom:1px solid #d6d1c6;font-size:36px}
.li b{font-weight:700}
.li .m{color:#6b6578;font-size:28px;margin-top:6px}
.plus{font-family:Archivo;font-stretch:112%;font-weight:800;font-size:64px;color:#6d28d9}
.models{font-size:30px;line-height:1.45;color:#3d3848;margin-top:34px}
.spacer{flex:1}
.cta{background:#6d28d9;color:#fff}
.fine{font-size:20px;color:#6b6578;line-height:1.4;max-width:560px}
.s9x16 h1{font-size:112px}.s9x16 .math{margin-top:80px}
"""
    body = f"""<div class="wrap">{BRAND('#16131f')}
<div class="tag">ALREADY PAY FOR CHATGPT?</div>
<h1 class="big">$8 more gets you <span class="serif">the rest.</span></h1>
<div class="math">
 <div class="li"><div><b>ChatGPT Plus</b><div class="m">OpenAI models</div></div><div>$20/mo</div></div>
 <div class="li"><div><b>MODUS</b><div class="m">GPT, Claude, Gemini, DeepSeek and Llama</div></div><div>$28/mo</div></div>
 <div class="li"><div><b>Difference</b></div><div class="plus">+$8</div></div>
</div>
<div class="models">Ask one model, or ask three at once and compare the answers side by side.</div>
<div class="spacer"></div>
<div class="row"><div class="fine">US monthly list price from chatgpt.com/pricing, Nov 2026. MODUS gives you the models, not ChatGPT's own app features.</div><span class="cta">Try MODUS &rarr;</span></div>
</div>"""
    return page(css, body, size)

# ---------- H3: Founder letter (DRAFT, needs his OK on every line) ----------
def h3(size):
    css = """
body{background:#fbfaf6;color:#1c1a22}
.paper{margin-top:60px;flex:1;display:flex;flex-direction:column}
.hi{font-family:'Instrument Serif';font-size:84px;line-height:1.02}
p{font-size:40px;line-height:1.48;margin-top:34px;color:#2a2733}
.sig{font-family:'Instrument Serif';font-style:italic;font-size:60px;margin-top:40px;color:#6d28d9}
.role{font-size:26px;color:#6b6578;margin-top:4px}
.spacer{flex:1}
.cta{background:#1c1a22;color:#fff}
.price{font-size:30px;font-weight:600}
.s9x16 p{font-size:42px}.s9x16 .hi{font-size:92px}
"""
    body = f"""<div class="wrap">{BRAND('#1c1a22')}
<div class="paper">
<div class="hi">I was paying for three AI apps.</div>
<p>ChatGPT for some things, Claude for writing, Gemini for others. Three bills and three tabs, and I still copied the same question between them.</p>
<p>So I built MODUS. Every model in one app, and one button that asks three of them at once.</p>
<p>If it isn't worth $28 a month to you, cancel and email me why. I read every one.</p>
<div class="sig">Jeremiah</div><div class="role">Founder, MODUS</div>
<div class="spacer"></div>
<div class="row"><span class="price">$28/mo. Cancel anytime.</span><span class="cta">Try MODUS &rarr;</span></div>
</div></div>"""
    return page(css, body, size)

ADS = {'MODUS-06-hot-dog': h1, 'MODUS-07-plus-eight': h2, 'MODUS-08-founder-letter': h3}

for name, fn in ADS.items():
    for size, (w, h) in SIZES.items():
        html = HERE / f'{name}_{size}.html'
        html.write_text(fn(size))
        d = OUT / ('feed-4x5' if size == '4x5' else 'story-9x16'); d.mkdir(exist_ok=True)
        png = d / f'{name}_{size}.png'
        subprocess.run([CHROME, '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
                        f'--window-size={w},{h}', '--virtual-time-budget=6000', f'--screenshot={png}', html.as_uri()],
                       check=True, capture_output=True)
        print(png.relative_to(OUT))

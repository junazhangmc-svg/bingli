# 生成 PWA 图标。运行：python make-icons.py
# 刻意和父亲那个「体检记录本」长得不一样 —— 同源两个应用图标相似，
# 桌面上会分不清点哪个。
from PIL import Image, ImageDraw

ACCENT = (44, 97, 82)       # --accent
PAPER  = (252, 253, 251)    # --paper
BAD    = (163, 53, 40)      # --bad
FAINT  = (168, 180, 172)

def draw(size, maskable=False):
    S = 1024                                   # 先在大画布上画，最后缩放，边缘更干净
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # 可遮罩图标：整块铺满，内容收进中间 80% 的安全区，
        # 否则被系统裁成圆形时会切掉边角。
        d.rectangle([0, 0, S, S], fill=ACCENT)
        pad, scale = S * 0.20, 0.60
    else:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=ACCENT)
        pad, scale = S * 0.20, 0.60

    # 一叠病历：后面两张露出边，前面一张是主体
    w, h = S * scale, S * scale * 1.18
    x0, y0 = (S - w) / 2, (S - h) / 2
    for i, off in enumerate((S * 0.055, S * 0.028)):
        d.rounded_rectangle([x0 + off, y0 - off, x0 + w + off, y0 + h - off],
                            radius=int(S * 0.035), fill=FAINT)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=int(S * 0.035), fill=PAPER)

    # 三条文字线 + 一条标红的异常项 —— 这一笔就是这个应用在干的事
    lw = int(S * 0.030)
    lx0, lx1 = x0 + w * 0.14, x0 + w * 0.72
    ly = y0 + h * 0.22
    gap = h * 0.155
    for i in range(4):
        bad = (i == 2)
        end = lx1 if not bad else x0 + w * 0.56
        d.rounded_rectangle([lx0, ly, end, ly + lw],
                            radius=lw // 2, fill=BAD if bad else ACCENT)
        if bad:   # 异常项右边点一个红点
            r = lw * 0.85
            cx = x0 + w * 0.72
            d.ellipse([cx - r, ly + lw / 2 - r, cx + r, ly + lw / 2 + r], fill=BAD)
        ly += gap

    return img.resize((size, size), Image.LANCZOS)

draw(192).save("icon-192.png")
draw(512).save("icon-512.png")
draw(512, maskable=True).save("icon-maskable.png")
print("icon-192.png / icon-512.png / icon-maskable.png 已生成")

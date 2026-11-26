"""Cut a figure out of its flat magenta background.

    python tools/tokens/cutout.py raw.png out.webp [size]

Magenta becomes transparent (as does anything already transparent; with a soft edge and the pink fringe taken out of the edge pixels),
the picture is trimmed to the figure, padded to a square and scaled to `size` pixels (default 512).
"""
import sys
import numpy as np
from PIL import Image


def cutout(src, dst, size=512):
    rgba = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    r, g, b, given = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3] / 255.0
    # How magenta a pixel is: red and blue both well above green. 0 on the figure, ~255 on the key.
    key = np.minimum(r, b) - g
    alpha = np.clip((150.0 - key) / 90.0, 0.0, 1.0)            # key >= 150 gone, <= 60 solid
    alpha = np.minimum(alpha, given)                           # a picture that arrives already cut out stays so
    # Despill: where red and blue both exceed green by more than the figure's colours do, pull them down.
    spill = np.clip(key - 20.0, 0.0, None) * (alpha < 1.0)
    out = np.dstack([np.clip(r - spill, 0, 255), g, np.clip(b - spill, 0, 255), alpha * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')

    solid = np.argwhere(alpha > 0.5)
    kept = float((alpha > 0.5).mean())
    if not len(solid):
        raise SystemExit(f'{src}: nothing left after removing the background')
    if kept > 0.9:
        raise SystemExit(f'{src}: the background was not removed (is it magenta?)')
    (y0, x0), (y1, x1) = solid.min(0), solid.max(0)
    img = img.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
    side = int(max(img.size) * 1.04)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    square.resize((size, size), Image.LANCZOS).save(dst, 'WEBP', quality=92, method=6)
    print(f'{dst}: figure covers {kept:.0%} of the frame')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cutout(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 512)

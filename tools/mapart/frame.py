"""Frame a map picture for image generation, and bring the result back.

    python tools/mapart/frame.py ref    maps/x.jpg  ref.png        # fit into 1536x1024 with black bars
    python tools/mapart/frame.py finish maps/x.jpg  out.png  maps/painterly/x.jpg

`finish` takes the bars back off the generated picture and scales it to the original's size, so
the map's backdrop placement (hexPx, ox, oy) fits it unchanged.
"""
import sys
from PIL import Image

W, H = 1536, 1024


def box(size, w=W, h=H):
    s = min(w / size[0], h / size[1])
    bw, bh = size[0] * s, size[1] * s
    return (w - bw) / 2, (h - bh) / 2, bw, bh


def ref(src, dst):
    im = Image.open(src).convert('RGB')
    x, y, bw, bh = box(im.size)
    canvas = Image.new('RGB', (W, H), (0, 0, 0))
    canvas.paste(im.resize((round(bw), round(bh)), Image.LANCZOS), (round(x), round(y)))
    canvas.save(dst)


def finish(src, out, dst):
    size = Image.open(src).size
    got = Image.open(out).convert('RGB')
    x, y, bw, bh = box(size, *got.size)
    got.crop((round(x), round(y), round(x + bw), round(y + bh))).resize(size, Image.LANCZOS).save(dst, 'JPEG', quality=88)
    print(f'{dst}: {size[0]}x{size[1]} from a {got.size[0]}x{got.size[1]} picture')


if __name__ == '__main__':
    if len(sys.argv) < 4 or sys.argv[1] not in ('ref', 'finish'):
        raise SystemExit(__doc__)
    ref(*sys.argv[2:4]) if sys.argv[1] == 'ref' else finish(*sys.argv[2:5])

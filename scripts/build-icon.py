"""Builds media/gitops-nav.woff, the icon font behind the plugin's own $(gitops-…) icons.

- gitops-pipeline (U+E001): three rounded boxes joined by arrows, drawn here on a 24x16 grid (VS Code
  sizes label icons by their advance width, so it can be wider than square); media/pipeline.svg
  is a preview of it.
- gitops-helm-config (U+E002): Lucide's ship-wheel (media/lucide, ISC licence). Lucide icons are
  strokes, so picosvg turns them into filled outlines first.

Codepoints must match "fontCharacter" in package.json.
Needs:  pip install fonttools picosvg && python scripts/build-icon.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from picosvg.svg import SVG

GRID = 16  # icon height; 1 grid unit = EM/16
EM = 1000
PIPELINE_WIDTH = 24
MEDIA = Path(__file__).resolve().parent.parent / 'media'

STROKE = 1.0
# Edges on whole pixels so 1px strokes stay crisp at 16px. Sits 1px below the em's middle because
# label icons are bottom-aligned with the text, whose visual middle is lower than the icon's.
TOP, BOTTOM = 5, 12
MID = (TOP + BOTTOM) / 2
BOXES = [(0, 5), (9, 14), (18, 23)]
RADIUS = 1.5


def rounded_box(x0, x1, y0, y1, r):
    """Outline (on-curve points, with ('q', ctrl) markers before each curved corner)."""
    return [
        (x0 + r, y0), (x1 - r, y0), ('q', (x1, y0)), (x1, y0 + r),
        (x1, y1 - r), ('q', (x1, y1)), (x1 - r, y1),
        (x0 + r, y1), ('q', (x0, y1)), (x0, y1 - r),
        (x0, y0 + r), ('q', (x0, y0)), (x0 + r, y0),
    ]


def arrow(x0, x1):
    """Shaft from x0, head ending at x1, centred on MID."""
    head = x1 - 2
    return [(x0, MID - .5), (head, MID - .5), (head, MID - 2), (x1, MID), (head, MID + 2), (head, MID + .5), (x0, MID + .5)]


def shapes():
    """(contour, is_hole) in SVG coordinates (y down)."""
    out = []
    for x0, x1 in BOXES:
        out.append((rounded_box(x0, x1, TOP, BOTTOM, RADIUS), False))
        s = STROKE
        out.append(([(x0 + s, TOP + s), (x1 - s, TOP + s), (x1 - s, BOTTOM - s), (x0 + s, BOTTOM - s)], True))
    for (_, a), (b, _) in zip(BOXES, BOXES[1:]):
        out.append((arrow(a, b), False))
    return out


def area(points):
    pts = [p for p in points if p[0] != 'q']
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) / 2


def to_font(points):
    scale = lambda x, y: (round(x * EM / GRID), round((GRID - y) * EM / GRID))  # flip y: fonts are y-up
    return [('q', scale(*p[1])) if p[0] == 'q' else scale(*p) for p in points]


def draw(pen, points, clockwise):
    pts = to_font(points)
    if (area(pts) < 0) != clockwise:  # TrueType: filled contours clockwise, holes anticlockwise
        pts = reverse(pts)
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    pen.moveTo(pts[0])
    i = 1
    while i < len(pts):
        if pts[i][0] == 'q':
            pen.qCurveTo(pts[i][1], pts[(i + 1) % len(pts)])
            i += 2
        else:
            pen.lineTo(pts[i])
            i += 1
    pen.closePath()


def reverse(pts):
    """Reverse a contour, keeping each curve control between the same two points."""
    segs, prev = [], pts[0]
    i = 1
    while i < len(pts):
        if pts[i][0] == 'q':
            segs.append((prev, pts[i], pts[i + 1]))
            prev = pts[i + 1]
            i += 2
        else:
            segs.append((prev, None, pts[i]))
            prev = pts[i]
            i += 1
    out = [segs[-1][2]]
    for start, ctrl, _ in reversed(segs):
        if ctrl:
            out.append(ctrl)
        out.append(start)
    return out


def pipeline_glyph():
    pen = TTGlyphPen(None)
    for contour, hole in shapes():
        draw(pen, contour, clockwise=not hole)
    return pen.glyph()


def svg_glyph(path):
    """A stroked SVG icon (any square viewBox) as a filled glyph."""
    svg = SVG.parse(str(path)).topicosvg()
    size = svg.view_box().w
    pen = TTGlyphPen(None)
    # Flip y (SVG is y-down, fonts y-up) and convert cubic curves to TrueType quadratics
    flipped = TransformPen(Cu2QuPen(pen, max_err=1, reverse_direction=True), (EM / size, 0, 0, -EM / size, 0, EM))
    for shape in svg.shapes():
        parse_path(shape.d, flipped)
    return pen.glyph()


def build_font(path):
    glyphs = {
        'pipeline': (0xE001, pipeline_glyph(), PIPELINE_WIDTH * EM // GRID),
        'helm-config': (0xE002, svg_glyph(MEDIA / 'lucide' / 'ship-wheel.svg'), EM),
    }
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(['.notdef', *glyphs])
    fb.setupCharacterMap({cp: name for name, (cp, _, _) in glyphs.items()})
    fb.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), **{name: g for name, (_, g, _) in glyphs.items()}})
    metrics = {'.notdef': (EM, 0)}
    for name, (_, g, width) in glyphs.items():
        g.recalcBounds(fb.font['glyf'])
        # Left side bearing must match the outline's xMin, or renderers shift the glyph
        metrics[name] = (width, g.xMin)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=EM, descent=0)
    fb.setupNameTable({'familyName': 'gitops-nav', 'styleName': 'Regular'})
    # Same vertical metrics as VS Code's codicon.ttf (300 upm: typo 300/0, win 327/4, USE_TYPO_METRICS)
    fb.setupOS2(sTypoAscender=EM, sTypoDescender=0, sTypoLineGap=0,
                usWinAscent=round(EM * 327 / 300), usWinDescent=round(EM * 4 / 300), fsSelection=0x40 | 0x80, version=4)
    fb.setupPost()
    fb.font.flavor = 'woff'
    fb.save(path)


def build_svg(path):
    def d(points):
        cmds, i = [f'M{points[0][0]} {points[0][1]}'], 1
        while i < len(points):
            if points[i][0] == 'q':
                (cx, cy), (x, y) = points[i][1], points[i + 1]
                cmds.append(f'Q{cx} {cy} {x} {y}')
                i += 2
            else:
                cmds.append(f'L{points[i][0]} {points[i][1]}')
                i += 1
        return ''.join(cmds) + 'Z'

    paths = ''.join(d(c) for c, _ in shapes())
    Path(path).write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{PIPELINE_WIDTH}" height="{GRID}" viewBox="0 0 {PIPELINE_WIDTH} {GRID}">'
        f'<path fill="currentColor" fill-rule="evenodd" d="{paths}"/></svg>\n'
    )


if __name__ == '__main__':
    build_font(MEDIA / 'gitops-nav.woff')
    build_svg(MEDIA / 'pipeline.svg')
    print('wrote', MEDIA / 'gitops-nav.woff', 'and', MEDIA / 'pipeline.svg')

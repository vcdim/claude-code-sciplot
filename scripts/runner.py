"""Run a user plotting script and save its figure.

usage: runner.py SCRIPT OUTDIR FORMATS
  FORMATS: comma list from png,pdf,svg,eps,jpg,webp,html (html: plotly only)

Picks the figure from the script's namespace: a plotly Figure (prefer `fig`),
else the current matplotlib figure. Prints one JSON line prefixed SCIPLOT_RESULT.
"""

import json
import os
import runpy
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

plt.show = lambda *a, **k: None

try:
    import plotly.graph_objects as go
    import plotly.io as pio

    go.Figure.show = lambda *a, **k: None
    pio.show = lambda *a, **k: None
except ImportError:
    go = None


def find_plotly(ns):
    if go is None:
        return None
    if isinstance(ns.get("fig"), go.Figure):
        return ns["fig"]
    figs = [v for v in ns.values() if isinstance(v, go.Figure)]
    return figs[-1] if figs else None


def main():
    script, out, formats = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    os.makedirs(out, exist_ok=True)
    os.chdir(out)
    import numpy as np
    import pandas as pd

    pre = {"plt": plt, "np": np, "pd": pd}
    if go is not None:
        import plotly.express as px

        pre.update(go=go, px=px)
    ns = runpy.run_path(script, init_globals=pre, run_name="__main__")

    files = {}
    pfig = find_plotly(ns)
    if pfig is not None:
        kind = "plotly"
        w = pfig.layout.width or 900
        h = pfig.layout.height or 600
        for fmt in formats:
            path = os.path.join(out, f"plot.{fmt}")
            if fmt == "html":
                pfig.write_html(path, include_plotlyjs="cdn", include_mathjax="cdn")
            else:
                pfig.write_image(path, width=w, height=h, scale=2 if fmt in ("png", "jpg", "webp") else 1)
            files[fmt] = path
    elif plt.get_fignums():
        kind = "matplotlib"
        fig = ns.get("fig") if isinstance(ns.get("fig"), matplotlib.figure.Figure) else plt.gcf()
        for fmt in formats:
            if fmt == "html":
                continue
            path = os.path.join(out, f"plot.{fmt}")
            fig.savefig(path, dpi=150, bbox_inches="tight")
            files[fmt] = path
    else:
        sys.exit("No figure found: draw with matplotlib, or assign a plotly Figure to `fig`.")

    size = [0, 0]
    if "png" in files:
        from PIL import Image

        size = list(Image.open(files["png"]).size)
    print("SCIPLOT_RESULT " + json.dumps({"kind": kind, "files": files, "size": size}))


if __name__ == "__main__":
    main()

# sciplot

A Claude Code mod that renders scientific figures in a side pane and exports them.
Ask Claude to plot something; it writes the code, sciplot runs it and shows the image.

| Engine | Language | Cost |
|---|---|---|
| Python | matplotlib, plotly, seaborn (via `uv`) | free |
| R | base graphics, ggplot2 | free |
| LaTeX | TikZ / pgfplots | free |
| MATLAB | `.m` code (falls back to GNU Octave) | paid |
| Mathematica | Wolfram Language (`wolframscript`, or the free Wolfram Engine) | paid |

Engines are detected at session start; missing or unlicensed ones are hidden
from Claude and fall back to a free option. `/sciplot engines` shows status.

## Use

- `/sciplot`: open the pane. Keys: `b`/`n` previous/next plot, `p` PDF, `s` SVG,
  `g` PNG, `i` interactive HTML (plotly).
- `/sciplot export pdf,svg [dir]`: export the current plot.
- Each plot is kept in `~/.cache/sciplot/<timestamp>/` with its script and exports.

Image display needs a terminal with the kitty graphics protocol (Ghostty, kitty,
WezTerm, iTerm2).

## Install

```
./run.sh install
```

or, from a session: `/plugin install sciplot --marketplace vcdim/sciplot`.

## Develop

```
./run.sh validate
./run.sh test
```

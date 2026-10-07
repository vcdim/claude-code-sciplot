# sciplot

Scientific plots inside [Claude Code](https://claude.com/claude-code). Ask Claude
to plot something; it writes the code, sciplot runs it in the engine you pick and
shows the figure in a side pane, ready to export as PDF, SVG or PNG.

<p align="center">
  <img src="docs/python-contour.png" width="45%" alt="sin(x)·sin(y) contour map, matplotlib">
  <img src="docs/mathematica-membrane.png" width="45%" alt="MATLAB logo L-shaped membrane, Mathematica">
</p>

```
> plot sin(x)·sin(y) as a contour map
> render the MATLAB logo in Mathematica
> make it a 3D surface in plotly
```

## Install

From a Claude Code session:

```
/plugin install sciplot --marketplace vcdim/sciplot
```

Then `/sciplot` opens the pane. The picture needs a terminal with the kitty
graphics protocol (Ghostty, kitty, WezTerm, iTerm2); elsewhere the pane falls
back to text and the exports still work.

## Engines

| Engine | Language | Cost |
|---|---|---|
| Python | matplotlib, plotly, seaborn (via `uv`) | free |
| R | base graphics, ggplot2 (LaTeX via tikzDevice) | free |
| LaTeX | TikZ / pgfplots | free |
| MATLAB | `.m` code (falls back to GNU Octave) | paid |
| Mathematica | Wolfram Language (`wolframscript`, or the free Wolfram Engine) | paid |

Engines are detected at session start; missing ones are hidden from Claude and
fall back to a free option. `/sciplot engines` shows what was found.

- **LaTeX text** by default when TeX is installed (matplotlib `usetex`, R
  `tikzDevice`, MATLAB's LaTeX interpreter), falling back to plain text if a
  label breaks it. Pass `latex: false` to turn it off.
- **300 dpi** PNG/JPG in every engine (plotly: 2× scale); PDF, SVG and EPS stay vector.

## Use

| | |
|---|---|
| `/sciplot` | open the pane |
| `/sciplot close` | close it |
| `/sciplot export pdf,svg [dir]` | export the current plot |
| `/sciplot delete` | move the current plot to the Trash |
| `/sciplot engines` | show which engines are installed |

Pane keys: `b` / `n` previous / next plot, `p` PDF, `s` SVG, `g` PNG,
`i` interactive HTML (plotly), `d` delete.

Each plot is kept in `~/.cache/sciplot/<timestamp>/` with its script and exports,
so any figure can be rerun or edited by hand.

## Develop

```
git clone https://github.com/vcdim/sciplot && cd sciplot
./run.sh install    # register this folder as a local marketplace and install
./run.sh validate   # claude plugin validate
./run.sh test       # claude plugin test
./run.sh engines    # list engine binaries on PATH
```

The plugin is a Claude Code hooks module: `hooks/register.tsx` registers the
`plot` tool, the `/sciplot` command and the pane; `scripts/` holds the per-engine
runners (`runner.py`, `runner.R`, `sciplot_runner.m`).

## License

[MIT](LICENSE)

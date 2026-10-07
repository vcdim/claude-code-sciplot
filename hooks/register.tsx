import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plot } from '../types'

const PANE = 'sciplot'
const TOOL = 'mcp__sciplot__plot'
const FORMATS = ['png', 'pdf', 'svg', 'eps', 'jpg', 'webp', 'html']
const PY_PACKAGES = ['matplotlib', 'plotly', 'kaleido', 'pillow', 'numpy', 'pandas']
const PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-\[\]=<>~!,]*$/
const LICENSE_RE = /licen[cs]e|activat|not entitled|sign in to mathworks/i

const last = atom({ plugin: 'sciplot', key: 'last' } as const, null as Plot | null)
const history = atom({ plugin: 'sciplot', key: 'history' } as const, [] as Plot[])
const busy = atom({ plugin: 'sciplot', key: 'busy' } as const, null as string | null)

// ---------------------------------------------------------------- engines

type Language = 'python' | 'r' | 'tikz' | 'matlab' | 'mathematica'

type Engine = {
  label: string
  ext: string
  paid: boolean
  formats: string[]
  howTo: string
  install: string
}

const PDF_FORMATS = ['png', 'pdf', 'svg', 'eps', 'jpg']

const ENGINES: Record<Language, Engine> = {
  python: {
    label: 'Python (matplotlib / plotly / seaborn)',
    ext: 'py',
    paid: false,
    formats: FORMATS,
    howTo:
      'matplotlib: just draw, do not call savefig/show. plotly: assign the figure to `fig`, do not call fig.show(). ' +
      'Pre-imported: plt, np, pd, px, go. Extra pip packages (seaborn, scipy, ...) via `packages`.',
    install: 'Install uv: https://docs.astral.sh/uv/',
  },
  r: {
    label: 'R (base graphics / ggplot2)',
    ext: 'R',
    paid: false,
    formats: PDF_FORMATS,
    howTo:
      'Base R or ggplot2 (library(ggplot2) works); a ggplot value at top level is printed like the console. ' +
      'Set size with `sciplot_size <- c(w, h)` in inches. Do not open devices or call ggsave.',
    install: 'brew install r  (free)',
  },
  tikz: {
    label: 'LaTeX TikZ / pgfplots',
    ext: 'tex',
    paid: false,
    formats: PDF_FORMATS,
    howTo:
      'Give a tikzpicture environment (pgfplots, amsmath loaded, compat=newest), or a full standalone document.',
    install: 'Install TeX Live / MacTeX (free): https://tug.org/mactex/',
  },
  matlab: {
    label: 'MATLAB',
    ext: 'm',
    paid: true,
    formats: PDF_FORMATS,
    howTo: 'Ordinary .m plotting code (plot, hold on, xlabel, ...). Runs headless; do not call exportgraphics/saveas.',
    install: 'Paid. Free alternative: GNU Octave (brew install octave) runs most .m plotting code; or redo in python.',
  },
  mathematica: {
    label: 'Mathematica / Wolfram Language',
    ext: 'wl',
    paid: true,
    formats: PDF_FORMATS,
    howTo: 'Wolfram Language code whose last expression (no trailing semicolon) is the graphic.',
    install: 'Paid. Free alternative: Wolfram Engine for developers (wolfram.com/engine) with wolframscript; or redo in python.',
  },
}

type Bins = Record<string, string>
type Availability = Record<Language, { ok: boolean; via?: string; why?: string }>

let bins: Bins = {}
let home = ''
const disabled = new Map<Language, string>()

async function detect($: EngineInterface): Promise<void> {
  const script = [
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/Library/TeX/texbin:$PATH"',
    'printf "home=%s\\n" "$HOME"',
    'for c in uv Rscript pdflatex pdftocairo wolframscript octave-cli; do printf "%s=%s\\n" "$c" "$(command -v $c)"; done',
    'm=$(command -v matlab || ls -d /Applications/MATLAB_R*.app/bin/matlab 2>/dev/null | sort | tail -1)',
    'printf "matlab=%s\\n" "$m"',
  ].join('\n')
  const { stdout } = await $.process.run(['sh', '-c', script])
  bins = {}
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0 && line.slice(at + 1)) bins[line.slice(0, at)] = line.slice(at + 1)
  }
  home = bins.home ?? ''
}

function availability(): Availability {
  const need = (...names: string[]) => {
    const missing = names.filter(n => !bins[n])
    return missing.length ? `missing ${missing.join(', ')}` : undefined
  }
  const out = {} as Availability
  const set = (lang: Language, why: string | undefined, via?: string) => {
    const off = disabled.get(lang)
    out[lang] = off ? { ok: false, why: off } : why ? { ok: false, why } : { ok: true, via }
  }
  set('python', need('uv'))
  set('r', need('Rscript', 'pdftocairo'))
  set('tikz', need('pdflatex', 'pdftocairo'))
  if (bins.matlab) set('matlab', undefined, 'MATLAB')
  else set('matlab', bins['octave-cli'] && bins.pdftocairo ? undefined : 'MATLAB not installed', 'Octave')
  set('mathematica', need('wolframscript', 'pdftocairo'))
  return out
}

function toolDescription(av: Availability): string {
  const langs = Object.keys(ENGINES) as Language[]
  const on = langs.filter(l => av[l].ok)
  const off = langs.filter(l => !av[l].ok)
  return [
    'Render a scientific figure in the sciplot side pane and optionally export it.',
    `Available \`language\` values: ${on.map(l => `"${l}"`).join(', ')} (default "python").`,
    ...on.map(l => `- ${l}: ${ENGINES[l].label}${av[l].via === 'Octave' ? ' via GNU Octave' : ''}. ${ENGINES[l].howTo}`),
    ...(off.length
      ? [`Not available here (use python instead): ${off.map(l => `${l} (${av[l].why})`).join('; ')}.`]
      : []),
    bins.pdflatex
      ? 'Text is rendered with LaTeX by default (`latex`: false to turn off): write labels as LaTeX math, e.g. r"$\\sin(x)$" (python) or "$\\sin(x)$" (R, escape backslashes). Escape bare _ % & in text. Falls back to plain text if LaTeX fails.'
      : 'TeX is not installed, so `latex` is off except in MATLAB, whose built-in latex interpreter still renders "$\\sin(x)$" labels. Python: matplotlib mathtext still renders r"$\\sin(x)$". R: no LaTeX, so write plain labels ("sin(x)") or plotmath (expression(sin(x))), never "$...$".',
    'The script runs with its output folder as cwd; each call saves the script plus every export there.',
    '`export` adds formats beyond png: pdf, svg, eps, jpg; python also webp, and html for plotly (interactive).',
    '`exportTo` copies the exports into that directory as <title>.<fmt>.',
  ].join('\n')
}

async function registerTool($: EngineInterface) {
  await $.tool.register({
    name: 'plot',
    description: toolDescription(availability()),
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Plotting code in the chosen language' },
        language: { type: 'string', enum: Object.keys(ENGINES), description: 'Default python' },
        title: { type: 'string', description: 'Short name for the figure' },
        latex: { type: 'boolean', description: 'LaTeX text rendering (default true when TeX is installed, always for MATLAB): matplotlib usetex, R tikzDevice, MATLAB latex interpreter. Write labels as LaTeX, e.g. "$\\sin(x)$".' },
        packages: { type: 'array', items: { type: 'string' }, description: 'python only: extra pip packages' },
        export: { type: 'array', items: { type: 'string', enum: FORMATS }, description: 'Extra formats to save' },
        exportTo: { type: 'string', description: 'Directory to copy the exports into' },
      },
      required: ['code'],
    },
  })
}

// ---------------------------------------------------------------- running

type ProcResult = { exitCode: number; stdout: string; stderr: string }
type RunOutcome =
  | { ok: true; kind: string; files: Record<string, string>; size: [number, number] }
  | { ok: false; error: string }

const tail = (ran: ProcResult, n = 25) =>
  (ran.stderr.trim() || ran.stdout.trim()).split('\n').slice(-n).join('\n') || `exit code ${ran.exitCode}`

function parseResult(ran: ProcResult): RunOutcome {
  const line = ran.stdout.split('\n').find(l => l.startsWith('SCIPLOT_RESULT '))
  if (ran.exitCode !== 0 || !line) return { ok: false, error: tail(ran) }
  const parsed = JSON.parse(line.slice('SCIPLOT_RESULT '.length))
  return { ok: true, kind: parsed.kind, files: parsed.files, size: parsed.size }
}

const mstr = (text: string) => `'${text.replace(/'/g, "''")}'`
const wstr = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function pngSize(base64: string): [number, number] {
  try {
    const bin = atob(base64.slice(0, 44))
    const at = (i: number) =>
      ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) | (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0
    return [at(16), at(20)]
  } catch {
    return [800, 600]
  }
}

// Turn dir/plot.pdf (page 1) into the other formats with pdftocairo.
async function fromPdf($: EngineInterface, dir: string, formats: string[], kind: string): Promise<RunOutcome> {
  const pdf = `${dir}/plot.pdf`
  const files: Record<string, string> = { pdf }
  const page = ['-f', '1', '-l', '1']
  for (const fmt of formats) {
    let argv: string[] | null = null
    if (fmt === 'png') argv = ['-png', '-r', '300', '-singlefile', ...page, pdf, `${dir}/plot`]
    if (fmt === 'jpg') argv = ['-jpeg', '-r', '300', '-singlefile', ...page, pdf, `${dir}/plot`]
    if (fmt === 'svg') argv = ['-svg', ...page, pdf, `${dir}/plot.svg`]
    if (fmt === 'eps') argv = ['-eps', ...page, pdf, `${dir}/plot.eps`]
    if (!argv) continue
    const ran = await $.process.run([bins.pdftocairo!, ...argv])
    if (ran.exitCode !== 0) return { ok: false, error: `pdftocairo ${fmt}: ${tail(ran)}` }
    files[fmt] = `${dir}/plot.${fmt}`
  }
  let size: [number, number] = [0, 0]
  if (files.png) size = pngSize(((await $.fs.read(files.png, { as: 'bytes' })) as { base64: string }).base64)
  return { ok: true, kind, files, size }
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function runEngine(
  $: EngineInterface,
  lang: Language,
  dir: string,
  formats: string[],
  packages: string[],
  latex = false,
): Promise<RunOutcome> {
  const scripts = `${$.plugin.root}/scripts`
  const tex = latex && !!bins.pdflatex
  const texEnv: Record<string, string> = tex
    ? { SCIPLOT_LATEX: '1', SCIPLOT_PDFLATEX: bins.pdflatex!, SCIPLOT_TEXBIN: bins.pdflatex!.replace(/\/[^/]+$/, '') }
    : {}
  const long = { timeoutMs: 300_000, env: texEnv }

  if (lang === 'python') {
    const withs = [...PY_PACKAGES, ...packages].flatMap(p => ['--with', p])
    const argv = [bins.uv!, 'run', '--no-project', '--quiet', ...withs, 'python', `${scripts}/runner.py`, `${dir}/script.py`, dir, formats.join(',')]
    return parseResult(await $.process.run(argv, long))
  }

  if (lang === 'matlab' && bins.matlab) {
    const call = `addpath(${mstr(scripts)}); sciplot_runner(${mstr(dir)}, ${mstr(formats.join(','))}, ${latex})`
    return parseResult(await $.process.run([bins.matlab, '-nodisplay', '-nosplash', '-batch', call], long))
  }

  // The rest draw dir/plot.pdf, then pdftocairo makes the other formats.
  let ran: ProcResult
  if (lang === 'matlab') {
    const code = [
      "set(0, 'defaultfigurevisible', 'off');",
      `cd(${mstr(dir)});`,
      "try, source('script.m'); catch err, disp(err.message); exit(1); end",
      "if isempty(get(0, 'children')), disp('No figure found: the script must draw something.'); exit(1); end",
      "set(gcf, 'PaperUnits', 'inches', 'PaperPosition', [0 0 7 4.5], 'PaperSize', [7 4.5]);",
      "print(gcf, 'plot.pdf', '-dpdf');",
    ].join(' ')
    ran = await $.process.run([bins['octave-cli']!, '--no-gui', '--quiet', '--eval', code], long)
  } else if (lang === 'r') {
    ran = await $.process.run([bins.Rscript!, `${scripts}/runner.R`, dir], {
      ...long,
      env: { ...texEnv, SCIPLOT_RLIB: `${home}/.cache/sciplot/Rlib` },
    })
  } else if (lang === 'tikz') {
    const body = await $.fs.read(`${dir}/script.tex`)
    const doc = /\\documentclass/.test(body)
      ? body
      : [
          '\\documentclass[border=4pt]{standalone}',
          '\\usepackage{pgfplots}',
          '\\pgfplotsset{compat=newest}',
          '\\usepackage{amsmath}',
          '\\begin{document}',
          body,
          '\\end{document}',
        ].join('\n')
    await $.fs.write(`${dir}/plot.tex`, doc)
    ran = await $.process.run([bins.pdflatex!, '-interaction=nonstopmode', '-halt-on-error', 'plot.tex'], { ...long, cwd: dir })
    if (ran.exitCode !== 0) {
      const log = ran.stdout.split('\n')
      const at = log.findIndex(l => l.startsWith('!'))
      return { ok: false, error: at >= 0 ? log.slice(at, at + 6).join('\n') : tail(ran) }
    }
  } else {
    const code = `g = Get[${wstr(`${dir}/script.wl`)}]; If[g === Null, Print["No figure: end the script with the graphic, no trailing semicolon."]; Exit[1]]; Export[${wstr(`${dir}/plot.pdf`)}, g]`
    ran = await $.process.run([bins.wolframscript!, '-code', code], long)
  }
  if (ran.exitCode !== 0 || !(await exists($, `${dir}/plot.pdf`))) {
    return { ok: false, error: tail(ran) }
  }
  return fromPdf($, dir, formats, lang === 'matlab' ? 'octave' : lang)
}

function languageOf(plot: Plot): Language {
  if (plot.kind === 'matplotlib' || plot.kind === 'plotly') return 'python'
  if (plot.kind === 'octave') return 'matlab'
  return plot.kind as Language
}

// Make the formats a plot does not have yet: from its PDF where it has one, else by running it again.
async function ensureFormats($: EngineInterface, plot: Plot, formats: string[]): Promise<Plot | string> {
  const missing = formats.filter(f => !plot.files[f])
  if (missing.length === 0) return plot
  const lang = languageOf(plot)
  if (missing.includes('html') && plot.kind !== 'plotly') return 'html export needs a plotly figure.'
  const bad = missing.filter(f => !ENGINES[lang].formats.includes(f))
  if (bad.length) return `${ENGINES[lang].label} cannot export ${bad.join(', ')}.`
  const ran =
    lang !== 'python' && plot.kind !== 'matlab' && plot.files.pdf
      ? await fromPdf($, plot.dir, missing, plot.kind)
      : await runEngine($, lang, plot.dir, missing, plot.packages, plot.latex ?? false)
  if (!ran.ok) return ran.error
  const next = { ...plot, files: { ...plot.files, ...ran.files } }
  await update($, last, () => next)
  await update($, history, list => (list ?? []).map(p => (p.id === next.id ? next : p)))
  return next
}

// ---------------------------------------------------------------- helpers

function newId(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'plot'
}

function parseFormats(raw: unknown): string[] | string {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/))
    .map(f => String(f).toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .map(f => (f === 'jpeg' ? 'jpg' : f))
  const bad = list.filter(f => !FORMATS.includes(f))
  return bad.length ? `Unknown format(s): ${bad.join(', ')}. Use ${FORMATS.join(', ')}.` : list
}

async function copyExports($: EngineInterface, plot: Plot, formats: string[], to: string): Promise<string[]> {
  const copied: string[] = []
  if ((await $.process.run(['mkdir', '-p', to])).exitCode !== 0) return copied
  for (const fmt of formats) {
    const src = plot.files[fmt]
    if (!src) continue
    const dest = `${to.replace(/\/$/, '')}/${slug(plot.title)}.${fmt}`
    if ((await $.process.run(['cp', src, dest])).exitCode === 0) copied.push(dest)
  }
  return copied
}

// Drop the shown plot from history, show its neighbour, and move its folder to the Trash.
async function deleteCurrent($: EngineInterface): Promise<string> {
  const current = await read($, last)
  if (!current) return 'Nothing to delete.'
  const list = (await read($, history)) ?? []
  const at = list.findIndex(p => p.id === current.id)
  const rest = list.filter(p => p.id !== current.id)
  await update($, history, () => rest)
  await update($, last, () => rest[Math.min(Math.max(at, 0), rest.length - 1)] ?? null)
  const root = `${home}/.cache/sciplot/`
  if (home && current.dir.startsWith(root) && current.dir.length > root.length) {
    const trashed = `${home}/.Trash/sciplot-${current.id}`
    if ((await $.process.run(['mv', current.dir, trashed])).exitCode === 0) {
      return `Deleted "${current.title}" (moved to ${trashed}).`
    }
  }
  return `Removed "${current.title}" from the pane.`
}

// Resolves to why the pane is not on screen, or null when it is.
async function openPane($: EngineInterface): Promise<string | null> {
  try {
    const opened = await $.ui.open({ id: PANE, title: 'sciplot', columns: 80 })
    return opened.isPlaced ? null : opened.reason
  } catch (err) {
    return String(err)
  }
}

function enginesReport(): string {
  const av = availability()
  return (Object.keys(ENGINES) as Language[])
    .map(l => {
      const a = av[l]
      const tag = ENGINES[l].paid ? ' [paid]' : ''
      return a.ok
        ? `✓ ${l}: ${ENGINES[l].label}${a.via === 'Octave' ? ' via GNU Octave' : ''}${tag}`
        : `✗ ${l}: ${a.why}${tag}. ${ENGINES[l].install}`
    })
    .join('\n')
}

// ---------------------------------------------------------------- live plotly view

// A headless browser (scripts/live_view.py) draws a plotly figure's HTML into PNG
// frames; the pane shows them and hands the pointer back, so the figure rotates,
// zooms and hovers in place.
type LiveFrame = { file: string; generation: number; cols: number; rows: number }

const LIVE_KEY = 'live'
const live = {
  sock: '',
  starting: null as Promise<string | null> | null,
  ready: false,
  wanted: true, // show plotly figures live; `i` toggles
  plotId: null as string | null, // the plot shown live
  region: null as { cols: number; rows: number } | null,
  pending: null as string | null, // html to open once the pane reports its size
  frame: null as LiveFrame | null,
  mounted: null as { cols: number; rows: number } | null,
  error: null as string | null,
  watcher: 0,
}

async function liveCall($: EngineInterface, path: string, body?: unknown): Promise<any> {
  try {
    const res = await $.http.fetch(`http://sciplot${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      socketPath: live.sock,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.ok ? JSON.parse(res.text || '{}') : null
  } catch {
    return null
  }
}

// Starts the browser process once per session; resolves to why it could not, or null.
function startLive($: EngineInterface): Promise<string | null> {
  if (live.ready) return Promise.resolve(null)
  if (live.starting) return live.starting
  live.sock = `${home}/.cache/sciplot/live.sock`
  const argv = [
    bins.uv!, 'run', '--no-project', '--quiet', '--with', 'playwright', '--with', 'aiohttp',
    'python', `${$.plugin.root}/scripts/live_view.py`, live.sock, `${home}/.cache/sciplot/live`,
  ]
  live.starting = new Promise(resolve => {
    void (async () => {
      let said = false
      let stderr = ''
      try {
        for await (const { stream, text } of $.process.spawn({ argv })) {
          if (stream === 'stderr') stderr = (stderr + text).slice(-2000)
          if (!said && stream === 'stdout' && text.includes('"ready"')) {
            said = true
            live.ready = true
            resolve(null)
            void watchLive($)
          }
        }
      } catch (err) {
        stderr += String(err)
      }
      live.ready = false
      live.starting = null
      live.watcher++
      const why = stderr.trim().split('\n').pop() || 'the live view process exited'
      if (stderr.trim()) $.ui.log(`sciplot live view: ${stderr.trim()}`, { to: 'debug' })
      if (!said) resolve(why)
    })()
  })
  return live.starting
}

// Long-polls the browser for frames and swaps each into the mounted Image.
async function watchLive($: EngineInterface): Promise<void> {
  const me = ++live.watcher
  let version = -1
  while (live.watcher === me && live.ready) {
    const s = await liveCall($, `/state?version=${version}`)
    if (live.watcher !== me) return
    if (!s) {
      await $.clock.sleep(250)
      continue
    }
    version = s.version
    if (s.error && s.error !== live.error) $.ui.toast(`Live view: ${String(s.error).split('\n')[0]}`)
    live.error = s.error ?? null
    const f = s.frame as LiveFrame | null
    if (!live.plotId || !f || f.generation === live.frame?.generation) continue
    live.frame = f
    const m = live.mounted
    if (m && m.cols === f.cols && m.rows === f.rows) {
      const r = await $.ui.blit({ requestId: PANE, key: LIVE_KEY, source: { file: f.file, format: 'png', generation: f.generation } })
      if (!r.deny) continue
    }
    $.ui.invalidate('ui.render')
  }
}

async function goLive($: EngineInterface, plot: Plot): Promise<void> {
  live.plotId = plot.id
  live.frame = null
  const done = await ensureFormats($, plot, ['html'])
  const why = typeof done === 'string' ? done : await startLive($)
  if (live.plotId !== plot.id) return
  if (why || typeof done === 'string') {
    live.plotId = null
    live.wanted = false
    $.ui.toast(`Live view unavailable: ${why}`)
    $.ui.invalidate('ui.render')
    return
  }
  if (live.region) await liveCall($, '/open', { html: done.files.html, ...live.region })
  else live.pending = done.files.html!
}

function stopLive($: EngineInterface): void {
  if (!live.plotId) return
  live.plotId = null
  live.frame = null
  live.pending = null
  live.region = null
  live.mounted = null
  if (live.ready) void liveCall($, '/close', {})
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await detect($)
    await registerTool($)
    await $.command.register({
      name: 'sciplot',
      description: 'Show the sciplot pane; /sciplot engines | delete | close | export pdf,svg [dir]',
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as {
      code?: string; language?: string; title?: string; latex?: boolean; packages?: string[]; export?: string[]; exportTo?: string
    }
    if (!input.code?.trim()) return { deny: '`code` is required.' }
    if (!home) await detect($)
    const lang = (input.language ?? 'python').toLowerCase() as Language
    if (!ENGINES[lang]) return { deny: `Unknown language "${input.language}". Use ${Object.keys(ENGINES).join(', ')}.` }
    const av = availability()[lang]
    if (!av.ok) return { deny: `${ENGINES[lang].label} is not available: ${av.why}. ${ENGINES[lang].install}` }
    const packages = input.packages ?? []
    const badPkg = packages.filter(p => !PACKAGE_RE.test(p))
    if (badPkg.length) return { deny: `Invalid package spec(s): ${badPkg.join(', ')}` }
    const formats = parseFormats(input.export ?? [])
    if (typeof formats === 'string') return { deny: formats }
    const unsupported = formats.filter(f => !ENGINES[lang].formats.includes(f))
    if (unsupported.length) return { deny: `${ENGINES[lang].label} cannot export ${unsupported.join(', ')}.` }

    // MATLAB's latex interpreter is built in; the others need a TeX install.
    const latex = input.latex ?? (lang === 'matlab' || !!bins.pdflatex)
    const id = newId()
    const title = input.title?.trim() || 'plot'
    const dir = `${home}/.cache/sciplot/${id}`
    const script = `${dir}/script.${ENGINES[lang].ext}`
    await $.fs.write(script, input.code)
    await update($, busy, () => title)
    const paneWait = openPane($)
    let ran: RunOutcome
    try {
      ran = await runEngine($, lang, dir, ['png', ...formats.filter(f => f !== 'png')], packages, latex)
    } catch (err) {
      ran = { ok: false, error: String(err) }
    } finally {
      await update($, busy, () => null)
    }
    if (!ran.ok) {
      if (ENGINES[lang].paid && LICENSE_RE.test(ran.error)) {
        disabled.set(lang, 'installed but not licensed or activated')
        await registerTool($)
        return { result: `${ENGINES[lang].label} is installed but not licensed or activated, so it is off for this session. ${ENGINES[lang].install}\n${ran.error}` }
      }
      return { result: `Plot failed:\n${ran.error}\n(script: ${script})` }
    }

    const plot: Plot = {
      id, dir, title, kind: ran.kind, png: ran.files.png ?? '',
      width: ran.size[0], height: ran.size[1], files: ran.files, packages, latex,
    }
    await update($, last, () => plot)
    await update($, history, list => [...(list ?? []), plot].slice(-50))
    const copied = input.exportTo ? await copyExports($, plot, formats.length ? formats : ['png'], input.exportTo) : []
    const waiting = await paneWait
    if (waiting) $.ui.toast(`sciplot pane not shown: ${waiting}. Run /sciplot to open it.`)
    const lines = [
      waiting
        ? `Rendered ${plot.kind} figure "${title}" (${plot.width}x${plot.height}px), but the pane is not shown: ${waiting}. The user can run /sciplot to open it.`
        : `Rendered ${plot.kind} figure "${title}" (${plot.width}x${plot.height}px) in the sciplot pane.`,
      ...Object.entries(plot.files).map(([fmt, path]) => `${fmt}: ${path}`),
      ...(copied.length ? ['Copied:', ...copied] : []),
    ]
    return { result: lines.join('\n') }
  })

  on('command.run', { command: 'sciplot' }, async ($, e) => {
    const args = String((e as unknown as { args?: string }).args ?? '').trim().split(/\s+/).filter(Boolean)
    if (args[0] === 'engines') {
      await detect($)
      await registerTool($)
      return { text: enginesReport() }
    }
    if (args[0] === 'delete') {
      if (!home) await detect($)
      return { text: await deleteCurrent($) }
    }
    if (args[0] === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'sciplot pane closed. /sciplot reopens it.' }
    }
    if (args[0] !== 'export') {
      const waiting = await openPane($)
      if (waiting) return { text: `sciplot pane could not be placed: ${waiting}` }
      return { text: 'sciplot pane opened. Ask Claude to plot something; /sciplot engines; /sciplot export pdf,svg [dir]; /sciplot close.' }
    }
    const plot = await read($, last)
    if (!plot) return { text: 'Nothing plotted yet.' }
    const formats = parseFormats(args[1] ?? 'pdf')
    if (typeof formats === 'string') return { text: formats }
    const done = await ensureFormats($, plot, formats)
    if (typeof done === 'string') return { text: `Export failed:\n${done}` }
    const copied = args[2] ? await copyExports($, done, formats, args[2]) : formats.map(f => done.files[f])
    return { text: `Exported:\n${copied.join('\n')}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Image, Client } = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Image?: any; Client?: any }
    const plot = await read($, last)
    const working = await read($, busy)
    const plots = (await read($, history)) ?? []
    const props = e.props as { bodyColumns?: number; placement?: 'dock' | 'inline'; scroll?: { bodyRows: number } }
    const body = props.bodyColumns ?? e.viewport?.columns ?? 80
    // Docked, the pane fills its height and the toolbar sits on the bottom row(s).
    const docked = props.placement === 'dock' && !!props.scroll?.bodyRows
    const barRows = body < 64 ? 2 : 1
    const maxRows = docked
      ? Math.max(4, props.scroll!.bodyRows - 1 - barRows - 1)
      : Math.max(6, (e.viewport?.rows ?? 40) - 6)

    if (!plot) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{working ? `Rendering ${working}…` : 'No plot yet. Ask Claude to plot something.'}</Text>
        </Box>
      )
    }

    let png: string | null = null
    try {
      png = ((await $.fs.read(plot.png, { as: 'bytes' })) as { base64: string }).base64
    } catch {
      png = null
    }

    // Terminal cells are about 2.5x as tall as wide (Ghostty/kitty default fonts); 2 left a gap above and below.
    const cell = 2.5
    let columns = Math.max(10, Math.min(255, body - 1))
    let rows = Math.max(4, Math.round((columns * plot.height) / Math.max(1, plot.width) / cell))
    if (rows > maxRows) {
      rows = maxRows
      columns = Math.max(10, Math.min(columns, Math.round((rows * cell * plot.width) / Math.max(1, plot.height))))
    }

    // Plotly figures go live: a headless browser draws them and takes the pointer.
    if (live.plotId && live.plotId !== plot.id) stopLive($)
    const canLive = plot.kind === 'plotly' && !!Image && !!Client && e.surface === 'terminal'
    if (canLive && live.wanted && !live.plotId) void goLive($, plot)
    const isLive = canLive && live.plotId === plot.id
    if (isLive) {
      columns = Math.max(10, Math.min(255, body - 1))
      rows = maxRows
      live.mounted = live.frame ? { cols: columns, rows } : null
    }

    const index = plots.findIndex(p => p.id === plot.id)
    const step = async (delta: number) => {
      const list = (await read($, history)) ?? []
      const current = await read($, last)
      const target = list[list.findIndex(p => p.id === current?.id) + delta]
      if (target) await update($, last, () => target)
    }

    const exportAndReveal = async (fmt: string) => {
      const current = await read($, last)
      if (!current) return
      const done = await ensureFormats($, current, [fmt])
      if (typeof done === 'string') return void $.ui.toast(`Export failed: ${done.split('\n').pop()}`)
      await $.process.run(['open', '-R', done.files[fmt]!])
      $.ui.toast(`Saved ${done.files[fmt]}`)
    }

    return (
      <Box flexDirection="column">
        <Text bold>
          {plot.title} <Text dimColor>{index >= 0 ? `${index + 1}/${plots.length} · ` : ''}{plot.kind}{working ? ` · rendering ${working}…` : ''}</Text>
        </Text>
        {isLive ? (
          <Box flexDirection="column" width={columns} height={rows}>
            {live.frame ? (
              <Image key={LIVE_KEY} source={{ file: live.frame.file, format: 'png', generation: live.frame.generation }} columns={columns} rows={rows} alt={plot.title} />
            ) : (
              <Text dimColor>Starting the live view…</Text>
            )}
            <Box position="absolute" top={0} left={0} width={columns} height={rows}>
              <Client key={`live-${plot.id}`} module="./live.tsx" width={columns} height={rows} />
            </Box>
          </Box>
        ) : Image && png ? (
          // Keep it a direct child of an unsized column: wrapped or in a fixed-height pane it drew clipped or not at all.
          <Image key={`${plot.id}-${columns}x${rows}`} source={{ png }} columns={columns} rows={rows} alt={plot.title} />
        ) : (
          <Text dimColor>{plot.png}</Text>
        )}
        {/* Docked, a fixed-height spacer (not flexGrow in a sized column) pushes the toolbar to the bottom. */}
        {docked && (isLive || (Image && png)) && <Box height={Math.max(0, props.scroll!.bodyRows - 1 - rows - barRows)} />}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button hotkey="b" onPress={() => step(-1)} dimColor={index <= 0}>←</Button>
          <Button hotkey="n" onPress={() => step(1)} dimColor={index < 0 || index >= plots.length - 1}>→</Button>
          <Button hotkey="p" onPress={() => exportAndReveal('pdf')}>PDF</Button>
          <Button hotkey="s" onPress={() => exportAndReveal('svg')}>SVG</Button>
          <Button hotkey="g" onPress={() => exportAndReveal('png')}>PNG</Button>
          <Button hotkey="d" dimColor onPress={async () => $.ui.toast(await deleteCurrent($))}>Delete</Button>
          {canLive && (
            <Button hotkey="i" onPress={async () => {
              live.wanted = !isLive
              if (isLive) stopLive($)
              $.ui.invalidate('ui.render')
            }}>{isLive ? 'Static' : 'Live'}</Button>
          )}
          {plot.kind === 'plotly' && (
            <Button hotkey="o" onPress={async () => {
              const done = await ensureFormats($, plot, ['html'])
              if (typeof done !== 'string') await $.process.run(['open', done.files.html!])
            }}>Browser</Button>
          )}
        </Box>
      </Box>
    )
  })

  // From live.tsx: the region's size, and pointer events to forward.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || !live.plotId) return next(e)
    const data = e.data as { type?: string; cols?: number; rows?: number; events?: unknown[] }
    if (data.type === 'size' && data.cols && data.rows) {
      live.region = { cols: data.cols, rows: data.rows }
      if (live.pending) {
        const html = live.pending
        live.pending = null
        await liveCall($, '/open', { html, ...live.region })
      } else {
        await liveCall($, '/size', live.region)
      }
    } else if (data.type === 'input' && Array.isArray(data.events)) {
      await liveCall($, '/input', { events: data.events })
    }
    return next(e)
  })

  // The wheel over a live figure zooms it rather than scrolling the pane.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (!live.plotId || !live.ready || e.by === 0) return next(e)
    const x = (e.pointer?.column ?? Math.floor((live.region?.cols ?? 2) / 2)) + 0.5
    const y = (e.pointer?.row ?? Math.floor((live.region?.rows ?? 2) / 2)) - 1 + 0.5 // the title row sits above
    await liveCall($, '/input', { events: [{ kind: 'wheel', x, y, dy: Math.max(-10, Math.min(10, e.by)) }] })
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    stopLive($)
    return closed
  })
}

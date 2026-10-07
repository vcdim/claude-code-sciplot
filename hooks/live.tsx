/* @jsx h */
import type { ClientPointerEvent, ClientSurface } from 'claude-code'

// Runs in the terminal over the live plotly picture: reports the region's size
// and forwards the pointer (in cells, sub-cell where the terminal says) to the
// hooks module, which hands it to the headless browser.

type State = { cols: number; rows: number }
type LiveEvent = { kind: 'down' | 'move' | 'up'; button?: string; x: number; y: number }

function toEvent(e: ClientPointerEvent): LiveEvent | null {
  if (e.type === 'enter' || e.type === 'leave') return null
  const ev: LiveEvent = { kind: e.type, x: e.fine?.x ?? e.x + 0.5, y: e.fine?.y ?? e.y + 0.5 }
  if (e.button) ev.button = e.button
  return ev
}

export default function Live(_props: unknown, surface: ClientSurface<State>) {
  const { Box } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ cols: 0, rows: 0 })
    const queue: LiveEvent[] = []
    surface.onPointer(e => {
      const ev = toEvent(e)
      if (!ev) return
      // Keep only the latest of a run of moves: the browser needs where the pointer is, not every step.
      const prev = queue[queue.length - 1]
      if (ev.kind === 'move' && prev?.kind === 'move' && prev.button === ev.button) queue[queue.length - 1] = ev
      else queue.push(ev)
    })
    surface.every(30, () => {
      if (queue.length) surface.post({ type: 'input', events: queue.splice(0, queue.length) })
    })
  }

  const { columns: cols, rows } = surface
  if (cols > 0 && rows > 0 && surface.state && (surface.state.cols !== cols || surface.state.rows !== rows)) {
    surface.setState({ cols, rows })
    surface.post({ type: 'size', cols, rows })
  }

  return <Box flexDirection="column" height="100%" />
}

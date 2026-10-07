export type Plot = {
  id: string
  dir: string
  title: string
  kind: string
  png: string
  width: number
  height: number
  files: Record<string, string>
  packages: string[]
}

declare module 'claude-code' {
  interface PluginState {
    sciplot: { last: Plot | null; history: Plot[]; busy: string | null }
  }
}

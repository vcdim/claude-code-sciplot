import { expect, test } from 'claude-code/testing'

const RESULT = {
  kind: 'matplotlib',
  files: { png: '/h/.cache/sciplot/x/plot.png', pdf: '/h/.cache/sciplot/x/plot.pdf' },
  size: [800, 600],
}

test('plot runs the script through uv and reports the exports', async ($, on) => {
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    runs.push(argv)
    if (argv[0] === 'sh') return { value: { exitCode: 0, stdout: 'home=/h\nuv=/bin/uv\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: `SCIPLOT_RESULT ${JSON.stringify(RESULT)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: undefined }))

  const ran = await $.tool.call({ tool: 'mcp__sciplot__plot', code: 'plt.plot([1, 2])', export: ['pdf'] })
  expect(String(ran.result)).toContain('Rendered matplotlib figure')
  expect(String(ran.result)).toContain('pdf: /h/.cache/sciplot/x/plot.pdf')
  const uv = runs.find(a => a[0] === '/bin/uv')
  expect(uv?.at(-1)).toBe('png,pdf')
})

test('plot refuses an unknown export format', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'home=/h\nuv=/bin/uv\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const ran = await $.tool.call({ tool: 'mcp__sciplot__plot', code: 'x = 1', export: ['bmp'] })
  expect(String(ran.deny)).toContain('Unknown format')
})

test('a missing engine is refused with a free alternative', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'home=/h\nuv=/bin/uv\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const ran = await $.tool.call({ tool: 'mcp__sciplot__plot', code: 'plot(1:3)', language: 'matlab' })
  expect(String(ran.deny)).toContain('Octave')
})

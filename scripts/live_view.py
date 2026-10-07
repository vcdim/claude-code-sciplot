"""Serve a live, interactive view of a plotly HTML file for the sciplot pane.

usage: live_view.py SOCKET RUNDIR

Runs headless Chrome (the installed Google Chrome, else Playwright's Chromium),
renders the page into PNG frames under RUNDIR, and takes pointer input over an
HTTP API on the Unix socket SOCKET:

  POST /open   {"html": path, "cols": n, "rows": n}  load a page sized to the pane
  POST /size   {"cols": n, "rows": n}                 resize to the pane
  POST /input  {"events": [{"kind", "button", "x", "y", "dy"}]}  x, y in cells
  POST /close                                         blank the view
  GET  /state?version=n   wait (up to 20 s) for a state newer than n

Exits when its parent process goes away.
"""

import asyncio
import json
import os
import sys

from aiohttp import web
from playwright.async_api import async_playwright

# CSS pixels per terminal cell; cells are about 2.5x as tall as wide.
CELL_W = 8
CELL_H = 20
SCALE = 2  # device pixels per CSS pixel
MIN_FRAME_GAP = 1 / 30

FIT = """() => {
  document.documentElement.style.margin = document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'
  for (const gd of document.querySelectorAll('.plotly-graph-div')) {
    gd.style.width = innerWidth + 'px'
    gd.style.height = innerHeight + 'px'
    if (window.Plotly) Plotly.relayout(gd, {width: innerWidth, height: innerHeight})
  }
}"""


class View:
    def __init__(self, rundir):
        self.rundir = rundir
        self.page = None
        self.cols = self.rows = 0
        self.version = 0
        self.generation = 0
        self.frame = None
        self.error = None
        self.dirty = asyncio.Event()
        self.changed = asyncio.Condition()
        self.held = None

    async def start(self):
        self.pw = await async_playwright().start()
        try:
            self.browser = await self.pw.chromium.launch(channel="chrome")
        except Exception:
            self.browser = await self.pw.chromium.launch()
        asyncio.create_task(self.painter())

    def viewport(self):
        return {"width": max(1, self.cols) * CELL_W, "height": max(1, self.rows) * CELL_H}

    async def open(self, html, cols, rows):
        self.cols, self.rows = cols, rows
        if self.page is None:
            ctx = await self.browser.new_context(viewport=self.viewport(), device_scale_factor=SCALE)
            self.page = await ctx.new_page()
        else:
            await self.page.set_viewport_size(self.viewport())
        self.error = None
        try:
            await self.page.goto("file://" + html, wait_until="networkidle", timeout=20000)
            await self.page.evaluate(FIT)
        except Exception as err:
            self.error = f"{type(err).__name__}: {err}"
        self.dirty.set()

    async def resize(self, cols, rows):
        if self.page is None or (cols, rows) == (self.cols, self.rows):
            return
        self.cols, self.rows = cols, rows
        await self.page.set_viewport_size(self.viewport())
        await self.page.evaluate(FIT)
        self.dirty.set()

    async def input(self, events):
        if self.page is None:
            return
        mouse = self.page.mouse
        for ev in events:
            x, y = float(ev.get("x", 0)) * CELL_W, float(ev.get("y", 0)) * CELL_H
            kind = ev.get("kind")
            if kind == "move":
                await mouse.move(x, y)
            elif kind == "down":
                self.held = ev.get("button") or "left"
                await mouse.move(x, y)
                await mouse.down(button=self.held)
            elif kind == "up":
                await mouse.move(x, y)
                await mouse.up(button=self.held or ev.get("button") or "left")
                self.held = None
            elif kind == "wheel":
                await mouse.move(x, y)
                await mouse.wheel(0, float(ev.get("dy", 0)) * 100)
        self.dirty.set()

    async def close(self):
        if self.page is not None:
            await self.page.goto("about:blank")
        self.frame = None
        await self.bump()

    async def painter(self):
        while True:
            await self.dirty.wait()
            self.dirty.clear()
            if self.page is None or not self.cols:
                continue
            # Let plotly finish redrawing after the input before taking the frame.
            await asyncio.sleep(MIN_FRAME_GAP)
            self.generation += 1
            path = os.path.join(self.rundir, f"live-{self.generation % 2}.png")
            try:
                await self.page.screenshot(path=path)
            except Exception as err:
                self.error = f"{type(err).__name__}: {err}"
                await self.bump()
                continue
            self.frame = {"file": path, "generation": self.generation, "cols": self.cols, "rows": self.rows}
            await self.bump()

    async def bump(self):
        async with self.changed:
            self.version += 1
            self.changed.notify_all()

    def state(self):
        return {"version": self.version, "frame": self.frame, "error": self.error}


async def main():
    sock, rundir = sys.argv[1], sys.argv[2]
    os.makedirs(rundir, exist_ok=True)
    view = View(rundir)
    await view.start()

    async def body(req):
        try:
            return await req.json()
        except Exception:
            return {}

    async def open_(req):
        b = await body(req)
        await view.open(str(b["html"]), int(b["cols"]), int(b["rows"]))
        return web.json_response(view.state())

    async def size(req):
        b = await body(req)
        await view.resize(int(b["cols"]), int(b["rows"]))
        return web.json_response({"ok": True})

    async def input_(req):
        await view.input((await body(req)).get("events", []))
        return web.json_response({"ok": True})

    async def close(req):
        await view.close()
        return web.json_response({"ok": True})

    async def state(req):
        since = int(req.query.get("version", "-1"))
        async with view.changed:
            try:
                await asyncio.wait_for(view.changed.wait_for(lambda: view.version > since), 20)
            except asyncio.TimeoutError:
                pass
        return web.json_response(view.state())

    app = web.Application()
    app.add_routes([
        web.post("/open", open_), web.post("/size", size), web.post("/input", input_),
        web.post("/close", close), web.get("/state", state),
    ])
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    if os.path.exists(sock):
        os.unlink(sock)
    await web.UnixSite(runner, sock).start()
    print(json.dumps({"ready": sock}), flush=True)

    # Stop when the parent (uv, under the Claude Code session) goes away.
    parent = os.getppid()
    while os.getppid() == parent:
        await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())

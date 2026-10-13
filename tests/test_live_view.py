"""Two live views side by side must not share a socket, requests or frames.

Run: uv run --no-project --with aiohttp python -m unittest discover -s tests -p 'test_*.py'
(No browser needed: the views are served without starting Chrome.)
"""

import asyncio
import os
import socket
import subprocess
import sys
import tempfile
import unittest

import aiohttp

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "live_view.py")
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import live_view  # noqa: E402


class CountingView(live_view.View):
    def __init__(self, rundir):
        super().__init__(rundir)
        self.closed = 0

    async def close(self):
        self.closed += 1
        await super().close()


class FakeMouse:
    def __init__(self):
        self.log = []

    async def move(self, x, y):
        self.log.append(("move", x, y))

    async def down(self, button="left"):
        self.log.append(("down", button))

    async def up(self, button="left"):
        self.log.append(("up", button))

    async def wheel(self, dx, dy):
        self.log.append(("wheel", dx, dy))


class FakePage:
    """Stands in for a Chrome page: records pointer input, screenshots write NAME."""

    def __init__(self, name):
        self.name, self.mouse = name, FakeMouse()

    async def screenshot(self, path):
        with open(path, "w") as f:
            f.write(self.name)

    async def goto(self, url, **_):
        pass


def painting(view, name):
    """Give VIEW a fake page and run its painter, as start() and open() would."""
    view.page, view.cols, view.rows = FakePage(name), 10, 4
    return asyncio.create_task(view.painter())


def frames_in(rundir):
    """{frame file: contents} for the PNG frames in RUNDIR."""
    out = {}
    for f in os.listdir(rundir):
        if f.endswith(".png"):
            with open(os.path.join(rundir, f)) as fh:
                out[f] = fh.read()
    return out


async def frame_after(sock, version):
    """Long-poll /state until a frame newer than VERSION arrives; returns the state."""
    async with aiohttp.ClientSession(connector=aiohttp.UnixConnector(path=sock)) as s:
        for _ in range(20):
            async with s.get(f"http://sciplot/state?version={version}") as r:
                st = await r.json()
            if st["frame"] and st["version"] > version:
                return st
            version = st["version"]
    raise AssertionError(f"no new frame on {sock}")


async def post(sock, path, body=None):
    async with aiohttp.ClientSession(connector=aiohttp.UnixConnector(path=sock)) as s:
        async with s.post(f"http://sciplot{path}", json=body or {}) as r:
            return await r.json()


class TwoViewers(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Short root: macOS caps Unix socket paths at 104 bytes.
        self.root = tempfile.mkdtemp(prefix="sp", dir="/tmp")
        self.views, self.runners, self.socks, self.dirs = [], [], [], []
        for name in ("a", "b"):
            rundir = os.path.join(self.root, name)
            os.makedirs(rundir)
            sock = os.path.join(rundir, "live.sock")
            view = CountingView(rundir)
            self.runners.append(await live_view.serve(sock, rundir, view))
            self.views.append(view)
            self.socks.append(sock)
            self.dirs.append(rundir)
            for g in (0, 1):  # frames as the painter would leave them
                open(os.path.join(rundir, f"live-{g}.png"), "wb").close()

    async def asyncTearDown(self):
        for runner in self.runners:
            await runner.cleanup()
        subprocess.run(["rm", "-rf", self.root])

    async def test_input_and_frames_stay_with_their_viewer_after_the_other_closes(self):
        painters = [painting(v, n) for v, n in zip(self.views, ("a", "b"))]
        try:
            await post(self.socks[0], "/input", {"events": [{"kind": "move", "x": 1, "y": 2}]})
            await post(self.socks[1], "/input", {"events": [
                {"kind": "down", "x": 3, "y": 4}, {"kind": "up", "x": 3, "y": 4}]})
            a_moves = [("move", 1 * live_view.CELL_W, 2 * live_view.CELL_H)]
            self.assertEqual(self.views[0].page.mouse.log, a_moves)
            self.assertEqual([e[0] for e in self.views[1].page.mouse.log], ["move", "down", "move", "up"])

            frames = [await frame_after(sock, 0) for sock in self.socks]
            for (st, rundir, name) in zip(frames, self.dirs, ("a", "b")):
                self.assertEqual(os.path.dirname(st["frame"]["file"]), rundir)
                with open(st["frame"]["file"]) as f:
                    self.assertEqual(f.read(), name)

            # Close a: b keeps taking input and painting into its own directory only.
            await post(self.socks[0], "/close")
            a_files = frames_in(self.dirs[0])
            await post(self.socks[1], "/input", {"events": [{"kind": "wheel", "x": 5, "y": 1, "dy": 1}]})
            st = await frame_after(self.socks[1], frames[1]["version"])
            self.assertGreater(st["frame"]["generation"], frames[1]["frame"]["generation"])
            self.assertEqual(os.path.dirname(st["frame"]["file"]), self.dirs[1])
            self.assertEqual(self.views[1].page.mouse.log[-1], ("wheel", 0, 100.0))
            self.assertEqual(self.views[0].page.mouse.log, a_moves)
            self.assertEqual(frames_in(self.dirs[0]), a_files)
        finally:
            for t in painters:
                t.cancel()

    async def test_close_reaches_only_its_own_viewer(self):
        await post(self.socks[0], "/close")
        self.assertEqual([v.closed for v in self.views], [1, 0])
        await post(self.socks[1], "/close")
        self.assertEqual([v.closed for v in self.views], [1, 1])

    async def test_a_second_viewer_cannot_take_a_live_socket(self):
        with self.assertRaises(RuntimeError):
            await live_view.serve(self.socks[0], self.dirs[0], CountingView(self.dirs[0]))
        # The process refuses too, before starting a browser, and leaves the socket alone.
        proc = await asyncio.create_subprocess_exec(
            sys.executable, SCRIPT, self.socks[0], self.dirs[0],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(proc.communicate(), 30)
        self.assertEqual(proc.returncode, 1)
        self.assertIn(b"another live view", err)
        self.assertTrue(os.path.exists(self.socks[0]))
        await post(self.socks[0], "/close")
        self.assertEqual(self.views[0].closed, 1)

    async def test_a_stale_socket_is_reclaimed(self):
        # Viewer a died without removing its socket. (A clean runner.cleanup() unlinks the
        # file on Python 3.13+, so leave one behind by hand: bound, closed, never unlinked.)
        await self.runners.pop(0).cleanup()
        stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        if os.path.exists(self.socks[0]):
            os.unlink(self.socks[0])
        stale.bind(self.socks[0])
        stale.close()
        self.assertTrue(os.path.exists(self.socks[0]))
        view = CountingView(self.dirs[0])
        self.runners.append(await live_view.serve(self.socks[0], self.dirs[0], view))
        await post(self.socks[0], "/close")
        self.assertEqual(view.closed, 1)

    async def test_cleanup_removes_only_its_own_files(self):
        live_view.cleanup(self.socks[0], self.dirs[0])
        self.assertFalse(os.path.exists(self.dirs[0]))
        self.assertEqual(sorted(os.listdir(self.dirs[1])), ["live-0.png", "live-1.png", "live.sock"])
        await post(self.socks[1], "/close")
        self.assertEqual(self.views[1].closed, 1)


if __name__ == "__main__":
    unittest.main()

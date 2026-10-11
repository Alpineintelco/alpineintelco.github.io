import http.server
import socket
from pathlib import Path

root = Path(__file__).resolve().parent.parent
port = 8000
reload_script = b"""<script>
let version
setInterval(async () => {
  const now = await fetch("/__version").then(r => r.text()).catch(() => version)
  if (version && now !== version) location.reload()
  version = now
}, 500)
</script>
</body>"""


def version():
    files = [
        (str(p), p.stat().st_mtime)
        for p in root.rglob("*")
        if p.is_file() and ".git" not in p.parts and p.name != ".DS_Store"
    ]
    return str(hash(tuple(sorted(files)))).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path == "/__version":
            body = version()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if path.suffix == ".html" and path.is_file():
            body = path.read_bytes().replace(b"</body>", reload_script, 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


print(f"http://localhost:{port}")
Server(("::", port), Handler).serve_forever()

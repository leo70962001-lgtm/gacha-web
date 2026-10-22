"""本機預覽伺服器：web/ 當網站根目錄
index.html 寫成 claude.ai artifact 的格式（沒有 <!doctype>/<html>/<head>/<body>），
這裡把它包上同一個外殼再送出，本機看到的就跟發佈後一樣。
  py -I tools/serve.py [port]
"""
import http.server, os, sys, functools

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
SHELL_HEAD = ('<!doctype html><html><head><meta charset=utf8>'
              '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
              '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
              'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
              '</head><body>')
SHELL_TAIL = '</body></html>'


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webp': 'image/webp', '.glb': 'model/gltf-binary'}

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        if path in ('/', '/index.html'):
            body = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
            data = (SHELL_HEAD + body + SHELL_TAIL).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(H, directory=ROOT)).serve_forever()

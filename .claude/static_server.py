import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", 8000))
Handler = http.server.SimpleHTTPRequestHandler

# Threaded: the page requests a dozen assets at once, and the single-threaded
# server refuses the overflow with ERR_CONNECTION_REFUSED.
class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


with Server(("", PORT), Handler) as httpd:
    httpd.serve_forever()

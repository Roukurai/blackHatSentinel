#!/usr/bin/env python3
# Dev-only sink for the collector. Accepts POST /events, prints each event,
# returns 200 {"accepted":N,"duplicates":D}. Dedups by event_id across the run.
# Usage: python3 collector/tests/devsink.py [port]   (default 8080)
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

seen = set()
total = 0

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass  # silence default logging
    def do_POST(self):
        global total
        if self.path != "/events":
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            events = json.loads(body)
            assert isinstance(events, list)
        except Exception as e:
            self.send_response(400); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode()); return
        accepted = dupes = 0
        for e in events:
            eid = e.get("event_id")
            if eid in seen:
                dupes += 1; continue
            seen.add(eid); accepted += 1; total += 1
            print(f"  [{total:>3}] {e.get('type','?'):<24} "
                  f"user={e.get('username')!r:<14} ip={e.get('source_ip')} "
                  f"port={e.get('source_port')} origin={e.get('origin')}")
        print(f"--- batch: accepted={accepted} dupes={dupes} (running total={total})")
        self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers()
        self.wfile.write(json.dumps({"accepted": accepted, "duplicates": dupes}).encode())
    def do_GET(self):
        self.send_response(200); self.end_headers()
        self.wfile.write(json.dumps({"total_events": total}).encode())

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"devsink listening on 127.0.0.1:{port} (POST /events)")
    HTTPServer(("127.0.0.1", port), H).serve_forever()

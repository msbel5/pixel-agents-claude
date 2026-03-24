#!/usr/bin/env python3
import http.server, subprocess, io
from PIL import Image

PORT = 5800

def capture():
    proc = subprocess.run(['grim', '-s', '0.35', '-'], capture_output=True, timeout=5)
    if proc.returncode != 0: return None
    img = Image.open(io.BytesIO(proc.stdout)).convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=30)
    return buf.getvalue()

VIEWER = b'''<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0}body{background:#000}
#a,#b{width:100%;height:100%;position:fixed;top:0;left:0;object-fit:contain}
#b{display:none}</style>
</head><body>
<img id="a"><img id="b">
<script>
var a=document.getElementById("a"),b=document.getElementById("b"),c=0;
function go(){
  var next=c%2==0?b:a;
  var curr=c%2==0?a:b;
  next.onload=function(){
    next.style.display="block";
    curr.style.display="none";
    c++;
    setTimeout(go,200);
  };
  next.onerror=function(){setTimeout(go,2000)};
  next.src="/snap?"+c;
}
a.onload=function(){setTimeout(go,200)};
a.src="/snap?start";
</script>
</body></html>'''

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/snap'):
            jpg = capture()
            if jpg:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(jpg)))
                self.end_headers()
                self.wfile.write(jpg)
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(VIEWER)
    def log_message(self, *a): pass

print('Screen stream on :5800')
http.server.HTTPServer(('0.0.0.0', PORT), H).serve_forever()

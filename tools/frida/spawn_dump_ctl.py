import frida, sys, time, base64, json
script_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dump4.js'
duration = int(sys.argv[2]) if len(sys.argv) > 2 else 120
prefix = sys.argv[3] if len(sys.argv) > 3 else 'cap'
fq = open('/tmp/%s_req.bin'%prefix, 'ab'); fr = open('/tmp/%s_resp.bin'%prefix, 'ab')
jl = open('/tmp/%s.jsonl'%prefix, 'a')
stats = {'req': 0, 'resp': 0}; handles = {}
def on_message(m, d):
    if m.get('type') == 'send':
        p = m.get('payload')
        if isinstance(p, dict) and 'b64' in p:
            raw = base64.b64decode(p['b64'])
            key = (p['dir'], p.get('cid'))
            f = handles.setdefault(key, open('/tmp/%s_%s_c%s.bin'%(prefix,p['dir'],p.get('cid')),'ab'))
            f.write(raw); f.flush()
            jl.write(json.dumps({'dir': p['dir'], 'n': len(raw), 't': time.time()}) + '\n'); jl.flush()
            stats[p['dir']] += len(raw)
            print('[cap]', p['dir'], len(raw), 'bytes (total req=%d resp=%d)' % (stats['req'], stats['resp']), flush=True)
        else:
            print('[frida]', p, flush=True)
    elif m.get('type') == 'error':
        print('[frida-err]', (m.get('stack') or m.get('description'))[:400], flush=True)
device = frida.get_usb_device(timeout=15)
pid = device.spawn(['me.alzz.awsl'])
session = device.attach(pid)
sc = session.create_script(open(script_path).read())
sc.on('message', on_message)
sc.load()
device.resume(pid)
print('[*] spawn-gated, capturing %ds' % duration, flush=True)
t0 = time.time()
while time.time() - t0 < duration: time.sleep(1)
print('[*] done totals', stats, flush=True)

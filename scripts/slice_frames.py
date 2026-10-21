# 切片 spritesheet → 16 张单帧 PNG（供 tkinter 桌面宠物使用，Tk8.6 原生读 PNG）
import zlib, struct, os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'resources', 'sprites')

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w, h = 8, b'', 0, 0
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos+4])
        ctype = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+length]
        if ctype == b'IHDR':
            w, h = struct.unpack('>II', chunk[:8])
        elif ctype == b'IDAT':
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = w * 4
    px = bytearray(w * h * 4)
    for y in range(h):
        off = y * (stride + 1)
        assert raw[off] == 0, f'filter {raw[off]} 不支持（自研编码器只产生 filter 0）'
        px[y*stride:(y+1)*stride] = raw[off+1:off+1+stride]
    return w, h, px

def write_png(path, w, h, px):
    def chunk(ctype, payload):
        c = struct.pack('>I', len(payload)) + ctype + payload
        return c + struct.pack('>I', zlib.crc32(ctype + payload) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

for pet in ['tihun', 'mojiao', 'liuyi']:
    w, h, px = read_png(os.path.join(ROOT, f'{pet}_sprite.png'))
    fw, fh = w // 4, h // 4
    outdir = os.path.join(ROOT, 'frames', pet)
    os.makedirs(outdir, exist_ok=True)
    for f in range(16):
        col, row = f % 4, f // 4
        frame = bytearray(fw * fh * 4)
        for y in range(fh):
            src = ((row*fh + y) * w + col*fw) * 4
            frame[y*fw*4:(y+1)*fw*4] = px[src:src + fw*4]
        write_png(os.path.join(outdir, f'f{f:02d}.png'), fw, fh, frame)
    print(f'{pet}: 16 frames → {outdir}')
print('DONE')

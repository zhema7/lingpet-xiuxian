# 修仙灵兽 · 桌面宠物 v2（登场漩涡 / 游走 / 护法模式）
# 启动: pythonw desktop_pet.py <framesDir>
# 状态(单向): ~/.lingpet/desktop-state.json {petType, level}
# 偏好: ~/.lingpet/desktop-pet-pref.json {mode: 'wander'|'guard'}
import tkinter as tk
import json, os, sys, time, random, math

HOME = os.path.expanduser('~')
LINGPET = os.path.join(HOME, '.lingpet')
STATE_FILE = os.path.join(LINGPET, 'desktop-state.json')
PREF_FILE = os.path.join(LINGPET, 'desktop-pet-pref.json')
POS_FILE = os.path.join(LINGPET, 'desktop-pet-pos.json')
PID_FILE = os.path.join(LINGPET, 'desktop-pet.pid')
KEY = '#010203'

FRAMES_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'sprites', 'frames')
SCALE = 2

ANIM = {
    'idle':      ([0, 1, 2, 3], 260),
    'cultivate': ([4, 5, 6, 7], 200),
    'eat':       ([8, 9, 10, 9], 200),
    'happy':     ([12, 13, 14, 15], 140),
    'walk':      ([0, 1, 2, 3], 110),
}
AURAS = {1: ('#e8f0ff', 66), 2: ('#4fd8ff', 72), 3: ('#ffd54f', 78), 4: ('#b388ff', 84), 5: ('#ff9e40', 90)}
PETS = ['tihun', 'mojiao', 'liuyi']
PET_NAMES = {'tihun': '啼魂', 'mojiao': '墨蛟', 'liuyi': '霜蜈'}

os.makedirs(LINGPET, exist_ok=True)

root = tk.Tk()
root.overrideredirect(True)
root.attributes('-topmost', True)
root.attributes('-transparentcolor', KEY)
root.configure(bg=KEY)

canvas = tk.Canvas(root, width=200, height=200, bg=KEY, highlightthickness=0, bd=0)
canvas.pack()

state = {'petType': 'tihun', 'level': 1}
pref = {'mode': 'wander'}
current = {'pet': 'tihun', 'frames': [], 'action': 'idle', 'idx': 0, 'until': 0,
           'aura_id': None, 'sprite_id': None, 'flip': False,
           'walk_dir': 1, 'walk_until': 0, 'wait_until': time.time() + 3}

def load_json(fp, default):
    try:
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(default, dict) and isinstance(data, dict):
            return {**default, **data}
        return data if data is not None else default
    except Exception:
        return dict(default) if isinstance(default, dict) else default

def save_json(fp, obj):
    try:
        with open(fp, 'w', encoding='utf-8') as f:
            json.dump(obj, f)
    except Exception:
        pass

def load_frames(pet):
    d = os.path.join(FRAMES_DIR, pet)
    out = []
    for i in range(16):
        img = tk.PhotoImage(file=os.path.join(d, f'f{i:02d}.png'))
        out.append(img.zoom(SCALE, SCALE) if SCALE > 1 else img)
    return out

def aura_tier(level):
    for t, maxL in [(1, 1), (2, 4), (3, 7), (4, 10), (5, 99)]:
        if level <= maxL:
            return t
    return 1

def apply_pet():
    current['pet'] = state['petType']
    current['frames'] = load_frames(current['pet'])
    current['idx'] = 0
    color, r = AURAS[aura_tier(state['level'])]
    if current['aura_id']:
        canvas.delete(current['aura_id'])
    current['aura_id'] = canvas.create_oval(100 - r, 104 - r, 100 + r, 104 + r,
                                            outline=color, width=2, stipple='gray50', fill='')
    canvas.itemconfig(state_tag, text=f'Lv.{state["level"]}')

def draw_frame(frame_idx):
    img = current['frames'][frame_idx]
    if current['flip']:
        img = img.subsample(1, 1)  # tk 无水平翻转，用负 zoom 不支持；省略翻转
    if current['sprite_id']:
        canvas.delete(current['sprite_id'])
    current['sprite_id'] = canvas.create_image(100, 40, image=img, anchor='n')

def tick():
    now = time.time()
    # 动作到时回落 idle
    if current['action'] not in ('idle', 'walk') and now > current['until']:
        current['action'] = 'idle'
    # 游走模式: 随机起走/停下
    if pref['mode'] == 'wander' and current['action'] in ('idle', 'walk'):
        if current['action'] == 'idle' and now > current['wait_until'] and random.random() < 0.02:
            current['action'] = 'walk'
            current['walk_dir'] = random.choice([-1, 1])
            current['walk_until'] = now + random.uniform(1.5, 4)
        elif current['action'] == 'walk':
            if now > current['walk_until']:
                current['action'] = 'idle'
                current['wait_until'] = now + random.uniform(2, 6)
            else:
                nx = root.winfo_x() + current['walk_dir'] * 2
                sw = root.winfo_screenwidth()
                if nx < 0 or nx > sw - 200:
                    current['walk_dir'] *= -1
                    nx = max(0, min(sw - 200, nx))
                root.geometry(f'+{nx}+{root.winfo_y()}')
    frames_def, delay = ANIM[current['action']]
    current['idx'] = (current['idx'] + 1) % len(frames_def)
    draw_frame(frames_def[current['idx']])
    # 随机小动作
    if current['action'] == 'idle' and random.random() < 0.006:
        current['action'] = random.choice(['happy', 'eat'])
        current['until'] = now + 2.5
    root.after(delay, tick)

def poll_state():
    global state
    state = load_json(STATE_FILE, state)
    if state['petType'] != current['pet'] or aura_tier(state['level']) != aura_tier(getattr(poll_state, '_lv', -1)):
        poll_state._lv = state['level']
        apply_pet()
    root.after(2000, poll_state)

# —— 登场漩涡动画: 光点由小到大旋转汇聚 → 灵兽现身 ——
def play_intro(on_done):
    dots = []
    for i in range(10):
        d = canvas.create_oval(0, 0, 0, 0, outline='', fill='#ffd54f', stipple='gray50')
        dots.append(d)
    anim = {'t': 0}
    def step():
        anim['t'] += 1
        t = anim['t']
        for i, d in enumerate(dots):
            phase = i * 0.63
            prog = min(1.0, t / 45)
            r = (1 - prog) * 90 + prog * 8
            ang = phase + t * 0.22
            x = 100 + math.cos(ang) * r
            y = 104 + math.sin(ang) * r * 0.75
            sz = 3 + prog * 5
            canvas.coords(d, x - sz, y - sz, x + sz, y + sz)
        if t < 45:
            root.after(30, step)
        else:
            for d in dots:
                canvas.delete(d)
            flash = canvas.create_oval(60, 64, 140, 144, outline='#fff6c8', width=3, fill='')
            canvas.create_text(100, 104, text='✦', fill='#fff6c8', font=('Segoe UI', 26, 'bold'))
            root.after(220, lambda: (canvas.delete(flash), on_done()))
    step()

# —— 交互 ——
drag = {'x': 0, 'y': 0, 'moved': False}

def on_press(e):
    drag.update({'x': e.x, 'y': e.y, 'moved': False})

def on_move(e):
    if abs(e.x - drag['x']) + abs(e.y - drag['y']) > 3:
        drag['moved'] = True
    root.geometry(f'+{root.winfo_x() + e.x - drag["x"]}+{root.winfo_y() + e.y - drag["y"]}')

def on_release(e):
    save_json(POS_FILE, {'x': root.winfo_x(), 'y': root.winfo_y()})
    if not drag['moved']:
        current['action'] = 'happy'
        current['until'] = time.time() + 2

def do_action(name, secs):
    current['action'] = name
    current['until'] = time.time() + secs

def toggle_mode():
    pref['mode'] = 'guard' if pref['mode'] == 'wander' else 'wander'
    save_json(PREF_FILE, pref)
    refresh_menu()

def quit_pet():
    try:
        os.remove(PID_FILE)
    except Exception:
        pass
    root.destroy()

menu = tk.Menu(root, tearoff=0)
def refresh_menu():
    menu.delete(0, 'end')
    menu.add_command(label='🍎 喂食', command=lambda: do_action('eat', 3))
    menu.add_command(label='🧘 打坐', command=lambda: do_action('cultivate', 6))
    mode_label = '🛡️ 为我护法（当前）' if pref['mode'] == 'guard' else '🛡️ 为我护法'
    walk_label = '🚶 自由游走（当前）' if pref['mode'] == 'wander' else '🚶 自由游走'
    menu.add_command(label=walk_label, command=lambda: (pref.update({'mode': 'wander'}), save_json(PREF_FILE, pref), refresh_menu()))
    menu.add_command(label=mode_label, command=lambda: (pref.update({'mode': 'guard'}), save_json(PREF_FILE, pref), refresh_menu()))
    menu.add_separator()
    menu.add_command(label='✖ 收回灵兽袋', command=quit_pet)
refresh_menu()

canvas.bind('<Button-1>', on_press)
canvas.bind('<B1-Motion>', on_move)
canvas.bind('<ButtonRelease-1>', on_release)
canvas.bind('<Button-3>', lambda e: menu.tk_popup(e.x_root, e.y_root))

state_tag = canvas.create_text(100, 16, text='', fill='#ffd54f', font=('Segoe UI', 9, 'bold'))

pref = load_json(PREF_FILE, pref)
pos = load_json(POS_FILE, None) or {}
root.geometry(f'+{pos.get("x", 1200)}+{pos.get("y", 400)}')

with open(PID_FILE, 'w') as f:
    f.write(str(os.getpid()))

state = load_json(STATE_FILE, state)
apply_pet()
# 登场漩涡 → 开始主循环
play_intro(lambda: (tick(), poll_state()))
root.mainloop()

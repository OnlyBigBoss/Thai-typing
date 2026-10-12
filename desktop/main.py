"""Thai typing trainer (Kedmanee) - desktop version. Run: python desktop/main.py"""
import json
import random
import time
import tkinter as tk
from datetime import date, datetime
from pathlib import Path
from tkinter import ttk

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "data" / "words.json").read_text(encoding="utf-8"))
LAYOUT = DATA["layout"]
STORE_FILE = Path.home() / ".thai_typing_history.json"

GOAL_MIN = 30
LESSON_LEN = 120
TEST_LEN = 600
FONT = "Leelawadee UI"
COMBINING = set("ัิีึืฺุู็่้๊๋์ํ๎")
MODES = {"บทเรียน": 0, "ทดสอบ 30 วินาที": 30, "ทดสอบ 60 วินาที": 60}

# same palette as web/style.css (dark theme)
C = {
    "bg": "#1f2226", "panel": "#262a2f", "fg": "#d9d6cf", "muted": "#8b8f96", "line": "#3a3f46",
    "ok": "#9cc58c", "bad": "#ef8a7c", "bad_bg": "#4a2f2d", "accent": "#e8b84a",
    "kb_bg": "#383b40", "mod": "#4a4f57", "keyfg": "#f3f1ec", "keyfg_s": "#c4c2bd",
}
FINGER_COLORS = {
    "LP": "#4e7d57", "LR": "#7a7a2c", "LM": "#a8742c", "LI": "#9b4a5e",
    "RI": "#46709a", "RM": "#74589c", "RR": "#2f8580", "RP": "#7a6a5c", "T": "#a5524b",
}
FINGER_NAMES = {
    "LP": "ก้อยซ้าย", "LR": "นางซ้าย", "LM": "กลางซ้าย", "LI": "ชี้ซ้าย",
    "RI": "ชี้ขวา", "RM": "กลางขวา", "RR": "นางขวา", "RP": "ก้อยขวา", "T": "โป้ง",
}
# modifier keys around each row so the board looks like a real one (every row = 15 units)
EXTRA = [
    {"after": [("Backspace", 2, None)]},
    {"before": [("Tab", 1.5, None)], "last_w": 1.5},
    {"before": [("Caps Lock", 1.75, None)], "after": [("Enter", 2.25, None)]},
    {"before": [("Shift", 2.25, "shiftL")], "after": [("Shift", 2.75, "shiftR")]},
]
BOTTOM = [("Ctrl", 1.5, None), ("Alt", 1.5, None), ("", 9, "space"), ("Alt", 1.5, None), ("Ctrl", 1.5, None)]
U, GAP, PAD = 46, 4, 12  # keyboard geometry in px


def cap(ch: str) -> str:
    return "◌" + ch if ch in COMBINING else ch


def lighten(hex_color: str, amount: float = 0.3) -> str:
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    r, g, b = (round(v + (255 - v) * amount) for v in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def load_store() -> dict:
    try:
        data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if isinstance(data, list):  # old format: plain history list
        data = {"history": data}
    data.setdefault("history", [])
    data.setdefault("daily", {})
    return data


def save_store(data: dict) -> None:
    try:
        STORE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ฝึกพิมพ์ไทย - เกษมณี")
        self.geometry("1000x820")
        self.configure(bg=C["bg"])
        self.lessons = DATA["lessons"]
        self.all_keys = list(dict.fromkeys(k for l in self.lessons for k in l["keys"]))
        self.key_of = {}  # char -> (row, col, shift, finger)
        for r, row in enumerate(LAYOUT["rows"]):
            for layer in ("base", "shift"):
                for c, ch in enumerate(row[layer]):
                    self.key_of.setdefault(ch, (r, c, layer == "shift", row["fingers"][c]))
        self.bumps = {tuple(b) for b in LAYOUT["bumps"]}
        self.target = ""
        self.limit = 0
        self.started_at = 0.0
        self.total = self.errors = 0
        self.prev_len = 0
        self.finished = False
        self.after_id = None

        self._style()
        self._build_ui()
        self.start()

    # ---- UI ----
    def _style(self):
        st = ttk.Style(self)
        st.theme_use("clam")
        st.configure("TCombobox", fieldbackground=C["panel"], background=C["panel"], foreground=C["fg"],
                     arrowcolor=C["fg"], bordercolor=C["line"])
        st.map("TCombobox", fieldbackground=[("readonly", C["panel"]), ("disabled", C["bg"])],
               foreground=[("readonly", C["fg"]), ("disabled", C["muted"])])
        self.option_add("*TCombobox*Listbox.background", C["panel"])
        self.option_add("*TCombobox*Listbox.foreground", C["fg"])
        st.configure("TButton", background=C["panel"], foreground=C["fg"], bordercolor=C["line"])
        st.map("TButton", background=[("active", C["line"])])

    def label(self, parent, **kw):
        kw.setdefault("bg", C["bg"])
        kw.setdefault("fg", C["fg"])
        kw.setdefault("font", (FONT, 11))
        return tk.Label(parent, **kw)

    def _build_ui(self):
        top = tk.Frame(self, bg=C["bg"], padx=16, pady=10)
        top.pack(fill="x")
        self.mode = ttk.Combobox(top, values=list(MODES), state="readonly", width=16, font=(FONT, 11))
        self.mode.current(0)
        self.mode.pack(side="left")
        self.lesson = ttk.Combobox(top, values=[l["title"] for l in self.lessons], state="readonly",
                                   width=44, font=(FONT, 11))
        self.lesson.current(0)
        self.lesson.pack(side="left", padx=8)
        ttk.Button(top, text="↻ เริ่มใหม่ (Esc)", command=self.start).pack(side="right")
        self.mode.bind("<<ComboboxSelected>>", lambda e: self.start())
        self.lesson.bind("<<ComboboxSelected>>", lambda e: self.start())
        self.bind("<Escape>", lambda e: self.start())

        # stats panel
        panel = tk.Frame(self, bg=C["bg"], padx=16)
        panel.pack(fill="x")
        panel.columnconfigure(1, weight=1)
        for i, name in enumerate(["ตัวชี้วัด:", "ปุ่มทั้งหมด:", "ปุ่มปัจจุบัน:", "เป้าหมายรายวัน:"]):
            self.label(panel, text=name, font=(FONT, 11, "bold"), anchor="e", width=13).grid(
                row=i, column=0, sticky="e", padx=(0, 10), pady=2)
        self.metrics = self.label(panel, fg=C["muted"], anchor="w")
        self.metrics.grid(row=0, column=1, sticky="w")
        self.all_chips = tk.Text(panel, height=1, bg=C["bg"], fg=C["muted"], bd=0, highlightthickness=0,
                                 font=(FONT, 12), wrap="char", cursor="arrow")
        self.all_chips.grid(row=1, column=1, sticky="we")
        self.all_chips.tag_configure("learned", foreground=C["fg"])
        self.all_chips.tag_configure("cur", foreground=C["accent"], underline=True)
        self.all_chips.tag_configure("dim", foreground="#565a61")
        self.cur_chips = self.label(panel, fg=C["accent"], anchor="w", font=(FONT, 12))
        self.cur_chips.grid(row=2, column=1, sticky="w")
        goal = tk.Frame(panel, bg=C["bg"])
        goal.grid(row=3, column=1, sticky="w")
        self.goal_text = self.label(goal, fg=C["muted"])
        self.goal_text.pack(side="left")
        self.goal_bar = tk.Canvas(goal, width=360, height=10, bg=C["bg"], highlightthickness=1,
                                  highlightbackground=C["line"])
        self.goal_bar.pack(side="left", padx=12)

        # target text
        self.text = tk.Text(self, height=3, wrap="word", font=(FONT, 24), padx=16, pady=8, bg=C["bg"],
                            fg=C["fg"], bd=0, highlightthickness=0, state="disabled", cursor="arrow",
                            spacing1=6, spacing3=6)
        self.text.pack(fill="x", padx=8, pady=(18, 0))
        self.text.tag_configure("sp", foreground=C["muted"])
        self.text.tag_configure("ok", foreground=C["ok"])
        self.text.tag_configure("bad", foreground=C["bad"], background=C["bad_bg"])
        self.text.tag_configure("cur", underline=True, foreground=C["accent"])

        self.entry = tk.Entry(self, font=(FONT, 16), bg=C["panel"], fg=C["fg"], insertbackground=C["fg"],
                              relief="flat", highlightthickness=1, highlightbackground=C["line"],
                              highlightcolor=C["accent"])
        self.entry.pack(fill="x", padx=24, pady=8)
        self.entry.bind("<KeyRelease>", self.on_change)
        self.entry.bind("<BackSpace>", self.on_backspace)
        self.entry.bind("<<Paste>>", lambda e: "break")

        self.result = self.label(self, fg=C["accent"], font=(FONT, 13, "bold"))
        self.result.pack(fill="x")

        # keyboard
        kb_w = int(15 * U + 14 * GAP + 2 * PAD)
        kb_h = int(5 * U + 4 * GAP + 2 * PAD)
        self.kb = tk.Canvas(self, width=kb_w, height=kb_h, bg=C["bg"], highlightthickness=0)
        self.kb.pack(pady=(8, 4))
        legend = tk.Frame(self, bg=C["bg"])
        legend.pack()
        for f, name in FINGER_NAMES.items():
            tk.Label(legend, bg=FINGER_COLORS[f], width=2).pack(side="left", padx=(10, 4))
            self.label(legend, text=name, fg=C["muted"], font=(FONT, 10)).pack(side="left")

        self.history = self.label(self, justify="left", anchor="w", fg=C["muted"], font=(FONT, 10))
        self.history.pack(fill="x", padx=24, pady=(12, 0))
        self.show_history()

    def draw_keyboard(self, next_ch: str | None):
        cv = self.kb
        cv.delete("all")
        w_total = int(cv.cget("width"))
        h_total = int(cv.cget("height"))
        cv.create_rectangle(0, 0, w_total, h_total, fill=C["kb_bg"], outline="")

        nxt = self.key_of.get(next_ch) if next_ch and next_ch != " " else None
        shift_id = None
        if nxt and nxt[2]:
            shift_id = "shiftR" if nxt[3].startswith("L") else "shiftL"

        def width(w):
            return w * U + (w - 1) * GAP

        def key(x, y, w, color, highlight, shift_label="", base_label="", mod_label="", bump=False):
            fill = lighten(color, 0.25) if highlight else color
            cv.create_rectangle(x, y, x + width(w), y + U, fill=fill,
                                outline=C["accent"] if highlight else "", width=3 if highlight else 0)
            if mod_label:
                cv.create_text(x + 8, y + U / 2, text=mod_label, anchor="w", fill=C["keyfg_s"], font=(FONT, 9))
            if shift_label:
                cv.create_text(x + 6, y + 3, text=shift_label, anchor="nw", fill=C["keyfg_s"], font=(FONT, 10))
            if base_label:
                cv.create_text(x + 6, y + U - 3, text=base_label, anchor="sw", fill=C["keyfg"], font=(FONT, 13))
            if bump:
                cx = x + width(w) / 2
                cv.create_oval(cx - 3, y + U - 9, cx + 3, y + U - 3, fill=C["keyfg_s"], outline="")
            return x + width(w) + GAP

        y = PAD
        for r, row in enumerate(LAYOUT["rows"]):
            x = PAD
            extra = EXTRA[r]
            for label, w, kid in extra.get("before", []):
                x = key(x, y, w, C["mod"], kid is not None and kid == shift_id, mod_label=label)
            for c, (b, s) in enumerate(zip(row["base"], row["shift"])):
                w = extra["last_w"] if "last_w" in extra and c == len(row["base"]) - 1 else 1
                hl = bool(nxt) and nxt[0] == r and nxt[1] == c
                x = key(x, y, w, FINGER_COLORS[row["fingers"][c]], hl, cap(s), cap(b),
                        bump=(r, c) in self.bumps)
            for label, w, kid in extra.get("after", []):
                x = key(x, y, w, C["mod"], kid is not None and kid == shift_id, mod_label=label)
            y += U + GAP
        x = PAD
        for label, w, kid in BOTTOM:
            is_space = kid == "space"
            x = key(x, y, w, FINGER_COLORS["T"] if is_space else C["mod"], is_space and next_ch == " ",
                    mod_label=label)

    # ---- session ----
    def start(self):
        if self.started_at and not self.finished:
            self.add_practice(min(self.elapsed(), self.limit or float("inf")))
        if self.after_id:
            self.after_cancel(self.after_id)
            self.after_id = None
        self.finished = False
        self.started_at = 0.0
        self.total = self.errors = self.prev_len = 0
        self.entry.delete(0, "end")
        self.result.config(text="")
        self.limit = MODES[self.mode.get()]
        self.lesson.config(state="readonly" if self.limit == 0 else "disabled")
        if self.limit == 0:
            lesson = self.lessons[self.lesson.current()]
            if lesson.get("type") == "paragraph":
                self.target = random.choice(lesson["items"])
            else:
                self.target = self.fill(lesson["items"], LESSON_LEN)
        else:
            pool = [w for l in self.lessons if l["id"] in ("words", "sentences") for w in l["items"]]
            self.target = self.fill(pool, TEST_LEN)
        self.render_chips()
        self.render_goal()
        self.render("")
        self.entry.focus_set()

    @staticmethod
    def fill(pool: list, length: int) -> str:
        parts, n, prev = [], 0, None
        while n < length:
            w = random.choice(pool)
            if w == prev and len(pool) > 1:
                continue
            parts.append(w)
            n += len(w) + 1
            prev = w
        return " ".join(parts)

    def on_backspace(self, event):
        # let Ctrl+Backspace keep its default behaviour
        if event.state & 0x4:
            return None
        if not self.finished:
            text = self.entry.get()
            if text:
                self.entry.delete(len(text) - 1, "end")  # one code point, not the whole cluster
                self.on_change()
        return "break"

    def on_change(self, _event=None):
        if self.finished:
            return
        typed = self.entry.get()
        if not self.started_at and typed:
            self.started_at = time.time()
            self.tick()
        for i in range(self.prev_len, len(typed)):
            self.total += 1
            if i >= len(self.target) or typed[i] != self.target[i]:
                self.errors += 1
        self.prev_len = len(typed)
        self.render(typed)
        if not self.limit and len(typed) >= len(self.target):
            self.finish()

    def tick(self):
        if self.finished:
            return
        self.update_stats(self.entry.get())
        if self.limit and self.elapsed() >= self.limit:
            self.finish()
            return
        self.after_id = self.after(200, self.tick)

    def elapsed(self) -> float:
        return time.time() - self.started_at if self.started_at else 0.0

    def render(self, typed: str):
        t = self.text
        t.config(state="normal")
        t.delete("1.0", "end")
        t.insert("1.0", self.target.replace(" ", "·"))
        for i, ch in enumerate(self.target):
            if ch == " ":
                t.tag_add("sp", f"1.0+{i}c")
        for i, ch in enumerate(typed[: len(self.target)]):
            t.tag_add("ok" if ch == self.target[i] else "bad", f"1.0+{i}c", f"1.0+{i + 1}c")
        if len(typed) < len(self.target) and not self.finished:
            t.tag_add("cur", f"1.0+{len(typed)}c", f"1.0+{len(typed) + 1}c")
            t.see(f"1.0+{len(typed)}c")
        t.config(state="disabled")
        self.update_stats(typed)
        done = self.finished or len(typed) >= len(self.target)
        self.draw_keyboard(None if done else self.target[len(typed)])

    def stats_values(self, typed: str):
        correct = sum(1 for i, ch in enumerate(typed) if i < len(self.target) and ch == self.target[i])
        t = self.elapsed()
        wpm = round(correct / 5 / (t / 60)) if t > 0 else 0
        acc = round((self.total - self.errors) / self.total * 100) if self.total else 100
        return wpm, acc, t

    def update_stats(self, typed: str):
        wpm, acc, t = self.stats_values(typed)
        shown = max(0, int(self.limit - t + 0.999)) if self.limit else int(t)
        score = round(wpm * acc / 100)
        self.metrics.config(
            text=f"ความเร็ว: {wpm} wpm     ความแม่นยำ: {acc}%     คะแนน: {score}     เวลา: {shown} วิ")

    def render_chips(self):
        is_lesson = self.limit == 0
        idx = self.lesson.current()
        upto = self.lessons[: idx + 1] if is_lesson else self.lessons
        learned = {k for l in upto for k in l["keys"]}
        cur = self.lessons[idx]["keys"] if is_lesson else []
        t = self.all_chips
        t.config(state="normal")
        t.delete("1.0", "end")
        for ch in self.all_keys:
            tags = ("cur",) if ch in cur else ("learned",) if ch in learned else ("dim",)
            t.insert("end", cap(ch), tags)
            t.insert("end", "  ")
        t.config(state="disabled", height=2)
        if not is_lesson:
            self.cur_chips.config(text="โหมดทดสอบ: ใช้ทุกปุ่ม", fg=C["muted"])
        elif cur:
            self.cur_chips.config(text="  ".join(cap(k) for k in cur), fg=C["accent"])
        else:
            self.cur_chips.config(text="ทบทวนปุ่มที่เรียนมาทั้งหมด", fg=C["muted"])

    # ---- daily goal ----
    def daily_seconds(self, store: dict | None = None) -> float:
        d = (store or load_store())["daily"]
        return d.get("seconds", 0) if d.get("date") == date.today().isoformat() else 0

    def add_practice(self, sec: float):
        if sec > 0:
            store = load_store()
            store["daily"] = {"date": date.today().isoformat(), "seconds": self.daily_seconds(store) + sec}
            save_store(store)
        self.render_goal()

    def render_goal(self):
        pct = min(100, round(self.daily_seconds() / (GOAL_MIN * 60) * 100))
        self.goal_text.config(text=f"{pct}%/{GOAL_MIN} นาที")
        self.goal_bar.delete("all")
        self.goal_bar.create_rectangle(0, 0, 360 * pct / 100, 12, fill=C["accent"], outline="")

    def finish(self):
        if self.finished:
            return
        self.finished = True
        typed = self.entry.get()
        wpm, acc, t = self.stats_values(typed)
        self.update_stats(typed)
        self.render(typed)
        self.add_practice(min(t, self.limit or float("inf")))
        self.result.config(text=f"เสร็จแล้ว! ความเร็ว {wpm} WPM · ความแม่นยำ {acc}% · คะแนน {round(wpm * acc / 100)}"
                                f" — กด Esc เพื่อเริ่มรอบใหม่")
        store = load_store()
        entry = {"date": datetime.now().isoformat(timespec="seconds"), "mode": self.mode.get(), "wpm": wpm, "acc": acc}
        store["history"] = [entry, *store["history"]][:10]
        save_store(store)
        self.show_history()

    def show_history(self):
        hist = load_store()["history"]
        lines = [f"{h['date']} · {h['mode']} · {h['wpm']} WPM · {h['acc']}%" for h in hist[:5]]
        self.history.config(text="สถิติล่าสุด\n" + ("\n".join(lines) or "ยังไม่มีสถิติ"))


if __name__ == "__main__":
    App().mainloop()

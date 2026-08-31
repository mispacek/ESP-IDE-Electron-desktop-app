# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# eyes_optimized.py — MicroPython RoboEyes (MONO_VLSB), rychla verze
# - based on https://github.com/FluxGarage/RoboEyes
# - pre-render & cache rounded-rect "oko" a blit pri kazdem frame
# - zadne floaty, integer tweening, minimum Pythonu v horke smycce

import utime as time
import urandom as _urnd
import framebuf

# --- Barvy ---
BGCOLOR = 0
MAINCOLOR = 1

# --- Moody ---
DEFAULT = 0
TIRED = 1
ANGRY = 2
HAPPY = 3

# --- Konstanty poloh ---
N, NE, E, SE, S, SW, W, NW = 1,2,3,4,5,6,7,8

# --- Utility ---
def _clamp(v, lo, hi):
    if v < lo: return lo
    if v > hi: return hi
    return v

def _rand(n):
    if n and n > 0:
        return _urnd.getrandbits(16) % n
    return 0

# --- Predpocty masek pro zaoblene rohy (pro generovani bitmapy oka) ---
_MAX_R = 16
_MASKS = {0: []}
def _precompute_round_masks():
    global _MASKS
    for r in range(1, _MAX_R+1):
        rr = r*r
        rows = []
        for dy in range(r):
            # integer sqrt aproximace (male r -> linearni dolu)
            xi = r
            rem = rr - dy*dy
            while xi*xi > rem:
                xi -= 1
            rows.append(xi)
        _MASKS[r] = rows
_precompute_round_masks()

def _fill_round_rect(fb, x, y, w, h, r, col):
    # Trivialni pripady
    if w <= 0 or h <= 0:
        return

    # Puvodni rychly „bez radiusu“
    if r <= 0:
        fb.fill_rect(x, y, w, h, col)
        return

    # Orez radiusu na rozumne meze
    if r > _MAX_R:
        r = _MAX_R
    if r * 2 > w:
        r = w // 2
    if r * 2 > h:
        r = h // 2

    # PO OREZU muze byt r == 0 → uz neni co zaoblovat
    if r <= 0:
        fb.fill_rect(x, y, w, h, col)
        return

    # Stred a boky
    fb.fill_rect(x + r, y, w - 2 * r, h, col)
    if h - 2 * r > 0:
        fb.fill_rect(x, y + r, r, h - 2 * r, col)
        fb.fill_rect(x + w - r, y + r, r, h - 2 * r, col)

    rows = _MASKS[r]

    # TOP: potrebujeme male dx nahore → pouzij obracene poradi
    for dy in range(r):
        dx = rows[r - 1 - dy]
        if dx:
            fb.hline(x + r - dx, y + dy, dx, col)       # levy horni
            fb.hline(x + w - r,  y + dy, dx, col)       # pravy horni

    # BOTTOM: klasicke poradi
    for dy in range(r):
        dx = rows[dy]
        if dx:
            yy = y + h - r + dy
            fb.hline(x + r - dx, yy, dx, col)           # levy dolni
            fb.hline(x + w - r,  yy, dx, col)           # pravy dolni

def _fill_triangle(fb, x0, y0, x1, y1, x2, y2, col):
    # serazeni podle y
    if y0 > y1: x0, x1, y0, y1 = x1, x0, y1, y0
    if y1 > y2: x1, x2, y1, y2 = x2, x1, y2, y1
    if y0 > y1: x0, x1, y0, y1 = x1, x0, y1, y0

    def draw_scanline(y, xa, xb):
        if xa > xb: xa, xb = xb, xa
        fb.hline(xa, y, xb - xa + 1, col)

    def edge_x(y, y0, x0, y1, x1):
        dy = y1 - y0
        if dy == 0: return x0
        num = (x1 - x0) * (y - y0)
        return x0 + (num // dy) if num >= 0 else x0 - ((-num) // dy)

    # horni cast
    y = y0
    while y <= y1:
        xa = edge_x(y, y0, x0, y2, x2)
        xb = edge_x(y, y0, x0, y1, x1)
        draw_scanline(y, xa, xb)
        y += 1
    # dolni cast
    y = y1 + 1
    while y <= y2:
        xa = edge_x(y, y0, x0, y2, x2)
        xb = edge_x(y, y1, x1, y2, x2)
        draw_scanline(y, xa, xb)
        y += 1

# ----------------- Oko bitmap cache (LRU) -----------------
class _EyeCache:
    def __init__(self, max_items=24):
        self.max = max_items
        self._d = {}     # (w,h,r) -> (buf, fb)
        self._order = [] # LRU

    def get(self, w, h, r):
        k = (w, h, r)
        ent = self._d.get(k)
        if ent:
            # LRU touch
            try:
                self._order.remove(k)
            except ValueError:
                pass
            self._order.append(k)
            return ent[1]  # vraci FrameBuffer
        # create
        pages = (h + 7) >> 3
        buf = bytearray(w * pages)
        fb = framebuf.FrameBuffer(buf, w, h, framebuf.MONO_VLSB)
        fb.fill(0)
        _fill_round_rect(fb, 0, 0, w, h, r if r <= _MAX_R else _MAX_R, 1)
        # insert with eviction
        self._d[k] = (buf, fb)
        self._order.append(k)
        if len(self._order) > self.max:
            oldk = self._order.pop(0)
            self._d.pop(oldk, None)
        return fb

# =========================================================
#                     TRIDA ROBOEYES
# =========================================================
class RoboEyes:
    def __init__(self, fbuf, display):
        self.fbuf = fbuf
        
        # detekce signatury blit() na teto platforme (3-arg vs 4-arg)
        try:
            # pokus s 4 parametry (key=-1 = bez transparentni barvy)
            self.fbuf.blit(self.fbuf, 0, 0, -1)
            self._blit = lambda src, x, y: self.fbuf.blit(src, x, y, -1)
        except TypeError:
            # starsi/usporne porty: jen 3 parametry
            self._blit = lambda src, x, y: self.fbuf.blit(src, x, y)
        
        
        self.display = display
        self.screenWidth  = getattr(fbuf, 'width', 128)
        self.screenHeight = getattr(fbuf, 'height', 64)
        self.frameInterval = 20
        self._fpsTimer = time.ticks_ms()

        # Stavy / prepinace
        self.tired = self.angry = self.happy = 0
        self.curious = self.cyclops = 0
        self.eyeL_open = self.eyeR_open = 0

        # Rozmery
        self.eyeLwidthDefault = 36
        self.eyeLheightDefault = 36
        self.eyeLwidthCurrent = self.eyeLwidthDefault
        self.eyeLheightCurrent = 1
        self.eyeLwidthNext = self.eyeLwidthDefault
        self.eyeLheightNext = self.eyeLheightDefault
        self.eyeLheightOffset = 0
        self.eyeLborderRadiusDefault = 8
        self.eyeLborderRadiusCurrent = 8
        self.eyeLborderRadiusNext = 8

        self.eyeRwidthDefault = 36
        self.eyeRheightDefault = 36
        self.eyeRwidthCurrent = 36
        self.eyeRheightCurrent = 1
        self.eyeRwidthNext = 36
        self.eyeRheightNext = 36
        self.eyeRheightOffset = 0
        self.eyeRborderRadiusDefault = 8
        self.eyeRborderRadiusCurrent = 8
        self.eyeRborderRadiusNext = 8

        # Roztec a pozice
        self.spaceBetweenDefault = 10
        self.spaceBetweenCurrent = 10
        self.spaceBetweenNext = 10

        self.eyeLxDefault = (self.screenWidth - (self.eyeLwidthDefault + self.spaceBetweenDefault + self.eyeRwidthDefault)) // 2
        self.eyeLyDefault = (self.screenHeight - self.eyeLheightDefault) // 2

        self.eyeLx = self.eyeLxDefault
        self.eyeLy = self.eyeLyDefault
        self.eyeLxNext = self.eyeLx
        self.eyeLyNext = self.eyeLy

        self.eyeRxDefault = self.eyeLx + self.eyeLwidthCurrent + self.spaceBetweenDefault
        self.eyeRyDefault = self.eyeLy
        self.eyeRx = self.eyeRxDefault
        self.eyeRy = self.eyeRyDefault
        self.eyeRxNext = self.eyeRx
        self.eyeRyNext = self.eyeRy

        # Vicka
        self.eyelidsHeightMax = self.eyeLheightDefault >> 1
        self.eyelidsTiredHeight = 0
        self.eyelidsTiredHeightNext = 0
        self.eyelidsAngryHeight = 0
        self.eyelidsAngryHeightNext = 0
        self.eyelidsHappyBottomOffsetMax = (self.eyeLheightDefault >> 1) + 3
        self.eyelidsHappyBottomOffset = 0
        self.eyelidsHappyBottomOffsetNext = 0

        # Makro animace
        self.hFlicker = self.hFlickerAlternate = 0
        self.hFlickerAmplitude = 2
        self.vFlicker = self.vFlickerAlternate = 0
        self.vFlickerAmplitude = 10

        self.autoblinker = 0
        self.blinkInterval = 1
        self.blinkIntervalVariation = 4
        self._blinktimer = time.ticks_ms()

        self.idle = 0
        self.idleInterval = 1
        self.idleIntervalVariation = 3
        self._idleTimer = time.ticks_ms()

        self.confused = 0
        self._confTimer = 0
        self.confusedAnimationDuration = 700
        self.confusedToggle = 1

        self.laugh = 0
        self._laughTimer = 0
        self.laughAnimationDuration = 700
        self.laughToggle = 1

        self.sweat = 0
        self.sweatBorderradius = 3
        self.sweat1XPosInitial = self.sweat2XPosInitial = self.sweat3XPosInitial = 2
        self.sweat1XPos = self.sweat2XPos = self.sweat3XPos = 2
        self.sweat1YPos = self.sweat2YPos = self.sweat3YPos = 2
        self.sweat1YPosMax = self.sweat2YPosMax = self.sweat3YPosMax = 8
        self.sweat1Height = self.sweat2Height = self.sweat3Height = 2
        self.sweat1Width  = self.sweat2Width  = self.sweat3Width  = 1

        # Cache pro oci (pre-render)
        self._eye_cache = _EyeCache(max_items=24)

    # --------- API ----------
    def begin(self, width, height, frameRate):
        self.screenWidth = width
        self.screenHeight = height
        self.fbuf.fill(BGCOLOR); self.display.show()
        self.eyeLheightCurrent = 1
        self.eyeRheightCurrent = 1
        self.setFramerate(frameRate)

    def update(self):
        now = time.ticks_ms()
        if time.ticks_diff(now, self._fpsTimer) >= self.frameInterval:
            self._drawEyes()
            self._fpsTimer = now
        time.sleep_ms(0)

    def setFramerate(self, fps):
        if fps <= 0: fps = 1
        self.frameInterval = 1000 // fps

    def setDisplayColors(self, background, main):
        global BGCOLOR, MAINCOLOR
        BGCOLOR = background; MAINCOLOR = main

    def _keep_center_x(self, total_w_next: int):
        # soucasny (animovany) celkovy rozmer paru
        total_w_cur = self.eyeLwidthCurrent + self.spaceBetweenCurrent + self.eyeRwidthCurrent
        # aktualni geometricky stred paru (vuci obrazovce)
        cx = self.eyeLx + (total_w_cur >> 1)

        # kam musi prijit leve oko, aby stred zustal stejny po zmene sirek/mezery
        newLx = (self.screenWidth >> 1) - (total_w_next >> 1)

        # omez na obrazovku
        max_lx = self.screenWidth - total_w_next
        if newLx < 0: newLx = 0
        elif newLx > max_lx: newLx = max_lx

        # nastav jak cilovou, tak „okamzitou“ polohu X – Y se NEMENI
        self.eyeLx = int(newLx)
        self.eyeLxNext = int(newLx)

    def setWidth(self, leftEye, rightEye):
        self.eyeLwidthNext = leftEye; self.eyeRwidthNext = rightEye
        self.eyeLwidthDefault = leftEye; self.eyeRwidthDefault = rightEye
        self._keep_center_x(leftEye + self.spaceBetweenNext + rightEye)

    def setHeight(self, leftEye, rightEye):
        self.eyeLheightNext = leftEye; self.eyeRheightNext = rightEye
        self.eyeLheightDefault = leftEye; self.eyeRheightDefault = rightEye

    def setBorderradius(self, leftEye, rightEye):
        self.eyeLborderRadiusNext = leftEye; self.eyeRborderRadiusNext = rightEye
        self.eyeLborderRadiusDefault = leftEye; self.eyeRborderRadiusDefault = rightEye

    def setSpacebetween(self, space):
        self.spaceBetweenNext = space; self.spaceBetweenDefault = space
        self._keep_center_x(self.eyeLwidthNext + space + self.eyeRwidthNext)

    def setMood(self, mood):
        if mood == TIRED: self.tired, self.angry, self.happy = 1,0,0
        elif mood == ANGRY: self.tired, self.angry, self.happy = 0,1,0
        elif mood == HAPPY: self.tired, self.angry, self.happy = 0,0,1
        else: self.tired = self.angry = self.happy = 0

    def setPosition(self, position):
        # vyuziva constrainty pro leve oko, prave se odvodi
        gx = self._getScreenConstraint_X()
        gy = self._getScreenConstraint_Y()
        if   position == N:  self.eyeLxNext, self.eyeLyNext = gx>>1, 0
        elif position == NE: self.eyeLxNext, self.eyeLyNext = gx, 0
        elif position == E:  self.eyeLxNext, self.eyeLyNext = gx, gy>>1
        elif position == SE: self.eyeLxNext, self.eyeLyNext = gx, gy
        elif position == S:  self.eyeLxNext, self.eyeLyNext = gx>>1, gy
        elif position == SW: self.eyeLxNext, self.eyeLyNext = 0, gy
        elif position == W:  self.eyeLxNext, self.eyeLyNext = 0, gy>>1
        elif position == NW: self.eyeLxNext, self.eyeLyNext = 0, 0
        else:                self.eyeLxNext, self.eyeLyNext = gx>>1, gy>>1

    def look_joystick(self, X, Y):
        # 1) clamp vstupu
        if X < -100: X = -100
        if X >  100: X =  100
        if Y < -100: Y = -100
        if Y >  100: Y =  100

        # 2) stejne mantinely jako setPosition()
        max_x = self._getScreenConstraint_X()
        max_y = self._getScreenConstraint_Y()

        # 3) linearni mapovani do rozsahu 0..max
        #    X: (-100..100) → (0..max_x)
        self.eyeLxNext = int(((X + 100) * max_x) // 200)
        #    Y: (+100..-100) → (0..max_y)  (kladne Y = nahoru → mensi obrazove Y)
        self.eyeLyNext = int(((-Y + 100) * max_y) // 200)

    def setAutoblinker(self, active, interval=None, variation=None):
        self.autoblinker = 1 if active else 0
        if interval  is not None: self.blinkInterval = int(interval)
        if variation is not None: self.blinkIntervalVariation = int(variation)

    def setIdleMode(self, active, interval=None, variation=None):
        self.idle = 1 if active else 0
        if interval  is not None: self.idleInterval = int(interval)
        if variation is not None: self.idleIntervalVariation = int(variation)

    def setCuriosity(self, curiousBit): self.curious = 1 if curiousBit else 0
    def setCyclops(self, cyclopsBit):   self.cyclops = 1 if cyclopsBit else 0

    def setHFlicker(self, flickerBit, Amplitude=None):
        self.hFlicker = 1 if flickerBit else 0
        if Amplitude is not None: self.hFlickerAmplitude = int(Amplitude)

    def setVFlicker(self, flickerBit, Amplitude=None):
        self.vFlicker = 1 if flickerBit else 0
        if Amplitude is not None: self.vFlickerAmplitude = int(Amplitude)

    def setSweat(self, sweatBit): self.sweat = 1 if sweatBit else 0

    def close(self, left=None, right=None):
        if left is None and right is None:
            self.eyeLheightNext = 1; self.eyeRheightNext = 1
            self.eyeL_open = 0; self.eyeR_open = 0
        else:
            if left:  self.eyeLheightNext = 1; self.eyeL_open = 0
            if right: self.eyeRheightNext = 1; self.eyeR_open = 0

    def open(self, left=None, right=None):
        if left is None and right is None:
            self.eyeL_open = 1; self.eyeR_open = 1
        else:
            if left:  self.eyeL_open = 1
            if right: self.eyeR_open = 1

    def blink(self, left=None, right=None):
        self.close(left, right); self.open(left, right)

    def anim_confused(self): self.confused = 1
    def anim_laugh(self):    self.laugh = 1

    # --------- interni pomocnici ----------
    def _getScreenConstraint_X(self):
        return self.screenWidth - self.eyeLwidthCurrent - self.spaceBetweenCurrent - self.eyeRwidthCurrent
    def _getScreenConstraint_Y(self):
        return self.screenHeight - self.eyeLheightDefault

    def _drawEyes(self):
        # Lokalni aliasy (mene attribute lookups)
        fb = self.fbuf
        MA = MAINCOLOR
        BG = BGCOLOR

        # -------- tweening + logika --------
        if self.curious:
            self.eyeLheightOffset = 8 if (self.eyeLxNext <= 10 or (self.eyeLxNext >= (self._getScreenConstraint_X() - 10) and self.cyclops)) else 0
            self.eyeRheightOffset = 8 if (self.eyeRxNext >= self.screenWidth - self.eyeRwidthCurrent - 10) else 0
        else:
            self.eyeLheightOffset = 0; self.eyeRheightOffset = 0

        self.eyeLheightCurrent = (self.eyeLheightCurrent + self.eyeLheightNext + self.eyeLheightOffset) >> 1
        self.eyeLy += ((self.eyeLheightDefault - self.eyeLheightCurrent) >> 1)
        self.eyeLy -= (self.eyeLheightOffset >> 1)

        self.eyeRheightCurrent = (self.eyeRheightCurrent + self.eyeRheightNext + self.eyeRheightOffset) >> 1
        self.eyeRy += ((self.eyeRheightDefault - self.eyeRheightCurrent) >> 1)
        self.eyeRy -= (self.eyeRheightOffset >> 1)

        if self.eyeL_open and self.eyeLheightCurrent <= (1 + self.eyeLheightOffset): self.eyeLheightNext = self.eyeLheightDefault
        if self.eyeR_open and self.eyeRheightCurrent <= (1 + self.eyeRheightOffset): self.eyeRheightNext = self.eyeRheightDefault

        self.eyeLwidthCurrent  = (self.eyeLwidthCurrent  + self.eyeLwidthNext)  >> 1
        self.eyeRwidthCurrent  = (self.eyeRwidthCurrent  + self.eyeRwidthNext)  >> 1
        self.spaceBetweenCurrent = (self.spaceBetweenCurrent + self.spaceBetweenNext) >> 1

        self.eyeLx = (self.eyeLx + self.eyeLxNext) >> 1
        self.eyeLy = (self.eyeLy + self.eyeLyNext) >> 1
        self.eyeRxNext = self.eyeLxNext + self.eyeLwidthCurrent + self.spaceBetweenCurrent
        self.eyeRyNext = self.eyeLyNext
        self.eyeRx = (self.eyeRx + self.eyeRxNext) >> 1
        self.eyeRy = (self.eyeRy + self.eyeRyNext) >> 1

        self.eyeLborderRadiusCurrent = (self.eyeLborderRadiusCurrent + self.eyeLborderRadiusNext) >> 1
        self.eyeRborderRadiusCurrent = (self.eyeRborderRadiusCurrent + self.eyeRborderRadiusNext) >> 1

        now = time.ticks_ms()
        if self.autoblinker and time.ticks_diff(now, self._blinktimer) >= 0:
            self.blink()
            self._blinktimer = time.ticks_add(now, (self.blinkInterval * 1000) + (_rand(self.blinkIntervalVariation) * 1000))

        if self.laugh:
            if self.laughToggle:
                self.setVFlicker(1, 5); self._laughTimer = now; self.laughToggle = 0
            elif time.ticks_diff(now, self._laughTimer) >= self.laughAnimationDuration:
                self.setVFlicker(0, 0); self.laughToggle = 1; self.laugh = 0

        if self.confused:
            if self.confusedToggle:
                self.setHFlicker(1, 20); self._confTimer = now; self.confusedToggle = 0
            elif time.ticks_diff(now, self._confTimer) >= self.confusedAnimationDuration:
                self.setHFlicker(0, 0); self.confusedToggle = 1; self.confused = 0

        if self.idle and time.ticks_diff(now, self._idleTimer) >= 0:
            self.eyeLxNext = _rand(self._getScreenConstraint_X() + 1)
            self.eyeLyNext = _rand(self._getScreenConstraint_Y() + 1)
            self._idleTimer = time.ticks_add(now, (self.idleInterval * 1000) + (_rand(self.idleIntervalVariation) * 1000))

        if self.hFlicker:
            d = self.hFlickerAmplitude
            if self.hFlickerAlternate: self.eyeLx += d; self.eyeRx += d
            else:                       self.eyeLx -= d; self.eyeRx -= d
            self.hFlickerAlternate ^= 1

        if self.vFlicker:
            d = self.vFlickerAmplitude
            if self.vFlickerAlternate: self.eyeLy += d; self.eyeRy += d
            else:                       self.eyeLy -= d; self.eyeRy -= d
            self.vFlickerAlternate ^= 1

        if self.cyclops:
            self.eyeRwidthCurrent = 0; self.eyeRheightCurrent = 0; self.spaceBetweenCurrent = 0

        # clamping
        self.eyeLx = _clamp(self.eyeLx, 0, self.screenWidth - 1)
        self.eyeLy = _clamp(self.eyeLy, 0, self.screenHeight - 1)
        self.eyeRx = _clamp(self.eyeRx, 0, self.screenWidth - 1)
        self.eyeRy = _clamp(self.eyeRy, 0, self.screenHeight - 1)

        # -------- kresleni --------
        fb.fill(BG)

        # PRE-RENDER oci -> blit
        Lw, Lh, Lr = self.eyeLwidthCurrent, self.eyeLheightCurrent, self.eyeLborderRadiusCurrent
        Rw, Rh, Rr = self.eyeRwidthCurrent, self.eyeRheightCurrent, self.eyeRborderRadiusCurrent

        # leve oko
        if Lw > 0 and Lh > 0:
            lfb = self._eye_cache.get(Lw, Lh, Lr)
            self._blit(lfb, self.eyeLx, self.eyeLy)

        # prave oko
        if not self.cyclops and Rw > 0 and Rh > 0:
            rfb = self._eye_cache.get(Rw, Rh, Rr)
            self._blit(rfb, self.eyeRx, self.eyeRy)

        # mood vicka (stejna logika, ale area je uz mala)
        self.eyelidsTiredHeightNext = (self.eyeLheightCurrent >> 1) if self.tired else 0
        self.eyelidsAngryHeightNext = (self.eyeLheightCurrent >> 1) if self.angry else 0
        self.eyelidsHappyBottomOffsetNext = (self.eyeLheightCurrent >> 1) if self.happy else 0

        self.eyelidsTiredHeight = (self.eyelidsTiredHeight + self.eyelidsTiredHeightNext) >> 1
        if self.eyelidsTiredHeight:
            if not self.cyclops:
                _fill_triangle(fb, self.eyeLx, self.eyeLy-1,
                                   self.eyeLx + Lw, self.eyeLy-1,
                                   self.eyeLx, self.eyeLy + self.eyelidsTiredHeight - 1, BG)
                _fill_triangle(fb, self.eyeRx, self.eyeRy-1,
                                   self.eyeRx + Rw, self.eyeRy-1,
                                   self.eyeRx + Rw, self.eyeRy + self.eyelidsTiredHeight - 1, BG)
            else:
                midx = self.eyeLx + (Lw >> 1)
                _fill_triangle(fb, self.eyeLx, self.eyeLy-1, midx, self.eyeLy-1,
                                   self.eyeLx, self.eyeLy + self.eyelidsTiredHeight - 1, BG)
                _fill_triangle(fb, midx, self.eyeLy-1, self.eyeLx + Lw, self.eyeLy-1,
                                   self.eyeLx + Lw, self.eyeLy + self.eyelidsTiredHeight - 1, BG)

        self.eyelidsAngryHeight = (self.eyelidsAngryHeight + self.eyelidsAngryHeightNext) >> 1
        if self.eyelidsAngryHeight:
            if not self.cyclops:
                _fill_triangle(fb, self.eyeLx, self.eyeLy-1,
                                   self.eyeLx + Lw, self.eyeLy-1,
                                   self.eyeLx + Lw, self.eyeLy + self.eyelidsAngryHeight - 1, BG)
                _fill_triangle(fb, self.eyeRx, self.eyeRy-1,
                                   self.eyeRx + Rw, self.eyeRy-1,
                                   self.eyeRx, self.eyeRy + self.eyelidsAngryHeight - 1, BG)
            else:
                midx = self.eyeLx + (Lw >> 1)
                _fill_triangle(fb, self.eyeLx, self.eyeLy-1, midx, self.eyeLy-1,
                                   midx, self.eyeLy + self.eyelidsAngryHeight - 1, BG)
                _fill_triangle(fb, midx, self.eyeLy-1, self.eyeLx + Lw, self.eyeLy-1,
                                   midx, self.eyeLy + self.eyelidsAngryHeight - 1, BG)


        self.eyelidsHappyBottomOffsetNext = ((Lh >> 1) if self.happy else 0)
        self.eyelidsHappyBottomOffset = (self.eyelidsHappyBottomOffset + self.eyelidsHappyBottomOffsetNext) >> 1

        off = self.eyelidsHappyBottomOffset
        if off > 0:
            # leve – rezeme jen spodni pas vysky 'off'
            h_cut = off
            y_cut = self.eyeLy + Lh - off
            r_cut = self.eyeLborderRadiusCurrent
            if r_cut > off: r_cut = off  # radius nesmi byt vetsi nez vyska pasu
            _fill_round_rect(fb, self.eyeLx, y_cut, Lw, h_cut, r_cut, BG)

            # prave
            if not self.cyclops:
                h_cut = off
                y_cut = self.eyeRy + Rh - off
                r_cut = self.eyeRborderRadiusCurrent
                if r_cut > off: r_cut = off
                _fill_round_rect(fb, self.eyeRx, y_cut, Rw, h_cut, r_cut, BG)


        # pot
        if self.sweat:
            # 1
            if self.sweat1YPos <= self.sweat1YPosMax: self.sweat1YPos += 1
            else:
                self.sweat1XPosInitial = _rand(30); self.sweat1YPos = 2
                self.sweat1YPosMax = _rand(10) + 10; self.sweat1Width = 1; self.sweat1Height = 2
            if self.sweat1YPos <= (self.sweat1YPosMax >> 1): self.sweat1Width += 1; self.sweat1Height += 1
            else:
                if self.sweat1Width > 1: self.sweat1Width -= 1
                if self.sweat1Height > 2: self.sweat1Height -= 1
            self.sweat1XPos = self.sweat1XPosInitial - (self.sweat1Width >> 1)
            _fill_round_rect(fb, self.sweat1XPos, self.sweat1YPos,
                             self.sweat1Width, self.sweat1Height, self.sweatBorderradius, MA)

            # 2
            if self.sweat2YPos <= self.sweat2YPosMax: self.sweat2YPos += 1
            else:
                self.sweat2XPosInitial = _rand(self.screenWidth - 60) + 30; self.sweat2YPos = 2
                self.sweat2YPosMax = _rand(10) + 10; self.sweat2Width = 1; self.sweat2Height = 2
            if self.sweat2YPos <= (self.sweat2YPosMax >> 1): self.sweat2Width += 1; self.sweat2Height += 1
            else:
                if self.sweat2Width > 1: self.sweat2Width -= 1
                if self.sweat2Height > 2: self.sweat2Height -= 1
            self.sweat2XPos = self.sweat2XPosInitial - (self.sweat2Width >> 1)
            _fill_round_rect(fb, self.sweat2XPos, self.sweat2YPos,
                             self.sweat2Width, self.sweat2Height, self.sweatBorderradius, MA)

            # 3
            if self.sweat3YPos <= self.sweat3YPosMax: self.sweat3YPos += 1
            else:
                self.sweat3XPosInitial = (self.screenWidth - 30) + _rand(30); self.sweat3YPos = 2
                self.sweat3YPosMax = _rand(10) + 10; self.sweat3Width = 1; self.sweat3Height = 2
            if self.sweat3YPos <= (self.sweat3YPosMax >> 1): self.sweat3Width += 1; self.sweat3Height += 1
            else:
                if self.sweat3Width > 1: self.sweat3Width -= 1
                if self.sweat3Height > 2: self.sweat3Height -= 1
            self.sweat3XPos = self.sweat3XPosInitial - (self.sweat3Width >> 1)
            _fill_round_rect(fb, self.sweat3XPos, self.sweat3YPos,
                             self.sweat3Width, self.sweat3Height, self.sweatBorderradius, MA)

        # flush
        self.display.show()
        time.sleep_ms(0)


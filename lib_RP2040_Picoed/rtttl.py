from machine import Pin
from machine import PWM
import utime

pwm3 = PWM(Pin(3), freq=1000, duty_u16=0)

def play_tone_rttl(freq, duration):
    if freq == 0:
        utime.sleep_ms(duration_ms)
        return
    pwm3.freq(int(freq))
    pwm3.duty_u16(32767)
    utime.sleep_ms(int(duration))
    pwm3.duty_u16(0)

def play_rtttl(rtttl_str, gap_ms=25):
    import utime, math

    SEMITONE_OFFSET = {
        'c': -9, 'c#': -8, 'd': -7, 'd#': -6, 'e': -5,
        'f': -4, 'f#': -3, 'g': -2, 'g#': -1,
        'a':  0, 'a#':  1, 'b':  2,
    }

    _, defaults, notes_str = rtttl_str.split(':')
    defaults = {k: int(v) for k, v in
                (item.split('=') for item in defaults.split(','))}
    d_def = defaults.get('d', 4)
    o_def = defaults.get('o', 5)
    bpm   = defaults.get('b', 120)

    beat_ms = 60000 // bpm            # délka jedné doby v ms

    for token in notes_str.split(','):
        token = token.strip().lower()
        if not token:
            continue

        # --- délka ---
        i = 0
        while i < len(token) and token[i].isdigit():
            i += 1
        dur_val     = int(token[:i]) if i else d_def
        duration_ms = int((4 / dur_val) * beat_ms)
        if '.' in token:                  # tečkovaná nota
            duration_ms = int(duration_ms * 1.5)

        body = token[i:] .replace('.', '')   # část s notou/pauzou

        # --- pauza (P) -------------------------------------------
        if body[0] == 'p':
            utime.sleep_ms(duration_ms)      # **ticho místo play_tone()**
            utime.sleep_ms(gap_ms)
            continue
        # ----------------------------------------------------------

        # --- název noty ---
        note_name = body[0]
        if len(body) > 1 and body[1] == '#':
            note_name += '#'

        octave_chars = ''.join(ch for ch in body if ch.isdigit())
        octave = int(octave_chars) if octave_chars else o_def

        n     = SEMITONE_OFFSET[note_name] + (octave - 4) * 12
        freq  = int(440 * math.pow(2, n / 12))

        play_tone_rttl(freq, duration_ms)
        utime.sleep_ms(gap_ms)
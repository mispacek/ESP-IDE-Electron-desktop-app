# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# Servo PWM library
# based on Radomir Dopieralski
# and from https://bitbucket.org/thesheep/micropython-servo

from machine import PWM
import math

def _check_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("%s must be int or float" % name)
    if value != value or value == float("inf") or value == -float("inf"):
        raise ValueError("%s must be a finite number" % name)
    return value

def _check_positive(value, name):
    value = _check_number(value, name)
    if value <= 0:
        raise ValueError("%s must be greater than 0" % name)
    return value

def _limit(value, lower, upper):
    return min(upper, max(lower, value))

def _to_int(value):
    if value >= 0:
        return int(value + 0.5)
    return int(value - 0.5)

class Servo:
    """
    A simple class for controlling hobby servos.

    Args:
        pin (machine.Pin): The pin where servo is connected. Must support PWM.
        freq (int/float): The frequency of the signal, in hertz.
        min_us (int/float): The minimum signal length supported by the servo.
        max_us (int/float): The maximum signal length supported by the servo.
        angle (int/float): The angle between the minimum and maximum positions.

    """
    def __init__(self, pin, reverse=None, freq=50, min_us=600, max_us=2400, angle=180):
        self.min_us = _check_positive(min_us, "min_us")
        self.max_us = _check_positive(max_us, "max_us")
        if self.max_us <= self.min_us:
            raise ValueError("max_us must be greater than min_us")
        self.us = 0
        self.freq = _to_int(_check_positive(freq, "freq"))
        self.angle = _check_positive(angle, "angle")
        try:
            self.pwm = PWM(pin, freq=self.freq, duty=0)
        except TypeError:
            self.pwm = PWM(pin, freq=self.freq)
        self.reverse = reverse
        if hasattr(self.pwm, "duty_ns"):
            self._duty_mode = "ns"
        elif hasattr(self.pwm, "duty_u16"):
            self._duty_mode = "u16"
        else:
            self._duty_mode = "duty"

    def _write_off(self):
        if self._duty_mode == "ns":
            self.pwm.duty_ns(0)
        elif self._duty_mode == "u16":
            self.pwm.duty_u16(0)
        else:
            self.pwm.duty(0)

    def _write_duty(self, us):
        if self._duty_mode == "ns":
            self.pwm.duty_ns(_to_int(us * 1000))
        elif self._duty_mode == "u16":
            duty = us * self.freq * 65535 / 1000000
            self.pwm.duty_u16(_to_int(_limit(duty, 0, 65535)))
        else:
            duty = us * self.freq * 1023 / 1000000
            self.pwm.duty(_to_int(_limit(duty, 0, 1023)))

    def write_us(self, us):
        """Set the signal to be ``us`` microseconds long. Zero disables it."""
        us = _check_number(us, "us")
        if us == 0:
            self._write_off()
            self.us = 0
            return
        us = _limit(us, self.min_us, self.max_us)
        self.us = us
        self._write_duty(us)

    def write_speed(self, speed):
        """Set speed for 360 servos. [-100% 100%]"""
        speed = _limit(_check_number(speed, "speed"), -100, 100)
        if self.reverse:
            speed = speed * (-1)
        self.write_us(_limit(1500 + (speed * 9), self.min_us, self.max_us))

    def write_angle(self, degrees=None, radians=None):
        """Move to the specified angle in ``degrees`` or ``radians``."""
        if degrees is None:
            if radians is None:
                raise ValueError("degrees or radians must be specified")
            radians = _check_number(radians, "radians")
            degrees = math.degrees(radians)
        else:
            degrees = _check_number(degrees, "degrees")
        
        if self.reverse:
            degrees = (self.angle - degrees) % 360
        else:
            degrees = degrees % 360
            
        total_range = self.max_us - self.min_us
        us = self.min_us + total_range * degrees / self.angle
        self.write_us(us)

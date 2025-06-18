from machine import PWM
import math

# originally by Radomir Dopieralski http://sheep.art.pl
# from https://bitbucket.org/thesheep/micropython-servo

class Servo:
    """
    A simple class for controlling hobby servos.

    Args:
        pin (machine.Pin): The pin where servo is connected. Must support PWM.
        freq (int): The frequency of the signal, in hertz.
        min_us (int): The minimum signal length supported by the servo.
        max_us (int): The maximum signal length supported by the servo.
        angle (int): The angle between the minimum and maximum positions.

    """
    def __init__(self, pin, reverse=None, freq=50, min_us=600, max_us=2400, angle=180):
        self.min_us = min_us
        self.max_us = max_us
        self.us = 0
        self.freq = freq
        self.angle = angle
        self.pwm = PWM(pin, freq=freq, duty_u16=0)
        self.reverse = reverse

    def write_us(self, us):
        """Set the signal to be ``us`` microseconds long. Zero disables it."""
        if us == 0:
            self.pwm.duty_u16(0)
            return
        us = min(self.max_us, max(self.min_us, us))
        self.pwm.duty_ns(us * 1000) # 1 ms = 1E3 us

    def write_speed(self, speed):
        """Set speed for 360 servos. [-100% 100%]"""
        if self.reverse:
            speed = speed * (-1)
        self.write_us(int(min(max(1500 + (speed*9),600),2400)))

    def write_angle(self, degrees=None, radians=None):
        """Move to the specified angle in ``degrees`` or ``radians``."""
        if degrees is None:
            degrees = math.degrees(radians)
        
        if self.reverse:
            degrees = (self.angle - degrees) % 360
        else:
            degrees = degrees % 360
            
        total_range = self.max_us - self.min_us
        us = self.min_us + total_range * degrees // self.angle
        self.write_us(int(us))

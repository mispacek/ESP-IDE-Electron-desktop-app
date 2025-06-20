from machine import Pin
from machine import PWM

def gpio_set(pin,value):
  if value >= 1:
    Pin(pin, Pin.OUT).on()
  else:
    Pin(pin, Pin.OUT).off()


class DCMotor:      
    def __init__(self, pin1, pin2, invert):
        self.pin1=pin1
        self.pin2=pin2
        self.invert=invert
        self.speed = 0
        
        Pin(pin1, Pin.OUT).off()
        self.pin2_PWM = PWM(Pin(pin2), freq=1000, duty_u16=0)

    def set_speed(self,speed):
        tmp_speed = int(min(max(speed, -100,), 100))
        
        # inverze smeru
        if self.invert == 1:
            self.speed = tmp_speed * (-1)
        else:
            self.speed = tmp_speed

        # ovladani PWM
        if self.speed >= 1:
            Pin(self.pin1, Pin.OUT).off()
            self.pin2_PWM.duty_u16(abs(int(self.speed * 655.35)))
        elif self.speed <= (-1):
            Pin(self.pin1, Pin.OUT).on()
            self.pin2_PWM.duty_u16(65535 - abs(int(self.speed * 655.35)))
        else:
            Pin(self.pin1, Pin.OUT).off()
            self.pin2_PWM.duty_u16(0)
from machine import ADC
from machine import Pin

class joystick(object) :
    def __init__( self, adx, ady, pin_sw, rot = 0 ) :
        self._range = 65535
        self._middle = self._range / 2
        self._deadband = self._range * 0.035
        
        
        self._vrx=ADC(Pin(adx))
        self._vry=ADC(Pin(ady))
        self._sw=Pin(pin_sw, Pin.IN , Pin.PULL_UP)
        self._rot = rot
        
        self._tmpx = 0
        self._tmpy = 0
        
        self._outx = 0
        self._outy = 0

        self._otmpx = 0
        self._otmpy = 0
        self._otmpsw = 0

    def _joy_convert_int(self, x, in_min, in_max, out_min, out_max, lim=1):
        return max(min(out_max, (x - in_min) * (out_max - out_min) // (in_max - in_min) + out_min), out_min)

    def _joy_read(self):
        self._tmpx = self._vrx.read_u16()
        self._tmpy = self._vry.read_u16()
        
        if (self._tmpx > self._middle - self._deadband) and (self._tmpx < self._middle + self._deadband):
            self._outx = 0;
        elif self._tmpx > self._middle + self._deadband:
            self._outx = self._joy_convert_int(self._tmpx, self._middle - self._deadband, self._range - self._deadband, 0, 100, 1)
        elif self._tmpx < self._middle - self._deadband:
            self._outx = self._joy_convert_int(self._tmpx, 0 + self._deadband, self._middle - self._deadband, -100, 0, 1)
        else: 
            self._outx = 0
        
        if (self._tmpy > self._middle - self._deadband) and (self._tmpy < self._middle + self._deadband):
            self._outy = 0;
        elif self._tmpy > self._middle + self._deadband:
            self._outy = self._joy_convert_int(self._tmpy, self._middle - self._deadband, self._range - self._deadband, 0, 100, 1)
        elif self._tmpy < self._middle - self._deadband:
            self._outy = self._joy_convert_int(self._tmpy, 0 + self._deadband, self._middle - self._deadband, -100, 0, 1)
        else: 
            self._outy = 0
        
        if self._rot == 0:
            self._otmpx = self._outy * (-1)
            self._otmpy = self._outx * (-1)
        elif self._rot == 90:
            self._otmpx = self._outx * (-1)
            self._otmpy = self._outy
        elif self._rot == 180:
            self._otmpx = self._outy
            self._otmpy = self._outx
        elif self._rot == 270:
            self._otmpx = self._outx
            self._otmpy = self._outy * (-1)
        else:
            self._otmpx = outy * (-1)
            self._otmpy = outx * (-1)
        
        if self._sw.value():
            self._otmpsw = False
        else:
            self._otmpsw = True
    
    def joy_check(self, joy_dir):
        self._joy_read()
        if (joy_dir == 1) and (self._otmpy > 90):
            return True
        if (joy_dir == 2) and (self._otmpx > 90):
            return True
        if (joy_dir == 3) and (self._otmpy < (-90)):
            return True
        if (joy_dir == 4) and (self._otmpx < (-90)):
            return True
        if (joy_dir == 5) and (self._otmpsw):
            return True
        return False

    def get_joyX(self):
        self._joy_read()
        return self._otmpx
    
    def get_joyY(self):
        self._joy_read()
        return self._otmpy

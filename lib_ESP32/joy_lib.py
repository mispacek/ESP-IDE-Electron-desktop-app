from machine import ADC
from machine import Pin

class joystick(object) :
    def __init__( self, adx, ady, pin_sw, rot = 0 ) :
        self._vrx=ADC(Pin(adx))
        self._vrx.atten(ADC.ATTN_11DB)
        self._vrx.width(ADC.WIDTH_10BIT)
        self._vry=ADC(Pin(ady))
        self._vry.atten(ADC.ATTN_11DB)
        self._vry.width(ADC.WIDTH_10BIT)
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
        self._tmpx = self._vrx.read()
        self._tmpy = self._vry.read()
        

        if (self._tmpx > 425) and (self._tmpx < 575):
            self._outx = 0;
        elif self._tmpx > 575:
            self._outx = self._joy_convert_int(self._tmpx, 575, 950, 0, 100, 1)
        elif self._tmpx < 425:
            self._outx = self._joy_convert_int(self._tmpx, 80, 425, -100, 0, 1)
        else: 
            self._outx = 0
        
        
        if (self._tmpy > 425) and (self._tmpy < 575):
            self._outy = 0;
        elif self._tmpy > 575:
            self._outy = self._joy_convert_int(self._tmpy, 575, 950, 0, 100, 1)
        elif self._tmpy < 425:
            self._outy = self._joy_convert_int(self._tmpy, 80, 425, -100, 0, 1)
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

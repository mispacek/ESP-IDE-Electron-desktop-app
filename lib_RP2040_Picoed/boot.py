# ==================================
#  ESP IDE v1.13
#  Soubor: boot.py
#  Platforma: Raspberry Pi Pico:ED
#  Autor : Milan Spacek 
# ==================================

import gc
import os
import time

from display import *
import framebuf, machine

i2c = machine.I2C(0, sda=machine.Pin(0), scl=machine.Pin(1), freq=400_000)

W, H = 128, 64
buf  = bytearray((H // 8) * W)
fbuf = framebuf.FrameBuffer(buf, W, H, framebuf.MONO_VLSB)

display = LEDMatrix17x7(i2c, fbuf, x_off=0, y_off=0, bright=60)

fbuf.fill(0)
#fbuf.text("OK", 0, 0, 1)
display.show()


def reset():
    from machine import reset
    reset()

def df():
  s = os.statvfs('//')
  return ('{0} MB'.format((s[0]*s[3])/1048576))

def free(full=False):
  gc.collect()
  F = gc.mem_free()
  A = gc.mem_alloc()
  T = F+A
  P = '{0:.2f}%'.format(F/T*100)
  if not full: return P
  else : return ('Total: {0} Free: {1} ({2})'.format(T,F,P))

gc.collect()

def terminal_color(txt,col=33):
    return "\033[" + str(col) + "m" + str(txt) + "\033[m" 

def printBar(num1,num2,col):
    #if num1/num2 < 
    print("[",end="")
    print((("\033[" + str(col) + "m#\033[m")*num1),end="")
    print(" " * num2,end="") 
    print("]  ",end="")

# Zobrazeni informaci o zarizeni v terminalu
def info():
    gc.collect()    
    bar100 = 30
    
    F = gc.mem_free()
    A = gc.mem_alloc()
    T = F+A
    P = A/T*100
    
    if P < 40:
        col = 32
    elif P < 60:
        col = 33
    else:
        col = 31
    
    b1 = T / bar100
    print("Obsazena  RAM : ", end="")
    printBar(int(A / b1), bar100 - int(A / b1),col)
    print(terminal_color('{0:.1f}%'.format(P) + '   =   {0:.1f}kB z '.format(A / 1000) + '{0:.1f}kB'.format(T / 1000),col))

    s = os.statvfs('//')
    flash100 = (s[0]*s[2])/1048576
    flash = (s[0]*s[3])/1048576
    P = (flash100-flash)/flash100*100
    
    if P < 40:
        col = 32
    elif P < 60:
        col = 33
    else:
        col = 31
    
    b1 = flash100 / bar100
    print("Obsazena Flash: ", end="")
    printBar(int((flash100-flash) / b1), bar100 - int((flash100-flash) / b1),col)
    print(terminal_color('{0:.1f}%'.format(P) + '   =   {0:.3f}MB z '.format((flash100-flash)) + '{0:.3f}MB'.format(flash100),col)) 


# This file is executed on every boot (including wake-boot from deepsleep)
import gc
import os
import time


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



def stop_code():
    try:
        on_exit()
    except:
        time.sleep_ms(0)

def run_code():
    try:
        gc.collect()
        exec(open("idecode").read())
    except KeyboardInterrupt:
        print('Zastaveni programu')
        gc.collect()
        stop_code()

# Autostart programu
try:
    start_data = open("idecode").read(16)
    if "#autostart*" in start_data:
        print("Autostart programu za 3s")
        time.sleep(3)
        print("Startuji...")
        run_code()
except:
    time.sleep_ms(0)

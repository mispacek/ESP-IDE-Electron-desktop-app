# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘
# This file is executed on every boot (including wake-boot from deepsleep)
import gc
import os
import sys
import time
import utime
from micropython import alloc_emergency_exception_buf

# Buffer pro kriticke chyby programu
alloc_emergency_exception_buf(128)

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


_ERR_HINTS = {
    'SyntaxError': 'Chyba syntaxe. (zavorky, dvojtecky ,uvozovky)',
    'IndentationError': 'Spatne odsazeni (mezery/taby)',
    'NameError': 'Pouzita nedefinovana promenna nebo funkce',
    'TypeError': 'Spatny typ nebo pocet argumentu',
    'ValueError': 'Spatny format nebo rozsah hodnoty',
    'IndexError': 'Index je mimo seznam',
    'KeyError': 'Klic ve slovniku neexistuje',
    'AttributeError': 'Objekt nema vlastnost/metodu',
    'ZeroDivisionError': 'Deleni nulou',
    'ImportError': 'Chyba importu knihovny',
    'OSError': 'Problem se souborem nebo zarizenim (I2C/SPI/FS)',
    'MemoryError': 'Nedostatek RAM. Optimalizuj!',
}

def _print_user_error(e):
    try:
        etype = e.__class__.__name__
    except Exception:
        etype = 'Chyba'
    try:
        msg = str(e)
    except Exception:
        msg = ''
    if msg:
        head = 'CHYBA v programu (%s): %s' % (etype, msg)
    else:
        head = 'CHYBA v programu (%s)' % etype
    try:
        print(terminal_color(head, 31))
    except Exception:
        print(head)
    hint = _ERR_HINTS.get(etype)
    if hint:
        try:
            print(terminal_color('Tip: ' + hint, 33))
        except Exception:
            print('Tip: ' + hint)
    if etype == 'OSError':
        try:
            if e.args and e.args[0] == 2:
                msg2 = "Soubor nenalezen (zkontroluj 'idecode' a cesty)."
                try:
                    print(terminal_color('Tip: ' + msg2, 33))
                except Exception:
                    print('Tip: ' + msg2)
        except Exception:
            pass
    try:
        sys.print_exception(e)
    except Exception:
        pass



# Funkce ESP IDE pri zastaveni programu
def stop_code():
    try:
        on_exit()
    except:
        time.sleep_ms(0)


# Funkce ESP IDE pro spusteni programu (paměťově úspornější)
def run_code():
    G = globals()  # lokální reference = méně lookupů
    try:
        gc.collect()
        with open("idecode", "r") as f:
            src = f.read()   
        code = compile(src, "idecode", "exec")
        del src
        gc.collect()
        exec(code, G)
        del code
        gc.collect()
    except KeyboardInterrupt:
        print('Zastaveni programu')
        gc.collect()
        stop_code()

    except MemoryError:
        gc.collect()
        try:
            print(terminal_color("CHYBA: Nedostatek RAM.", 31))
        except Exception:
            print("CHYBA: Nedostatek RAM.")

    except Exception as e:
        gc.collect()
        _print_user_error(e)

gc.collect()



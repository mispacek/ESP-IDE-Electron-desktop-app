# ==================================
#  ESP IDE v1.13
#  Soubor: main.py
#  Platforma: Raspberry Pi Pico:ED
#  Autor : Milan Spacek 
# ==================================

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
        print("Autostart programu za 1s")
        time.sleep(1)
        run_code()
except:
    time.sleep_ms(0) 
# ┌────────────────────────────────────────────┐
# │ ESP IDE  : FREE MicroPython WEB IDE        │
# │ AUTHOR   : Milan Spacek (2019–2026)        │
# │ WEB      : https://espide.eu               │
# │ LICENSE  : AGPL-3.0                        │
# │                                            │
# │ CODE IS OPEN — IMPROVEMENTS MUST STAY OPEN │
# │ Please contribute your improvements back   │
# └────────────────────────────────────────────┘

import time


# Autostart programu
def autostart():
    try:
        os.stat('idecode')
    except OSError:
        return

    try:
        with open('idecode', 'r') as f:
            start_data = f.read(16)
        if "#autostart*" in start_data:
            print("Autostart programu za 2s")
            time.sleep(2)
            print("Startuji...")
            try:
                run_code()
            except Exception as e:
                print("Chyba při běhu programu:")
                sys.print_exception(e)
    except Exception as e:
        print("Chyba při čtení souboru 'idecode':")
        sys.print_exception(e)

print("ESP IDE Simulator v0.3")

#autostart()



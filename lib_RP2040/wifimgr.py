import network
import time
from machine import unique_id
from ubinascii import hexlify

ap_ssid = "AP"
ap_password = ""
ap_authmode = 0
# 0=open, 1=WEP, 2=WPA-PSK, 3=WPA2-PSK, 4=WPA/WPA2-PSK


NETWORK_PROFILES = 'wifi.cfg'

wlan_ap = network.WLAN(network.AP_IF)
wlan_sta = network.WLAN(network.STA_IF)


def getHostname():
    try:
        hostname = open("hostname.cfg").read()
        hostname = hostname.replace('\r', '')
        hostname = hostname.replace('\n', '')
        hostname = hostname.replace(' ', '')
        #print("Hostname : " + hostname)
        time.sleep_ms(0)
        return hostname
    except:
        time.sleep_ms(0)
        return ap_ssid + "-" + str(getUid())

def getUid(): # full or short (5 chars: first 2 + last 3)
    id = hexlify(unique_id()).decode().upper()[4:12]
    return id

def get_connection():
    # Return a working WLAN(STA_IF) instance or None
    # First check if there already is any connection:
    if wlan_sta.isconnected():
        return wlan_sta

    #wlan_sta.disconnect()
    connected = False
    try:
        # ESP connecting to WiFi takes time, wait a bit and try again:
        time.sleep(3)
        if wlan_sta.isconnected():
            return wlan_sta

        # Read known network profiles from file
        profiles = read_profiles()

        # Search WiFis in range
        wlan_sta.active(True)
        networks = wlan_sta.scan()

        AUTHMODE = {0: "open", 1: "WEP", 2: "WPA-PSK", 3: "WPA2-PSK", 4: "WPA/WPA2-PSK"}
        for ssid, bssid, channel, rssi, authmode, hidden in sorted(networks, key=lambda x: x[3], reverse=True):
            #ssid = ssid.decode('utf-8')
            encrypted = authmode > 0
            print("ssid: %s chan: %d rssi: %d authmode: %s" % (ssid.decode('utf-8'), channel, rssi, AUTHMODE.get(authmode, '?')))
            #print("test_ssid:" , ssid)
            if encrypted:
                if ssid in profiles:
                    password = profiles[ssid]
                    connected = do_connect(ssid, password)
                else:
                    print("Preskakuji WiFi ktera neni v seznamu")
            #else:  # open
            #    connected = do_connect(ssid, None)
            if connected:
                break

    except Exception as e:
        print("exception", str(e))

    # start web server for connection manager:
    if not connected:
        connected = start_AP()

    return wlan_sta if connected else None


def read_profiles():
    profiles = {}
    try:
        with open(NETWORK_PROFILES) as f:
            lines = f.read()
            lines = lines.replace('\r\n', '\n')
            lines = lines.replace('\r', '\n')
            lines = lines.split("\n")

            for line in lines:
                try:
                    ssid, password = line.replace('\r', '').replace('\n', '').split(";")
                    ssid = ssid.encode("utf-8")
                    password = password.encode("utf-8")
                    profiles[ssid] = password
                except:
                    time.sleep(0)
    except:
        print("Nastaveni WiFi nenalezeno")
   
    return profiles


def add_profile(ssid,password):
    profiles = {}
    profiles[ssid] = password
    write_profiles(profiles)


def write_profiles(new_profiles):
    lines = []
    try:
        profiles = read_profiles()
        for ssid, password in profiles.items():
            lines.append("%s;%s\r" % (ssid, password))
    except:
        print("Zadne predchozi nastaveni Wifi nenalezeno")

    for ssid, password in new_profiles.items():
        lines.append("%s;%s\r" % (ssid, password))
    with open(NETWORK_PROFILES, "w") as f:
        f.write(''.join(lines))


def do_connect(ssid, password):
    time.sleep_us(100)
    wlan_sta.active(True)
    time.sleep_us(100)
    wlan_sta.config(dhcp_hostname=getHostname())
    time.sleep_us(100)
    print("Hostname:" + getHostname())
    if wlan_sta.isconnected():
        return None
    print('Pripojuji se k Wifi %s...' % ssid.decode('utf-8'), end='')
    wlan_sta.connect(ssid, password)
    for retry in range(100):
        connected = wlan_sta.isconnected()
        if connected:
            break
        time.sleep(0.1)
        print('.', end='')
    if connected:
        try:
            #wlan_sta.config(ps_mode=network.WIFI_PS_NONE)
            wlan_sta.config(pm=wlan_sta.PM_NONE)
        except:
            print('\nNepodarilo se vypnout usporny rezim WiFi')
        print('\nPripojeno !\nNastaveni site: ', wlan_sta.ifconfig())
    else:
        print('\nChyba !\nNepodarilo se pripojit k : ' + ssid)
    return connected


def start_AP():
    time.sleep_us(100)
    wlan_sta.active(True)
    time.sleep_us(100)
    wlan_ap.active(True)
    time.sleep_us(100)
    wlan_ap.config(essid=getHostname(), password=ap_password, authmode=ap_authmode, dhcp_hostname=getHostname())
    print("Hostname:" + getHostname())
    time.sleep_us(100)
    try:
        #wlan_ap.config(ps_mode=network.WIFI_PS_NONE)
        wlan_ap.config(pm=wlan_ap.PM_NONE)
    except:
        print('\nNepodarilo se vypnout usporny rezim WiFi')
    print('WiFi AP ssid ' + getHostname())
    print('AP vytvoreno.\nMuzete se pripojit k ESP na adrese 192.168.4.1 nebo pomoci hostname:' + getHostname())
    print('Vytvorte soubor wifi.cfg s nastavenim wifi ve formatu SSID;Heslo')

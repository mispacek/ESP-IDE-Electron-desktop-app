"""NTP compatibility backed by the host computer clock."""

import time
from machine import RTC

host = 'pool.ntp.org'
timeout = 1


def settime():
    current = time.gmtime()
    RTC().datetime((
        current[0], current[1], current[2], current[6],
        current[3], current[4], current[5], 0,
    ))
    return None

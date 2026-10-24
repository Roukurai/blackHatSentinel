#!/usr/bin/env python3
# Generates journalctl -o json style fixtures for collector tests.
# DOCUMENTATION IPs only (RFC5737). No real data ever committed.
import json, datetime
base = datetime.datetime(2026,10,24,15,51,15, tzinfo=datetime.timezone.utc)
HOST = "ubuntu-01"
out, seq = [], 0
def ev(dt, msg, ident="sshd"):
    global seq; seq += 1
    us = int(dt.timestamp()*1_000_000)
    return {"__CURSOR": f"s=abc;i={seq:x};b=1;m={us:x};t={us:x};x={seq:x}",
            "__REALTIME_TIMESTAMP": str(us), "_HOSTNAME": HOST,
            "SYSLOG_IDENTIFIER": ident, "_SYSTEMD_UNIT": "ssh.service", "MESSAGE": msg}
t = base
for i in range(8): out.append(ev(t, f"Invalid user user from 192.0.2.50 port {21000+i}")); t+=datetime.timedelta(seconds=1)
for i in range(6): out.append(ev(t, f"Invalid user admin from 192.0.2.50 port {22000+i}")); t+=datetime.timedelta(seconds=1)
out.append(ev(t, "Invalid user  from 192.0.2.50 port 23000")); t+=datetime.timedelta(seconds=2)          # empty username
out.append(ev(t, "Connection closed by authenticating user root 198.51.100.7 port 40001 [preauth]")); t+=datetime.timedelta(seconds=1)
out.append(ev(t, "Connection closed by 198.51.100.7 port 40002")); t+=datetime.timedelta(seconds=1)       # probe -> skip
out.append(ev(t, "Server listening on 0.0.0.0 port 22."))                                                 # noise -> skip
t2 = base + datetime.timedelta(minutes=5)
for u in ["sol","solana","eth","ethereum","validator","polygon","tron","node","bot","trader"]:
    out.append(ev(t2, f"Invalid user {u} from 203.0.113.9 port 30000")); t2+=datetime.timedelta(minutes=2)
t3 = base + datetime.timedelta(minutes=40)
for i in range(6): out.append(ev(t3, f"Failed password for demo from 203.0.113.77 port {50000+i} ssh2")); t3+=datetime.timedelta(seconds=4)
out.append(ev(t3, "Accepted password for demo from 203.0.113.77 port 50010 ssh2")); t3+=datetime.timedelta(seconds=2)
out.append(ev(t3, "Accepted publickey for rou from 203.0.113.200 port 59999 ssh2: ED25519 SHA256:EXAMPLEFINGERPRINTvalueForTestsOnly000000000"))
import sys
with open(sys.argv[1] if len(sys.argv)>1 else "fixtures.jsonl","w") as f:
    for o in out: f.write(json.dumps(o)+"\n")
print(f"wrote {len(out)} events")

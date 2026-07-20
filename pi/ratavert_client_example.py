#!/usr/bin/env python3
"""
RatAvert — example Raspberry Pi client.

This is a REFERENCE implementation showing exactly how the Pi should talk to
the backend per the data contract in the build brief. Wire your real camera
capture, YOLOv8 inference, and GPIO trigger code in where marked below.

Install on the Pi:
    pip3 install requests

Run:
    DEVICE_KEY=<paste from backend .env>  BACKEND_URL=http://<backend-host>:4000 python3 ratavert_client_example.py

What this script does, matching backend/server.js:
  - Sends a heartbeat every 5s to POST /api/pi/heartbeat
  - Polls GET /api/pi/commands every 2s for trigger commands queued by the
    dashboard (manual test-fires), executes them, then acks via POST /api/pi/ack
  - Runs your detection loop; when YOLOv8 confirms a rat, uploads the photo to
    POST /api/pi/photos and then reports the detection to POST /api/pi/detections
"""

from __future__ import annotations

import os
import time
import threading
import requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:4000")
DEVICE_KEY = os.environ["DEVICE_KEY"]  # required — copy from backend/.env
HEADERS = {"x-device-key": DEVICE_KEY}

ARMED = {"lights": True, "audio": True, "pepper": True, "last": True}
DETECTION_INTERVAL_SECONDS = 20  # overwritten by /api/settings if you poll it


# ── GPIO trigger stubs — replace with your real relay/servo/sprayer code ────
def fire_trigger(trigger_type: str, duration: float) -> bool:
    """Actuate the physical hardware for `trigger_type`. Return True on success."""
    print(f"[HARDWARE] firing {trigger_type} for {duration}s")
    # e.g. GPIO.output(PIN_MAP[trigger_type], GPIO.HIGH); time.sleep(duration); GPIO.output(..., GPIO.LOW)
    time.sleep(min(duration, 0.2))  # placeholder
    return True


def capture_photo_path() -> str | None:
    """Capture a still from the camera and return a local file path, or None."""
    # e.g. picam2.capture_file("/tmp/capture.jpg"); return "/tmp/capture.jpg"
    return None


def run_yolo_detection() -> dict | None:
    """Run one YOLOv8 inference pass. Return a detection dict if a rat is
    confirmed above your confidence threshold, else None.
    Expected shape: {"confidence": 0.91}
    """
    # e.g. results = model.predict(frame); if rat found: return {"confidence": conf}
    return None


# ── Heartbeat loop ───────────────────────────────────────────────────────────
def get_local_ip() -> str:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "0.0.0.0"
    finally:
        s.close()


def heartbeat_loop():
    while True:
        try:
            requests.post(
                f"{BACKEND_URL}/api/pi/heartbeat",
                headers=HEADERS,
                json={"online": True, "ip": get_local_ip(), "armed": ARMED},
                timeout=5,
            )
        except requests.RequestException as e:
            print(f"[heartbeat] failed: {e}")
        time.sleep(5)


# ── Command polling loop — receives manual test-fires from the dashboard ───
def commands_loop():
    while True:
        try:
            resp = requests.get(f"{BACKEND_URL}/api/pi/commands", headers=HEADERS, timeout=5)
            for cmd in resp.json():
                ok = fire_trigger(cmd["type"], cmd.get("duration", 2))
                requests.post(
                    f"{BACKEND_URL}/api/pi/ack",
                    headers=HEADERS,
                    json={
                        "command_id": cmd["id"],
                        "type": cmd["type"],
                        "status": "ok" if ok else "fail",
                        "fired_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    },
                    timeout=5,
                )
        except requests.RequestException as e:
            print(f"[commands] failed: {e}")
        time.sleep(2)


# ── Detection loop — the actual YOLOv8 + auto-response sequence ────────────
def upload_photo(local_path: str) -> str | None:
    if not local_path or not os.path.exists(local_path):
        return None
    with open(local_path, "rb") as f:
        resp = requests.post(
            f"{BACKEND_URL}/api/pi/photos",
            headers=HEADERS,
            files={"photo": ("capture.jpg", f, "image/jpeg")},
            timeout=15,
        )
    resp.raise_for_status()
    return resp.json()["photo_url"]


def detection_loop():
    auto_sequence = ["lights", "audio", "pepper"]
    while True:
        time.sleep(DETECTION_INTERVAL_SECONDS)
        detection = run_yolo_detection()
        if not detection:
            continue

        confidence = detection["confidence"]
        photo_path = capture_photo_path()
        photo_url = upload_photo(photo_path)

        actions_fired = []
        for trigger_type in auto_sequence:
            if not ARMED.get(trigger_type):
                continue
            if fire_trigger(trigger_type, 2):
                actions_fired.append(trigger_type)
            time.sleep(3)  # matches the dashboard's 3s-apart sequence display

        escalate = ARMED.get("last") and confidence > 0.85  # your own escalation rule
        if escalate:
            fire_trigger("last", 2)

        try:
            requests.post(
                f"{BACKEND_URL}/api/pi/detections",
                headers=HEADERS,
                json={
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "confidence": confidence,
                    "photo_url": photo_url,
                    "actions_fired": actions_fired,
                    "escalated_to_last_resort": bool(escalate),
                },
                timeout=5,
            )
        except requests.RequestException as e:
            print(f"[detection] report failed: {e}")


if __name__ == "__main__":
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=commands_loop, daemon=True).start()
    print("RatAvert Pi client running. Ctrl+C to stop.")
    detection_loop()

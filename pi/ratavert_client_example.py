#!/usr/bin/env python3
"""
RatAvert — Raspberry Pi client (real YOLOv8n NCNN detection).

Wired up for: a custom-trained YOLOv8n model, exported to NCNN format,
running on a Raspberry Pi 3B+ (or better).

WHAT THIS SCRIPT DOES:
  - Captures a frame from the camera on a timer
  - Runs your NCNN model on it to check for a rat
  - On detection: fires the lights/audio/pepper sequence (+ last resort if
    still detected after N seconds), uploads the photo, reports the
    detection to the backend
  - Sends a heartbeat every 5s so the dashboard knows it's online
  - Polls for manual test-fire commands from the dashboard every 2s

═══════════════════════════════════ SETUP ═══════════════════════════════════

1. Raspberry Pi OS must be the 64-BIT version (Bookworm or later). The
   32-bit ("armhf") image cannot install PyTorch/Ultralytics — this is the
   single most common setup mistake. Check with:
       getconf LONG_BIT      # must print 64, not 32

2. Copy your exported NCNN model folder onto the Pi (the folder produced by
   `model.export(format="ncnn")`, usually named something like
   "best_ncnn_model" — it contains a .param and .bin file inside).
   Put it at:  ~/ratavert-pi/model/   (or set MODEL_PATH below to wherever
   you put it)

3. Install dependencies (see requirements.txt in this same folder):
       pip3 install --break-system-packages -r requirements.txt
   This will take a while — ultralytics pulls in PyTorch, which is a large
   download and slow to install on a Pi 3B+. Budget 20-40 minutes.
   If you hit a memory error during install, add swap first:
       sudo dphys-swapfile swapoff
       sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
       sudo dphys-swapfile setup && sudo dphys-swapfile swapon

4. Set these environment variables (the install.sh / systemd service already
   handles DEVICE_KEY and BACKEND_URL — add these two alongside them in
   ~/ratavert-pi/.env):
       MODEL_PATH=/home/pi/ratavert-pi/model/best_ncnn_model
       RAT_CLASS_NAME=rat          # must match your model's class name exactly
       CONFIDENCE_THRESHOLD=0.6    # 0.0-1.0, tune based on your model
       DETECTION_INTERVAL_SECONDS=10   # realistic for a Pi 3B+, see note below

⚠️ PERFORMANCE ON A PI 3B+: this hardware is significantly slower than a Pi
4/5. A single YOLOv8n NCNN inference typically takes several seconds here
(vs. well under 1s on a Pi 4/5), and importing ultralytics itself can take
30-60s on first run. This script is built for periodic checks, not live
video — DETECTION_INTERVAL_SECONDS of 5-15s is realistic. If you need faster
response, a Pi 4 (or better) is the practical upgrade path; the code here
doesn't need to change either way.

═══════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import os
import time
import threading
import requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:4000")
DEVICE_KEY = os.environ["DEVICE_KEY"]  # required — copy from backend/.env or Railway Variables
HEADERS = {"x-device-key": DEVICE_KEY}

MODEL_PATH = os.environ.get("MODEL_PATH", "./model/best_ncnn_model")
RAT_CLASS_NAME = os.environ.get("RAT_CLASS_NAME", "rat")
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.6"))
DETECTION_INTERVAL_SECONDS = int(os.environ.get("DETECTION_INTERVAL_SECONDS", "10"))
CAMERA_BACKEND = os.environ.get("CAMERA_BACKEND", "picamera2")  # "picamera2" or "usb"
CAPTURE_PATH = "/tmp/ratavert_capture.jpg"

ARMED = {"lights": True, "audio": True, "pepper": True, "last": True}

# GPIO pin mapping — matches the wiring reference shown in the dashboard's
# Settings → Device tab. Adjust to your actual wiring.
# "last" (the snap trap) is deliberately excluded here — it's a servo that
# needs an angle, not just on/off power, so it's handled separately below.
GPIO_PINS = {"lights": 17, "audio": 27, "pepper": 22}
SERVO_PIN = 18

_model = None            # lazy-loaded YOLO model (loading it is slow — do it once)
_camera = None           # lazy-initialized camera handle
_gpio_devices = {}       # lazy-initialized gpiozero output devices (relays)
_trap_servo = None       # lazy-initialized gpiozero Servo (snap trap)


# ── Camera ───────────────────────────────────────────────────────────────────
def _get_camera():
    global _camera
    if _camera is not None:
        return _camera
    if CAMERA_BACKEND == "picamera2":
        from picamera2 import Picamera2
        cam = Picamera2()
        cam.configure(cam.create_still_configuration(main={"size": (640, 640)}))
        cam.start()
        time.sleep(1)  # let auto-exposure settle
        _camera = cam
    else:
        import cv2
        cam = cv2.VideoCapture(0)
        if not cam.isOpened():
            raise RuntimeError("Could not open USB camera at index 0")
        _camera = cam
    return _camera


def capture_photo_path() -> str | None:
    """Capture a still from the camera and return a local file path."""
    cam = _get_camera()
    try:
        if CAMERA_BACKEND == "picamera2":
            cam.capture_file(CAPTURE_PATH)
        else:
            import cv2
            ok, frame = cam.read()
            if not ok:
                return None
            cv2.imwrite(CAPTURE_PATH, frame)
        return CAPTURE_PATH
    except Exception as e:
        print(f"[camera] capture failed: {e}")
        return None


# ── GPIO triggers ────────────────────────────────────────────────────────────
def _get_trap_servo():
    global _trap_servo
    if _trap_servo is None:
        from gpiozero import Servo
        _trap_servo = Servo(SERVO_PIN)
    return _trap_servo


def _fire_trap(duration: float) -> bool:
    """Swing the SG90 to trigger the snap trap, then return to neutral.
    Uses gpiozero.Servo (PWM angle control) rather than a plain on/off
    relay, since the trap needs to physically move, not just get power.
    """
    try:
        servo = _get_trap_servo()
        print(f"[HARDWARE] firing snap trap servo on GPIO{SERVO_PIN}")
        servo.min()          # swing to trigger position — tune min()/max()
        time.sleep(min(duration, 1.0))   # servos don't need long dwell time
        servo.mid()          # return to neutral/rest position
        time.sleep(0.3)      # let it settle before detaching
        servo.detach()       # stop sending PWM so it doesn't jitter/buzz while idle
        return True
    except Exception as e:
        print(f"[HARDWARE] snap trap servo failed: {e}")
        return False


def fire_trigger(trigger_type: str, duration: float) -> bool:
    """Actuate the physical hardware for `trigger_type`. Return True on success."""
    if trigger_type == "last":
        return _fire_trap(duration)

    pin = GPIO_PINS.get(trigger_type)
    if pin is None:
        print(f"[HARDWARE] no GPIO pin configured for '{trigger_type}'")
        return False
    try:
        from gpiozero import OutputDevice
        if trigger_type not in _gpio_devices:
            _gpio_devices[trigger_type] = OutputDevice(pin)
        dev = _gpio_devices[trigger_type]

        if trigger_type == "lights":
            # LED strobe: flash rather than hold steady, per the spec's
            # "intermittent flashing light patterns" — a solid-on relay
            # doesn't create the disruptive strobe effect.
            print(f"[HARDWARE] strobing {trigger_type} on GPIO{pin} for {duration}s")
            end_time = time.monotonic() + duration
            flash_on_seconds = 0.1
            flash_off_seconds = 0.1
            while time.monotonic() < end_time:
                dev.on()
                time.sleep(flash_on_seconds)
                dev.off()
                time.sleep(flash_off_seconds)
        else:
            print(f"[HARDWARE] firing {trigger_type} on GPIO{pin} for {duration}s")
            dev.on()
            time.sleep(duration)
            dev.off()
        return True
    except Exception as e:
        print(f"[HARDWARE] {trigger_type} failed: {e}")
        return False


# ── YOLOv8n NCNN detection ───────────────────────────────────────────────────
def _get_model():
    global _model
    if _model is not None:
        return _model
    print(f"[model] loading NCNN model from {MODEL_PATH} (this can take a while on a Pi 3B+)...")
    from ultralytics import YOLO
    _model = YOLO(MODEL_PATH, task="detect")
    print("[model] loaded.")
    return _model


def run_yolo_detection() -> dict | None:
    """Capture a frame and run one YOLOv8n NCNN inference pass. Returns
    {"confidence": conf} if a rat is confirmed above threshold, else None.
    """
    photo_path = capture_photo_path()
    if not photo_path:
        return None

    model = _get_model()
    results = model.predict(photo_path, verbose=False, conf=CONFIDENCE_THRESHOLD)
    if not results:
        return None

    result = results[0]
    best_conf = None
    for box in result.boxes:
        cls_id = int(box.cls[0])
        cls_name = result.names.get(cls_id, str(cls_id))
        conf = float(box.conf[0])
        if cls_name == RAT_CLASS_NAME and conf >= CONFIDENCE_THRESHOLD:
            if best_conf is None or conf > best_conf:
                best_conf = conf

    if best_conf is None:
        return None
    return {"confidence": best_conf, "photo_path": photo_path}


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
                if cmd["type"] == "pi_camera_test":
                    # Not a hardware trigger — just grab a frame and report it back.
                    photo_path = capture_photo_path()
                    photo_url = upload_photo(photo_path) if photo_path else None
                    requests.post(
                        f"{BACKEND_URL}/api/pi/ack",
                        headers=HEADERS,
                        json={
                            "command_id": cmd["id"],
                            "type": "pi_camera_test",
                            "status": "ok" if photo_url else "fail",
                            "photo_url": photo_url,
                            "fired_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        },
                        timeout=15,
                    )
                    continue

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

    if not os.path.isdir(MODEL_PATH):
        print(f"[detection] MODEL_PATH '{MODEL_PATH}' not found — detection is "
              f"disabled for now (this is expected before running setup_model.sh). "
              f"Heartbeat and manual test-fire commands still work normally.")
        while True:
            time.sleep(60)  # idle — nothing to do until a model is configured

    print(f"[detection] checking every {DETECTION_INTERVAL_SECONDS}s, "
          f"confidence threshold {CONFIDENCE_THRESHOLD}, class '{RAT_CLASS_NAME}'")
    # Load the model once, up front, so the first real detection isn't
    # delayed by a slow cold-start load. If this fails, log it clearly and
    # keep the process alive (heartbeat/commands) instead of crash-looping.
    try:
        _get_model()
    except Exception as e:
        print(f"[detection] FAILED to load model: {e}")
        print(f"[detection] detection is disabled until this is fixed — "
              f"heartbeat and manual test-fire commands still work normally.")
        while True:
            time.sleep(60)

    while True:
        time.sleep(DETECTION_INTERVAL_SECONDS)
        try:
            detection = run_yolo_detection()
        except Exception as e:
            print(f"[detection] inference failed: {e}")
            continue
        if not detection:
            continue

        confidence = detection["confidence"]
        print(f"[detection] RAT CONFIRMED — confidence {confidence:.2f}")
        photo_url = upload_photo(detection.get("photo_path"))

        actions_fired = []
        for trigger_type in auto_sequence:
            if not ARMED.get(trigger_type):
                continue
            if fire_trigger(trigger_type, 2):
                actions_fired.append(trigger_type)
            time.sleep(3)  # matches the dashboard's 3s-apart sequence display

        escalate = ARMED.get("last") and confidence > 0.85  # tune your own escalation rule
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

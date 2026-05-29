# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vinya** is a MicroPython firmware project for a smart vineyard tarp automation system running on Raspberry Pi Pico W/W2. It controls an automated tarp deployment mechanism based on weather conditions and remote commands.

## Development Workflow

This is embedded firmware — there are no build scripts, package managers, or test runners.

**Upload firmware to Pico:**
- Use Thonny IDE (recommended) or `ampy` CLI to transfer `.py` files to the Pico
- The Pico executes `main.py` on boot; rename the active firmware file accordingly

**Library management via Fasapico:**
- Run `Fasapico.py` once on the Pico to auto-download the `fasapico` library from GitHub
- External libs needed: `fasapico` (WiFi helper), `mqtt` (MQTT client)
- Built-in MicroPython libs used: `machine`, `dht`, `urequests`, `ujson`, `network`

**Debugging:**
- Monitor serial output via Thonny's shell or any serial terminal at the Pico's USB port
- Use `test mqtt.py` to verify MQTT broker connectivity independently

## Architecture

### Files in `Code Pico/`

| File | Purpose |
|---|---|
| `Auto+Manu_Bache_Mqtt.py` | **Primary production firmware** — full auto/manual modes + MQTT + DHT11 |
| `Code Firebase, MQTT.py` | Firebase + MQTT dual-stack variant |
| `Code Firebase V2.py` | Firebase-only + stepper motor control |
| `Code Firebase.py` | Firebase + simulated DHT11 sensor data |
| `Fasapico.py` | Library auto-downloader from GitHub |
| `test mqtt.py` | Minimal MQTT connectivity test |

### Hardware Pinout

| Component | Pins |
|---|---|
| Stepper motor (ULN2003 IN1–IN4) | GP0, GP1, GP2, GP3 |
| DHT11 sensor | GP15 |
| Mode toggle button | GP20 |
| Status LED | GP27 |

### Stepper Motor

Uses an 8-step half-step sequence. Direction is controlled by stepping through the sequence forward or in reverse. The motor is de-energized when idle to prevent heat buildup.

### Operation Modes

**AUTO mode** — sensor-driven with hysteresis:
- Deploys tarp when temperature < 17 °C or > 23 °C, or humidity > 80 %
- Retracts when conditions return to normal range
- DHT11 readings published to MQTT

**MANU mode** — MQTT-controlled:
- Listens on topic `bzh/mecatro/dashboard/vinya/ordre`
- Commands: `"ouvrir"` (deploy) / `"fermer"` (retract)

Button on GP20 toggles between modes; GP27 LED reflects current mode.

### Communication Layers

**Firebase REST API** (`vinya-6264b` project, `europe-west1`):
- `/stationMeteo.json` — sensor telemetry (PUT)
- `/tarpCommand.json` — motor commands (GET/polling)

**MQTT** (`mqtt.dev.icam.school:1883`):
- Base topic: `bzh/mecatro/dashboard/vinya`
- Sub-topics: `/temperature`, `/humidite`, `/ordre`, `/mode`, `/test`

Both transports can coexist in the same firmware build.

### Credentials

WiFi credentials and Firebase/MQTT endpoints are currently hardcoded in each firmware file. The `Fasapico.py` downloader also supports a `secrets.py` file on the Pico for keeping credentials off source files — prefer that pattern for new work.

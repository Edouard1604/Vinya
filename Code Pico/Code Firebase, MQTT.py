# =============================================================================
# Vinya — Firmware Raspberry Pi Pico W
# Firebase + MQTT + Moteur DC (contrôleur de vitesse PWM)
# =============================================================================
#
# Brochage :
#   GP0–GP3   → Moteur pas-à-pas (non utilisé dans ce fichier, conservé)
#   GP14      → Signal PWM → contrôleur de vitesse moteur DC
#   VSYS      → Alimentation contrôleur moteur (via la carte)
#   GP26/ADC0 → Potentiomètre de vitesse (0–3.3V → duty 30–100%)
#   GP15      → DHT11 (température / humidité)
#   GP20      → Bouton mode (Manuel / Auto)
#   GP27      → LED status
#
# Flux de commande :
#   Application web  →  Firebase /tarpCommand.json  →  Pico
#   Application web  →  MQTT topic /ordre           →  Pico
#   "DEPLOY" / "ouvrir"  → moteur_deployer()
#   "RETRACT" / "fermer" → moteur_arreter()
# =============================================================================

import network
import time
import urequests
import ujson
from machine import Pin, PWM, ADC
import dht

# ── Credentials WiFi ──────────────────────────────────────────────────────────
SSID     = "TonSSID"
PASSWORD = "TonMotDePasse"

# ── Firebase ──────────────────────────────────────────────────────────────────
FIREBASE_BASE = "https://vinya-6264b-default-rtdb.europe-west1.firebasedatabase.app"
METEO_URL     = FIREBASE_BASE + "/stationMeteo.json"
CMD_URL       = FIREBASE_BASE + "/tarpCommand.json"

# ── MQTT ──────────────────────────────────────────────────────────────────────
MQTT_BROKER = "mqtt.dev.icam.school"
MQTT_PORT   = 1883
MQTT_ROOT   = "bzh/mecatro/dashboard/vinya"
TOPIC_ORDRE = MQTT_ROOT + "/ordre"
TOPIC_MODE  = MQTT_ROOT + "/mode"
TOPIC_TEMP  = MQTT_ROOT + "/temperature"
TOPIC_HUM   = MQTT_ROOT + "/humidite"
TOPIC_ETAT  = MQTT_ROOT + "/etat"

# ── Pins ──────────────────────────────────────────────────────────────────────
MOTOR_PIN      = 14     # PWM → contrôleur de vitesse
POT_PIN        = 26     # ADC0 → potentiomètre
DHT_PIN        = 15     # DHT11
LED_PIN        = 27     # LED status
BTN_PIN        = 20     # Bouton mode

# ── Paramètres moteur ─────────────────────────────────────────────────────────
MOTOR_PWM_FREQ   = 10_000   # 10 kHz (adapté aux contrôleurs brushed)
MOTOR_MIN_DUTY   = 0.30     # 30 % minimum (évite le démarrage brutal)
MOTOR_RAMP_MS    = 1_500    # durée de la montée progressive (ms)
MOTOR_STOP_MS    = 800      # durée de la descente progressive (ms)

# ── Init hardware ─────────────────────────────────────────────────────────────
motor_pwm = PWM(Pin(MOTOR_PIN, Pin.OUT))
motor_pwm.freq(MOTOR_PWM_FREQ)
motor_pwm.duty_u16(0)        # moteur arrêté au démarrage

pot     = ADC(Pin(POT_PIN))
capteur = dht.DHT11(Pin(DHT_PIN))
led     = Pin(LED_PIN, Pin.OUT)
btn     = Pin(BTN_PIN, Pin.IN, Pin.PULL_UP)

# ── État global ───────────────────────────────────────────────────────────────
tarp_deploye = False
mode_auto    = False
temperature  = 0.0
humidite     = 0.0
mqtt_client  = None

# =============================================================================
# MOTEUR DC (PWM + Potentiomètre)
# =============================================================================

def lire_vitesse_pot() -> int:
    """
    Lit le potentiomètre (GP26/ADC0) et retourne le duty cycle PWM cible.
    Plage : 30 % min → 100 % max  (valeurs 0–65535 pour duty_u16).
    Le minimum à 30 % protège le contrôleur contre les tensions trop faibles.
    """
    raw    = pot.read_u16()                              # 0 → 65535
    min_d  = int(65535 * MOTOR_MIN_DUTY)                 # ~19660
    max_d  = 65535
    duty   = min_d + int((raw / 65535) * (max_d - min_d))
    return duty


def moteur_deployer():
    """
    Lance le moteur à la vitesse définie par le potentiomètre.
    Montée progressive sur MOTOR_RAMP_MS pour protéger la mécanique
    et éviter les pics de courant au démarrage.
    """
    global tarp_deploye

    cible = lire_vitesse_pot()
    steps = 60
    delai = MOTOR_RAMP_MS // steps   # ~25 ms par palier

    print("[MOTEUR] Démarrage progressif → duty cible = {} ({:.1f}%)".format(
        cible, cible / 65535 * 100))

    for i in range(steps + 1):
        duty = int((i / steps) * cible)
        motor_pwm.duty_u16(duty)
        time.sleep_ms(delai)

    tarp_deploye = True
    led.on()
    print("[MOTEUR] Bâche déployée — moteur en marche")


def moteur_arreter():
    """
    Coupe le moteur avec descente progressive sur MOTOR_STOP_MS.
    """
    global tarp_deploye

    actuel = motor_pwm.duty_u16()
    if actuel == 0:
        tarp_deploye = False
        led.off()
        return

    steps = 40
    delai = MOTOR_STOP_MS // steps   # ~20 ms par palier

    print("[MOTEUR] Arrêt progressif depuis duty = {}".format(actuel))

    for i in range(steps, -1, -1):
        duty = int((i / steps) * actuel)
        motor_pwm.duty_u16(duty)
        time.sleep_ms(delai)

    motor_pwm.duty_u16(0)
    tarp_deploye = False
    led.off()
    print("[MOTEUR] Arrêté")

# =============================================================================
# WiFi
# =============================================================================

def connecter_wifi() -> bool:
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected():
        return True
    print("[WiFi] Connexion à {} ...".format(SSID))
    wlan.connect(SSID, PASSWORD)
    for _ in range(20):
        if wlan.isconnected():
            print("[WiFi] Connecté — IP : {}".format(wlan.ifconfig()[0]))
            return True
        time.sleep(1)
    print("[WiFi] ÉCHEC connexion")
    return False

# =============================================================================
# DHT11
# =============================================================================

def lire_dht():
    global temperature, humidite
    try:
        capteur.measure()
        temperature = capteur.temperature()
        humidite    = capteur.humidity()
        print("[DHT11] T={}°C  H={}%".format(temperature, humidite))
    except Exception as e:
        print("[DHT11] Erreur : {}".format(e))

# =============================================================================
# Firebase
# =============================================================================

def publier_meteo_firebase():
    """Envoie les données capteurs + état bâche vers Firebase."""
    payload = ujson.dumps({
        "temperature": temperature,
        "humidite":    humidite,
        "tarp":        "deploye" if tarp_deploye else "range",
        "mode":        "auto"    if mode_auto    else "manu",
    })
    try:
        r = urequests.put(
            METEO_URL,
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        r.close()
        print("[Firebase] Météo publiée")
    except Exception as e:
        print("[Firebase] Erreur PUT météo : {}".format(e))


def lire_commande_firebase():
    """
    Lit /tarpCommand.json.
    Retourne : "DEPLOY", "RETRACT", "STOP" ou None.
    """
    try:
        r   = urequests.get(CMD_URL)
        raw = r.text.strip().strip('"').upper()
        r.close()
        if raw in ("DEPLOY", "RETRACT", "STOP"):
            return raw
        return None
    except Exception as e:
        print("[Firebase] Erreur GET commande : {}".format(e))
        return None


def effacer_commande_firebase():
    """Remet /tarpCommand.json à null après traitement."""
    try:
        r = urequests.put(
            CMD_URL,
            data='"null"',
            headers={"Content-Type": "application/json"}
        )
        r.close()
    except Exception as e:
        print("[Firebase] Erreur effacement commande : {}".format(e))

# =============================================================================
# MQTT
# =============================================================================

def on_message(topic, msg):
    """Callback MQTT — traite les commandes reçues en temps réel."""
    global mode_auto

    payload = msg.decode().strip().lower()
    topic_s = topic.decode()
    print("[MQTT] {} → {}".format(topic_s, payload))

    if topic_s == TOPIC_ORDRE:
        if payload == "ouvrir" and not tarp_deploye:
            moteur_deployer()
            publier_meteo_firebase()
            _mqtt_publish(TOPIC_ETAT, "deploye")

        elif payload in ("fermer", "stop") and tarp_deploye:
            moteur_arreter()
            publier_meteo_firebase()
            _mqtt_publish(TOPIC_ETAT, "range")

    elif topic_s == TOPIC_MODE:
        mode_auto = (payload == "auto")
        print("[MODE] {}".format("AUTO" if mode_auto else "MANU"))


def _mqtt_publish(topic: str, msg: str):
    """Publie un message MQTT en gérant les erreurs silencieusement."""
    global mqtt_client
    if mqtt_client:
        try:
            mqtt_client.publish(topic, msg)
        except Exception as e:
            print("[MQTT] Erreur publish : {}".format(e))


def connecter_mqtt() -> bool:
    global mqtt_client
    try:
        from mqtt import MQTTClient
        cid         = "vinya_pico_{}".format(time.ticks_ms())
        mqtt_client = MQTTClient(cid, MQTT_BROKER, MQTT_PORT)
        mqtt_client.set_callback(on_message)
        mqtt_client.connect()
        mqtt_client.subscribe(TOPIC_ORDRE)
        mqtt_client.subscribe(TOPIC_MODE)
        print("[MQTT] Connecté et abonné ({} + {})".format(TOPIC_ORDRE, TOPIC_MODE))
        return True
    except Exception as e:
        print("[MQTT] Erreur connexion : {}".format(e))
        mqtt_client = None
        return False

# =============================================================================
# BOUCLE PRINCIPALE
# =============================================================================

def main():
    global mode_auto, tarp_deploye

    print("=" * 50)
    print("  Vinya Firmware — Firebase + MQTT + Moteur DC")
    print("=" * 50)

    # Initialisation
    connecter_wifi()
    connecter_mqtt()
    lire_dht()
    publier_meteo_firebase()

    # Intervalles (ms)
    INTERVAL_DHT      = 5_000    # lecture DHT11 toutes les 5 s
    INTERVAL_FIREBASE = 3_000    # poll commandes Firebase toutes les 3 s
    INTERVAL_METEO    = 10_000   # push météo Firebase toutes les 10 s
    INTERVAL_MQTT_PUB = 10_000   # publish MQTT télémétrie toutes les 10 s

    t_dht      = time.ticks_ms()
    t_firebase = time.ticks_ms()
    t_meteo    = time.ticks_ms()
    t_mqtt_pub = time.ticks_ms()
    btn_prev   = btn.value()

    while True:
        now = time.ticks_ms()

        # ── Bouton mode Manuel / Auto ─────────────────────────────────────────
        btn_val = btn.value()
        if btn_prev == 1 and btn_val == 0:    # front descendant = appui bouton
            mode_auto = not mode_auto
            print("[BTN] Basculement → {}".format("AUTO" if mode_auto else "MANU"))
            time.sleep_ms(50)                 # anti-rebond
        btn_prev = btn_val

        # ── Lecture DHT11 ─────────────────────────────────────────────────────
        if time.ticks_diff(now, t_dht) >= INTERVAL_DHT:
            lire_dht()
            t_dht = now

        # ── Check messages MQTT entrants ──────────────────────────────────────
        if mqtt_client:
            try:
                mqtt_client.check_msg()
            except Exception as e:
                print("[MQTT] check_msg perdu : {} — reconnexion...".format(e))
                connecter_mqtt()

        # ── Poll commandes Firebase ───────────────────────────────────────────
        if time.ticks_diff(now, t_firebase) >= INTERVAL_FIREBASE:
            cmd = lire_commande_firebase()

            if cmd == "DEPLOY" and not tarp_deploye:
                moteur_deployer()
                effacer_commande_firebase()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "deploye")

            elif cmd in ("RETRACT", "STOP") and tarp_deploye:
                moteur_arreter()
                effacer_commande_firebase()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "range")

            t_firebase = now

        # ── Mode AUTO (seuils température) ────────────────────────────────────
        if mode_auto and temperature > 0:
            if temperature > 23 and not tarp_deploye:
                print("[AUTO] T={}°C > 23°C → déploiement bâche".format(temperature))
                moteur_deployer()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "deploye_auto")

            elif temperature < 17 and tarp_deploye:
                print("[AUTO] T={}°C < 17°C → rétractation bâche".format(temperature))
                moteur_arreter()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "range_auto")

        # ── Push météo Firebase ───────────────────────────────────────────────
        if time.ticks_diff(now, t_meteo) >= INTERVAL_METEO:
            publier_meteo_firebase()
            t_meteo = now

        # ── Publish MQTT télémétrie ───────────────────────────────────────────
        if time.ticks_diff(now, t_mqtt_pub) >= INTERVAL_MQTT_PUB:
            _mqtt_publish(TOPIC_TEMP, str(temperature))
            _mqtt_publish(TOPIC_HUM,  str(humidite))
            t_mqtt_pub = now

        # Pause courte pour ne pas saturer le CPU
        time.sleep_ms(100)


# Point d'entrée
main()

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
TOPIC_ORDRE      = MQTT_ROOT + "/ordre"
TOPIC_MODE       = MQTT_ROOT + "/mode"
TOPIC_DUREE      = MQTT_ROOT + "/duree"
TOPIC_POMPE      = MQTT_ROOT + "/pompe"
TOPIC_POMPE_DUREE= MQTT_ROOT + "/pompe_duree"
TOPIC_MOTEUR_B   = MQTT_ROOT + "/moteur_b"   # pilotage manuel Canal B en temps réel
TOPIC_TEMP       = MQTT_ROOT + "/temperature"
TOPIC_HUM        = MQTT_ROOT + "/humidite"
TOPIC_ETAT       = MQTT_ROOT + "/etat"

# ── Pins ──────────────────────────────────────────────────────────────────────
# ── Canal A — Moteur bâche ────────────────────────────────────────────────────
MOTOR_A_ENA    = 11     # PWM → vitesse moteur A (ENA)
MOTOR_A_IN1    = 12     # Direction bit 1 moteur A (IN1)
MOTOR_A_IN2    = 13     # Direction bit 2 moteur A (IN2)

# ── Canal B — Moteur pompe / 2ème mécanisme ───────────────────────────────────
MOTOR_B_ENB    = 14     # PWM → vitesse moteur B (ENB)
MOTOR_B_IN3    = 15     # Direction bit 1 moteur B (IN3)  ⚠ même pin que DHT11 → voir note
MOTOR_B_IN4    = 16     # Direction bit 2 moteur B (IN4)

POT_PIN        = 26     # ADC0 → potentiomètre
DHT_PIN        = 22     # DHT11 → déplacé sur GP22 (GP15 occupé par IN3)
LED_PIN        = 27     # LED status
BTN_PIN        = 20     # Bouton mode
PUMP_PIN       = 4      # Relais pompe (HIGH = ON)

# ── Paramètres moteur ─────────────────────────────────────────────────────────
MOTOR_PWM_FREQ   = 10_000   # 10 kHz (adapté aux contrôleurs brushed)
MOTOR_MIN_DUTY   = 0.30     # 30 % minimum moteur A (évite le démarrage brutal)
MOTOR_RAMP_MS    = 1_500    # durée de la montée progressive (ms)
MOTOR_STOP_MS    = 800      # durée de la descente progressive (ms)

# ── Canal B — même pot que A, ratios SLOW/FAST appliqués dessus ──────────────
MOTOR_B_SLOW_RATIO = 0.5   # 50 % de la vitesse pot pour mode lent
MOTOR_B_FAST_RATIO = 1.0   # 100 % de la vitesse pot pour mode rapide

# ── Init hardware ─────────────────────────────────────────────────────────────
# Canal A — bâche
motor_a_pwm = PWM(Pin(MOTOR_A_ENA, Pin.OUT))
motor_a_pwm.freq(MOTOR_PWM_FREQ)
motor_a_pwm.duty_u16(0)
motor_in1 = Pin(MOTOR_A_IN1, Pin.OUT)
motor_in2 = Pin(MOTOR_A_IN2, Pin.OUT)
motor_in1.value(0)
motor_in2.value(0)

# Canal B — 2ème moteur
motor_b_pwm = PWM(Pin(MOTOR_B_ENB, Pin.OUT))
motor_b_pwm.freq(MOTOR_PWM_FREQ)
motor_b_pwm.duty_u16(0)
motor_in3 = Pin(MOTOR_B_IN3, Pin.OUT)
motor_in4 = Pin(MOTOR_B_IN4, Pin.OUT)
motor_in3.value(0)
motor_in4.value(0)

pot     = ADC(Pin(POT_PIN))
capteur = dht.DHT11(Pin(DHT_PIN))
led     = Pin(LED_PIN, Pin.OUT)
btn     = Pin(BTN_PIN, Pin.IN, Pin.PULL_UP)
pompe   = Pin(PUMP_PIN, Pin.OUT)
pompe.off()    # pompe arrêtée au démarrage

# ── État global ───────────────────────────────────────────────────────────────
tarp_deploye  = False
mode_auto     = False
temperature   = 0.0
humidite      = 0.0
mqtt_client   = None
duree_action        = 30    # Durée de l'action moteur bâche en secondes (par défaut 30 s)
motor_stop_at       = None  # ticks_ms cible pour l'arrêt automatique moteur
motor_action        = None  # 'deploy' ou 'retract' — indique l'opération en cours
retract_blocked_until = None  # après un déploiement, bloque les rétractations parasites
duree_pompe   = 30      # Durée de l'action pompe en secondes (par défaut 30 s)
pompe_active  = False   # État courant de la pompe
pompe_stop_at = None    # ticks_ms cible pour l'arrêt automatique pompe (None = pas de timer)

# =============================================================================
# MOTEUR DC (PWM + Potentiomètre)
# =============================================================================

def lire_vitesse_pot() -> int:
    """
    Lit le potentiomètre (GP26/ADC0) et retourne le duty cycle PWM cible.
    Plage : 30 % min → 100 % max  (valeurs 0–65535 pour duty_u16).
    Le minimum à 30 % protège le contrôleur contre les tensions trop faibles.
    """
    raw   = pot.read_u16()                              # 0 → 65535
    min_d = int(65535 * MOTOR_MIN_DUTY)                 # ~19660
    max_d = 65535
    duty  = min_d + int((raw / 65535) * (max_d - min_d))
    return duty


def _set_direction_a(forward: bool):
    """
    Canal A — sens de rotation moteur bâche.
      forward=True  → IN1=1, IN2=0  (déploiement)
      forward=False → IN1=0, IN2=1  (rétractation)
    """
    if forward:
        motor_in1.value(1)
        motor_in2.value(0)
    else:
        motor_in1.value(0)
        motor_in2.value(1)
    print("[MOTEUR A] Direction → {}".format("AVANT" if forward else "ARRIERE"))


def moteur_deployer():
    """
    Canal A — lance le moteur en sens AVANT (déploiement bâche).
    Montée progressive sur MOTOR_RAMP_MS.
    Auto-stop après duree_action secondes via motor_stop_at.
    tarp_deploye = True est mis immédiatement, il ne sera remis à False
    qu'à la fin d'une rétractation (pas à l'auto-stop).
    """
    global tarp_deploye, motor_stop_at, motor_action

    cible = lire_vitesse_pot()
    steps = 60
    delai = MOTOR_RAMP_MS // steps

    _set_direction_a(forward=True)   # IN1=1, IN2=0

    print("[MOTEUR A] Démarrage → duty cible = {} ({:.1f}%)".format(
        cible, cible / 65535 * 100))

    for i in range(steps + 1):
        motor_a_pwm.duty_u16(int((i / steps) * cible))
        time.sleep_ms(delai)

    tarp_deploye          = True
    motor_action          = 'deploy'
    motor_stop_at         = time.ticks_ms() + duree_action * 1000
    # Bloque toute rétractation pendant duree_action + 5 s (évite Firebase parasite)
    retract_blocked_until = time.ticks_ms() + (duree_action + 5) * 1000
    led.on()
    print("[MOTEUR A] Déploiement — arrêt dans {}s".format(duree_action))


def moteur_retracter():
    """
    Canal A — lance le moteur en sens ARRIÈRE (rétractation bâche).
    tarp_deploye sera mis à False uniquement quand l'auto-stop se déclenche
    (fin physique de la rétractation), pas avant.
    """
    global motor_stop_at, motor_action

    cible = lire_vitesse_pot()
    steps = 60
    delai = MOTOR_RAMP_MS // steps

    _set_direction_a(forward=False)  # IN1=0, IN2=1

    print("[MOTEUR A] Rétractation → duty cible = {} ({:.1f}%)".format(
        cible, cible / 65535 * 100))

    for i in range(steps + 1):
        motor_a_pwm.duty_u16(int((i / steps) * cible))
        time.sleep_ms(delai)

    motor_action  = 'retract'
    motor_stop_at = time.ticks_ms() + duree_action * 1000
    print("[MOTEUR A] Rétractation — arrêt dans {}s".format(duree_action))


def moteur_arreter():
    """
    Canal A — descente progressive PWM puis direction neutre.
    Annule le timer automatique.
    """
    global tarp_deploye, motor_stop_at

    motor_stop_at = None

    actuel = motor_a_pwm.duty_u16()
    if actuel == 0:
        motor_in1.value(0)
        motor_in2.value(0)
        led.off()
        return

    steps = 40
    delai = MOTOR_STOP_MS // steps

    print("[MOTEUR A] Arrêt progressif depuis duty = {}".format(actuel))

    for i in range(steps, -1, -1):
        motor_a_pwm.duty_u16(int((i / steps) * actuel))
        time.sleep_ms(delai)

    motor_a_pwm.duty_u16(0)
    motor_in1.value(0)
    motor_in2.value(0)
    tarp_deploye = False
    led.off()
    print("[MOTEUR A] Arrêté")

# =============================================================================
# MOTEUR B — Canal B du pont en H (pilotage manuel via dashboard)
# =============================================================================

def _set_direction_b(forward: bool):
    """
    Configure IN3/IN4 pour le sens du moteur B.
      forward=True  → IN3=1, IN4=0
      forward=False → IN3=0, IN4=1
    """
    if forward:
        motor_in3.value(1)
        motor_in4.value(0)
    else:
        motor_in3.value(0)
        motor_in4.value(1)


def moteur_b_demarrer(forward: bool, fast: bool):
    """
    Lance le moteur B en avant ou arrière, à vitesse lente ou rapide.
    Utilise le même potentiomètre que Canal A pour avoir la même vitesse de base.
    Rampe courte (300 ms) pour protéger le pont en H.
    """
    pot_duty   = lire_vitesse_pot()
    ratio      = MOTOR_B_FAST_RATIO if fast else MOTOR_B_SLOW_RATIO
    duty_cible = int(pot_duty * ratio)

    _set_direction_b(forward)

    # Rampe courte de 300 ms (12 paliers × 25 ms)
    steps = 12
    for i in range(steps + 1):
        motor_b_pwm.duty_u16(int((i / steps) * duty_cible))
        time.sleep_ms(25)

    vitesse = "RAPIDE" if fast else "LENTE"
    sens    = "AVANT"  if forward else "ARRIERE"
    print("[MOTEUR B] {} {} — duty = {} ({:.0f}%)".format(
        sens, vitesse, duty_cible, duty_cible / 65535 * 100))


def moteur_b_arreter():
    """Arrête le moteur B avec descente progressive (200 ms)."""
    actuel = motor_b_pwm.duty_u16()
    if actuel == 0:
        motor_in3.value(0)
        motor_in4.value(0)
        return
    steps = 8
    for i in range(steps, -1, -1):
        motor_b_pwm.duty_u16(int((i / steps) * actuel))
        time.sleep_ms(25)
    motor_b_pwm.duty_u16(0)
    motor_in3.value(0)
    motor_in4.value(0)
    print("[MOTEUR B] Arrêté")


# =============================================================================
# POMPE
# =============================================================================

def pompe_demarrer():
    """
    Active la pompe et programme un arrêt automatique après duree_pompe secondes.
    """
    global pompe_active, pompe_stop_at
    pompe.on()
    pompe_active  = True
    pompe_stop_at = time.ticks_ms() + duree_pompe * 1000
    print("[POMPE] Démarrée — arrêt automatique dans {}s".format(duree_pompe))


def pompe_arreter():
    """Coupe la pompe et annule le timer automatique."""
    global pompe_active, pompe_stop_at
    pompe.off()
    pompe_active  = False
    pompe_stop_at = None
    print("[POMPE] Arrêtée")


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

def _retract_guarded() -> bool:
    """Retourne True si une rétractation est autorisée (garde inactive)."""
    if retract_blocked_until is None:
        return True
    return time.ticks_diff(time.ticks_ms(), retract_blocked_until) >= 0


def on_message(topic, msg):
    """Callback MQTT — traite les commandes reçues en temps réel."""
    global mode_auto, duree_action, duree_pompe

    payload = msg.decode().strip().lower()
    topic_s = topic.decode()
    print("[MQTT] {} → {}".format(topic_s, payload))

    if topic_s == TOPIC_DUREE:
        # Mise à jour de la durée d'action moteur
        try:
            val = int(float(payload))
            if 1 <= val <= 300:
                duree_action = val
                print("[DUREE] Durée mise à jour → {}s".format(duree_action))
        except ValueError:
            print("[DUREE] Valeur invalide : {}".format(payload))

    elif topic_s == TOPIC_ORDRE:
        if payload == "ouvrir" and not tarp_deploye:
            moteur_deployer()
            effacer_commande_firebase()  # évite que Firebase re-déclenche la même commande
            publier_meteo_firebase()
            _mqtt_publish(TOPIC_ETAT, "deploye")

        elif payload == "fermer" and tarp_deploye:
            if _retract_guarded():
                moteur_retracter()
                effacer_commande_firebase()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "retractation")
            else:
                print("[GARDE] Rétractation MQTT bloquée — déploiement récent")

        elif payload == "stop":
            moteur_arreter()
            effacer_commande_firebase()
            publier_meteo_firebase()
            _mqtt_publish(TOPIC_ETAT, "range")

    elif topic_s == TOPIC_MOTEUR_B:
        # Pilotage manuel Canal B en temps réel via MQTT (évite la latence Firebase 3s)
        if payload == "forward_slow":
            moteur_b_demarrer(forward=True,  fast=False)
        elif payload == "forward_fast":
            moteur_b_demarrer(forward=True,  fast=True)
        elif payload == "backward_slow":
            moteur_b_demarrer(forward=False, fast=False)
        elif payload == "backward_fast":
            moteur_b_demarrer(forward=False, fast=True)
        elif payload in ("stop", "idle"):
            moteur_b_arreter()

    elif topic_s == TOPIC_POMPE_DUREE:
        # Mise à jour de la durée d'action pompe
        try:
            val = int(float(payload))
            if 1 <= val <= 300:
                duree_pompe = val
                print("[POMPE DUREE] Durée mise à jour → {}s".format(duree_pompe))
        except ValueError:
            print("[POMPE DUREE] Valeur invalide : {}".format(payload))

    elif topic_s == TOPIC_POMPE:
        if payload == "on":
            pompe_demarrer()
        elif payload == "off":
            pompe_arreter()

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
        mqtt_client.subscribe(TOPIC_DUREE)
        mqtt_client.subscribe(TOPIC_POMPE)
        mqtt_client.subscribe(TOPIC_POMPE_DUREE)
        mqtt_client.subscribe(TOPIC_MOTEUR_B)
        print("[MQTT] Connecté — abonnements: ordre, mode, duree, pompe, pompe_duree, moteur_b")
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

    # ── Nettoyage des commandes Firebase au démarrage ─────────────────────────
    # Évite que des commandes d'une session précédente (ex: RETRACT) se déclenchent
    _HDR = {"Content-Type": "application/json"}
    for url in [CMD_URL,
                FIREBASE_BASE + "/motorCommand.json",
                FIREBASE_BASE + "/pumpCommand.json"]:
        try:
            urequests.put(url, data='"null"', headers=_HDR).close()
        except Exception as e:
            print("[INIT] Erreur clear Firebase {} : {}".format(url, e))
    print("[INIT] Firebase nettoyé")

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

        # ── Auto-stop moteur après duree_action secondes ──────────────────────
        if motor_stop_at is not None and time.ticks_diff(now, motor_stop_at) >= 0:
            global tarp_deploye, motor_action
            motor_stop_at = None
            # Descente progressive PWM sans passer par moteur_arreter()
            # pour ne pas changer tarp_deploye incorrectement
            actuel = motor_a_pwm.duty_u16()
            steps  = 40
            delai  = MOTOR_STOP_MS // steps
            for i in range(steps, -1, -1):
                motor_a_pwm.duty_u16(int((i / steps) * actuel))
                time.sleep_ms(delai)
            motor_a_pwm.duty_u16(0)
            motor_in1.value(0)
            motor_in2.value(0)

            if motor_action == 'retract':
                # Rétractation terminée → bâche rangée
                tarp_deploye = False
                led.off()
                print("[MOTEUR] Auto-stop rétractation — bâche rangée")
                _mqtt_publish(TOPIC_ETAT, "range")
            else:
                # Déploiement terminé → moteur arrêté mais bâche toujours déployée
                print("[MOTEUR] Auto-stop déploiement — bâche déployée, moteur arrêté")
                _mqtt_publish(TOPIC_ETAT, "deploye_arrete")
            motor_action = None
            publier_meteo_firebase()

        # ── Auto-stop pompe après duree_pompe secondes ────────────────────────
        if pompe_stop_at is not None and time.ticks_diff(now, pompe_stop_at) >= 0:
            print("[POMPE] Auto-stop — {}s écoulés".format(duree_pompe))
            pompe_arreter()
            _mqtt_publish(TOPIC_ETAT, "pompe_off")

        # ── Poll commandes Firebase ───────────────────────────────────────────
        if time.ticks_diff(now, t_firebase) >= INTERVAL_FIREBASE:
            # Commande bâche
            cmd = lire_commande_firebase()

            if cmd == "DEPLOY" and not tarp_deploye:
                moteur_deployer()
                effacer_commande_firebase()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "deploye")

            elif cmd == "RETRACT" and tarp_deploye:
                if _retract_guarded():
                    moteur_retracter()
                    effacer_commande_firebase()
                    publier_meteo_firebase()
                    _mqtt_publish(TOPIC_ETAT, "retractation")
                else:
                    effacer_commande_firebase()  # efface quand même pour ne pas boucler
                    print("[GARDE] Rétractation Firebase bloquée — déploiement récent")

            elif cmd == "STOP":
                moteur_arreter()
                effacer_commande_firebase()
                publier_meteo_firebase()
                _mqtt_publish(TOPIC_ETAT, "range")

            # ── Commande moteur B (pilotage manuel) ──────────────────────────
            try:
                r_b = urequests.get(FIREBASE_BASE + "/motorCommand.json")
                mot_cmd = r_b.text.strip().strip('"').upper()
                r_b.close()

                _MOTOR_B_URL = FIREBASE_BASE + "/motorCommand.json"
                _HDR = {"Content-Type": "application/json"}

                if mot_cmd == "FORWARD_SLOW":
                    moteur_b_demarrer(forward=True,  fast=False)
                    urequests.put(_MOTOR_B_URL, data='"null"', headers=_HDR).close()

                elif mot_cmd == "FORWARD_FAST":
                    moteur_b_demarrer(forward=True,  fast=True)
                    urequests.put(_MOTOR_B_URL, data='"null"', headers=_HDR).close()

                elif mot_cmd == "BACKWARD_SLOW":
                    moteur_b_demarrer(forward=False, fast=False)
                    urequests.put(_MOTOR_B_URL, data='"null"', headers=_HDR).close()

                elif mot_cmd == "BACKWARD_FAST":
                    moteur_b_demarrer(forward=False, fast=True)
                    urequests.put(_MOTOR_B_URL, data='"null"', headers=_HDR).close()

                elif mot_cmd in ("STOP", "IDLE"):
                    moteur_b_arreter()
                    urequests.put(_MOTOR_B_URL, data='"null"', headers=_HDR).close()

            except Exception as e:
                print("[Firebase] Erreur poll motorCommand : {}".format(e))

            # Commande pompe
            try:
                r_pompe = urequests.get(FIREBASE_BASE + "/pumpCommand.json")
                pump_cmd = r_pompe.text.strip().strip('"').upper()
                r_pompe.close()
                if pump_cmd == "ON" and not pompe_active:
                    pompe_demarrer()
                    urequests.put(FIREBASE_BASE + "/pumpCommand.json",
                                  data='"null"',
                                  headers={"Content-Type": "application/json"}).close()
                elif pump_cmd == "OFF" and pompe_active:
                    pompe_arreter()
                    urequests.put(FIREBASE_BASE + "/pumpCommand.json",
                                  data='"null"',
                                  headers={"Content-Type": "application/json"}).close()
            except Exception as e:
                print("[Firebase] Erreur poll pompe : {}".format(e))

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

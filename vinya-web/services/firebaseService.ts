import { VineyardData, WeatherPoint } from '../types';
import { FIREBASE_DB_URL } from '../constants';

// ── Helpers ───────────────────────────────────────

export const findSmartValue = (obj: any, keys: string[]): number | undefined => {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return Number(obj[key]);
  }
  const lowerKeys = keys.map(k => k.toLowerCase());
  for (const key of Object.keys(obj)) {
    if (lowerKeys.includes(key.toLowerCase()) && obj[key] !== undefined && obj[key] !== null)
      return Number(obj[key]);
  }
  return undefined;
};

// ── Firebase REST calls ───────────────────────────

export const fetchSensorData = async () => {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}?t=${Date.now()}`);
    if (!res.ok) { console.warn('Firebase fetch failed:', res.statusText); return null; }
    return res.json();
  } catch (err) {
    console.error('Error fetching from Firebase:', err);
    return null;
  }
};

export const fetchCurrentReadings = async () => {
  const data = await fetchSensorData();
  if (!data) return null;
  return {
    temp: findSmartValue(data, ['temperature', 'temp', 'Temp', 't', 'dht_temp']),
    hum:  findSmartValue(data, ['humidity', 'hum', 'humidite', 'h', 'dht_hum']),
    pres: findSmartValue(data, ['pressure', 'pres', 'pression', 'p', 'baro']),
    wind: findSmartValue(data, ['windSpeed', 'wind', 'vent', 'vitesse', 'w', 'anemo']),
    rain: findSmartValue(data, ['precipitation', 'precipitations', 'rain', 'pluie', 'r', 'pluvio']),
  };
};

export const sendTarpCommand = async (action: 'deploy' | 'retract' | 'stop'): Promise<boolean> => {
  try {
    const url = FIREBASE_DB_URL.replace('stationMeteo.json', 'tarpCommand.json');
    // Envoi en MAJUSCULES pour correspondre exactement à ce qu'attend le Pico
    const command = action.toUpperCase(); // "DEPLOY" | "RETRACT" | "STOP"
    console.log(`[Firebase] PUT ${url} → ${command}`);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const responseText = await res.text();
    console.log(`[Firebase] Réponse: HTTP ${res.status} → ${responseText}`);
    if (res.status === 401 || res.status === 403) {
      console.error('[Firebase] ACCÈS REFUSÉ — vérifiez les règles Firebase (rules).');
      return false;
    }
    if (!res.ok) throw new Error(`Firebase write failed: ${res.status} ${res.statusText}`);
    return true;
  } catch (err) {
    console.error('[Firebase] Erreur sendTarpCommand:', err);
    return false;
  }
};

export const sendTarpDuration = async (seconds: number): Promise<boolean> => {
  try {
    const url = FIREBASE_DB_URL.replace('stationMeteo.json', 'tarpDuration.json');
    console.log(`[Firebase] Durée action → ${seconds}s`);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seconds),
    });
    if (!res.ok) throw new Error(`Firebase duration write failed: ${res.statusText}`);
    return true;
  } catch (err) {
    console.error('[Firebase] Erreur sendTarpDuration:', err);
    return false;
  }
};

export type MotorCmd = 'FORWARD_SLOW' | 'FORWARD_FAST' | 'BACKWARD_SLOW' | 'BACKWARD_FAST' | 'STOP' | 'IDLE';

export const sendMotorCommand = async (cmd: MotorCmd): Promise<boolean> => {
  try {
    const url = FIREBASE_DB_URL.replace('stationMeteo.json', 'motorCommand.json');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (!res.ok) throw new Error(`Firebase motor write failed: ${res.statusText}`);
    return true;
  } catch (err) {
    console.error('[Firebase] Erreur sendMotorCommand:', err);
    return false;
  }
};

export const sendPumpCommand = async (action: 'ON' | 'OFF'): Promise<boolean> => {
  try {
    const url = FIREBASE_DB_URL.replace('stationMeteo.json', 'pumpCommand.json');
    console.log(`[Firebase] Pompe → ${action}`);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) throw new Error(`Firebase pump write failed: ${res.statusText}`);
    return true;
  } catch (err) {
    console.error('[Firebase] Erreur sendPumpCommand:', err);
    return false;
  }
};

export const sendMqttCommand = async (action: 'CONNECT' | 'DISCONNECT'): Promise<boolean> => {
  try {
    const url = FIREBASE_DB_URL.replace('stationMeteo.json', 'mqttCommand.json');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) throw new Error(`Firebase MQTT write failed: ${res.statusText}`);
    return true;
  } catch (err) {
    console.error('Error sending MQTT command:', err);
    return false;
  }
};

// ── History generator ─────────────────────────────

const generateRealisticHistory = (
  current: { temp: number; hum: number; pres: number; wind: number; rain: number },
  scale: '1h' | '24h' | '7d'
): WeatherPoint[] => {
  const points: WeatherPoint[] = [];
  const now = new Date();
  const config: Record<string, { count: number; interval: number }> = {
    '1h':  { count: 12, interval: 5 },
    '24h': { count: 24, interval: 60 },
    '7d':  { count: 7,  interval: 24 * 60 },
  };
  const { count, interval } = config[scale];

  for (let i = count - 1; i >= 0; i--) {
    const pointTime = new Date(now.getTime() - i * interval * 60000);
    const hour = pointTime.getHours();
    const dayCycle = Math.sin(((hour - 10) / 24) * 2 * Math.PI);
    const noise = (Math.random() - 0.5) * 0.5;
    const drift = i / count;

    let timeLabel = '';
    if (scale === '1h')  timeLabel = pointTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (scale === '24h') timeLabel = pointTime.toLocaleTimeString('fr-FR', { hour: '2-digit' });
    if (scale === '7d')  timeLabel = pointTime.toLocaleDateString('fr-FR', { weekday: 'short' });

    const temp = Number((current.temp - (scale === '24h' ? dayCycle * 5 : noise * 2) * drift).toFixed(1));
    let hum  = Math.round(current.hum  - (scale === '24h' ? -dayCycle * 15 : noise * 5) * drift);
    hum = Math.min(100, Math.max(0, hum));
    const pres = Math.round(current.pres - (noise * 2) * drift);
    let wind = Math.round(current.wind - (Math.random() * 10 - 5) * drift);
    wind = Math.max(0, wind);
    const rain = i === 0 ? current.rain : (Math.random() > 0.8 ? Number((Math.random() * 2).toFixed(1)) : 0);

    points.unshift({ time: timeLabel, temperature: temp, humidity: hum, pressure: pres, windSpeed: wind, precipitation: rain });
  }
  return points;
};

// ── Fast data fetch (no AI) ───────────────────────

export const fetchFastVineyardData = async (): Promise<VineyardData> => {
  try {
    const raw = await fetchSensorData();

    const safe = {
      temp: findSmartValue(raw, ['temperature', 'temp', 'Temp', 't', 'dht_temp']) ?? 0,
      hum:  findSmartValue(raw, ['humidity', 'hum', 'humidite', 'h', 'dht_hum']) ?? 0,
      pres: findSmartValue(raw, ['pressure', 'pres', 'pression', 'p', 'baro']) ?? 1013,
      wind: findSmartValue(raw, ['windSpeed', 'wind', 'vent', 'vitesse', 'w', 'anemo']) ?? 0,
      rain: findSmartValue(raw, ['precipitation', 'precipitations', 'rain', 'pluie', 'r', 'pluvio']) ?? 0,
    };

    const history1h  = generateRealisticHistory(safe, '1h');
    const history24h = generateRealisticHistory(safe, '24h');
    const history7d  = generateRealisticHistory(safe, '7d');

    return {
      lastUpdated:     new Date().toISOString(),
      currentTemp:     safe.temp,
      currentHumidity: safe.hum,
      pressure:        safe.pres,
      windSpeed:       safe.wind,
      precipitation:   safe.rain,
      soilMoisture:    30,
      uvIndex:         0,
      isTarpDeployed:  false,
      isAutoMode:      false,
      history:         history24h,
      history1h,
      history24h,
      history7d,
      alerts:          [],
      aiAnalysis:      'Station météo active — données Firebase en direct.',
      externalWeather: { location: 'Vannes', temperature: 0, feelsLike: 0, condition: 'N/A' },
      groundingSources: [],
    };
  } catch (err) {
    console.error('Error fetching vineyard data:', err);
    throw err;
  }
};

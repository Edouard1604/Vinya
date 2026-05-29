/**
 * storageService.ts — Couche de persistance IndexedDB (time-series)
 *
 * Architecture de stockage :
 * ┌─────────────────────────────────────────────────────────┐
 * │  DB : vinya_weather_db  (v1)                            │
 * │  Store : readings                                        │
 * │    keyPath : id (auto-increment)                         │
 * │    index   : by_timestamp  (non-unique, pour les range)  │
 * │                                                          │
 * │  Politique : append-only — jamais d'écrasement.          │
 * │  Agrégation automatique selon la période demandée :      │
 * │    24h  → buckets 30 min  (~48 points)                   │
 * │    7 j  → buckets 3 h     (~56 points)                   │
 * │    1 m  → buckets 1 jour  (~30 points)                   │
 * │    tout → buckets 1 jour  (n points)                     │
 * └─────────────────────────────────────────────────────────┘
 */

import { WeatherPoint, TimeSeriesPoint } from '../types';

// ── Constantes ────────────────────────────────────────────────────────────────

const DB_NAME    = 'vinya_weather_db';
const STORE      = 'readings';
const DB_VERSION = 1;

// ── Singleton connexion ───────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath:       'id',
          autoIncrement: true,
        });
        // Index non-unique sur timestamp pour les requêtes de plage
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ── Écriture (append-only) ────────────────────────────────────────────────────

/**
 * Ajoute une mesure. Ne modifie jamais les données existantes.
 * Appeler depuis handleRefresh dans Dashboard dès qu'on reçoit de nouvelles données.
 */
export async function appendReading(
  point: Omit<TimeSeriesPoint, 'id'>,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(point);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Lecture ───────────────────────────────────────────────────────────────────

async function getByRange(
  fromMs: number,
  toMs:   number,
): Promise<TimeSeriesPoint[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('by_timestamp');
    const range = IDBKeyRange.bound(fromMs, toMs);
    const req   = index.getAll(range);
    req.onsuccess = () => resolve(req.result as TimeSeriesPoint[]);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllReadings(): Promise<TimeSeriesPoint[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as TimeSeriesPoint[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function countReadings(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result as number);
    req.onerror   = () => reject(req.error);
  });
}

// ── Agrégation ────────────────────────────────────────────────────────────────

type NumField = keyof Omit<TimeSeriesPoint, 'id' | 'timestamp'>;

function avg(pts: TimeSeriesPoint[], field: NumField): number {
  if (!pts.length) return 0;
  return Number(
    (pts.reduce((s, p) => s + p[field], 0) / pts.length).toFixed(1),
  );
}

/**
 * Regroupe les points dans des buckets de taille `bucketMs`,
 * calcule la moyenne de chaque variable par bucket.
 * Résultat trié chronologiquement.
 */
function bucketAggregate(
  points:      TimeSeriesPoint[],
  bucketMs:    number,
  fmtLabel:    (d: Date) => string,
): WeatherPoint[] {
  const map = new Map<number, TimeSeriesPoint[]>();

  for (const p of points) {
    const key = Math.floor(p.timestamp / bucketMs) * bucketMs;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, pts]) => ({
      time:          fmtLabel(new Date(ts)),
      temperature:   avg(pts, 'temperature'),
      humidity:      avg(pts, 'humidity'),
      pressure:      avg(pts, 'pressure'),
      windSpeed:     avg(pts, 'windSpeed'),
      precipitation: avg(pts, 'precipitation'),
    }));
}

// ── API publique de requête ───────────────────────────────────────────────────

/** 24 h → buckets 30 min → ~48 points */
export async function get24hData(): Promise<WeatherPoint[]> {
  const now    = Date.now();
  const points = await getByRange(now - 24 * 3_600_000, now);
  return bucketAggregate(
    points,
    30 * 60_000,
    d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  );
}

/** 7 jours → buckets 3 h → ~56 points */
export async function get7dData(): Promise<WeatherPoint[]> {
  const now    = Date.now();
  const points = await getByRange(now - 7 * 24 * 3_600_000, now);
  return bucketAggregate(
    points,
    3 * 3_600_000,
    d => `${d.toLocaleDateString('fr-FR', { weekday: 'short' })} ${d.getHours()}h`,
  );
}

/** 1 mois → buckets 1 jour → ~30 points (moyennes journalières) */
export async function get1mData(): Promise<WeatherPoint[]> {
  const now    = Date.now();
  const points = await getByRange(now - 30 * 24 * 3_600_000, now);
  return bucketAggregate(
    points,
    24 * 3_600_000,
    d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
  );
}

/** Historique complet → buckets 1 jour */
export async function getFullData(): Promise<WeatherPoint[]> {
  const points = await getAllReadings();
  return bucketAggregate(
    points,
    24 * 3_600_000,
    d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
  );
}

// ── Seed de démo ──────────────────────────────────────────────────────────────

export interface SeedBase {
  temperature: number;
  humidity:    number;
  pressure:    number;
  windSpeed:   number;
  precipitation: number;
}

/** Vide entièrement le store (utile avant un re-seed) */
async function clearDB(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Récupère la lecture la plus récente */
async function getLatestReading(): Promise<TimeSeriesPoint | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('by_timestamp');
    const req   = index.openCursor(null, 'prev'); // curseur décroissant → premier = le plus récent
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      resolve(cursor ? (cursor.value as TimeSeriesPoint) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Génère 30 jours de mesures réalistes ancrées sur les VRAIES valeurs capteurs.
 *
 * Règles :
 *  • Les données convergent vers `base` : le dernier point = valeurs réelles.
 *  • Si la DB contient déjà des données dont la dernière température s'écarte
 *    de plus de 4 °C des valeurs réelles → on efface et on reseede.
 *  • Modèles :
 *      Température : cycle sinusoïdal jour/nuit ancré sur base.temperature
 *      Humidité    : corrélation inverse avec la température
 *      Pression    : marche aléatoire bornée autour de base.pressure
 *      Vent        : marche aléatoire autour de base.windSpeed
 *      Pluie       : évènements sporadiques (~4 % des slots)
 */
export async function seedDemoData(base?: SeedBase): Promise<void> {
  const count  = await countReadings();
  const latest = count > 0 ? await getLatestReading() : null;

  // Si des données existent, vérifier si elles sont cohérentes avec les vraies valeurs
  if (latest && base) {
    const drift = Math.abs(latest.temperature - base.temperature);
    if (drift <= 4) return; // Données OK, rien à faire
    // Trop d'écart → on reseede à partir des vraies valeurs
    await clearDB();
  } else if (count > 0 && !base) {
    return; // Données existantes, pas de vraies valeurs → on garde
  }

  // ── Génération ──────────────────────────────────────────────────────────────

  const now   = Date.now();
  const STEP  = 30 * 60_000;  // 30 min
  const TOTAL = 30 * 24 * 2; // 1 440 points = 30 jours

  // Valeurs de référence (vraies valeurs ou fallback)
  const refTemp  = base?.temperature  ?? 15;
  const refHum   = base?.humidity     ?? 70;
  const refPres  = base?.pressure     ?? 1013;
  const refWind  = base?.windSpeed    ?? 8;

  // Pour que le dernier point du seed ≈ valeur réelle, on calcule le cycle
  // au moment actuel et on en déduit la "base neutre" sans cycle
  const nowHour    = new Date().getHours();
  const nowCycle   = Math.sin(((nowHour - 6) / 24) * 2 * Math.PI);
  const neutralBase = refTemp - nowCycle * 6; // annule la contribution du cycle à t=now

  const db    = await openDB();
  const tx    = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);

  let pres = refPres;
  let wind = refWind;

  for (let i = TOTAL - 1; i >= 0; i--) {
    const ts   = now - i * STEP;
    const d    = new Date(ts);
    const hour = d.getHours();
    const day  = Math.floor(i / 48); // 0 (récent) → 29 (ancien)

    // Cycle 24 h centré sur neutralBase → à i=0, temp ≈ refTemp
    const cycle     = Math.sin(((hour - 6) / 24) * 2 * Math.PI);
    const slowTrend = Math.sin((day / 30) * Math.PI) * 3;
    const noise     = (Math.random() - 0.5) * 1.0;
    const temperature = Number((neutralBase + cycle * 6 + slowTrend + noise).toFixed(1));

    // Humidité : corrélation inverse
    const humBase   = Math.max(0, Math.min(100, refHum + (refTemp - temperature) * 2));
    const humidity  = Math.min(100, Math.max(20, Math.round(
      humBase + (Math.random() - 0.5) * 6,
    )));

    // Pression : marche aléatoire bornée
    pres += (Math.random() - 0.5) * 0.6;
    pres  = Math.max(992, Math.min(1028, pres));
    const pressure = Math.round(pres);

    // Vent : marche aléatoire avec inertie
    wind += (Math.random() - 0.5) * 2;
    wind  = Math.max(0, Math.min(45, wind));
    const windSpeed = Math.round(wind);

    // Précipitations : 4 % des slots
    const precipitation = Math.random() > 0.96
      ? Number((Math.random() * 4.5).toFixed(1))
      : 0;

    store.add({ timestamp: ts, temperature, humidity, pressure, windSpeed, precipitation });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export interface ExternalWeather {
  location: string;
  temperature: number;
  feelsLike: number;
  condition: string;
}

export interface WeatherPoint {
  time: string;
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  precipitation: number;
}

/**
 * Schéma IndexedDB — une mesure horodatée.
 * keyPath: 'id' (auto-increment)  |  index: 'by_timestamp'
 * Les données ne sont jamais écrasées, seulement ajoutées (append-only).
 */
export interface TimeSeriesPoint {
  id?: number;          // auto-increment IndexedDB
  timestamp: number;    // Unix ms — clé de tri principale
  temperature: number;  // °C
  humidity: number;     // %
  pressure: number;     // hPa
  windSpeed: number;    // km/h
  precipitation: number; // mm
}

export interface Alert {
  id: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  type: 'frost' | 'disease' | 'water' | 'system';
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface VineyardData {
  lastUpdated: string;
  currentTemp: number;
  currentHumidity: number;
  pressure: number;
  windSpeed: number;
  precipitation: number;
  soilMoisture: number;
  uvIndex: number;
  isTarpDeployed: boolean;
  isAutoMode: boolean;
  history: WeatherPoint[];
  history1h: WeatherPoint[];
  history24h: WeatherPoint[];
  history7d: WeatherPoint[];
  alerts: Alert[];
  aiAnalysis: string;
  externalWeather: ExternalWeather;
  groundingSources?: GroundingSource[];
}

export interface VineyardContextType {
  data: VineyardData;
  setData: (data: VineyardData | ((prevData: VineyardData) => VineyardData)) => void;
}

// ── MQTT ──────────────────────────────────────────

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING   = 'CONNECTING',
  CONNECTED    = 'CONNECTED',
  ERROR        = 'ERROR',
}

export interface ConnectionConfig {
  protocol: 'ws' | 'wss';
  host: string;
  port: number;
  path: string;
  clientId: string;
}

export interface MqttMessage {
  id: string;
  topic: string;
  payload: string;
  timestamp: number;
  direction: 'in' | 'out';
}

export interface StoredHistory {
  topics: string[];
  payloads: string[];
}

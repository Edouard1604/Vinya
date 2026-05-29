import React from 'react';
import { VineyardContextType, VineyardData, ConnectionConfig } from './types';

export const FIREBASE_DB_URL =
  'https://vinya-6264b-default-rtdb.europe-west1.firebasedatabase.app/stationMeteo.json';

export const MQTT_CONFIG: ConnectionConfig = {
  protocol: 'wss',
  host: 'mqtt.dev.icam.school',
  port: 443,
  path: '/mqtt',
  clientId: 'vinya_web_client',
};

export const MQTT_ROOT = 'bzh/mecatro';
export const MQTT_TOPICS = {
  DASHBOARD: `${MQTT_ROOT}/dashboard`,
  PROJETS:   `${MQTT_ROOT}/projets`,
  getProjectActionneurs: (project: string) => `${MQTT_ROOT}/projets/${project}/actionneurs/`,
  getProjectCapteurs:   (project: string) => `${MQTT_ROOT}/projets/${project}/capteurs/`,
  getDashboard:         (project: string) => `${MQTT_ROOT}/dashboard/${project}/`,
  getSubWildcard:       (project: string) => `${MQTT_ROOT}/+/${project}/#`,
};

export const defaultVineyardData: VineyardData = {
  lastUpdated:     new Date().toISOString(),
  currentTemp:     0,
  currentHumidity: 0,
  pressure:        1013,
  windSpeed:       0,
  precipitation:   0,
  soilMoisture:    0,
  uvIndex:         0,
  isTarpDeployed:  false,
  isAutoMode:      false,
  history:         [],
  history1h:       [],
  history24h:      [],
  history7d:       [],
  alerts:          [],
  aiAnalysis:      'En attente de synchronisation avec la station...',
  externalWeather: { location: 'Vannes', temperature: 12, feelsLike: 10, condition: 'Chargement...' },
  groundingSources: [],
};

export const VineyardContext = React.createContext<VineyardContextType>({
  data:    defaultVineyardData,
  setData: () => {},
});

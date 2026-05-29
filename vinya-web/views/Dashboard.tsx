import React, { useContext, useState } from 'react';
import { VineyardContext } from '../constants';
import { fetchSensorData, findSmartValue } from '../services/firebaseService';
import { publishVineyardUpdate } from '../services/mqttService';
import { appendReading } from '../services/storageService';
import { WeatherChart } from '../components/WeatherChart';
import { RefreshCw, Thermometer, Droplets, Gauge, Wind, CloudRain, ShieldCheck } from 'lucide-react';
import { ShinyButton } from '../components/ui/ShinyButton';

const SensorCard = ({ title, value, unit, subtext, icon: Icon, color, onClick, isSelected, isRefreshing, onRefresh }: any) => {
  const colorMap: Record<string, string> = {
    orange: 'bg-orange-500',
    purple: 'bg-purple-600',
    blue:   'bg-sky-500',
    green:  'bg-emerald-500',
    indigo: 'bg-indigo-500',
    red:    'bg-rose-500',
    cyan:   'bg-cyan-500',
  };

  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden bg-white p-6 rounded-[2rem] shadow-sm border transition-all cursor-pointer hover:-translate-y-2 ${
        isSelected ? 'border-2 border-vinya-secondary shadow-lg scale-[1.02]' : 'border-gray-50 hover:border-vinya-accent/20'
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`w-14 h-14 rounded-2xl ${colorMap[color] ?? colorMap.blue} flex items-center justify-center text-white shadow-lg`}>
          <Icon className="w-7 h-7" />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${isRefreshing ? 'animate-spin text-vinya-accent' : 'text-gray-300'}`}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <h3 className="text-gray-500 font-bold text-xs uppercase tracking-wider mb-1">{title}</h3>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-bold text-gray-900 tracking-tighter tabular-nums">{value}</span>
        {unit && <span className="text-lg font-semibold text-gray-400">{unit}</span>}
      </div>
      <p className="text-xs text-gray-500 mt-2 font-medium">{subtext}</p>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const { data, setData } = useContext(VineyardContext);
  const [selectedMetric, setSelectedMetric] = useState<'temperature' | 'pressure' | 'humidity' | 'windSpeed' | 'precipitation'>('temperature');
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [globalLoading, setGlobalLoading] = useState(false);
  /** Incrémenté à chaque rafraîchissement pour signaler au WeatherChart de se recharger */
  const [chartVersion, setChartVersion] = useState(0);

  const metricConfig = {
    temperature:   { label: 'Température', unit: '°C',   color: '#640D14', keys: ['temperature', 'temp', 't', 'dht_temp'] },
    humidity:      { label: 'Humidité',    unit: '%',    color: '#0ea5e9', keys: ['humidity', 'hum', 'humidite', 'h', 'dht_hum'] },
    pressure:      { label: 'Pression',    unit: 'hPa',  color: '#7c3aed', keys: ['pressure', 'pres', 'p', 'baro'] },
    windSpeed:     { label: 'Vent',        unit: 'km/h', color: '#10b981', keys: ['windSpeed', 'wind', 'vent', 'vitesse', 'w', 'anemo'] },
    precipitation: { label: 'Pluie',       unit: 'mm',   color: '#06b6d4', keys: ['precipitation', 'rain', 'pluie', 'r', 'pluvio'] },
  };

  const handleRefresh = async (sensorId?: string) => {
    const key = sensorId || 'all';
    setRefreshing(prev => ({ ...prev, [key]: true }));
    if (!sensorId) setGlobalLoading(true);

    try {
      const rawData = await fetchSensorData();
      if (rawData) {
        const newTemp  = findSmartValue(rawData, metricConfig.temperature.keys)   ?? data.currentTemp;
        const newHum   = findSmartValue(rawData, metricConfig.humidity.keys)      ?? data.currentHumidity;
        const newPres  = findSmartValue(rawData, metricConfig.pressure.keys)      ?? data.pressure;
        const newWind  = findSmartValue(rawData, metricConfig.windSpeed.keys)     ?? data.windSpeed;
        const newRain  = findSmartValue(rawData, metricConfig.precipitation.keys) ?? data.precipitation;

        setData(prev => ({
          ...prev,
          currentTemp:     newTemp,
          currentHumidity: newHum,
          pressure:        newPres,
          windSpeed:       newWind,
          precipitation:   newRain,
          lastUpdated:     new Date().toISOString(),
        }));

        publishVineyardUpdate({ temperature: newTemp, humidity: newHum, pressure: newPres, windSpeed: newWind, precipitation: newRain });

        // Persist dans IndexedDB (append-only) et signale au graphique
        appendReading({
          timestamp:     Date.now(),
          temperature:   newTemp,
          humidity:      newHum,
          pressure:      newPres,
          windSpeed:     newWind,
          precipitation: newRain,
        }).catch(err => console.warn('[IDB] append failed:', err));
        setChartVersion(v => v + 1);
      }
    } catch (err) {
      console.error('Erreur rafraîchissement:', err);
    } finally {
      setRefreshing(prev => ({ ...prev, [key]: false }));
      if (!sensorId) setGlobalLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 pb-24 pt-8 bg-[#FEFAE0]/50 min-h-screen">

      {/* Header */}
      <header className="mb-14 border-b-2 border-vinya-secondary/5 pb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-5xl font-serif font-black text-vinya-secondary">Tableau de Bord</h2>
          <p className="text-vinya-accent font-bold uppercase tracking-widest text-xs mt-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            Connexion Directe Firebase Active
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs font-bold text-gray-400 uppercase mb-1">Dernière synchro</p>
            <p className="text-2xl font-serif text-vinya-secondary">{new Date(data.lastUpdated).toLocaleTimeString()}</p>
          </div>
          <ShinyButton
            onClick={() => handleRefresh()}
            disabled={globalLoading}
            className="flex items-center gap-2 bg-white px-5 py-3 rounded-2xl shadow-sm border border-gray-100 font-bold text-sm text-vinya-secondary hover:shadow-md transition-shadow disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${globalLoading ? 'animate-spin' : ''}`} />
            Actualiser tout
          </ShinyButton>
        </div>
      </header>

      {/* Sensor cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        <SensorCard title="Température" value={data.currentTemp}     unit="°C"   color="orange" subtext="Capteur thermique"        icon={Thermometer} onClick={() => setSelectedMetric('temperature')}   isSelected={selectedMetric === 'temperature'}   isRefreshing={refreshing['temp']     || refreshing['all']} onRefresh={() => handleRefresh('temp')} />
        <SensorCard title="Humidité"    value={data.currentHumidity} unit="%"    color="blue"   subtext="Taux hygrométrique"       icon={Droplets}    onClick={() => setSelectedMetric('humidity')}      isSelected={selectedMetric === 'humidity'}      isRefreshing={refreshing['humidity'] || refreshing['all']} onRefresh={() => handleRefresh('humidity')} />
        <SensorCard title="Pression"    value={data.pressure}        unit="hPa"  color="purple" subtext="Station barométrique"     icon={Gauge}       onClick={() => setSelectedMetric('pressure')}      isSelected={selectedMetric === 'pressure'}      isRefreshing={refreshing['pressure'] || refreshing['all']} onRefresh={() => handleRefresh('pressure')} />
        <SensorCard title="Vent"        value={data.windSpeed}       unit="km/h" color="green"  subtext="Anémomètre station"       icon={Wind}        onClick={() => setSelectedMetric('windSpeed')}     isSelected={selectedMetric === 'windSpeed'}     isRefreshing={refreshing['wind']     || refreshing['all']} onRefresh={() => handleRefresh('wind')} />
        <SensorCard title="Pluie"       value={data.precipitation}   unit="mm"   color="cyan"   subtext="Pluviométrie"             icon={CloudRain}   onClick={() => setSelectedMetric('precipitation')} isSelected={selectedMetric === 'precipitation'} isRefreshing={refreshing['rain']     || refreshing['all']} onRefresh={() => handleRefresh('rain')} />
        <SensorCard title="Protection"  value={data.isTarpDeployed ? 'ACTIF' : 'OFF'} color="red" subtext={data.isTarpDeployed ? 'Bâche opérationnelle' : 'Vignes à découvert'} icon={ShieldCheck} isRefreshing={false} onRefresh={() => {}} />
      </div>

      {/* WeatherChart — historique interactif multi-métriques */}
      <WeatherChart
        refreshTrigger={chartVersion}
        currentValues={{
          temperature:   data.currentTemp,
          humidity:      data.currentHumidity,
          pressure:      data.pressure,
          windSpeed:     data.windSpeed,
          precipitation: data.precipitation,
        }}
      />

    </div>
  );
};

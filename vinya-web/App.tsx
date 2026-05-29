import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home } from './views/Home';
import { Dashboard } from './views/Dashboard';
import { MqttDashboard } from './views/MqttDashboard';
import { VineyardContext, defaultVineyardData } from './constants';
import { VineyardData } from './types';
import { fetchCurrentReadings, sendTarpCommand } from './services/firebaseService';
import { isClientConnected, publishMessage } from './services/mqttService';

const Navigation = () => {
  const location = useLocation();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const check = () => setIsConnected(isClientConnected());
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

  if (location.pathname === '/') return null;

  return (
    <header className="w-full py-6 px-8 flex justify-between items-center z-50 bg-[#FEFAE0] relative shadow-sm border-b border-vinya-secondary/5">
      <Link to="/" className="group transition-opacity hover:opacity-80">
        <img src="/logo-vinya.png" alt="Vinya" className="h-12 w-auto object-contain" />
      </Link>

      <div className="flex items-center gap-6">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${isConnected ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          <span className="relative flex h-2 w-2">
            {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
          </span>
          {isConnected ? 'Station Active' : 'Station Déconnectée'}
        </div>
        <div className="flex gap-4">
          {location.pathname !== '/mqtt' && (
            <Link to="/mqtt" className="text-xs font-bold uppercase tracking-widest text-[#640D14] hover:underline">Console</Link>
          )}
          {location.pathname !== '/dashboard' && (
            <Link to="/dashboard" className="text-xs font-bold uppercase tracking-widest text-[#640D14] hover:underline">Tableau</Link>
          )}
        </div>
      </div>
    </header>
  );
};

const App: React.FC = () => {
  const [data, setData] = useState<VineyardData>(defaultVineyardData);
  const isProcessingRef = useRef(false);
  const AUTO_TEMP_THRESHOLD = 24;

  useEffect(() => {
    if (!data.isAutoMode) return;

    const executeAutoAction = async (action: 'deploy' | 'retract') => {
      let mqttSuccess = false;
      if (isClientConnected()) {
        try {
          publishMessage('bzh/mecatro/dashboard/vinya/ordre', action === 'deploy' ? 'ouvrir' : 'fermer');
          mqttSuccess = true;
        } catch (e) { console.error('[AUTO] MQTT Error:', e); }
      }
      const firebaseSuccess = await sendTarpCommand(action);
      if (mqttSuccess || firebaseSuccess) {
        setData(prev => ({ ...prev, isTarpDeployed: action === 'deploy' }));
      }
    };

    const runAutoCheck = async () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      try {
        const readings = await fetchCurrentReadings();
        if (readings && readings.temp !== undefined) {
          setData(prev => ({
            ...prev,
            currentTemp:     readings.temp     ?? prev.currentTemp,
            currentHumidity: readings.hum      ?? prev.currentHumidity,
            pressure:        readings.pres     ?? prev.pressure,
            windSpeed:       readings.wind     ?? prev.windSpeed,
            precipitation:   readings.rain     ?? prev.precipitation,
            lastUpdated:     new Date().toISOString(),
          }));
          if ((readings.temp ?? 0) > AUTO_TEMP_THRESHOLD && !data.isTarpDeployed)
            await executeAutoAction('deploy');
          else if ((readings.temp ?? 0) <= AUTO_TEMP_THRESHOLD && data.isTarpDeployed)
            await executeAutoAction('retract');
        }
      } catch (err) {
        console.error('Auto loop error:', err);
      } finally {
        isProcessingRef.current = false;
      }
    };

    runAutoCheck();
    const id = setInterval(runAutoCheck, 3000);
    return () => clearInterval(id);
  }, [data.isAutoMode, data.isTarpDeployed]);

  return (
    <VineyardContext.Provider value={{ data, setData }}>
      <HashRouter>
        <div className="min-h-screen flex flex-col font-sans bg-[#FEFAE0]">
          <Navigation />
          <main className="flex-grow w-full">
            <Routes>
              <Route path="/"          element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/mqtt"      element={<MqttDashboard />} />
            </Routes>
          </main>
          <footer className="py-8 text-center text-vinya-secondary/40 text-xs font-serif tracking-widest uppercase">
            © 2024 Vinya • Excellence & Technologie
          </footer>
        </div>
      </HashRouter>
    </VineyardContext.Provider>
  );
};

export default App;

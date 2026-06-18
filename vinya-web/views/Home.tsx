import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionButton } from '../components/ActionButton';
import { ShinyButton } from '../components/ui/ShinyButton';
import { fetchFastVineyardData, sendTarpCommand, sendPumpCommand, sendMotorCommand, sendTarpDuration, sendPumpDuration, type MotorCmd } from '../services/firebaseService';
import { isClientConnected, publishMessage } from '../services/mqttService';
import { VineyardContext } from '../constants';

export const Home: React.FC = () => {
  const { data, setData } = useContext(VineyardContext);
  const [loading, setLoading] = useState(false);
  const [tarpStatus, setTarpStatus]   = useState<string>('');
  const [pumpActive, setPumpActive]   = useState(false);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpStatus, setPumpStatus]   = useState<string>('');
  const [motorSpeed, setMotorSpeed]   = useState<'SLOW' | 'FAST'>('SLOW');
  const [motorDir, setMotorDir]       = useState<'FORWARD' | 'BACKWARD' | 'STOP' | null>(null);
  const [motorStatus, setMotorStatus] = useState<string>('');
  const [isConsoleConnected, setIsConsoleConnected] = useState(false);
  const [tarpDuration, setTarpDuration] = useState(30);
  const [pumpDuration, setPumpDuration] = useState(30);
  const navigate = useNavigate();
  const AUTO_TEMP_THRESHOLD = 24;

  useEffect(() => {
    const check = () => setIsConsoleConnected(isClientConnected());
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

  const executeDeployTarp = async () => {
    if (data.isTarpDeployed) return;
    let mqttSuccess = false;
    if (isClientConnected()) {
      try {
        publishMessage('bzh/mecatro/dashboard/vinya/duree', String(tarpDuration));
        publishMessage('bzh/mecatro/dashboard/vinya/ordre', 'ouvrir');
        mqttSuccess = true;
      }
      catch (e) { console.error('MQTT Error:', e); }
    }
    setTarpStatus('Envoi de la commande...');
    await sendTarpDuration(tarpDuration);   // écrit la durée dans Firebase avant la commande
    const firebaseSuccess = await sendTarpCommand('deploy');
    if (mqttSuccess || firebaseSuccess) {
      setTarpStatus('Déploiement en cours...');
      setTimeout(() => {
        setData(prev => ({ ...prev, isTarpDeployed: true }));
        setTarpStatus(firebaseSuccess ? 'Bâche déployée avec succès.' : 'Commande envoyée (MQTT)');
        setTimeout(() => setTarpStatus(''), 3000);
      }, 2000);
    } else {
      setTarpStatus('Erreur de connexion');
      setTimeout(() => setTarpStatus(''), 3000);
    }
  };

  const executeRetractTarp = async () => {
    if (!data.isTarpDeployed) return;
    let mqttSuccess = false;
    if (isClientConnected()) {
      try {
        publishMessage('bzh/mecatro/dashboard/vinya/duree', String(tarpDuration));
        publishMessage('bzh/mecatro/dashboard/vinya/ordre', 'fermer');
        mqttSuccess = true;
      }
      catch (e) { console.error('MQTT Error:', e); }
    }
    setTarpStatus('Envoi de la commande...');
    await sendTarpDuration(tarpDuration);   // écrit la durée dans Firebase avant la commande
    const firebaseSuccess = await sendTarpCommand('retract');
    if (mqttSuccess || firebaseSuccess) {
      setTarpStatus('Rétractation en cours...');
      setTimeout(() => {
        setData(prev => ({ ...prev, isTarpDeployed: false }));
        setTarpStatus(firebaseSuccess ? 'Bâche rangée.' : 'Commande envoyée (MQTT)');
        setTimeout(() => setTarpStatus(''), 3000);
      }, 2000);
    } else {
      setTarpStatus('Erreur de connexion');
      setTimeout(() => setTarpStatus(''), 3000);
    }
  };

  const handlePump = async () => {
    setPumpLoading(true);
    const nextState = !pumpActive;
    const cmd = nextState ? 'ON' : 'OFF';
    setPumpStatus(nextState ? 'Démarrage pompe...' : 'Arrêt pompe...');
    // Écrit la durée pompe dans Firebase (canal fiable) + MQTT avant la commande ON
    if (nextState) {
      await sendPumpDuration(pumpDuration);
      if (isClientConnected()) {
        try { publishMessage('bzh/mecatro/dashboard/vinya/pompe_duree', String(pumpDuration)); }
        catch (e) { console.error('MQTT pump duration error:', e); }
      }
    }
    const ok = await sendPumpCommand(cmd);
    if (ok) {
      setPumpActive(nextState);
      setPumpStatus(nextState ? `Pompe active (${pumpDuration}s)` : 'Pompe arrêtée');
    } else {
      setPumpStatus('Erreur connexion');
    }
    setTimeout(() => setPumpStatus(''), 3000);
    setPumpLoading(false);
  };

  // Bouton pompe MAINTIEN : ON tant qu'on appuie, OFF au relâchement (temps réel via MQTT)
  const [pumpHeld, setPumpHeld] = useState(false);

  const startPumpHold = () => {
    setPumpHeld(true);
    setPumpStatus('Pompe (maintien)...');
    if (isClientConnected()) {
      try { publishMessage('bzh/mecatro/dashboard/vinya/pompe_manuel', 'on'); }
      catch (e) { console.error('MQTT pompe_manuel on error:', e); }
    }
    // Backup Firebase (au cas où MQTT non connecté)
    sendPumpCommand('ON');
  };

  const stopPumpHold = () => {
    if (!pumpHeld) return;
    setPumpHeld(false);
    setPumpStatus('Pompe arrêtée');
    if (isClientConnected()) {
      try { publishMessage('bzh/mecatro/dashboard/vinya/pompe_manuel', 'off'); }
      catch (e) { console.error('MQTT pompe_manuel off error:', e); }
    }
    sendPumpCommand('OFF');
    setTimeout(() => setPumpStatus(''), 2000);
  };

  // Re-envoie la commande si la vitesse change pendant qu'un moteur tourne
  useEffect(() => {
    if (motorDir === 'FORWARD' || motorDir === 'BACKWARD') {
      const cmd: MotorCmd = `${motorDir}_${motorSpeed}` as MotorCmd;
      sendMotorCommand(cmd);
      setMotorStatus(`${motorDir === 'FORWARD' ? '▶ Marche' : '◀ Arrière'} · ${motorSpeed === 'SLOW' ? 'Lent' : 'Rapide'}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorSpeed]);

  const startMotor = async (dir: 'FORWARD' | 'BACKWARD') => {
    setMotorDir(dir);
    const cmd: MotorCmd = `${dir}_${motorSpeed}` as MotorCmd;
    setMotorStatus(`${dir === 'FORWARD' ? '▶ Marche' : '◀ Arrière'} · ${motorSpeed === 'SLOW' ? 'Lent' : 'Rapide'} — envoi...`);
    // MQTT en priorité (temps réel) — Firebase en backup
    if (isClientConnected()) {
      try { publishMessage('bzh/mecatro/dashboard/vinya/moteur_b', cmd.toLowerCase()); }
      catch (e) { console.error('MQTT moteur_b error:', e); }
    }
    const ok = await sendMotorCommand(cmd);
    setMotorStatus(ok
      ? `${dir === 'FORWARD' ? '▶ Marche' : '◀ Arrière'} · ${motorSpeed === 'SLOW' ? 'Lent' : 'Rapide'}`
      : '⚠ Erreur Firebase');
  };

  // Appelée au relâchement des boutons Marche / Arrière
  const stopMotor = async () => {
    if (motorDir !== 'FORWARD' && motorDir !== 'BACKWARD') return;
    setMotorDir('STOP');
    if (isClientConnected()) {
      try { publishMessage('bzh/mecatro/dashboard/vinya/moteur_b', 'stop'); }
      catch (e) { console.error('MQTT moteur_b stop error:', e); }
    }
    setMotorStatus('⏹ Arrêt...');
    await sendMotorCommand('STOP');
    setTimeout(() => { setMotorDir(null); setMotorStatus(''); }, 400);
  };

  // Bouton Arrêt explicite — envoie STOP même si l'état local est désynchronisé
  const handleArrêt = async () => {
    setMotorDir('STOP');
    setMotorStatus('⏹ Arrêt...');
    await sendMotorCommand('STOP');
    setTimeout(() => { setMotorDir(null); setMotorStatus(''); }, 400);
  };

  const handleAutoModeToggle = () => {
    const newAutoMode = !data.isAutoMode;
    if (isClientConnected()) {
      try { publishMessage('bzh/mecatro/dashboard/vinya/mode', newAutoMode ? 'auto' : 'manu'); }
      catch (e) { console.error('MQTT Error (Mode):', e); }
    }
    setData(prev => ({ ...prev, isAutoMode: newAutoMode }));
  };

  const handleGetData = async () => {
    setLoading(true);
    try {
      const fastData = await fetchFastVineyardData();
      setData(prev => ({ ...fastData, isTarpDeployed: prev.isTarpDeployed, isAutoMode: prev.isAutoMode }));
      navigate('/dashboard');
    } catch {
      alert('Erreur lors de la récupération des données.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeployTarp = async () => {
    if (data.isAutoMode && data.currentTemp > AUTO_TEMP_THRESHOLD) {
      setTarpStatus('Mode Auto actif (>24°C)');
      setTimeout(() => setTarpStatus(''), 2000);
      return;
    }
    await executeDeployTarp();
  };

  const handleRetractTarp = async () => {
    if (data.isAutoMode && data.currentTemp <= AUTO_TEMP_THRESHOLD) {
      setTarpStatus('Mode Auto actif (<=24°C)');
      setTimeout(() => setTarpStatus(''), 2000);
      return;
    }
    await executeRetractTarp();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] px-4 text-center animate-fade-in-up pb-12 relative">

      {/* MQTT status badge */}
      <div className={`absolute top-4 right-4 flex items-center gap-2 bg-white/80 backdrop-blur px-3 py-1.5 rounded-full shadow-sm border z-50 animate-fade-in-up transition-colors duration-300 ${isConsoleConnected ? 'border-emerald-100' : 'border-red-100 opacity-60'}`}>
        <span className="relative flex h-2 w-2">
          {isConsoleConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isConsoleConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isConsoleConnected ? 'text-emerald-700' : 'text-red-700'}`}>
          {isConsoleConnected ? 'Console Active' : 'Console Inactive'}
        </span>
      </div>

      {/* Logo */}
      <div className="mb-10 max-w-3xl flex flex-col items-center mt-8">
        <img src="/logo-vinya.png" alt="Vinya" className="h-32 w-auto object-contain mb-2 drop-shadow-sm" />
        <div className="h-1 w-20 bg-vinya-secondary mx-auto mb-4 rounded-full opacity-80"></div>
        <p className="text-xl text-gray-600 font-light italic max-w-lg">
          "Station météo autonome pour les vignes"
        </p>
      </div>

      {/* Main control card */}
      <div className="w-full max-w-4xl bg-white/70 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/50 relative overflow-hidden flex flex-col">
        <div className="absolute top-0 right-0 w-96 h-96 bg-vinya-secondary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-vinya-accent/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>

        <div className="p-10 pb-6 relative z-10">
          <h3 className="text-xs font-bold uppercase text-gray-400 mb-8 tracking-[0.2em] flex items-center justify-center gap-4">
            <span className="h-px w-8 bg-gray-300"></span>
            Contrôle Opérationnel
            <span className="h-px w-8 bg-gray-300"></span>
          </h3>

          <div className="flex flex-col md:flex-row items-center justify-center gap-6 w-full">
            <div className="w-full md:w-1/3 flex justify-center order-2 md:order-1">
              <ActionButton
                variant="secondary"
                onClick={handleDeployTarp}
                disabled={data.isTarpDeployed || !!tarpStatus || (data.isAutoMode && data.currentTemp > AUTO_TEMP_THRESHOLD)}
                className="w-full py-4 text-sm font-medium"
              >
                Déployer
              </ActionButton>
            </div>

            <div className="w-full md:w-1/3 flex justify-center order-1 md:order-2 z-10 relative">
              <div className="absolute inset-0 bg-vinya-secondary/10 rounded-2xl blur-xl animate-pulse-slow"></div>
              <ShinyButton
                onClick={handleGetData}
                disabled={loading}
                className="w-full text-lg py-5 uppercase tracking-widest font-black border-2 border-vinya-secondary/10 hover:border-vinya-secondary/30 relative z-10 shadow-xl bg-[#FEFAE0] text-vinya-secondary rounded-xl px-6"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Chargement...
                  </>
                ) : 'GET DATA'}
              </ShinyButton>
            </div>

            <div className="w-full md:w-1/3 flex justify-center order-3">
              <ActionButton
                variant="secondary"
                onClick={handleRetractTarp}
                disabled={!data.isTarpDeployed || !!tarpStatus || (data.isAutoMode && data.currentTemp <= AUTO_TEMP_THRESHOLD)}
                className="w-full py-4 text-sm font-medium"
              >
                Rétracter
              </ActionButton>
            </div>
          </div>

          {/* ── Curseur durée d'action ── */}
          <div className="mt-6 px-4 flex flex-col items-center gap-2">
            <div className="flex items-center justify-between w-full max-w-sm">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">Durée d'action</span>
              <span className="text-vinya-secondary font-black text-base tabular-nums">
                {tarpDuration}s
              </span>
            </div>
            <div className="relative w-full max-w-sm">
              <input
                type="range"
                min={1}
                max={120}
                step={1}
                value={tarpDuration}
                onChange={(e) => setTarpDuration(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #640D14 0%, #640D14 ${((tarpDuration - 1) / 119) * 100}%, #e5e7eb ${((tarpDuration - 1) / 119) * 100}%, #e5e7eb 100%)`,
                  accentColor: '#640D14',
                }}
              />
            </div>
            <div className="flex justify-between w-full max-w-sm text-[10px] text-gray-300 font-medium select-none">
              <span>1s</span>
              <span>30s</span>
              <span>60s</span>
              <span>90s</span>
              <span>120s</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Le moteur s'arrête automatiquement après <span className="font-bold text-vinya-secondary">{tarpDuration} secondes</span>
            </p>
          </div>

          {/* Bouton Pompe */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={handlePump}
              disabled={pumpLoading}
              className={`relative overflow-hidden flex items-center gap-3 px-8 py-3 rounded-2xl font-bold text-sm border-2 transition-all duration-300 active:scale-95 disabled:opacity-50 shadow-md
                ${pumpActive
                  ? 'bg-cyan-500 border-cyan-400 text-white hover:bg-cyan-600 shadow-cyan-200'
                  : 'bg-white border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:border-cyan-400'
                }`}
            >
              {/* Animated water rings when active */}
              {pumpActive && (
                <span className="absolute inset-0 rounded-2xl animate-ping bg-cyan-400/20 pointer-events-none" />
              )}
              {/* Icon */}
              <svg className={`w-5 h-5 relative z-10 ${pumpLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              <span className="relative z-10 uppercase tracking-widest">
                {pumpLoading ? 'Envoi...' : pumpActive ? 'Pompe ON' : 'Pompe OFF'}
              </span>
              {/* Active indicator dot */}
              {pumpActive && (
                <span className="relative z-10 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
              )}
            </button>

            {/* Bouton Pompe MAINTIEN — actif tant qu'on appuie */}
            <button
              onMouseDown={startPumpHold}
              onMouseUp={stopPumpHold}
              onMouseLeave={stopPumpHold}
              onTouchStart={(e) => { e.preventDefault(); startPumpHold(); }}
              onTouchEnd={stopPumpHold}
              onTouchCancel={stopPumpHold}
              className={`select-none relative overflow-hidden flex items-center gap-3 px-8 py-3 rounded-2xl font-bold text-sm border-2 transition-all duration-150 active:scale-95 shadow-md
                ${pumpHeld
                  ? 'bg-cyan-600 border-cyan-500 text-white scale-105 shadow-cyan-300'
                  : 'bg-white border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:border-cyan-400'
                }`}
            >
              {pumpHeld && (
                <span className="absolute inset-0 rounded-2xl animate-ping bg-cyan-400/30 pointer-events-none" />
              )}
              <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="relative z-10 uppercase tracking-widest">
                {pumpHeld ? 'Pompe active' : 'Maintenir pompe'}
              </span>
            </button>
            <p className="text-[10px] text-gray-400 -mt-1">
              Maintenir le bouton pour activer la pompe en continu
            </p>

            {/* Pump status */}
            {pumpStatus && (
              <span className="text-cyan-600 font-semibold text-sm animate-pulse">{pumpStatus}</span>
            )}

            {/* ── Curseur durée pompe ── */}
            <div className="flex flex-col items-center gap-2 w-full max-w-sm mt-1">
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">Durée pompe</span>
                <span className="text-cyan-600 font-black text-base tabular-nums">{pumpDuration}s</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={pumpDuration}
                onChange={(e) => setPumpDuration(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #0e7490 0%, #0e7490 ${((pumpDuration - 5) / 115) * 100}%, #e5e7eb ${((pumpDuration - 5) / 115) * 100}%, #e5e7eb 100%)`,
                  accentColor: '#0e7490',
                }}
              />
              <div className="flex justify-between w-full text-[10px] text-gray-300 font-medium select-none">
                <span>5s</span>
                <span>30s</span>
                <span>60s</span>
                <span>90s</span>
                <span>120s</span>
              </div>
              <p className="text-[10px] text-gray-400">
                La pompe s'arrête automatiquement après <span className="font-bold text-cyan-600">{pumpDuration} secondes</span>
              </p>
            </div>
          </div>

          {/* Status feedback */}
          <div className="h-8 mt-3 flex items-center justify-center">
            {tarpStatus && (
              <span className="text-vinya-secondary font-serif font-bold text-lg animate-pulse flex items-center gap-2">
                {tarpStatus}
              </span>
            )}
            {!tarpStatus && data.isTarpDeployed && (
              <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#640D14]/10 border border-[#640D14]/20 text-[#640D14]">
                <span className="w-2 h-2 bg-[#640D14] rounded-full animate-pulse mr-2"></span>
                <span className="font-bold text-xs tracking-wide uppercase">Bâche Déployée</span>
              </div>
            )}
            {!tarpStatus && data.isAutoMode && (
              <div className="absolute top-10 right-10 flex flex-col items-end">
                <span className="text-[10px] font-bold text-purple-600 animate-pulse bg-purple-50 px-2 py-1 rounded-full border border-purple-100">
                  AUTO MONITORING ON
                </span>
                <span className="text-[10px] text-gray-400 mt-1 tabular-nums">
                  Temp: {data.currentTemp}°C
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Séparateur ── */}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>

        {/* ── Pilotage Manuel Moteurs ── */}
        <div className="px-10 py-7 relative z-10">
          <h3 className="text-[10px] font-bold uppercase text-gray-400 mb-5 tracking-[0.2em] flex items-center gap-3">
            <span className="h-px w-6 bg-gray-300"></span>
            Pilotage Manuel Moteurs
            <span className="h-px w-6 bg-gray-300"></span>
          </h3>

          {/* Sélecteur de vitesse */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vitesse</span>
            <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
              {(['SLOW', 'FAST'] as const).map(spd => (
                <button
                  key={spd}
                  onClick={() => setMotorSpeed(spd)}
                  className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200
                    ${motorSpeed === spd
                      ? 'bg-vinya-secondary text-white shadow-md scale-105'
                      : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {spd === 'SLOW' ? '🐢 Lent' : '⚡ Rapide'}
                </button>
              ))}
            </div>
          </div>

          {/* Boutons de direction */}
          <div className="flex items-center justify-center gap-4">
            {/* ARRIÈRE — maintenir */}
            <button
              onMouseDown={() => startMotor('BACKWARD')}
              onMouseUp={stopMotor}
              onMouseLeave={stopMotor}
              onTouchStart={e => { e.preventDefault(); startMotor('BACKWARD'); }}
              onTouchEnd={stopMotor}
              onTouchCancel={stopMotor}
              className={`select-none flex flex-col items-center gap-1.5 px-7 py-4 rounded-2xl border-2 font-bold text-sm transition-all duration-150 active:scale-95 shadow-sm
                ${motorDir === 'BACKWARD'
                  ? 'bg-vinya-secondary text-white border-vinya-secondary scale-105 shadow-lg shadow-vinya-secondary/30'
                  : 'bg-white text-vinya-secondary border-vinya-secondary/40 hover:border-vinya-secondary hover:bg-vinya-secondary/5'}`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              Arrière
            </button>

            {/* ARRÊT */}
            <button
              onClick={handleArrêt}
              className={`select-none flex flex-col items-center gap-1.5 px-6 py-4 rounded-2xl border-2 font-bold text-sm transition-all duration-150 active:scale-95 shadow-sm
                ${motorDir === 'STOP'
                  ? 'bg-gray-800 text-white border-gray-800 shadow-md animate-pulse'
                  : motorDir === null
                    ? 'bg-gray-800 text-white border-gray-800 shadow-md'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-800 hover:text-white hover:border-gray-800'}`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Arrêt
            </button>

            {/* MARCHE — maintenir */}
            <button
              onMouseDown={() => startMotor('FORWARD')}
              onMouseUp={stopMotor}
              onMouseLeave={stopMotor}
              onTouchStart={e => { e.preventDefault(); startMotor('FORWARD'); }}
              onTouchEnd={stopMotor}
              onTouchCancel={stopMotor}
              className={`select-none flex flex-col items-center gap-1.5 px-7 py-4 rounded-2xl border-2 font-bold text-sm transition-all duration-150 active:scale-95 shadow-sm
                ${motorDir === 'FORWARD'
                  ? 'bg-emerald-500 text-white border-emerald-500 scale-105 shadow-lg shadow-emerald-200'
                  : 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50'}`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              Marche
            </button>
          </div>

          <p className="text-center text-[10px] text-gray-400 font-medium mt-4 tracking-wide">
            Maintenir <span className="font-bold text-vinya-secondary">Marche</span> ou <span className="font-bold text-vinya-secondary">Arrière</span> pour piloter
          </p>

          {/* Statut moteur en temps réel */}
          <div className="mt-3 h-6 flex items-center justify-center">
            {motorStatus && (
              <span className={`text-xs font-bold tracking-wide transition-all
                ${motorDir === 'STOP' ? 'text-gray-500 animate-pulse' :
                  motorDir === 'FORWARD' ? 'text-emerald-600' :
                  motorDir === 'BACKWARD' ? 'text-vinya-secondary' : 'text-gray-400'}`}>
                {motorStatus}
              </span>
            )}
          </div>
        </div>

        <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>

        {/* System & Maintenance */}
        <div className="bg-gray-50/50 p-8 pt-6 relative">
          <h3 className="text-[10px] font-bold uppercase text-gray-400 mb-4 tracking-widest text-left pl-1">
            Système & Maintenance
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              {/* Auto mode toggle */}
              <button
                onClick={handleAutoModeToggle}
                className={`w-full flex items-center justify-between px-5 py-3 rounded-xl border transition-all duration-200 group ${data.isAutoMode ? 'bg-white border-purple-200 shadow-sm' : 'bg-white/50 border-gray-200 hover:bg-white'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${data.isAutoMode ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-400'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-bold ${data.isAutoMode ? 'text-purple-900' : 'text-gray-500'}`}>Mode Automatique</div>
                    <div className="text-[10px] text-gray-400">Surveillance continue</div>
                  </div>
                </div>
                <div className={`w-10 h-5 rounded-full relative transition-colors ${data.isAutoMode ? 'bg-purple-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${data.isAutoMode ? 'translate-x-5' : ''}`}></div>
                </div>
              </button>

              {/* MQTT connection status */}
              <div className={`w-full flex items-center justify-between px-5 py-3 rounded-xl border bg-white shadow-sm transition-all duration-500 ${isConsoleConnected ? 'border-emerald-200' : 'border-red-200 opacity-90'}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isConsoleConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-bold ${isConsoleConnected ? 'text-emerald-900' : 'text-red-900'}`}>
                      {isConsoleConnected ? 'Station Connectée' : 'Station Déconnectée'}
                    </div>
                    <div className={`text-[10px] font-medium ${isConsoleConnected ? 'text-emerald-600/70' : 'text-red-600/70'}`}>
                      {isConsoleConnected ? 'Flux MQTT Actif' : 'Flux MQTT Interrompu'}
                    </div>
                  </div>
                </div>
                <div className="relative flex h-3 w-3">
                  {isConsoleConnected ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  )}
                </div>
              </div>
            </div>

            {/* Console MQTT link */}
            <div className="flex flex-col h-full">
              <button
                onClick={() => navigate('/mqtt')}
                className="group relative flex-1 flex flex-col justify-between overflow-hidden bg-[#1a1a2e] rounded-xl p-5 border border-gray-800 hover:shadow-2xl hover:shadow-blue-900/20 transition-all duration-300"
              >
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#4f46e5 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
                <div className="flex justify-between items-start z-10 w-full">
                  <div className="p-2 bg-gray-800/50 backdrop-blur rounded-lg border border-gray-700 text-blue-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
                <div className="z-10 mt-4 text-left">
                  <h4 className="text-white font-bold text-lg group-hover:text-blue-300 transition-colors">Console MQTT</h4>
                  <p className="text-gray-400 text-xs mt-1">Accéder aux logs temps réel.</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

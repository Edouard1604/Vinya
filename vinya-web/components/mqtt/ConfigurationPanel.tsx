import React, { useState, useEffect } from 'react';
import { ConnectionConfig, ConnectionStatus } from '../../types';
import { MQTT_CONFIG } from '../../constants';
import { PlugZap, CheckCircle2, XCircle, FolderGit2, Layers, AlertCircle, Lock } from 'lucide-react';

interface ConfigurationPanelProps {
  status: ConnectionStatus;
  onConnect: (config: ConnectionConfig) => void;
  onDisconnect: () => void;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  subscriptions: string[];
}

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  status, onConnect, onDisconnect, projectName, onProjectNameChange, subscriptions,
}) => {
  const [localProjectName, setLocalProjectName] = useState(projectName);

  useEffect(() => { setLocalProjectName(projectName); }, [projectName]);

  const handleConnect = () =>
    onConnect({ ...MQTT_CONFIG, clientId: `${MQTT_CONFIG.clientId}_${Math.random().toString(16).substr(2, 8)}` });

  const handleBlur = () => { if (localProjectName !== projectName) onProjectNameChange(localProjectName); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };

  const isConnected  = status === ConnectionStatus.CONNECTED;
  const isConnecting = status === ConnectionStatus.CONNECTING;

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-vinya-secondary/10 overflow-hidden flex flex-col">
      <div className="bg-gray-50 p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-full ${isConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
            <PlugZap className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-vinya-secondary leading-tight">Broker & Project</h2>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-mono">
              <Lock className="w-3 h-3 text-emerald-500" />
              <span>{MQTT_CONFIG.host}:{MQTT_CONFIG.port}{MQTT_CONFIG.path}</span>
              <span className="text-gray-300">|</span>
              <span className="uppercase text-emerald-600 font-bold">{MQTT_CONFIG.protocol}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            isConnected ? 'bg-emerald-100 border-emerald-200 text-emerald-600' :
            status === ConnectionStatus.ERROR ? 'bg-red-100 border-red-200 text-red-600' :
            'bg-gray-100 border-gray-200 text-gray-500'
          }`}>{status}</span>
          {isConnected || isConnecting ? (
            <button onClick={onDisconnect} className="bg-red-500 hover:bg-red-600 text-white p-1.5 rounded transition-colors" title="Disconnect">
              <XCircle className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleConnect} className="bg-vinya-secondary hover:bg-[#500a10] text-white py-1.5 px-3 rounded text-xs font-bold transition-colors flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Connecter
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {status === ConnectionStatus.ERROR && (
          <div className="text-[10px] bg-red-50 border border-red-200 text-red-600 p-2 rounded flex items-start gap-2">
            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold">Connexion échouée</p>
              <p className="opacity-80">Vérifiez le support WSS sur le port 443.</p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1 flex items-center gap-1">
            <FolderGit2 className="w-3 h-3" /> Nom du Projet
          </label>
          <input
            type="text"
            value={localProjectName}
            onChange={(e) => setLocalProjectName(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="ex: vinya"
            className={`w-full bg-gray-50 border rounded-lg px-3 py-2 text-sm outline-none transition-all ${
              !localProjectName.trim() ? 'border-yellow-300 focus:border-yellow-500' : 'border-gray-200 focus:border-vinya-accent'
            } text-gray-800 placeholder-gray-400`}
          />
          {!localProjectName.trim() && (
            <p className="text-[10px] text-yellow-600 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Requis pour les topics
            </p>
          )}
        </div>

        <div className="bg-gray-50 rounded p-2 border border-gray-100">
          <div className="flex items-start gap-2">
            <Layers className={`w-3.5 h-3.5 mt-0.5 ${isConnected && subscriptions.length > 0 ? 'text-emerald-500' : 'text-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold text-gray-400 mb-0.5">Abonnement Actif</div>
              {isConnected && subscriptions.length > 0 ? (
                <div className="font-mono text-[10px] text-emerald-600 break-all">{subscriptions[0]}</div>
              ) : (
                <div className="text-[10px] text-gray-500 italic">{isConnected ? 'En attente...' : 'Non connecté'}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

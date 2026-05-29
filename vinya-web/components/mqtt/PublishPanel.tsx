import React, { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, Clock, AlertCircle, LayoutDashboard, Radio, Activity, Search } from 'lucide-react';
import { StoredHistory } from '../../types';
import { MQTT_TOPICS } from '../../constants';

interface PublishPanelProps {
  onPublish: (topic: string, payload: string) => void;
  history: StoredHistory;
  connected: boolean;
  projectName: string;
}

type PublishMode = 'dashboard' | 'actuator' | 'sensor';

export const PublishPanel: React.FC<PublishPanelProps> = ({ onPublish, history, connected, projectName }) => {
  const [mode, setMode] = useState<PublishMode>('dashboard');
  const [suffix, setSuffix] = useState('');
  const [payload, setPayload] = useState('ON');
  const [showTopicHistory, setShowTopicHistory] = useState(false);
  const [showPayloadHistory, setShowPayloadHistory] = useState(false);
  const [topicFilter, setTopicFilter] = useState('');
  const topicRef   = useRef<HTMLDivElement>(null);
  const payloadRef = useRef<HTMLDivElement>(null);

  const cleanProjectName = projectName.trim();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (topicRef.current && !topicRef.current.contains(e.target as Node)) setShowTopicHistory(false);
      if (payloadRef.current && !payloadRef.current.contains(e.target as Node)) setShowPayloadHistory(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getTopicPrefix = () => {
    if (!cleanProjectName) return 'bzh/mecatro/...';
    if (mode === 'dashboard') return MQTT_TOPICS.getDashboard(cleanProjectName);
    if (mode === 'actuator')  return MQTT_TOPICS.getProjectActionneurs(cleanProjectName);
    return MQTT_TOPICS.getProjectCapteurs(cleanProjectName);
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !cleanProjectName || !suffix) return;
    onPublish(`${getTopicPrefix()}${suffix}`, payload);
  };

  const selectHistoryItem = (type: 'topic' | 'payload', value: string) => {
    if (type === 'topic') {
      if (value.includes('/dashboard/'))   setMode('dashboard');
      else if (value.includes('/actionneurs/')) setMode('actuator');
      else if (value.includes('/capteurs/'))    setMode('sensor');
      setSuffix(value.split('/').pop() || value);
      setShowTopicHistory(false);
    } else {
      setPayload(value);
      setShowPayloadHistory(false);
    }
  };

  const filteredTopics = history.topics.filter(t => t.toLowerCase().includes(topicFilter.toLowerCase()));

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-vinya-secondary/10 flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
        <h2 className="font-bold flex items-center gap-2 text-vinya-secondary text-sm">
          <Send className="w-4 h-4 text-vinya-accent" />
          Test & Control
        </h2>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-3 overflow-y-auto">
        {!cleanProjectName && (
          <div className="p-2 bg-yellow-50 border border-yellow-200 rounded flex items-center gap-2 text-yellow-700 text-xs">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>Définir <b>Projet</b> ci-dessus.</span>
          </div>
        )}

        <div className={`flex flex-col gap-3 ${!cleanProjectName ? 'opacity-50 pointer-events-none' : ''}`}>
          {/* Mode selector */}
          <div className="flex p-1 bg-gray-100 rounded-lg border border-gray-200">
            {([['dashboard', LayoutDashboard, 'Dash', 'blue'], ['actuator', Radio, 'Cmd', 'indigo'], ['sensor', Activity, 'Data', 'emerald']] as const).map(([m, Icon, label, col]) => (
              <button
                key={m}
                onClick={() => setMode(m as PublishMode)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all ${mode === m ? `bg-white text-${col}-600 shadow-sm` : 'text-gray-500'}`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handlePublish} className="flex flex-col gap-3">
            {/* Topic */}
            <div className="relative" ref={topicRef}>
              <label className="block text-[10px] font-bold text-gray-400 mb-1">
                {mode === 'dashboard' ? 'Variable' : 'Composant'}
              </label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-l px-3 py-1.5 text-sm focus:border-vinya-accent outline-none font-mono text-gray-800"
                  placeholder={mode === 'actuator' ? 'pompe' : 'temperature'}
                />
                <button
                  type="button"
                  onClick={() => { setShowTopicHistory(!showTopicHistory); setTopicFilter(''); }}
                  className="bg-gray-100 border border-l-0 border-gray-200 rounded-r px-2 py-1.5 hover:bg-gray-200 text-gray-600 transition-colors h-full"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-1 text-[10px] text-gray-400 font-mono break-all">
                Topic: <span className="text-gray-600 font-bold">{getTopicPrefix()}{suffix || '...'}</span>
              </div>
              {showTopicHistory && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-xl z-20 max-h-[200px] overflow-y-auto flex flex-col">
                  <div className="p-2 sticky top-0 bg-white border-b border-gray-100 z-10">
                    <div className="relative">
                      <Search className="absolute left-2 top-1.5 w-3 h-3 text-gray-400" />
                      <input type="text" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} placeholder="Filtrer..." className="w-full bg-gray-50 border border-gray-200 rounded pl-7 pr-2 py-1 text-xs outline-none" autoFocus />
                    </div>
                  </div>
                  {filteredTopics.map((t, i) => (
                    <button key={i} type="button" onClick={() => selectHistoryItem('topic', t)} className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-vinya-primary hover:text-vinya-secondary transition-colors border-b border-gray-50 font-mono truncate">
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Payload */}
            <div className="flex-1 flex flex-col relative" ref={payloadRef}>
              <div className="flex justify-between items-end mb-1">
                <label className="block text-[10px] font-bold text-gray-400">Valeur / Message</label>
                <button type="button" onClick={() => setShowPayloadHistory(!showPayloadHistory)} className="text-[10px] flex items-center gap-1 text-vinya-accent hover:text-vinya-secondary transition-colors">
                  <Clock className="w-3 h-3" />
                </button>
              </div>
              <div className="relative">
                <input type="text" value={payload} onChange={(e) => setPayload(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-sm focus:border-vinya-accent outline-none font-mono text-gray-800" placeholder="ON" />
                {showPayloadHistory && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-xl z-20 max-h-[200px] overflow-y-auto">
                    {history.payloads.map((p, i) => (
                      <button key={i} type="button" onClick={() => selectHistoryItem('payload', p)} className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-vinya-primary hover:text-vinya-secondary transition-colors border-b border-gray-50 font-mono truncate">
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!connected || !cleanProjectName || !suffix}
              className={`w-full font-bold py-2.5 px-4 rounded-lg transition-all shadow-md flex items-center justify-center gap-2 mt-1 text-sm ${
                connected && cleanProjectName && suffix ? 'bg-vinya-secondary hover:bg-[#500a10] text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Envoyer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { connectToBroker, disconnectBroker, publishMessage, isClientConnected } from '../services/mqttService';
import { ConfigurationPanel } from '../components/mqtt/ConfigurationPanel';
import { PublishPanel } from '../components/mqtt/PublishPanel';
import { MessageList } from '../components/mqtt/MessageList';
import { ConnectionStatus, ConnectionConfig, MqttMessage, StoredHistory } from '../types';
import { MQTT_TOPICS, MQTT_CONFIG } from '../constants';

export const MqttDashboard: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [projectName, setProjectName] = useState('vinya');
  const [activeSubscriptions, setActiveSubscriptions] = useState<string[]>([]);
  const [messages, setMessages] = useState<MqttMessage[]>([]);
  const [history, setHistory] = useState<StoredHistory>({
    topics:   ['temperature', 'humidite', 'pompe', 'led'],
    payloads: ['ON', 'OFF', '25', '{"status":"ok"}'],
  });

  useEffect(() => {
    const savedProject = localStorage.getItem('mqtt_project');
    const projectToUse = savedProject || projectName;
    if (savedProject) setProjectName(savedProject);

    if (isClientConnected()) {
      const subTopic = MQTT_TOPICS.getSubWildcard(projectToUse.trim());
      connectToBroker(
        MQTT_CONFIG,
        () => { setStatus(ConnectionStatus.CONNECTED); setActiveSubscriptions([subTopic]); addSystemMessage(`Session restaurée. Abonnement: ${subTopic}`); },
        (topic, payload) => addMessage(topic, payload, 'in'),
        () => setStatus(ConnectionStatus.ERROR),
        subTopic
      );
    }
  }, []);

  const handleConnect = (config: ConnectionConfig) => {
    if (!projectName.trim()) { alert('Veuillez définir un nom de projet.'); return; }
    setStatus(ConnectionStatus.CONNECTING);
    const subTopic = MQTT_TOPICS.getSubWildcard(projectName.trim());
    connectToBroker(
      config,
      () => { setStatus(ConnectionStatus.CONNECTED); setActiveSubscriptions([subTopic]); addSystemMessage(`Connecté. Abonnement: ${subTopic}`); },
      (topic, payload) => addMessage(topic, payload, 'in'),
      (err) => { setStatus(ConnectionStatus.ERROR); addSystemMessage(`Erreur: ${err.message}`); },
      subTopic
    );
  };

  const handleDisconnect = () => {
    disconnectBroker();
    setStatus(ConnectionStatus.DISCONNECTED);
    setActiveSubscriptions([]);
    addSystemMessage('Déconnecté.');
  };

  const handleProjectNameChange = (name: string) => {
    setProjectName(name);
    localStorage.setItem('mqtt_project', name);
    if (status === ConnectionStatus.CONNECTED) addSystemMessage('Projet changé. Reconnectez-vous pour mettre à jour.');
  };

  const handlePublish = (topic: string, payload: string) => {
    try {
      publishMessage(topic, payload);
      addMessage(topic, payload, 'out');
      addToHistory(topic, payload);
    } catch (e: any) {
      addSystemMessage(`Erreur d'envoi: ${e.message}`);
    }
  };

  const addMessage = (topic: string, payload: string, direction: 'in' | 'out') =>
    setMessages(prev => [...prev.slice(-99), { id: Date.now().toString() + Math.random(), timestamp: Date.now(), topic, payload, direction }]);

  const addSystemMessage = (text: string) => addMessage('SYSTEM', text, 'in');

  const addToHistory = (topic: string, payload: string) =>
    setHistory(prev => ({
      topics:   prev.topics.includes(topic)     ? prev.topics   : [topic,   ...prev.topics].slice(0, 20),
      payloads: prev.payloads.includes(payload) ? prev.payloads : [payload, ...prev.payloads].slice(0, 20),
    }));

  return (
    <div className="min-h-screen bg-[#FEFAE0] px-4 pb-12 pt-8 flex flex-col items-center font-sans overflow-x-hidden">
      <div className="w-full max-w-6xl mb-8 flex flex-col sm:flex-row justify-between sm:items-end border-b-2 border-vinya-secondary/10 pb-4 gap-4">
        <div>
          <h1 className="text-3xl font-serif font-black text-vinya-secondary">Console MQTT</h1>
          <p className="text-vinya-accent font-bold uppercase tracking-widest text-xs mt-1">Interface Technicien</p>
        </div>
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start lg:h-[calc(100vh-180px)] h-auto">
        <div className="lg:col-span-4 flex flex-col gap-6 lg:h-full w-full">
          <ConfigurationPanel
            status={status}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            projectName={projectName}
            onProjectNameChange={handleProjectNameChange}
            subscriptions={activeSubscriptions}
          />
          <div className="h-[500px] lg:h-auto lg:flex-1 w-full">
            <PublishPanel
              onPublish={handlePublish}
              history={history}
              connected={status === ConnectionStatus.CONNECTED}
              projectName={projectName}
            />
          </div>
        </div>
        <div className="lg:col-span-8 h-[600px] lg:h-full w-full">
          <MessageList
            messages={messages}
            onClear={() => setMessages([])}
            onRepost={(msg) => handlePublish(msg.topic, msg.payload)}
          />
        </div>
      </div>
    </div>
  );
};

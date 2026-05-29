import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { ConnectionConfig } from '../types';

let instanceClient: MqttClient | null = null;

export const isClientConnected = (): boolean =>
  instanceClient !== null && instanceClient.connected;

export const connectToBroker = (
  config: ConnectionConfig,
  onConnect: () => void,
  onMessage: (topic: string, message: string) => void,
  onError: (err: Error) => void,
  topicSubscription?: string
) => {
  if (instanceClient && instanceClient.connected) {
    instanceClient.removeAllListeners('message');
    instanceClient.removeAllListeners('error');
    instanceClient.on('message', (topic, msg) => onMessage(topic, msg.toString()));
    instanceClient.on('error', onError);
    if (topicSubscription) instanceClient.subscribe(topicSubscription);
    onConnect();
    return;
  }

  const brokerUrl = `${config.protocol}://${config.host}:${config.port}${config.path || '/mqtt'}`;

  try {
    instanceClient = mqtt.connect(brokerUrl, {
      clientId: config.clientId,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      rejectUnauthorized: false,
    });

    instanceClient.on('connect', () => {
      onConnect();
      if (instanceClient && topicSubscription) instanceClient.subscribe(topicSubscription);
    });
    instanceClient.on('message', (topic, msg) => onMessage(topic, msg.toString()));
    instanceClient.on('error', onError);
  } catch (e) {
    onError(e as Error);
  }
};

export const publishMessage = (topic: string, message: string) => {
  if (instanceClient && instanceClient.connected) {
    instanceClient.publish(topic, message);
  } else {
    throw new Error('MQTT client not connected');
  }
};

export const publishVineyardUpdate = (donnees: any) => {
  if (instanceClient && instanceClient.connected) {
    instanceClient.publish('bzh/mecatro/dashboard/vinya/donnees', JSON.stringify(donnees));
  }
};

export const disconnectBroker = () => {
  if (instanceClient) {
    instanceClient.end();
    instanceClient = null;
  }
};

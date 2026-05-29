import React, { useEffect, useRef } from 'react';
import { MqttMessage } from '../../types';
import { Trash2, Copy, PauseCircle, PlayCircle } from 'lucide-react';

interface MessageListProps {
  messages: MqttMessage[];
  onClear: () => void;
  onRepost: (msg: MqttMessage) => void;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, onClear, onRepost }) => {
  const bottomRef   = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  useEffect(() => {
    if (autoScroll && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, autoScroll]);

  const formatTime = (ts: number) => {
    const d  = new Date(ts);
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${ms}`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-vinya-secondary/10 flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
        <h2 className="font-bold flex items-center gap-2 text-vinya-secondary text-sm">
          Messages ({messages.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded transition-colors ${autoScroll ? 'text-emerald-600 bg-emerald-50' : 'text-yellow-600 bg-yellow-50'}`}
            title="Auto Scroll"
          >
            {autoScroll ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
          </button>
          <button onClick={onClear} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Clear">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-custom bg-white">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400 italic text-sm">
            En attente de messages...
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group bg-gray-50 border border-gray-100 rounded p-2 hover:border-vinya-accent/30 transition-colors">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">{formatTime(msg.timestamp)}</span>
                  <span className="text-xs font-bold text-vinya-secondary font-mono truncate" title={msg.topic}>{msg.topic}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => navigator.clipboard.writeText(msg.payload)} className="p-1 hover:bg-white rounded text-gray-400" title="Copier">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button onClick={() => onRepost(msg)} className="p-1 hover:bg-white rounded text-blue-500" title="Republier">
                    <div className="text-[8px] font-bold border border-current px-1 rounded">REPOST</div>
                  </button>
                </div>
              </div>
              <div className="font-mono text-xs text-gray-600 break-all bg-white p-1.5 rounded border border-gray-100">
                {msg.payload}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

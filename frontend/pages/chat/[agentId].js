import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";

const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && window.location.hostname.includes("run.app")) {
    return window.location.origin.replace("frontend", "backend");
  }
  return "http://localhost:8080";
};
const API_URL = getApiUrl();

export default function AgentChatPage() {
  const router = useRouter();
  const { agentId } = router.query;
  const [agent, setAgent] = useState(null);
  const [messages, setMessages] = useState([]); // {role: 'user'|'agent', content: string}
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const chatEndRef = useRef(null);

  // Charger l'historique du chat depuis localStorage et l'agent
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) router.push("/login");
    setToken(savedToken);
    if (agentId) {
      loadAgent(agentId, savedToken);
      // Charger l'historique local
      const localHistory = localStorage.getItem(`chat_history_${agentId}`);
      if (localHistory) {
        try {
          setMessages(JSON.parse(localHistory));
        } catch {
          setMessages([]);
        }
      } else {
        setMessages([]);
      }
    }
  }, [agentId]);

  const loadAgent = async (id, authToken) => {
    try {
      const res = await axios.get(`${API_URL}/agents`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const found = res.data.agents?.find(a => a.id.toString() === id.toString());
      if (!found) router.push("/agents");
      setAgent(found);
    } catch (e) {
      router.push("/agents");
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    // Sauvegarder dans localStorage immédiatement
    if (agentId) {
      localStorage.setItem(`chat_history_${agentId}` , JSON.stringify(newMessages));
    }
    try {
      const response = await axios.post(
        `${API_URL}/ask`,
        {
          question: input,
          agent_id: agentId,
          history: newMessages.filter(m => m.role !== "system")
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const updatedMessages = [...newMessages, { role: "agent", content: response.data.answer }];
      setMessages(updatedMessages);
      // Mettre à jour localStorage avec la réponse de l'agent
      if (agentId) {
        localStorage.setItem(`chat_history_${agentId}` , JSON.stringify(updatedMessages));
      }
    } catch (e) {
      const updatedMessages = [...newMessages, { role: "agent", content: "Erreur lors de la réponse de l'agent." }];
      setMessages(updatedMessages);
      if (agentId) {
        localStorage.setItem(`chat_history_${agentId}` , JSON.stringify(updatedMessages));
      }
    } finally {
      setLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [messages]);

  if (!agent) return <div className="min-h-screen flex items-center justify-center">Chargement...</div>;

  return (
    <div className="min-h-screen flex flex-row bg-gradient-to-br from-blue-50 to-orange-50">
      {/* Colonne gauche : photo et bio */}
      <div className="w-full md:w-1/2 flex flex-col items-center justify-center p-10 bg-gradient-to-br from-blue-100 to-orange-100 border-r border-blue-200">
        {agent.profile_photo && (
          <div className="w-64 h-64 rounded-xl overflow-hidden border-4 border-blue-300 shadow-lg mb-8">
            <img
              src={
                agent.profile_photo.startsWith('http')
                  ? agent.profile_photo
                  : `${API_URL}/profile_photos/${agent.profile_photo.replace(/^.*[\\/]/, '')}`
              }
              alt={agent.name}
              width={320}
              height={320}
              style={{ objectFit: "cover" }}
              className="w-full h-full"
              onError={e => { e.target.onerror = null; e.target.src = '/default-avatar.png'; }}
            />
          </div>
        )}
        <h1 className="text-4xl font-bold text-gray-800 mb-2 text-center uppercase tracking-wide">{agent.name}</h1>
        <h2 className="text-lg text-blue-700 font-semibold mb-4 text-center">{agent.titre || ''}</h2>
        <div className="bg-white bg-opacity-80 rounded-lg p-6 shadow max-w-xl text-center">
          <p className="text-gray-700 text-lg whitespace-pre-line">{agent.biographie}</p>
        </div>
      </div>
      {/* Colonne droite : chat */}
      <div className="flex-1 flex flex-col h-screen">
        {/* Header mobile */}
        <div className="md:hidden flex items-center p-4 bg-white shadow-sm border-b">
          <Link href="/agents">
            <button className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold mr-4">Retour</button>
          </Link>
          <h2 className="text-xl font-bold text-gray-900">{agent.name}</h2>
        </div>
        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-4 py-8 flex flex-col space-y-4 bg-gradient-to-br from-white to-orange-50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`rounded-2xl px-4 py-3 shadow-sm max-w-[70%] whitespace-pre-line ${msg.role === "user" ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-900 rounded-bl-none border"}`}>
                {msg.content}
              </div>
            </div>
          ))}
          {/* Bulle de typing animée */}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 shadow-sm max-w-[70%] bg-white text-gray-900 rounded-bl-none border flex items-center">
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce mr-1" style={{animationDelay: '0ms'}}></span>
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce mr-1" style={{animationDelay: '150ms'}}></span>
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        {/* Input */}
        <div className="bg-white border-t p-4 flex items-center">
          <input
            type="text"
            className="flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mr-3"
            placeholder="Écrivez un message..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            disabled={loading || !input.trim()}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
  }
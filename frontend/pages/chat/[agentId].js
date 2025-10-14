
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

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
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const chatEndRef = useRef(null);
  const [creatingConv, setCreatingConv] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [newConvTitle, setNewConvTitle] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) router.push("/login");
    setToken(savedToken);
    if (agentId) {
      loadAgent(agentId, savedToken);
      loadConversations(agentId, savedToken, true); // pass flag to auto-create if none
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

  const loadConversations = async (agentId, authToken, autoCreateIfNone = false) => {
    try {
      const res = await axios.get(`${API_URL}/conversations?agent_id=${agentId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setConversations(res.data);
      if (res.data.length > 0) {
        selectConversation(res.data[0].id, authToken);
      } else if (autoCreateIfNone) {
        // Auto-create first conversation for this agent
        await handleNewConversation(true, authToken);
      }
    } catch (e) {
      setConversations([]);
    }
  };

  const selectConversation = async (convId, authToken = token) => {
    setSelectedConv(convId);
    setMessages([]);
    try {
      const res = await axios.get(`${API_URL}/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setMessages(res.data);
    } catch (e) {
      setMessages([]);
    }
  };

  const handleNewConversation = async (auto = false, overrideToken = null) => {
    setCreatingConv(true);
  const convCount = conversations.length + 1;
  const convTitle = `Conversation ${convCount}`;
    try {
      const res = await axios.post(`${API_URL}/conversations`, {
        agent_id: agentId,
        title: convTitle
      }, {
        headers: { Authorization: `Bearer ${overrideToken || token}` }
      });
      setCreatingConv(false);
      await loadConversations(agentId, overrideToken || token);
      if (res.data.conversation_id) {
        setSelectedConv(res.data.conversation_id);
        setMessages([]);
      }
    } catch (e) {
      setCreatingConv(false);
    }
  };

const handleEditTitle = async (convId) => {
  try {
    await axios.put(`${API_URL}/conversations/${convId}/title`, { title: editedTitle }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setEditingTitleId(null);
    setEditedTitle("");
    await loadConversations(agentId, token);
  } catch {}
};

const handleDeleteConversation = async (convId) => {
  if (!window.confirm("Supprimer cette conversation ?")) return;
  try {
    await axios.delete(`${API_URL}/conversations/${convId}`,
      { headers: { Authorization: `Bearer ${token}` } });
    await loadConversations(agentId, token);
    if (selectedConv === convId) {
      setSelectedConv(null);
      setMessages([]);
    }
  } catch {}
};

  const sendMessage = async () => {
    if (!input.trim() || !selectedConv) return;
    // Ajoute immédiatement le message utilisateur dans le state
    setMessages(prev => [
      ...prev,
      { role: "user", content: input }
    ]);
    setLoading(true);
    const userMessage = input;
    setInput("");
    try {
      // Si la conversation a le titre par défaut, le mettre à jour avec le début du premier message
      const conv = conversations.find(c => c.id === selectedConv);
      if (conv && (conv.title === `Conversation ${conversations.indexOf(conv)+1}` || !conv.title || conv.title === "")) {
        const firstMsgTitle = userMessage.length > 50 ? userMessage.slice(0, 50) + "..." : userMessage;
        await axios.put(`${API_URL}/conversations/${selectedConv}/title`, { title: firstMsgTitle }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        await loadConversations(agentId, token);
      }
      // Ajoute le message utilisateur côté backend
      await axios.post(`${API_URL}/conversations/${selectedConv}/messages`, {
        conversation_id: selectedConv,
        role: "user",
        content: userMessage
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Récupère l'historique de la conversation (messages)
      const resHist = await axios.get(`${API_URL}/conversations/${selectedConv}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const history = resHist.data.map(m => ({ role: m.role, content: m.content }));

      // Appel à l'API /ask pour générer la réponse IA
      const resAsk = await axios.post(`${API_URL}/ask`, {
        question: userMessage,
        agent_id: agentId,
        history: history
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const iaAnswer = resAsk.data.answer || "[Erreur IA]";

      // Ajoute la réponse IA comme message d'agent côté backend
      await axios.post(`${API_URL}/conversations/${selectedConv}/messages`, {
        conversation_id: selectedConv,
        role: "agent",
        content: iaAnswer
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      await selectConversation(selectedConv);
    } catch (e) {
      setLoading(false);
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
      {/* Colonne gauche : liste des conversations */}
      <div className="w-80 min-w-[18rem] max-w-xs flex flex-col border-r border-blue-200 bg-gradient-to-br from-blue-100 to-orange-100 p-4">
        <div className="flex flex-col items-center mb-6">
          {agent.profile_photo && (
            <div className="w-24 h-24 rounded-xl overflow-hidden border-4 border-blue-300 shadow mb-2">
              <img
                src={agent.profile_photo.startsWith('http') ? agent.profile_photo : `${API_URL}/profile_photos/${agent.profile_photo.replace(/^.*[\\/]/, '')}`}
                alt={agent.name}
                width={96}
                height={96}
                style={{ objectFit: "cover" }}
                className="w-full h-full"
                onError={e => { e.target.onerror = null; e.target.src = '/default-avatar.png'; }}
              />
            </div>
          )}
          <h1 className="text-xl font-bold text-gray-800 text-center uppercase tracking-wide mt-2">{agent.name}</h1>
        </div>
        <button
          className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 mb-4"
          onClick={handleNewConversation}
          disabled={creatingConv}
        >
          + Nouvelle conversation
        </button>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <div className="text-gray-500 text-center mt-8">Aucune conversation</div>}
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`p-3 rounded-lg mb-2 cursor-pointer flex items-center justify-between ${selectedConv === conv.id ? "bg-blue-200 font-bold" : "bg-white hover:bg-blue-100"}`}
              onClick={e => { if (e.target === e.currentTarget) selectConversation(conv.id); }}
            >
              <div className="flex-1 min-w-0" onClick={() => selectConversation(conv.id)}>
                {editingTitleId === conv.id ? (
                  <input
                    className="px-2 py-1 border rounded"
                    value={editedTitle}
                    onChange={e => setEditedTitle(e.target.value)}
                    onBlur={() => handleEditTitle(conv.id)}
                    onKeyDown={e => { if (e.key === "Enter") handleEditTitle(conv.id); }}
                    autoFocus
                  />
                ) : (
                  <span className="truncate">{conv.title || `Conversation ${conversations.findIndex(c => c.id === conv.id) + 1}`}</span>
                )}
                <div className="text-xs text-gray-500">{new Date(conv.created_at).toLocaleString()}</div>
              </div>
              <div className="flex items-center ml-2 gap-1">
                <button
                  className="p-1 text-gray-400 hover:text-blue-600"
                  title="Renommer"
                  onClick={e => { e.stopPropagation(); setEditingTitleId(conv.id); setEditedTitle(conv.title || ""); }}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  className="p-1 text-gray-400 hover:text-red-600"
                  title="Supprimer"
                  onClick={e => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
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
          {messages.map((msg, idx) => {
            const isLastAgentMsg =
              msg.role === "agent" &&
              idx === messages.length - 1 &&
              !msg.feedback;
            return (
              <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`rounded-2xl px-4 py-3 shadow-sm max-w-[70%] whitespace-pre-line ${msg.role === "user" ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-900 rounded-bl-none border"}`}>
                  {msg.content}
                  {/* Bouton de feedback uniquement sur le dernier message agent sans feedback */}
                  {isLastAgentMsg && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="text-xl bg-gray-200 rounded-md p-1 hover:bg-gray-300 hover:text-green-600 transition-colors cursor-pointer border border-gray-300"
                        title="Satisfait"
                        style={{ minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={async () => {
                          // Optimistic update: retire le bouton localement
                          setMessages(prevMsgs => prevMsgs.map((m, i) => i === idx ? { ...m, feedback: 'like' } : m));
                          try {
                            await axios.patch(`${API_URL}/messages/${msg.id}/feedback`, { feedback: 'like' }, { headers: { Authorization: `Bearer ${token}` } });
                          } catch {}
                        }}
                      >
                        <span role="img" aria-label="Pouce en l'air">👍</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Affiche "typing ..." et les trois points dans la même bulle agent si loading et le dernier message est celui de l'utilisateur */}
          {loading && messages.length > 0 && messages[messages.length-1].role === "user" && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 shadow-sm max-w-[70%] bg-white text-gray-900 rounded-bl-none border flex items-center gap-2">
                <span className="italic text-lg text-gray-500 mr-2">typing</span>
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
            disabled={loading || !selectedConv}
          />
          <button
            onClick={sendMessage}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            disabled={loading || !input.trim() || !selectedConv}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
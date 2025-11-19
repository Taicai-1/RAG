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

export default function TeamChatPage() {
  const router = useRouter();
  const { id: teamId } = router.query;
  const [team, setTeam] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingUserMessage, setPendingUserMessage] = useState(null);
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
    if (teamId) {
      loadTeam(teamId, savedToken);
      loadConversations(teamId, savedToken, true);
    }
  }, [teamId]);

  const loadTeam = async (id, authToken) => {
    try {
      const res = await axios.get(`${API_URL}/teams/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setTeam(res.data);
    } catch (e) {
      router.push("/teams");
    }
  };

  const loadConversations = async (teamId, authToken, autoCreateIfNone = false) => {
    try {
      const res = await axios.get(`${API_URL}/conversations?team_id=${teamId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setConversations(res.data);
      if (res.data.length > 0) {
        selectConversation(res.data[0].id, authToken);
      } else if (autoCreateIfNone) {
        await handleNewConversation(true, authToken);
      }
    } catch (e) {
      setConversations([]);
    }
  };

  const selectConversation = async (convId, authToken = token) => {
    setSelectedConv(convId);
    if (!pendingUserMessage) setMessages([]);
    try {
      const res = await axios.get(`${API_URL}/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (pendingUserMessage && res.data.length === 0) {
        setMessages([pendingUserMessage]);
      } else {
        setMessages(res.data);
      }
      setPendingUserMessage(null);
    } catch (e) {
      if (pendingUserMessage) {
        setMessages([pendingUserMessage]);
        setPendingUserMessage(null);
      } else {
        setMessages([]);
      }
    }
  };

  const handleNewConversation = async (auto = false, overrideToken = null) => {
    setCreatingConv(true);
    const convCount = conversations.length + 1;
    const convTitle = `Conversation ${convCount}`;
    try {
      const res = await axios.post(`${API_URL}/conversations`, {
        team_id: teamId,
        title: convTitle
      }, {
        headers: { Authorization: `Bearer ${overrideToken || token}` }
      });
      setCreatingConv(false);
      await loadConversations(teamId, overrideToken || token);
      if (res.data.conversation_id) {
        setSelectedConv(res.data.conversation_id);
        setMessages([]);
      }
    } catch (e) {
      setCreatingConv(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !selectedConv) return;
    const userMsg = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setPendingUserMessage(userMsg);
    setLoading(true);
    const userMessage = input;
    setInput("");
    try {
      const conv = conversations.find(c => c.id === selectedConv);
      if (conv && (conv.title === `Conversation ${conversations.indexOf(conv)+1}` || !conv.title || conv.title === "")) {
        const firstMsgTitle = userMessage.length > 50 ? userMessage.slice(0, 50) + "..." : userMessage;
        await axios.put(`${API_URL}/conversations/${selectedConv}/title`, { title: firstMsgTitle }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        await loadConversations(teamId, token);
      }
      await axios.post(`${API_URL}/conversations/${selectedConv}/messages`, {
        conversation_id: selectedConv,
        role: "user",
        content: userMessage
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const resHist = await axios.get(`${API_URL}/conversations/${selectedConv}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const history = resHist.data.map(m => ({ role: m.role, content: m.content }));
      // Appel à l'API /ask pour générer la réponse IA du chef d'équipe
      const resAsk = await axios.post(`${API_URL}/ask`, {
        question: userMessage,
        team_id: teamId,
        history: history
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const iaAnswer = resAsk.data.answer || "[Erreur IA]";
      await axios.post(`${API_URL}/conversations/${selectedConv}/messages`, {
        conversation_id: selectedConv,
        role: "agent",
        content: iaAnswer
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const actionResults = resAsk.data.action_results || [];
      for (const ar of actionResults) {
        try {
          let content = "";
          if (ar && ar.result) {
            if (ar.result.status === "ok" && ar.result.result) {
              const r = ar.result.result;
              if (r.url) {
                content = `Action ${ar.action} exécutée: ${r.url}`;
              } else if (r.document_id) {
                content = `Action ${ar.action} exécutée: document id ${r.document_id}`;
              } else if (r.path) {
                content = `Action ${ar.action} exécutée: fichier créé ${r.path}`;
              } else {
                content = `Action ${ar.action} exécutée: ${JSON.stringify(r)}`;
              }
            } else if (ar.result.status === "error") {
              content = `Action ${ar.action} erreur: ${ar.result.error || JSON.stringify(ar.result)}`;
            } else {
              content = `Action ${ar.action}: ${JSON.stringify(ar.result)}`;
            }
          } else {
            content = `Action ${ar.action}: ${JSON.stringify(ar)}`;
          }
          await axios.post(`${API_URL}/conversations/${selectedConv}/messages`, {
            conversation_id: selectedConv,
            role: "system",
            content: content
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
        } catch (e) {}
      }
      await selectConversation(selectedConv);
    } catch (e) {
      setLoading(false);
    } finally {
      setLoading(false);
      setPendingUserMessage(null);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [messages]);

  if (!team) return <div className="min-h-screen flex items-center justify-center">Chargement...</div>;

  return (
    <div className="min-h-screen flex flex-row bg-gradient-to-br from-blue-50 to-orange-50">
      {/* Colonne gauche : liste des conversations */}
      <div className="w-80 min-w-[18rem] max-w-xs flex flex-col border-r border-blue-200 bg-gradient-to-br from-blue-100 to-orange-100 p-4">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-xl font-bold text-gray-800 text-center uppercase tracking-wide mt-2">Équipe {team.name || teamId}</h1>
        </div>
        <button
          className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 mb-4"
          onClick={handleNewConversation}
          disabled={creatingConv}
        >
          + Nouvelle conversation
        </button>
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className="flex items-center p-3 bg-white rounded-lg shadow-sm mb-2 cursor-pointer hover:bg-gray-50"
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
      {/* Colonne droite : chat */}
      <div className="flex-1 flex flex-col h-screen">
        {/* Header mobile */}
        <div className="md:hidden flex items-center p-4 bg-white shadow-sm border-b">
          <Link href="/teams">
            <button className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold mr-4">Retour</button>
          </Link>
          <h2 className="text-xl font-bold text-gray-900">Équipe {team.name || teamId}</h2>
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
                  {isLastAgentMsg && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="text-xl bg-gray-200 rounded-md p-1 hover:bg-gray-300 hover:text-green-600 transition-colors cursor-pointer border border-gray-300"
                        title="Satisfait"
                        style={{ minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={async () => {
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
          {loading && ((messages.length > 0 && messages[messages.length-1].role === "user") || (messages.length === 1 && messages[0].role === "user")) && (
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
          <div className="flex items-center w-full gap-3">
            <input
              type="text"
              className="flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
    </div>
  );
}

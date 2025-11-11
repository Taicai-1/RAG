import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { 
  Bot, 
  Plus, 
  Trash2, 
  Pencil, 
  ArrowRight, 
  LogOut,
  Users,
  TrendingUp,
  UserCheck,
  ShoppingCart
} from "lucide-react";

// Auto-detect API URL based on environment
const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined" && window.location.hostname.includes("run.app")) {
    return window.location.origin.replace("frontend", "backend");
  }
  return "http://localhost:8080";
};

const API_URL = getApiUrl();

const AGENT_TYPES = {
  conversationnel: {
    key: 'conversationnel',
    name: 'Conversationnel',
    icon: Users,
    color: 'bg-blue-500',
    description: 'Dialogue / chat (OpenAI par défaut)'
  },
  actionnable: {
    key: 'actionnable',
    name: 'Actionnable',
    icon: Bot,
    color: 'bg-green-500',
    description: 'Peut exécuter des actions (Gemini recommandé)'
  },
  recherche_live: {
    key: 'recherche_live',
    name: 'Recherche live',
    icon: TrendingUp,
    color: 'bg-purple-500',
    description: 'Recherche web en direct (Perplexity recommandé)'
  }
};

export default function TeamsPage() {
  const [editingAgent, setEditingAgent] = useState(null); // kept for modal reuse
  const [teams, setTeams] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", contexte: "", leaderId: null, actionIds: [] });
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) {
      router.push("/login");
    } else {
      setToken(savedToken);
      loadTeams(savedToken);
      loadAgents(savedToken);
    }
    // eslint-disable-next-line
  }, [router]);

  // Lock body scroll when modal is open
  useEffect(() => {
    const previous = document.body.style.overflow;
    if (showForm) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previous || '';
    }
    return () => {
      document.body.style.overflow = previous || '';
    };
  }, [showForm]);

  const loadTeams = async (authToken) => {
    try {
      const response = await axios.get(`${API_URL}/teams`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setTeams(response.data.teams || []);
    } catch (error) {
      console.error("Error loading teams:", error);
      toast.error("Erreur lors du chargement des équipes");
    } finally {
      setLoading(false);
    }
  };

  const loadAgents = async (authToken) => {
    try {
      const response = await axios.get(`${API_URL}/agents`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setAgents(response.data.agents || []);
    } catch (error) {
      console.error("Error loading agents:", error);
      toast.error("Erreur lors du chargement des agents");
    }
  };

  const deleteAgent = async (agentId) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cet agent ?")) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Agent supprimé");
      loadAgents(token);
    } catch (error) {
      console.error("Error deleting agent:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Équipes d'agents</h1>
              <p className="mt-1 text-gray-500">Gérez et créez des équipes d'agents</p>
            </div>
            <button
              onClick={logout}
              className="flex items-center px-4 py-2 text-gray-600 hover:text-red-600 transition-colors"
            >
              <LogOut className="w-5 h-5 mr-2" />
              Se déconnecter
            </button>
          </div>
        </div>
      </div>

      {/* Create New Team Button */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => { setForm({ name: "", contexte: "", leaderId: null, actionIds: [] }); setShowForm(true); }}
              className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Plus className="w-5 h-5 mr-2" />
              Créer une équipe d'agents
            </button>
          </div>
          <div>
            <button
              onClick={() => router.push('/agents')}
              className="flex items-center px-6 py-3 bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ml-4"
              title="Retour à la page agents"
            >
              Retour à la page agents
            </button>
          </div>
        </div>
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-4 w-full max-w-md mx-auto max-h-[80vh] overflow-auto">
            <h2 className="text-xl font-semibold mb-4">Créer une nouvelle équipe d'agents</h2>
              <div className="space-y-3">
                <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="Nom de l'équipe" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
                <textarea className="w-full px-3 py-2 border rounded-lg" placeholder="Contexte de l'équipe" value={form.contexte} onChange={e => setForm(f => ({...f, contexte: e.target.value}))} rows="3" />
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Agent conversationnel (leader)</label>
                  <select 
                    className="w-full px-3 py-2 border rounded-lg" 
                    value={form.leaderId || ""} 
                    onChange={e => setForm(f => ({...f, leaderId: e.target.value ? parseInt(e.target.value) : null}))}
                  >
                    <option value="">Sélectionner un agent conversationnel</option>
                    {agents.filter(a => a.type === 'conversationnel').map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Agents actionnables (max 3)</label>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {agents.filter(a => a.type === 'actionnable').map(agent => (
                      <label key={agent.id} className="flex items-center">
                        <input 
                          type="checkbox" 
                          checked={form.actionIds.includes(agent.id)} 
                          onChange={e => {
                            const id = agent.id;
                            setForm(f => ({
                              ...f, 
                              actionIds: e.target.checked 
                                ? [...f.actionIds, id].slice(0, 3) 
                                : f.actionIds.filter(x => x !== id)
                            }));
                          }} 
                          className="mr-2"
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            <div className="flex space-x-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Annuler</button>
              <button
                onClick={async () => {
                  if (!form.name.trim()) {
                    toast.error("Le nom est obligatoire");
                    return;
                  }
                  if (!form.leaderId) {
                    toast.error("Choisir un agent conversationnel");
                    return;
                  }
                  if (form.actionIds.length !== 3) {
                    toast.error("Sélectionnez exactement 3 agents actionnables");
                    return;
                  }
                  setCreating(true);
                  try {
                    const payload = { 
                      name: form.name, 
                      contexte: form.contexte, 
                      leader_agent_id: form.leaderId, 
                      action_agent_ids: form.actionIds 
                    };
                    await axios.post(`${API_URL}/teams`, payload, { headers: { Authorization: `Bearer ${token}` } });
                    toast.success("Équipe créée");
                    setShowForm(false);
                    setForm({ name: "", contexte: "", leaderId: null, actionIds: [] });
                    loadTeams(token);
                  } catch (err) {
                    console.error("Error creating team:", err);
                    toast.error("Erreur lors de la création");
                  } finally {
                    setCreating(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={creating}
              >
                {creating ? "Création..." : "Créer"}
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      {/* Teams Grid */}
      {teams.length === 0 ? (
        <div className="text-center py-12">
          <Bot className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune équipe d'agents créée</h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teams.map((team) => {
            return (
              <div
                key={team.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => router.push(`/chat/team/${team.id}`)}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 rounded-lg bg-gray-100`}>
                      <Users className="w-6 h-6 text-gray-700" />
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={e => { e.stopPropagation(); router.push(`/chat/team/${team.id}`); }}
                        className="p-2 text-gray-400 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Voir"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{team.name}</h3>
                  <div className="text-sm text-gray-500 mb-3">Chef: {team.leader_name || team.leader_agent_id}</div>
                  <div className="flex flex-wrap gap-2">
                    {(team.action_agent_names || []).map((n, i) => (
                      <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">{n}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

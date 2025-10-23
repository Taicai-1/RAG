import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { 
// ...existing code...
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
  sales: {
    name: "Sales",
    icon: TrendingUp,
    color: "bg-blue-500",
    description: "Spécialisé dans les ventes et la prospection"
  },
  marketing: {
    name: "Marketing", 
    icon: Users,
    color: "bg-purple-500",
    description: "Expert en marketing et communication"
  },
  hr: {
    name: "RH",
    icon: UserCheck,
    color: "bg-green-500", 
    description: "Gestion des ressources humaines"
  },
  purchase: {
    name: "Achats",
    icon: ShoppingCart,
    color: "bg-orange-500",
    description: "Gestion des achats et fournisseurs"
  }
};

export default function AgentsPage() {
  const [editingAgent, setEditingAgent] = useState(null); // agent en cours d'édition
  // Fonction pour pré-remplir le formulaire avec les infos de l'agent à éditer
  const handleEditAgent = (agent) => {
    setForm({
      name: agent.name || "",
      contexte: agent.contexte || "",
      biographie: agent.biographie || "",
      profile_photo: null, // pas de pré-remplissage du fichier
      email: agent.email || "",
      password: "" // Toujours vide pour l'édition
    });
    setEditingAgent(agent);
    setShowForm(true);
  };
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", contexte: "", biographie: "", profile_photo: null, email: "", password: "", is_private: true });
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) {
      router.push("/login");
    } else {
      setToken(savedToken);
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

  const loadAgents = async (authToken) => {
    try {
      const response = await axios.get(`${API_URL}/agents`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setAgents(response.data.agents || []);
    } catch (error) {
      console.error("Error loading agents:", error);
      toast.error("Erreur lors du chargement des agents");
    } finally {
      setLoading(false);
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
              <h1 className="text-3xl font-bold text-gray-900">TAIC Companion</h1>
              <p className="mt-1 text-gray-500">Choisissez ou créez un companion IA spécialisé</p>
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

      {/* Create New Agent Button */}
      <div className="mb-8">
        <button
          onClick={() => { setEditingAgent(null); setForm({ name: "", contexte: "", biographie: "", profile_photo: null, email: "", password: "", is_private: true }); setShowForm(true); }}
          className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          <Plus className="w-5 h-5 mr-2" />
          Créer un nouveau companion IA
        </button>
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-md mx-auto">
            <h2 className="text-xl font-semibold mb-4">{editingAgent ? "Modifier l'agent" : "Créer un nouveau companion IA"}</h2>
            <div className="space-y-4">
              <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="Nom" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              <textarea className="w-full px-3 py-2 border rounded-lg" placeholder="Contexte" value={form.contexte} onChange={e => setForm(f => ({...f, contexte: e.target.value}))} />
              <textarea className="w-full px-3 py-2 border rounded-lg" placeholder="Biographie" value={form.biographie} onChange={e => setForm(f => ({...f, biographie: e.target.value}))} />
              <div className="flex flex-col items-center space-y-2">
                {form.profile_photo ? (
                  <img
                    src={URL.createObjectURL(form.profile_photo)}
                    alt="Aperçu"
                    className="w-24 h-24 object-cover rounded-full border-2 border-blue-400 shadow mb-2"
                  />
                ) : editingAgent && editingAgent.profile_photo ? (
                  <img
                    src={editingAgent.profile_photo.startsWith('http') ? editingAgent.profile_photo : `${API_URL}/profile_photos/${editingAgent.profile_photo.replace(/^.*[\\/]/, '')}`}
                    alt="Aperçu"
                    className="w-24 h-24 object-cover rounded-full border-2 border-blue-400 shadow mb-2"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full border-2 border-dashed border-blue-300 flex items-center justify-center text-blue-300 mb-2">
                    <span className="text-3xl">+</span>
                  </div>
                )}
                <label className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium cursor-pointer hover:bg-blue-700 transition-colors">
                  {form.profile_photo || (editingAgent && editingAgent.profile_photo) ? 'Changer la photo' : 'Choisir une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files[0]) {
                        setForm(f => ({...f, profile_photo: e.target.files[0]}));
                      }
                    }}
                  />
                </label>
                {/* Switch agent privé/public */}
                <div className="flex items-center mt-4">
                  <span className="mr-2 text-sm text-gray-700">Statut :</span>
                  <button
                    type="button"
                    aria-label={form.is_private ? 'Agent privé' : 'Agent public'}
                    className={`w-14 h-7 flex items-center rounded-full px-1 transition-colors duration-200 focus:outline-none border-2 border-blue-600 ${form.is_private ? 'bg-gray-200' : 'bg-blue-600'}`}
                    onClick={() => setForm(f => ({...f, is_private: !f.is_private}))}
                  >
                    <span
                      className={`h-5 w-5 rounded-full shadow flex items-center justify-center transition-transform duration-200 ${form.is_private ? 'bg-gray-400' : 'bg-white'}`}
                      style={{ transform: form.is_private ? 'translateX(28px)' : 'translateX(0)' }}
                    >
                      {form.is_private ? (
                        <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" stroke="#2563eb" strokeWidth="2" /><path d="M5 8a3 3 0 1 1 6 0" stroke="#2563eb" strokeWidth="2" /></svg>
                      ) : (
                        <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" stroke="#2563eb" strokeWidth="2" /><path d="M8 5v6M5 8h6" stroke="#2563eb" strokeWidth="2" /></svg>
                      )}
                    </span>
                  </button>
                  <span className={`ml-2 text-sm font-semibold ${form.is_private ? 'text-gray-700' : 'text-blue-700'}`}>{form.is_private ? 'Privé' : 'Public'}</span>
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
                  setCreating(true);
                  try {
                    const formData = new FormData();
                    formData.append("name", form.name);
                    formData.append("contexte", form.contexte);
                    formData.append("biographie", form.biographie);
                    if (form.profile_photo) formData.append("profile_photo", form.profile_photo);
                    // Ajout du statut
                    formData.append("statut", form.is_private ? "privé" : "public");
                    if (editingAgent) {
                      await axios.put(`${API_URL}/agents/${editingAgent.id}`, formData, {
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" }
                      });
                      toast.success("Agent modifié avec succès !");
                    } else {
                      await axios.post(`${API_URL}/agents`, formData, {
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" }
                      });
                      toast.success("Agent créé avec succès !");
                    }
                    setShowForm(false);
                    setForm({ name: "", contexte: "", biographie: "", profile_photo: null, email: "", password: "", is_private: true });
                    loadAgents(token);
                  } catch (err) {
                    toast.error(editingAgent ? "Erreur lors de la modification" : "Erreur lors de la création");
                  } finally {
                    setCreating(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={creating}
              >
                {creating ? (editingAgent ? "Modification..." : "Création...") : (editingAgent ? "Modifier" : "Créer")}
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      {/* Agents Grid */}
      {agents.length === 0 ? (
        <div className="text-center py-12">
          <Bot className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun companion IA créé</h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => {
            const typeConfig = AGENT_TYPES[agent.type] || AGENT_TYPES.sales;
            const IconComponent = typeConfig.icon;
            return (
              <div
                key={agent.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => router.push(`/?agentId=${agent.id}`)}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    {agent.profile_photo ? (
                      <img
                        src={agent.profile_photo.startsWith('http') ? agent.profile_photo : `${API_URL}/profile_photos/${agent.profile_photo.replace(/^.*[\\/]/, '')}`}
                        alt={agent.name}
                        className="w-12 h-12 object-cover rounded-full border-2 border-blue-400 shadow"
                        onError={e => { e.target.onerror = null; e.target.src = '/default-avatar.png'; }}
                      />
                    ) : (
                      <div className={`p-3 rounded-lg ${typeConfig.color}`}>
                        <IconComponent className="w-6 h-6 text-white" />
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <button
                        onClick={e => { e.stopPropagation(); handleEditAgent(agent); }}
                        className="p-2 text-gray-400 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Éditer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          deleteAgent(agent.id);
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{agent.name}</h3>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      router.push(`/?agentId=${agent.id}`);
                    }}
                    className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold shadow"
                  >
                    Ouvrir le companion
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


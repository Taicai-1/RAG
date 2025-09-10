import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { 
  Bot, 
  Plus, 
  Trash2, 
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
  // If in production (Cloud Run), try to detect backend URL
  if (typeof window !== "undefined" && window.location.hostname.includes("run.app")) {
    return window.location.origin.replace("frontend", "backend");
  }
  // Fallback to localhost
  return "http://localhost:8080";
};

const API_URL = getApiUrl();

// Agent type configuration
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
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", type: "sales" });
  const [token, setToken] = useState("");
  const router = useRouter();

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) {
      router.push("/login");
    } else {
      setToken(savedToken);
      loadAgents(savedToken);
    }
  }, [router]);

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

  const createAgent = async () => {
    if (!newAgent.name.trim()) {
      toast.error("Veuillez saisir un nom pour l'agent");
      return;
    }

    try {
      const response = await axios.post(
        `${API_URL}/agents`,
        newAgent,
        {
          headers: { 
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }
      );
      
      toast.success("Agent créé avec succès !");
      setShowCreateModal(false);
      setNewAgent({ name: "", type: "sales" });
      loadAgents(token);
    } catch (error) {
      console.error("Error creating agent:", error);
      toast.error("Erreur lors de la création de l'agent");
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

  const selectAgent = (agentId) => {
    router.push(`/?agentId=${agentId}`);
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Create New Agent Button */}
        <div className="mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Plus className="w-5 h-5 mr-2" />
            Créer un nouveau companion IA
          </button>
        </div>

        {/* Agents Grid */}
        {agents.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun companion IA créé</h3>
            <p className="text-gray-500 mb-6">Créez votre premier companion IA pour commencer</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Créer un companion IA
            </button>
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
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-lg ${typeConfig.color}`}>
                        <IconComponent className="w-6 h-6 text-white" />
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAgent(agent.id);
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">{agent.name}</h3>
                    <p className="text-sm text-gray-500 mb-1">Companion IA {typeConfig.name}</p>
                    <p className="text-sm text-gray-400 mb-6">{typeConfig.description}</p>
                    <button
                      onClick={() => selectAgent(agent.id)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors group-hover:bg-blue-50 group-hover:text-blue-700"
                    >
                      Ouvrir le companion IA
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4">Créer un nouveau companion IA TEST</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nom du companion IA
                </label>
                <input
                  type="text"
                  value={newAgent.name}
                  onChange={(e) => setNewAgent({...newAgent, name: e.target.value})}
                  placeholder="Ex: Companion IA Commercial"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type de companion IA
                </label>
                <select
                  value={newAgent.type}
                  onChange={(e) => setNewAgent({...newAgent, type: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {Object.entries(AGENT_TYPES).map(([type, config]) => (
                    <option key={type} value={type}>
                      {config.name} - {config.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={createAgent}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

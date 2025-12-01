import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";

const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  return "http://localhost:8080";
};
const API_URL = getApiUrl();

export default function CreateTeamPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [contexte, setContexte] = useState("");
  const [leaderId, setLeaderId] = useState(null);
  const [actionIds, setActionIds] = useState([]);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) {
      router.push('/login');
      return;
    }
    setToken(savedToken);
    loadAgents(savedToken);
    // eslint-disable-next-line
  }, []);

  const loadAgents = async (authToken) => {
    try {
      const res = await axios.get(`${API_URL}/agents`, { headers: { Authorization: `Bearer ${authToken}` } });
      setAgents(res.data.agents || []);
    } catch (e) {
      console.error(e);
      toast.error("Impossible de charger la liste des agents");
    } finally {
      setLoading(false);
    }
  };

  const toggleActionAgent = (id) => {
    setActionIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      return [...prev, id];
    });
  };

  const submit = async () => {
    if (!name.trim()) { toast.error("Le nom est requis"); return; }
    if (!leaderId) { toast.error("Choisir un chef d'agent conversationnel"); return; }
    setCreating(true);
    try {
      const payload = { name, contexte, leader_agent_id: leaderId, action_agent_ids: actionIds };
      const res = await axios.post(`${API_URL}/teams`, payload, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Équipe créée");
      const id = res.data.team && res.data.team.id;
      router.push(id ? `/teams/${id}` : '/teams');
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de la création de l'équipe");
    } finally {
      setCreating(false);
    }
  };

  const convAgents = agents.filter(a => (a.type || 'conversationnel') === 'conversationnel');
  const actionAgents = agents.filter(a => a.type === 'actionnable');

  if (loading) return (<div className="min-h-screen flex items-center justify-center">Chargement...</div>);

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <Toaster />
      <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-semibold mb-4">Créer une équipe d'agents</h1>
        <div className="space-y-4">
          <input value={name} onChange={e=>setName(e.target.value)} className="w-full p-2 border rounded" placeholder="Nom de l'équipe" />
          <textarea value={contexte} onChange={e=>setContexte(e.target.value)} className="w-full p-2 border rounded" placeholder="Contexte (optionnel)"></textarea>
          <div>
            <div className="font-semibold mb-2">Choisir le chef d'agent (conversationnel)</div>
            <select value={leaderId || ''} onChange={e=>setLeaderId(e.target.value ? Number(e.target.value) : null)} className="w-full p-2 border rounded">
              <option value="">-- Choisir --</option>
              {convAgents.map(a => (
                <option key={a.id} value={a.id}>{a.name} (id:{a.id})</option>
              ))}
            </select>
          </div>
          <div>
            <div className="font-semibold mb-2">Choisir 3 agents actionnables</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {actionAgents.map(a => (
                <label key={a.id} className={`flex items-center gap-2 p-2 border rounded ${actionIds.includes(a.id)?'bg-blue-50 border-blue-300':''}`}>
                  <input type="checkbox" checked={actionIds.includes(a.id)} onChange={() => toggleActionAgent(a.id)} />
                  <span>{a.name} (id:{a.id})</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => router.push('/teams')} className="px-4 py-2 bg-gray-100 rounded">Annuler</button>
            <button onClick={submit} disabled={creating} className="px-4 py-2 bg-blue-600 text-white rounded">{creating? 'Création...' : 'Créer l\'équipe'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

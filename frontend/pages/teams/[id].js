import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_URL = getApiUrl();

export default function TeamView() {
  const router = useRouter();
  const { id } = router.query;
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem('token');
    if (!token) { router.push('/login'); return; }
    loadTeam(id, token);
    // eslint-disable-next-line
  }, [id]);

  const loadTeam = async (teamId, token) => {
    try {
      const res = await axios.get(`${API_URL}/teams/${teamId}`, { headers: { Authorization: `Bearer ${token}` } });
      setTeam(res.data.team || res.data);
    } catch (e) {
      console.error(e);
      toast.error('Impossible de charger l\'équipe');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Chargement...</div>;
  if (!team) return <div className="min-h-screen flex items-center justify-center">Équipe introuvable</div>;

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-semibold mb-4">{team.name}</h1>
        <p className="text-sm text-gray-600 mb-4">{team.contexte}</p>
        <div className="mb-4">
          <div className="font-semibold">Chef d'agent:</div>
          <div>{team.leader_name || team.leader_agent_id}</div>
        </div>
        <div>
          <div className="font-semibold mb-2">Agents actionnables:</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(team.action_agent_names || []).map((n, i) => (
              <div key={i} className="p-3 border rounded">{n}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

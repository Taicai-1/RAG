import { useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { LogIn } from "lucide-react";

const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && window.location.hostname.includes("run.app")) {
    return window.location.origin.replace("frontend", "backend");
  }
  return "http://localhost:8080";
};
const API_URL = getApiUrl();

export default function AgentLogin() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Appel à l'endpoint de login agent (à adapter côté backend si besoin)
      const response = await axios.post(`${API_URL}/login-agent`, formData);
      // Stocke le token et l'id de l'agent
      localStorage.setItem("token", response.data.access_token);
      localStorage.setItem("agent_id", response.data.agent_id);
      toast.success("Connexion agent réussie !");
      // Redirige vers la page de chat de l'agent
      router.push(`/chat/${response.data.agent_id}`);
    } catch (err) {
      toast.error("Email ou mot de passe incorrect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-orange-50">
      <Toaster />
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-700 flex items-center justify-center gap-2">
          <LogIn className="w-7 h-7" /> Connexion Agent
        </h1>
        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="email"
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Email de l'agent"
            value={formData.email}
            onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
            required
          />
          <input
            type="password"
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Mot de passe"
            value={formData.password}
            onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
            required
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading ? "Connexion..." : <><LogIn className="w-5 h-5" /> Se connecter</>}
          </button>
        </form>
      </div>
    </div>
  );
}

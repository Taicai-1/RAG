import { useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { LogIn, UserPlus } from "lucide-react";

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

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Debug logs
    console.log("API_URL:", API_URL);
    console.log("Environment variables:", process.env);

    try {
      const endpoint = isLogin ? "/login" : "/register";
      const payload = isLogin
        ? { username: formData.username, password: formData.password }
        : formData;

      console.log("Making request to:", `${API_URL}${endpoint}`);
      console.log("Payload:", payload);

      const response = await axios.post(`${API_URL}${endpoint}`, payload);

      if (isLogin) {
        localStorage.setItem("token", response.data.access_token);
        toast.success("Connexion réussie !");
        router.push("/agents");
      } else {
        toast.success("Inscription réussie ! Vous pouvez maintenant vous connecter.");
        setIsLogin(true);
      }
    } catch (error) {
      console.error("Full error object:", error);
      console.error("Error response:", error.response);
      console.error("Error message:", error.message);
      
      let errorMessage = "Une erreur s'est produite";
      if (error.response) {
        errorMessage = error.response?.data?.detail || `Erreur ${error.response.status}: ${error.response.statusText}`;
      } else if (error.request) {
        errorMessage = "Impossible de contacter le serveur";
      } else {
        errorMessage = error.message;
      }
      
      console.error("Final error message:", errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <Toaster position="top-right" />
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          {isLogin ? "Connexion" : "Inscription"}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">TAIC Companion</p>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">Nom d'utilisateur ou adresse mail</label>
              <div className="mt-1">
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={formData.username}
                  onChange={handleChange}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
            </div>
            {!isLogin && (
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
                <div className="mt-1">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">Mot de passe</label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              {/* Lien mot de passe oublié visible uniquement en mode connexion */}
              {isLogin && (
                <div className="mt-2 text-right">
                  <a href="/forgot-password" className="text-blue-600 hover:underline text-sm">Mot de passe oublié ?</a>
                </div>
              )}
            </div>
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    {isLogin ? (
                      <LogIn className="w-5 h-5 mr-2" />
                    ) : (
                      <UserPlus className="w-5 h-5 mr-2" />
                    )}
                    {isLogin ? "Se connecter" : "S'inscrire"}
                  </>
                )}
              </button>
            </div>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-blue-600 hover:text-blue-500 text-sm"
              >
                {isLogin ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

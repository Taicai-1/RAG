import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";
import { Upload, Send, LogOut, FileText, MessageCircle, Plus, Trash2, Check, ArrowLeft, Bot, Download, Moon, Sun, Loader2, Mic } from "lucide-react";

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

export default function Dashboard() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [token, setToken] = useState("");
  const [documents, setDocuments] = useState([]);
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [agentId, setAgentId] = useState(null);
  // Suppression des états liés à l'export CSV/PDF/tableau
  const [darkMode, setDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [urlToAdd, setUrlToAdd] = useState("");
  const router = useRouter();

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) {
      router.push("/login");
    } else {
      setToken(savedToken);
      
      // Initialize dark mode from localStorage
      const savedDarkMode = localStorage.getItem("darkMode") === "true";
      setDarkMode(savedDarkMode);
      
      // Check if we have an agentId in URL
      const { agentId: urlAgentId } = router.query;
      if (urlAgentId) {
        setAgentId(urlAgentId);
        loadAgentData(urlAgentId, savedToken);
      } else {
        // No agent specified, redirect to agents page
        router.push("/agents");
      }
    }

    // Add keyboard shortcuts
    const handleKeyDown = (e) => {
      // Ctrl+K or Cmd+K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('input[placeholder="Posez votre question..."]')?.focus();
      }
      
      // Escape to clear search
      if (e.key === 'Escape') {
        setQuestion("");
        document.querySelector('input[placeholder="Posez votre question..."]')?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, router.query]);

  const loadAgentData = async (agentId, authToken) => {
    setLoadingDocuments(true);
    try {
      // Load agent info first
      const agentResponse = await axios.get(`${API_URL}/agents`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      
      const agent = agentResponse.data.agents?.find(a => a.id.toString() === agentId.toString());
      if (!agent) {
        toast.error("Companion IA non trouvé");
        router.push("/agents");
        return;
      }
      
      setCurrentAgent(agent);
      
      // Load documents for this specific agent
      const docsResponse = await axios.get(`${API_URL}/user/documents?agent_id=${agentId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      
      setDocuments(docsResponse.data.documents || []);
      // Select all agent's documents by default
      setSelectedDocuments(new Set((docsResponse.data.documents || []).map(doc => doc.id)));
      
    } catch (error) {
      console.error("Error loading agent data:", error);
      toast.error("Erreur lors du chargement de l'agent");
    } finally {
      setLoadingDocuments(false);
    }
  };

  const loadDocuments = async (authToken) => {
    setLoadingDocuments(true);
    try {
      const response = await axios.get(`${API_URL}/user/documents`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      setDocuments(response.data.documents);
      // Select all documents by default
      setSelectedDocuments(new Set(response.data.documents.map(doc => doc.id)));
    } catch (error) {
      console.error("Error loading documents:", error);
      toast.error("Erreur lors du chargement des documents");
    } finally {
      setLoadingDocuments(false);
    }
  };

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem("darkMode", newDarkMode.toString());
  };

  // Enhanced loading states
  const showSuccessToast = (message) => {
    toast.success(message, {
      duration: 3000,
      style: {
        background: darkMode ? '#374151' : '#fff',
        color: darkMode ? '#fff' : '#000',
      },
    });
  };

  const showErrorToast = (message) => {
    toast.error(message, {
      duration: 4000,
      style: {
        background: darkMode ? '#374151' : '#fff',
        color: darkMode ? '#fff' : '#000',
      },
    });
  };

  // Enhanced typing indicator
  const handleQuestionChange = (e) => {
    setQuestion(e.target.value);
    setIsTyping(true);
    
    // Clear typing indicator after user stops typing
    setTimeout(() => setIsTyping(false), 1000);
  };

  const askQuestion = async () => {
    if (!question.trim()) {
      showErrorToast("Veuillez poser une question");
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(
        `${API_URL}/ask`,
        { 
          question,
          selected_documents: Array.from(selectedDocuments),
          agent_id: currentAgent?.id || agentId // on envoie l'id de l'agent sélectionné
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      setAnswer(response.data.answer);
      showSuccessToast("Réponse générée avec succès !");
    } catch (error) {
      console.error("Error:", error);
      showErrorToast("Erreur lors de la génération de la réponse");
    } finally {
      setLoading(false);
    }
  };

  // Suppression des fonctions d'export CSV/PDF

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploadLoading(true);
    
    try {
      let response;
      
      if (currentAgent) {
        // Upload for specific agent
        const formData = new FormData();
        formData.append("file", file);
        formData.append("agent_id", currentAgent.id.toString());
        
        response = await axios.post(`${API_URL}/upload-agent`, formData, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        // Reload documents for current agent
        loadAgentData(currentAgent.id, token);
      } else {
        // Upload without agent (general upload)
        const formData = new FormData();
        formData.append("file", file);
        
        response = await axios.post(`${API_URL}/upload`, formData, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        // Reload all documents
        loadDocuments(token);
      }
      
      toast.success(`Document "${file.name}" ajouté avec succès !`);
      event.target.value = ""; // Reset file input
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Erreur lors de l'ajout du document");
    } finally {
      setUploadLoading(false);
    }
  };

  const deleteDocument = async (docId) => {
    try {
  await axios.delete(`${API_URL}/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDocuments(prev => prev.filter(doc => doc.id !== docId));
      setSelectedDocuments(prev => {
        const newSet = new Set(prev);
        newSet.delete(docId);
        return newSet;
      });
      toast.success("Document supprimé");
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const toggleDocumentSelection = (docId) => {
    setSelectedDocuments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(docId)) {
        newSet.delete(docId);
      } else {
        newSet.add(docId);
      }
      return newSet;
    });
  };

  const logout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  // Fonction pour démarrer la reconnaissance vocale
  const startListening = () => {
    if (!('webkitSpeechRecognition' in window)) {
      toast.error("La reconnaissance vocale n'est pas supportée sur ce navigateur.");
      return;
    }
    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setQuestion(prev => prev ? prev + " " + transcript : transcript);
      setIsTyping(true);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  // Nouvelle fonction pour ajouter une URL comme document
  const handleAddUrl = async () => {
    if (!urlToAdd.trim()) return;
    setLoading(true);
    try {
      // Envoi de la requête d'ajout d'URL
      const response = await axios.post(
        `${API_URL}/add-url`,
        { url: urlToAdd },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      
      setUrlToAdd("");
      showSuccessToast("URL ajoutée avec succès !");
      
      // Rechargement des documents
      loadDocuments(token);
    } catch (error) {
      console.error("Error adding URL:", error);
      showErrorToast("Erreur lors de l'ajout de l'URL");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex transition-colors duration-300 ${
      darkMode ? 'bg-gray-900' : 'bg-gray-50'
    }`}>
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: darkMode ? '#374151' : '#fff',
            color: darkMode ? '#fff' : '#000',
          },
        }}
      />
      {/* Left Sidebar - Sources */}
      <div className={`w-80 shadow-lg border-r flex flex-col transition-colors duration-300 ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        {/* Bouton Users pour voir la fiche agent */}
        {currentAgent && (
          <div className="p-4 border-b border-blue-100 bg-blue-50 flex items-center justify-start">
            <button
              onClick={() => router.push(`/chat/${currentAgent.id}`)}
              className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold shadow"
              style={{ minWidth: 90 }}
            >
              Users
            </button>
          </div>
        )}
        {/* Header */}
        <div className={`p-6 border-b transition-colors duration-300 ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/agents')}
                className={`mr-3 p-1 transition-colors ${
                  darkMode 
                    ? 'text-gray-400 hover:text-blue-400' 
                    : 'text-gray-500 hover:text-blue-600'
                }`}
                title="Retour aux agents"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className={`text-xl font-bold flex items-center ${
                darkMode ? 'text-gray-100' : 'text-gray-800'
              }`}>
                <FileText className="w-6 h-6 mr-2 text-blue-600" />
                Sources
              </h2>
            </div>
            <div className="flex items-center space-x-2">
              {/* Bouton Mode Sombre */}
              <button
                onClick={toggleDarkMode}
                className={`p-2 rounded-lg transition-colors ${
                  darkMode 
                    ? 'text-yellow-400 hover:bg-gray-700' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title={darkMode ? "Mode clair" : "Mode sombre"}
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button
                onClick={logout}
                className={`p-2 rounded-lg transition-colors ${
                  darkMode 
                    ? 'text-gray-400 hover:text-red-400 hover:bg-gray-700' 
                    : 'text-gray-500 hover:text-red-600 hover:bg-gray-100'
                }`}
                title="Se déconnecter"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {/* Agent Info */}
          {currentAgent && (
            <div className={`mb-4 p-3 rounded-lg transition-colors duration-300 ${
              darkMode ? 'bg-gray-700' : 'bg-gray-50'
            }`}>
              <div className="flex items-center">
                <Bot className={`w-5 h-5 mr-2 ${
                  currentAgent.type === 'sales' ? 'text-green-600' :
                  currentAgent.type === 'marketing' ? 'text-purple-600' :
                  currentAgent.type === 'hr' ? 'text-blue-600' :
                  'text-orange-600'
                }`} />
                <div>
                  <p className={`font-medium ${
                    darkMode ? 'text-gray-100' : 'text-gray-800'
                  }`}>{currentAgent.name} ({currentAgent.type})</p>
                  <p className={`text-sm capitalize ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}>{currentAgent.type}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Add Document Button */}
          <label className={`flex items-center justify-center w-full p-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-300 ${
            darkMode 
              ? 'border-blue-400 hover:border-blue-300 hover:bg-gray-700' 
              : 'border-blue-300 hover:border-blue-400 hover:bg-blue-50'
          }`}>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.txt,.docx"
              onChange={handleFileUpload}
              disabled={uploadLoading}
            />
            {uploadLoading ? (
              <Loader2 className="w-5 h-5 mr-2 text-blue-600 animate-spin" />
            ) : (
              <Plus className="w-5 h-5 mr-2 text-blue-600" />
            )}
            <span className="text-blue-600 font-medium">
              {uploadLoading ? "Ajout en cours..." : "Ajouter"}
            </span>
          </label>

          {/* Add URL Button */}
          <div className="flex items-center mt-4 space-x-2">
            <input
              type="text"
              className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                darkMode ? 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400' : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'
              }`}
              placeholder="Ajouter une URL (https://...)"
              value={urlToAdd}
              onChange={e => setUrlToAdd(e.target.value)}
              disabled={uploadLoading}
            />
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
              disabled={uploadLoading || !urlToAdd.trim()}
              onClick={async () => {
                if (!urlToAdd.trim()) return;
                setUploadLoading(true);
                try {
                  const payload = { url: urlToAdd };
                  if (currentAgent) payload.agent_id = currentAgent.id;
                  await axios.post(`${API_URL}/upload-url`, payload, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  toast.success("URL ajoutée avec succès !");
                  setUrlToAdd("");
                  // Recharger les documents pour afficher la nouvelle source
                  if (currentAgent) loadAgentData(currentAgent.id, token);
                  else loadDocuments(token);
                } catch (error) {
                  console.error("Erreur lors de l'ajout de l'URL:", error);
                  toast.error("Erreur lors de l'ajout de l'URL");
                } finally {
                  setUploadLoading(false);
                }
              }}
            >Ajouter l'URL</button>
          </div>
        </div>
        {/* Documents List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingDocuments ? (
            <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              Chargement des documents...
            </div>
          ) : documents.length === 0 ? (
            <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="font-medium">Aucun document</p>
              <p className="text-sm">Ajoutez des documents pour commencer</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className={`p-3 rounded-lg border transition-all duration-200 ${
                    selectedDocuments.has(doc.id)
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                      : darkMode
                        ? "border-gray-600 bg-gray-700 hover:bg-gray-600"
                        : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleDocumentSelection(doc.id)}
                      className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        selectedDocuments.has(doc.id)
                          ? "bg-blue-600 border-blue-600"
                          : darkMode
                            ? "border-gray-500 hover:border-blue-400"
                            : "border-gray-300 hover:border-blue-400"
                      }`}
                    >
                      {selectedDocuments.has(doc.id) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </button>
                    {/* Document Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <FileText className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                        <p className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-900'}`} title={doc.filename}>
                          {doc.filename}
                        </p>
                      </div>
                      <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    {/* Delete Button */}
                    <button
                      onClick={() => deleteDocument(doc.id)}
                      className={`flex-shrink-0 p-1 transition-colors ${
                        darkMode 
                          ? 'text-gray-500 hover:text-red-400' 
                          : 'text-gray-400 hover:text-red-600'
                      }`}
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className={`border-b p-4 transition-colors ${
          darkMode 
            ? 'border-gray-600 bg-gray-800' 
            : 'border-gray-200 bg-white'
        }`}>
          {currentAgent && (
            <div className="flex items-center">
              <Bot className={`w-6 h-6 mr-3 ${
                currentAgent.type === 'sales' ? 'text-green-600' :
                currentAgent.type === 'marketing' ? 'text-purple-600' :
                currentAgent.type === 'hr' ? 'text-blue-600' :
                'text-orange-600'
              }`} />
              <div>
                <h1 className={`text-xl font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {currentAgent.name} ({currentAgent.type})
                </h1>
                <p className={`text-sm capitalize ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Companion IA {currentAgent.type}
                </p>
              </div>
            </div>
          )}
        </div>
        {/* Input Section */}
        <div className={`border-b p-6 transition-colors ${
          darkMode 
            ? 'border-gray-600 bg-gray-800' 
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex space-x-4">
            <div className="relative flex-1">
              <input
                type="text"
                value={question}
                onChange={handleQuestionChange}
                onKeyPress={(e) => e.key === "Enter" && askQuestion()}
                placeholder="Posez votre question..."
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                  darkMode
                    ? 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400'
                    : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'
                }`}
                disabled={loading}
              />
              {isTyping && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                  </div>
                </div>
              )}
            </div>
            {/* Bouton micro à gauche du bouton Envoyer */}
            <button
              type="button"
              onClick={startListening}
              className={`p-3 rounded-lg bg-blue-100 hover:bg-blue-200 ${isListening ? "animate-pulse" : ""}`}
              title="Entrée vocale"
              disabled={isListening}
            >
              <Mic className="w-5 h-5 text-blue-600" />
            </button>
            <button
              onClick={askQuestion}
              disabled={loading || !question.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2 font-medium"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{loading ? "Envoi..." : "Envoyer"}</span>
            </button>
          </div>
        </div>
        {/* Answer Area */}
        <div className={`flex-1 p-6 transition-colors ${
          darkMode ? 'bg-gray-800' : 'bg-gray-50'
        }`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Analyse en cours...
              </p>
            </div>
          ) : answer ? (
            <div className={`rounded-lg p-6 shadow-sm transition-colors ${
              darkMode ? 'bg-gray-700' : 'bg-white'
            }`}>
              <div className="prose max-w-none">
                <pre className={`leading-relaxed whitespace-pre-wrap font-sans text-sm overflow-x-auto ${
                  darkMode ? 'text-gray-200' : 'text-gray-800'
                }`}>
                  {answer}
                </pre>
              </div>
              
              {/* Suppression des boutons d'export CSV/PDF */}
            </div>
          ) : (
            /* Welcome Message */
            <div className={`text-center py-12 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className={`text-xl font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Bienvenue dans TAIC Companion
              </h3>
              <p className="mb-4">
                {documents.length === 0
                  ? "Ajoutez des documents et posez vos questions"
                  : "Posez une question basée sur vos documents sélectionnés"}
              </p>
              {documents.length > 0 && selectedDocuments.size > 0 && (
                <p className="text-sm text-blue-600">
                  {selectedDocuments.size} document{selectedDocuments.size > 1 ? 's' : ''} prêt{selectedDocuments.size > 1 ? 's' : ''} pour répondre à vos questions
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

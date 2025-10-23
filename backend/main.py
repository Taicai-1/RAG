# Endpoint pour obtenir une URL signée de téléchargement GCS
from google.cloud import storage


# --- Envoi d'email de réinitialisation ---
import smtplib
from email.mime.text import MIMEText


from uuid import uuid4
from datetime import timedelta

from collections import deque
import threading

import requests
# Endpoint pour renommer une conversation
from fastapi import Body

from pydantic import BaseModel


from models_conversation import Conversation, Message
from pydantic import BaseModel
from typing import List, Optional


from pydantic import BaseModel


from google.cloud import storage

from fastapi import Body, FastAPI, UploadFile, File, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import requests
import logging
import os
import time
import json
import io
from datetime import datetime

from auth import create_access_token, verify_token, hash_password, verify_password
from database import get_db, init_db, User, Document, Agent, Base, engine
from rag_engine import get_answer, get_answer_with_files, process_document_for_user
from file_generator import FileGenerator
from utils import logger, event_tracker

from fastapi import Form
import shutil

# Setup Google Cloud Logging
if os.getenv("GOOGLE_CLOUD_PROJECT"):
    try:
        from google.cloud import logging as cloud_logging
        client = cloud_logging.Client()
        client.setup_logging()
    except ImportError:
        pass

app = FastAPI(title="TAIC Companion API", version="1.0.0")


# Ajout d'un endpoint pour ajouter une URL comme source
class UrlUploadRequest(BaseModel):
    url: str
    agent_id: int = None

# Expose le dossier profile_photos en statique après la création de l'app
from fastapi.staticfiles import StaticFiles
import os
if not os.path.exists("profile_photos"):
    os.makedirs("profile_photos")
app.mount("/profile_photos", StaticFiles(directory="profile_photos"), name="profile_photos")

@app.post("/upload-url")
async def upload_url(
    request: UrlUploadRequest,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Ajoute une URL comme document/source pour le RAG"""
    try:
        # Télécharger le contenu de l'URL
        response = requests.get(request.url, timeout=15)
        response.raise_for_status()
        html = response.text

        # Extraire uniquement les informations utiles : titre, meta description et contenu principal
        from bs4 import BeautifulSoup
        try:
            from readability import Document as ReadabilityDocument
            use_readability = True
        except Exception:
            use_readability = False

        title = ""
        meta_desc = ""
        main_text = ""

        try:
            soup = BeautifulSoup(html, "lxml")
            # Title
            if soup.title and soup.title.string:
                title = soup.title.string.strip()
            # Meta description
            md = soup.find("meta", attrs={"name": "description"})
            if md and md.get("content"):
                meta_desc = md.get("content").strip()

            # Try Readability first (better extraction of main article)
            if use_readability:
                try:
                    doc = ReadabilityDocument(html)
                    main_html = doc.summary()
                    main_soup = BeautifulSoup(main_html, "lxml")
                    # Get visible text
                    main_text = "\n".join([p.get_text(separator=" ", strip=True) for p in main_soup.find_all(["p", "h1", "h2", "h3"])])
                except Exception:
                    use_readability = False

            # Fallback: extract visible text from body, but filter out navigation/footer links
            if not main_text:
                body = soup.body
                if body:
                    # Remove scripts, styles, nav, footer, aside
                    for tag in body.find_all(["script", "style", "nav", "footer", "aside", "header", "form", "noscript"]):
                        tag.decompose()
                    # Collect paragraphs and headings
                    paragraphs = [p.get_text(separator=" ", strip=True) for p in body.find_all(["p", "h1", "h2", "h3"]) if p.get_text(strip=True)]
                    main_text = "\n".join(paragraphs)

            # Build a cleaned text that contains only useful metadata + main content (limit length)
            cleaned = []
            if title:
                cleaned.append(f"Title: {title}")
            if meta_desc:
                cleaned.append(f"Description: {meta_desc}")
            if main_text:
                cleaned.append("Content:\n" + main_text)

            content = "\n\n".join(cleaned)
            if not content.strip():
                # If nothing meaningful found, fallback to raw text (but cleaned)
                content = soup.get_text(separator="\n", strip=True)

        except Exception as e:
            logger.warning(f"Failed to parse HTML for useful content, falling back to raw. Error: {e}")
            content = html

        # Shorten the filename
        filename = request.url.split("//")[-1][:100].replace("/", "_") + ".txt"

        # Truncate content to a reasonable length to avoid huge token usage (e.g., 200k chars)
        max_chars = 200000
        if len(content) > max_chars:
            content = content[:max_chars]

        # Indexer le document comme pour un upload classique (send cleaned text)
        doc_id = process_document_for_user(filename, content.encode("utf-8", errors="ignore"), int(user_id), db, agent_id=request.agent_id)

        logger.info(f"URL ajoutée pour user {user_id}, agent {request.agent_id}: {request.url}")
        event_tracker.track_document_upload(int(user_id), request.url, len(content))

        return {"url": request.url, "document_id": doc_id, "agent_id": request.agent_id, "status": "uploaded"}
    except Exception as e:
        logger.error(f"Erreur lors de l'ajout d'URL: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de l'URL")
    


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.?taic\.ai",  # Permissif pour Cloud Run
    allow_credentials=True,  # Doit être False avec allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    """Initialize database and create tables on startup"""
    try:
        logger.info("Initializing database...")
        init_db()
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        
        # Run migration to add agent_id column if it doesn't exist
        logger.info("Running database migrations...")
        await run_migrations()
        
        logger.info("Database initialization completed successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        # Don't raise exception to allow the app to start, but log the error

async def run_migrations():
    """Run database migrations"""
    try:
        from sqlalchemy import text
        
        with engine.connect() as conn:
            # Check if agent_id column exists in documents table
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'documents' AND column_name = 'agent_id'
            """))
            
            if not result.fetchone():
                logger.info("Adding agent_id column to documents table...")
                conn.execute(text("""
                    ALTER TABLE documents 
                    ADD COLUMN agent_id INTEGER REFERENCES agents(id)
                """))
                conn.commit()
                logger.info("agent_id column added successfully")
            else:
                logger.info("agent_id column already exists")
                
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        # Don't raise exception to allow the app to continue

# Health check endpoints
@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "TAIC Companion API is running", "status": "ok"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "TAIC Companion API"}

# Pydantic models
class UserCreate(BaseModel):
    username: str
    email: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class QuestionRequest(BaseModel):
    question: str
    selected_documents: list[int] = []  # List of document IDs to use
    agent_id: int = None  # Id de l'agent sélectionné

class AgentCreate(BaseModel):
    name: str
    contexte: str = None
    biographie: str = None
    profile_photo: str = None  # URL or filename
    email: str
    password: str

class AgentResponse(BaseModel):
    id: int
    name: str
    contexte: str = None
    biographie: str = None
    profile_photo: str = None
    email: str
    user_id: int
    created_at: datetime
    class Config:
        from_attributes = True

# Routes
@app.post("/register")
async def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register new user"""
    try:
        # Check if user exists
        if db.query(User).filter(User.username == user.username).first():
            raise HTTPException(status_code=400, detail="Username already registered")
        
        if db.query(User).filter(User.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create new user
        hashed_password = hash_password(user.password)
        db_user = User(
            username=user.username,
            email=user.email,
            hashed_password=hashed_password
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"User registered: {user.username}")
        event_tracker.track_user_action(db_user.id, "user_registered")
        
        return {"message": "User created successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/login")
async def login(user: UserLogin, db: Session = Depends(get_db)):
    """Login user"""
    try:
        # Permet la connexion avec username OU email
        db_user = db.query(User).filter(
            (User.username == user.username) | (User.email == user.username)
        ).first()
        if not db_user or not verify_password(user.password, db_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        access_token = create_access_token(data={"sub": str(db_user.id)})
        logger.info(f"User logged in: {user.username}")
        event_tracker.track_user_action(db_user.id, "user_login")
        return {"access_token": access_token, "token_type": "bearer"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Nouvelle version de l'endpoint /ask : utilise toujours la mémoire (historique) et le modèle fine-tuné si dispo
from models_conversation import Message

@app.post("/ask")
async def ask_question(
    request: QuestionRequest,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Ask question to RAG system (toujours avec mémoire et bon modèle)"""
    start_time = time.time()
    try:
        logger.info(f"Processing question from user {user_id}: {request.question}")
        logger.info(f"Selected documents: {request.selected_documents}")

        # Récupérer l'historique complet de la conversation si conversation_id fourni
        history = []
        if hasattr(request, 'conversation_id') and request.conversation_id:
            msgs = db.query(Message).filter(Message.conversation_id == request.conversation_id).order_by(Message.created_at.asc()).all()
            history = [{"role": m.role, "content": m.content} for m in msgs]
        elif hasattr(request, 'history') and request.history:
            # fallback: si le frontend envoie déjà l'historique
            history = request.history

        # Ajoute les 3 derniers messages de l'agent concerné pour le contexte
        if request.agent_id:
            last_agent_msgs = db.query(Message).filter(
                Message.role == "agent",
                Message.conversation_id.in_(
                    db.query(Conversation.id).filter(Conversation.agent_id == request.agent_id)
                )
            ).order_by(Message.timestamp.desc()).limit(3).all()
            for m in reversed(last_agent_msgs):
                history.insert(0, {"role": m.role, "content": m.content})

        # Récupérer le modèle fine-tuné de l'agent si dispo
        model_id = None
        agent = None
        if request.agent_id:
            from database import Agent
            agent = db.query(Agent).filter(Agent.id == request.agent_id).first()
            if agent and agent.finetuned_model_id:
                model_id = agent.finetuned_model_id

            # Ajoute la phrase avant la question finale
            question_finale = request.question
            prompt = f"Sachant le contexte et la discussion en cours, réponds à cette question : {question_finale}"
            # Appeler get_answer avec mémoire et model_id
            answer = get_answer(
                prompt,
                int(user_id),
                db,
                selected_doc_ids=request.selected_documents,
                agent_id=request.agent_id,
                history=history,
                model_id=model_id
            )

        response_time = time.time() - start_time
        logger.info(f"Question answered for user {user_id} in {response_time:.2f}s")
        event_tracker.track_question_asked(int(user_id), request.question, response_time)
        return {"answer": answer}
    except Exception as e:
        logger.error(f"Error answering question for user {user_id}: {e}")
        return {"answer": f"Désolé, une erreur s'est produite lors du traitement de votre question. Détails: {str(e)}"}

@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Upload and process document for a specific agent"""
    try:
        # Check file size (10MB limit)
        if file.size > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large (max 10MB)")
        
        # Check file type
        allowed_types = ['.pdf', '.txt', '.docx', '.ics']
        if not any(file.filename.lower().endswith(ext) for ext in allowed_types):
            raise HTTPException(status_code=400, detail="File type not supported")
        
        content = await file.read()
        
        # Process document (agent_id will be None if not provided)
        doc_id = process_document_for_user(file.filename, content, int(user_id), db, agent_id=None)
        
        logger.info(f"Document uploaded for user {user_id}: {file.filename}")
        event_tracker.track_document_upload(int(user_id), file.filename, len(content))
        
        return {"filename": file.filename, "document_id": doc_id, "status": "uploaded"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/upload-agent")
async def upload_file_for_agent(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Upload and process document for a specific agent"""
    try:
        # Get agent_id from form data
        form = await request.form()
        logger.info(f"Form data received in /upload-agent: {dict(form)}")
        agent_id = form.get("agent_id")
        # Fallback: extract agent_id from 'data' if present (Zapier edge case)
        if not agent_id and "data" in form:
            # Try to parse agent_id from string like 'agent_id=23'
            data_value = form.get("data")
            if isinstance(data_value, str) and data_value.startswith("agent_id="):
                agent_id = data_value.split("=", 1)[1]
        
        if not agent_id:
            logger.error(f"agent_id missing in form: {dict(form)}")
            raise HTTPException(status_code=400, detail="agent_id is required")
        
        agent_id = int(agent_id)
        # Check file size (10MB limit)
        if file.size > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large (max 10MB)")
        
        # Check file type
        allowed_types = ['.pdf', '.txt', '.docx', '.ics']
        if not any(file.filename.lower().endswith(ext) for ext in allowed_types):
            raise HTTPException(status_code=400, detail="File type not supported")
        
        # Verify agent belongs to the user
        agent = db.query(Agent).filter(Agent.id == agent_id, Agent.user_id == int(user_id)).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found or doesn't belong to user")
        
        content = await file.read()
        doc_id = process_document_for_user(file.filename, content, int(user_id), db, agent_id)
        
        logger.info(f"Document uploaded for user {user_id}, agent {agent_id}: {file.filename}")
        event_tracker.track_document_upload(int(user_id), file.filename, len(content))
        
        return {"filename": file.filename, "document_id": doc_id, "agent_id": agent_id, "status": "uploaded"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": time.time()}

@app.get("/test-jwt")
async def test_jwt():
    """Test JWT configuration"""
    import os
    from auth import SECRET_KEY
    
    return {
        "jwt_secret_found": bool(os.getenv("JWT_SECRET_KEY")),
        "jwt_secret_length": len(SECRET_KEY) if SECRET_KEY else 0,
        "jwt_secret_prefix": SECRET_KEY[:10] + "..." if SECRET_KEY else "None",
        "environment_vars": {
            key: "***" if "KEY" in key or "SECRET" in key or "PASSWORD" in key 
            else value for key, value in os.environ.items() 
            if key.startswith(("JWT", "OPENAI", "DATABASE", "GOOGLE"))
        }
    }

@app.get("/test-auth")
async def test_auth(user_id: str = Depends(verify_token)):
    """Test authentication"""
    return {
        "status": "success",
        "message": "Authentication successful",
        "user_id": user_id,
        "timestamp": time.time()
    }

@app.get("/test-openai")
async def test_openai():
    """Test OpenAI connection"""
    try:
        import os
        import requests
        
        # Check if API key is accessible
        api_key = os.getenv("OPENAI_API_KEY")
        
        # Clean the API key - remove any whitespace/newlines (CRITICAL!)
        if api_key:
            api_key = api_key.strip()
            
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        
        response_data = {
            "api_key_found": bool(api_key),
            "api_key_length": len(api_key) if api_key else 0,
            "api_key_prefix": api_key[:10] + "..." if api_key else "None",
            "project_id": project_id,
        }
        
        if not api_key:
            return {
                "status": "error", 
                "message": "OPENAI_API_KEY not found in environment",
                "debug": response_data
            }
        
        # Test with direct HTTP request instead of OpenAI client
        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            data = {
                "input": "test",
                "model": "text-embedding-3-small"
            }
            
            # Test multiple endpoints
            endpoints_to_try = [
                "https://api.openai.com/v1/embeddings",
                "https://api.openai.com/v1/embeddings",  # Try twice for consistency
            ]
            
            for i, endpoint in enumerate(endpoints_to_try):
                try:
                    # Simple requests test
                    response = requests.post(
                        endpoint,
                        headers=headers,
                        json=data,
                        timeout=30,
                        verify=True  # Ensure SSL verification
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        return {
                            "status": "success", 
                            "message": f"OpenAI connection successful with requests (endpoint {i+1})",
                            "embedding_length": len(result['data'][0]['embedding']),
                            "endpoint_used": endpoint,
                            "debug": response_data
                        }
                    else:
                        response_data[f"attempt_{i+1}"] = f"Status {response.status_code}: {response.text[:100]}"
                        
                except Exception as e:
                    response_data[f"attempt_{i+1}_error"] = str(e)
                    continue
            
            # If all direct requests failed, return detailed error
            return {
                "status": "error", 
                "message": "All direct HTTP requests failed",
                "debug": response_data
            }
                
        except Exception as e:
            # Try with openai client as fallback
            from openai_client import client
            response = client.embeddings.create(
                input="test",
                model="text-embedding-3-small"
            )
            
            return {
                "status": "success", 
                "message": "OpenAI connection successful with client",
                "embedding_length": len(response.data[0].embedding),
                "debug": response_data
            }
        
    except Exception as e:
        return {
            "status": "error", 
            "message": str(e),
            "debug": response_data if 'response_data' in locals() else {}
        }

@app.get("/user/documents")
async def get_user_documents(
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db),
    agent_id: int = None
):
    """Get user's documents, optionally filtered by agent"""
    try:
        logger.info(f"Fetching documents for user {user_id}, agent {agent_id}")
        
        # Build query
        query = db.query(Document).filter(Document.user_id == int(user_id))
        
        # If agent_id is specified, filter by it
        if agent_id is not None:
            query = query.filter(Document.agent_id == agent_id)
        
        documents = query.all()
        logger.info(f"Found {len(documents)} documents for user {user_id}, agent {agent_id}")
        
        result = []

        for doc in documents:
            try:
                doc_data = {
                    "id": doc.id,
                    "filename": doc.filename,
                    "created_at": doc.created_at.isoformat(),
                    "gcs_url": doc.gcs_url
                }
                # Safely try to add agent_id if it exists
                if hasattr(doc, 'agent_id'):
                    doc_data["agent_id"] = doc.agent_id
                result.append(doc_data)
            except Exception as doc_error:
                logger.error(f"Error processing document {doc.id}: {doc_error}")
                continue

        return {"documents": result}
        
    except Exception as e:
        logger.error(f"Error fetching documents: {e}")
        logger.error(f"Error type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Delete a user's document"""
    try:
        # Check if document exists and belongs to user
        document = db.query(Document).filter(
            Document.id == document_id,
            Document.user_id == int(user_id)
        ).first()
        
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Delete document
        db.delete(document)
        db.commit()
        
        logger.info(f"Document {document_id} deleted by user {user_id}")
        event_tracker.track_user_action(int(user_id), f"document_deleted:{document.filename}")
        
        return {"message": "Document deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Endpoints pour les agents
@app.get("/agents")
async def get_agents(
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Get user's agents"""
    try:
        agents = db.query(Agent).filter(Agent.user_id == int(user_id)).all()
        return {"agents": agents}
    except Exception as e:
        logger.error(f"Error getting agents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")



@app.post("/agents")
async def create_agent(
    name: str = Form(...),
    contexte: str = Form(None),
    biographie: str = Form(None),
    statut: str = Form("public"),
    profile_photo: UploadFile = File(None),
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Create a new agent with optional profile photo upload"""
    try:
        logger.info(f"[CREATE_AGENT] Champs reçus: name={name}, contexte={contexte}, biographie={biographie}, statut={statut}, profile_photo={profile_photo.filename if profile_photo else None}, user_id={user_id}")
        # --- GCS UPLOAD UTILS ---
        GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "applydi-agent-photos")
        def upload_profile_photo_to_gcs(file: UploadFile) -> str:
            """Upload a file to Google Cloud Storage and return its public URL."""
            client = storage.Client()
            bucket = client.bucket(GCS_BUCKET_NAME)
            filename = f"{int(time.time())}_{file.filename.replace(' ', '_')}"
            blob = bucket.blob(filename)
            blob.upload_from_file(file.file, content_type=file.content_type)
            try:
                # Make the object publicly readable so the browser can load it directly
                blob.make_public()
            except Exception:
                logger.exception("Failed to make uploaded profile photo public; object may remain private")
            public_url = blob.public_url
            logger.info(f"Uploaded profile photo to GCS and set public URL: {public_url}")
            return public_url

        photo_url = None
        if profile_photo is not None:
            try:
                photo_url = upload_profile_photo_to_gcs(profile_photo)
                logger.info(f"[CREATE_AGENT] Photo de profil uploadée sur GCS: {photo_url}")
            except Exception as file_err:
                logger.error(f"[CREATE_AGENT] Erreur lors de l'upload GCS: {file_err}")
                raise HTTPException(status_code=500, detail=f"Erreur lors de l'upload de la photo sur GCS: {file_err}")

        db_agent = Agent(
            name=name,
            contexte=contexte,
            biographie=biographie,
            profile_photo=photo_url,
            statut=statut,
            user_id=int(user_id)
        )
        db.add(db_agent)
        db.commit()
        db.refresh(db_agent)
        logger.info(f"[CREATE_AGENT] Agent créé avec succès: id={db_agent.id}, statut={db_agent.statut}")
        return {"agent": db_agent}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CREATE_AGENT] Erreur inattendue: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création de l'agent: {e}")

@app.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: int,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Delete an agent"""
    try:
        agent = db.query(Agent).filter(
            Agent.id == agent_id,
            Agent.user_id == int(user_id)
        ).first()
        
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        db.delete(agent)
        db.commit()
        
        return {"message": "Agent deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting agent: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/agents/{agent_id}")
async def get_agent(
    agent_id: int,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Get a specific agent"""
    try:
        agent = db.query(Agent).filter(
            Agent.id == agent_id,
            Agent.user_id == int(user_id)
        ).first()
        
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        return {"agent": agent}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting agent: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class AgentLogin(BaseModel):
    email: str
    password: str

@app.post("/login-agent")
async def login_agent(agent: AgentLogin, db: Session = Depends(get_db)):
    """Login agent by email and password"""
    try:
        db_agent = db.query(Agent).filter(Agent.email == agent.email).first()
        if not db_agent or not verify_password(agent.password, db_agent.password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        access_token = create_access_token(data={"sub": str(db_agent.id), "agent": True})
        logger.info(f"Agent logged in: {agent.email}")
        return {"access_token": access_token, "agent_id": db_agent.id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login agent error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
# Endpoint pour modifier un agent existant
from fastapi import Form
@app.put("/agents/{agent_id}")
async def update_agent(
    agent_id: int,
    name: str = Form(...),
    contexte: str = Form(None),
    biographie: str = Form(None),
    statut: str = Form("public"),
    profile_photo: UploadFile = File(None),
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Met à jour un agent existant, y compris la photo de profil (GCS) et le statut."""
    try:
        agent = db.query(Agent).filter(
            Agent.id == agent_id,
            Agent.user_id == int(user_id)
        ).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        agent.name = name
        agent.contexte = contexte
        agent.biographie = biographie
        agent.statut = statut

        GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "applydi-agent-photos")
        def upload_profile_photo_to_gcs(file: UploadFile) -> str:
            client = storage.Client()
            bucket = client.bucket(GCS_BUCKET_NAME)
            filename = f"{int(time.time())}_{file.filename.replace(' ', '_')}"
            blob = bucket.blob(filename)
            blob.upload_from_file(file.file, content_type=file.content_type)
            try:
                blob.make_public()
            except Exception:
                logger.exception("Failed to make uploaded profile photo public; object may remain private")
            public_url = blob.public_url
            logger.info(f"Uploaded profile photo to GCS and set public URL: {public_url}")
            return public_url

        if profile_photo is not None:
            try:
                photo_url = upload_profile_photo_to_gcs(profile_photo)
                agent.profile_photo = photo_url
            except Exception as file_err:
                logger.error(f"[UPDATE_AGENT] Erreur lors de l'upload GCS: {file_err}")
                raise HTTPException(status_code=500, detail=f"Erreur lors de l'upload de la photo sur GCS: {file_err}")

        db.commit()
        db.refresh(agent)
        logger.info(f"[UPDATE_AGENT] Agent modifié avec succès: id={agent.id}, statut={agent.statut}")
        return {"agent": agent}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[UPDATE_AGENT] Erreur inattendue: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la modification de l'agent: {e}")

## Suppression des endpoints de génération de fichiers CSV et PDF

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

class ConversationCreate(BaseModel):
    agent_id: int
    title: Optional[str] = None

class MessageCreate(BaseModel):
    conversation_id: int
    role: str
    content: str

@app.post("/conversations", response_model=dict)
async def create_conversation(conv: ConversationCreate, db: Session = Depends(get_db)):
    conversation = Conversation(agent_id=conv.agent_id, title=conv.title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return {"conversation_id": conversation.id}

@app.get("/conversations", response_model=List[dict])
async def list_conversations(agent_id: int, db: Session = Depends(get_db)):
    conversations = db.query(Conversation).filter(Conversation.agent_id == agent_id).order_by(Conversation.created_at.desc()).all()
    return [{"id": c.id, "title": c.title, "created_at": c.created_at} for c in conversations]

@app.post("/conversations/{conversation_id}/messages", response_model=dict)
async def add_message(conversation_id: int, msg: MessageCreate, db: Session = Depends(get_db)):
    message = Message(conversation_id=conversation_id, role=msg.role, content=msg.content)
    db.add(message)
    db.commit()
    db.refresh(message)
    return {"message_id": message.id}

@app.get("/conversations/{conversation_id}/messages", response_model=List[dict])
async def get_messages(conversation_id: int, db: Session = Depends(get_db)):
    messages = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.timestamp.asc()).all()
    return [{"id": m.id, "role": m.role, "content": m.content, "timestamp": m.timestamp} for m in messages]
# Endpoint de connexion agent (email + password)
class FeedbackRequest(BaseModel):
    feedback: str  # 'like' ou 'dislike'

@app.patch("/messages/{message_id}/feedback")
async def set_message_feedback(message_id: int, req: FeedbackRequest, db: Session = Depends(get_db)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if req.feedback not in ("like", "dislike"):
        raise HTTPException(status_code=400, detail="Feedback must be 'like' or 'dislike'")
    msg.feedback = req.feedback
    # Si feedback = like, bufferise le message et le message user précédent
    if req.feedback == "like":
        msg.buffered = 1
        # Cherche le message user juste avant dans la même conversation
        prev_user_msg = db.query(Message).filter(
            Message.conversation_id == msg.conversation_id,
            Message.timestamp < msg.timestamp,
            Message.role == "user"
        ).order_by(Message.timestamp.desc()).first()
        if prev_user_msg:
            prev_user_msg.feedback = "like"
            prev_user_msg.buffered = 1
    db.commit()
    return {"message_id": msg.id, "feedback": msg.feedback, "buffered": msg.buffered}
# --- Endpoints pour conversations et messages ---
class ConversationTitleUpdate(BaseModel):
    title: str

@app.put("/conversations/{conversation_id}/title")
async def update_conversation_title(conversation_id: int, data: ConversationTitleUpdate, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.title = data.title
    db.commit()
    db.refresh(conv)
    return {"id": conv.id, "title": conv.title}

# Endpoint pour supprimer une conversation
@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conv)
    db.commit()
    return {"message": "Conversation deleted"}

# --- SLACK WEBHOOK ENDPOINT ---


# On garde les 500 derniers event_id pour éviter les doublons
_recent_event_ids = deque(maxlen=500)
_event_ids_lock = threading.Lock()



@app.post("/slack/events")
async def slack_events(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    event_id = data.get("event_id")
    if event_id:
        with _event_ids_lock:
            if event_id in _recent_event_ids:
                print(f"Event déjà traité, on ignore: {event_id}")
                return {"ok": True, "info": "Duplicate event ignored"}
            _recent_event_ids.append(event_id)
    # Vérification du challenge lors de l'installation
    if data.get("type") == "url_verification":
        return {"challenge": data["challenge"]}
    event = data.get("event", {})
    # On ne traite que les mentions du bot (app_mention)
    if event.get("type") == "app_mention" and "text" in event:
        user_message = event["text"]
        channel = event["channel"]
        team_id = data.get("team_id") or event.get("team")
        thread_ts = event.get("thread_ts")  # timestamp du thread si présent
        # Try to parse the bot user id from the mention (format: <@U123ABC>) and prefer selecting agent by bot user id
        import re
        # Extract all user mentions like <@U123ABC>
        mentions = re.findall(r"<@([A-Z0-9]+)>", user_message)
        agent = None
        matched_mention = None
        # Try to find an agent whose slack_bot_user_id matches any mention
        for mid in mentions:
            a = db.query(Agent).filter(Agent.slack_bot_user_id == mid).first()
            if a:
                agent = a
                matched_mention = mid
                break

        # Fallback: select by team id if no agent matched any mention
        if not agent:
            agent = db.query(Agent).filter(Agent.slack_team_id == team_id).first()

        if matched_mention:
            logger.info(f"Slack mention matched bot_user_id={matched_mention} -> agent_id={agent.id}")

        agent_id = agent.id if agent else None
        slack_token = agent.slack_bot_token if agent else None
        if not slack_token:
            print(f"❌ Aucun token Slack trouvé pour l'agent avec team_id={team_id}.")
            return {"ok": False, "error": "No Slack token for agent"}
        # 1. Récupère l'historique du channel ou du thread
        history = []
        try:
            headers = {"Authorization": f"Bearer {slack_token}"}
            messages = []
            if thread_ts:
                # Récupère tous les messages du thread
                resp = requests.get(
                    "https://slack.com/api/conversations.replies",
                    headers=headers,
                    params={"channel": channel, "ts": thread_ts}
                )
                messages = resp.json().get("messages", [])
                logger.info(f"Slack thread history (count={len(messages)}): {[m.get('text','') for m in messages]}")
            else:
                # Récupère les derniers messages du channel
                resp = requests.get(
                    "https://slack.com/api/conversations.history",
                    headers=headers,
                    params={"channel": channel, "limit": 10}
                )
                messages = resp.json().get("messages", [])
                logger.info(f"Slack channel history (count={len(messages)}): {[m.get('text','') for m in messages]}")
            # Formate l'historique pour le modèle dans l'ordre du plus ancien au plus récent
            for msg in sorted(messages, key=lambda m: float(m.get("ts", 0))):
                role = "user" if msg.get("user") else "assistant"
                content = msg.get("text", "")
                history.append({"role": role, "content": content})
        except Exception as e:
            logger.error(f"Erreur récupération historique Slack: {e}")
            history = []
        # Log le contenu de l'historique avant get_answer
        logger.info(f"Slack context sent to get_answer: {history}")
        # 2. Appel direct à la fonction get_answer avec l'historique Slack
        answer = get_answer(user_message, None, db, agent_id=agent_id, history=history)
        # 3. Envoie la réponse sur Slack avec le bon token
        resp = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {slack_token}"},
            json={"channel": channel, "text": answer, "thread_ts": thread_ts} if thread_ts else {"channel": channel, "text": answer}
        )
        print("Slack response:", resp.status_code, resp.text)
    return {"ok": True}



class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


# Endpoint pour demander la réinitialisation du mot de passe (DB version)
from database import PasswordResetToken

@app.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    token = str(uuid4())
    expires_at = datetime.utcnow() + timedelta(minutes=15)
    # Store token in DB
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=expires_at,
        used=False
    )
    db.add(reset_token)
    db.commit()
    # Génère le lien de réinitialisation dynamiquement
    import os
    frontend_url = os.getenv("FRONTEND_URL", "https://taic.ai")
    reset_link = f"{frontend_url}/reset-password?token={token}"
    try:
        send_reset_email(user.email, reset_link)
        return {"message": "Un lien de réinitialisation a été envoyé par email", "token": token}
    except Exception as e:
        print(f"Erreur lors de l'envoi de l'email: {e}")
        return {"message": "Erreur lors de l'envoi de l'email", "token": token}

# Endpoint pour réinitialiser le mot de passe (DB version)
@app.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    reset_token = db.query(PasswordResetToken).filter(PasswordResetToken.token == req.token).first()
    if not reset_token:
        raise HTTPException(status_code=400, detail="Token invalide ou expiré")
    if reset_token.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Token expiré")
    if reset_token.used:
        raise HTTPException(status_code=400, detail="Token déjà utilisé")
    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    user.hashed_password = hash_password(req.new_password)
    reset_token.used = True
    db.commit()
    return {"message": "Mot de passe réinitialisé avec succès"}
# Mémoire temporaire pour les event_id déjà traités (reset à chaque redémarrage du serveur)

def send_reset_email(to_email, reset_link):
    msg = MIMEText(f"Voici votre lien de réinitialisation : {reset_link}")
    msg['Subject'] = "Réinitialisation de votre mot de passe"
    msg['From'] = "cohenjeremy046@gmail.com"  # Remplace par ton adresse
    msg['To'] = to_email

    # Utilise un mot de passe d'application Gmail (pas ton vrai mot de passe)
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
        server.login("cohenjeremy046@gmail.com", "qvoo zfco ryva hwpi")  # Remplace par ton mot de passe d'application
        server.send_message(msg)


# ...existing code...


# ...existing code...

@app.get("/health-nltk")
async def health_nltk():
    """Health check for NLTK and chunking logic"""
    from file_loader import chunk_text
    test_text = "Hello world. This is a test.\n\nNew paragraph."
    try:
        chunks = chunk_text(test_text)
        return {"status": "ok", "chunks": chunks, "n_chunks": len(chunks)}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

#test
##### Public agents endpoints (no auth) #####

# Simple in-memory rate limiter per IP for public chat (timestamps list)
_public_chat_rate = {}
_PUBLIC_CHAT_LIMIT = 60  # messages per hour per IP


def _check_rate_limit(ip: str):
    now = time.time()
    window = 3600
    q = _public_chat_rate.get(ip) or []
    # keep timestamps within window
    q = [t for t in q if now - t < window]
    if len(q) >= _PUBLIC_CHAT_LIMIT:
        return False
    q.append(now)
    _public_chat_rate[ip] = q
    return True


@app.get("/public/agents/{agent_id}")
async def public_get_agent(agent_id: int, db: Session = Depends(get_db)):
    """Return public agent profile if statut == 'public'"""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.statut == 'public').first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not public")
    # Only expose non-sensitive fields
    return {
        "id": agent.id,
        "name": agent.name,
        "contexte": agent.contexte,
        "biographie": agent.biographie,
        "profile_photo": agent.profile_photo,
        "created_at": agent.created_at.isoformat() if hasattr(agent, 'created_at') else None,
        "slug": getattr(agent, 'slug', None),
    }


class PublicChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = None


@app.post("/public/agents/{agent_id}/chat")
async def public_agent_chat(agent_id: int, req: PublicChatRequest, request: Request, db: Session = Depends(get_db)):
    """Public chat endpoint for a public agent. Rate-limited by IP."""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.statut == 'public').first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not public")

    # Rate limiting
    ip = request.client.host if hasattr(request, 'client') and request.client else 'unknown'
    try:
        if not _check_rate_limit(ip):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
    except Exception:
        # fallback: allow to avoid blocking if something goes wrong
        pass

    # Build history for the model if provided
    history = req.history or []
    # Append the current user message as last user message in history
    history.append({"role": "user", "content": req.message})

    try:
        answer = get_answer(req.message, None, db, agent_id=agent_id, history=history)
    except Exception as e:
        logger.exception(f"Error generating public chat answer for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Error generating answer")

    return {"answer": answer}

#test
@app.get("/documents/{document_id}/download-url")
async def get_signed_download_url(document_id: int, user_id: str = Depends(verify_token), db: Session = Depends(get_db)):
    """Retourne une URL signée pour télécharger le document depuis GCS"""
    import logging
    import traceback
    from urllib.parse import urlparse
    logger = logging.getLogger("main.download_url")

    try:
        document = db.query(Document).filter(Document.id == document_id, Document.user_id == int(user_id)).first()
        if not document or not document.gcs_url:
            raise HTTPException(status_code=404, detail="Document non trouvé ou pas de fichier GCS")

        gcs_url = document.gcs_url
        logger.info(f"Generating signed URL for document {document_id}, gcs_url={gcs_url}")

        # Parse bucket and blob name (supports storage.googleapis.com and gs:// formats)
        from urllib.parse import unquote
        parsed = urlparse(gcs_url)
        if gcs_url.startswith('gs://'):
            parts = gcs_url[5:].split('/', 1)
            bucket_name = parts[0]
            blob_name = parts[1] if len(parts) > 1 else ''
        else:
            path = parsed.path.lstrip('/')
            path_parts = path.split('/')
            bucket_name = path_parts[0]
            blob_name_encoded = '/'.join(path_parts[1:])
            # URL-decode the blob name (handles %C3%A9, %2B, etc.)
            blob_name = unquote(blob_name_encoded)

        logger.info(f"Blob name (encoded)={locals().get('blob_name_encoded', None)}, decoded={blob_name}")

        logger.info(f"Parsed bucket={bucket_name}, blob={blob_name}")

        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Existence check
        try:
            exists = blob.exists()
        except Exception as e:
            logger.exception("Error checking blob existence (possible permission issue)")
            raise HTTPException(status_code=500, detail="Erreur lors de la vérification de l'existence du fichier GCS (vérifiez les permissions du service account)")

        if not exists:
            logger.error(f"Blob not found: {bucket_name}/{blob_name}")
            raise HTTPException(status_code=404, detail="Fichier introuvable dans le bucket GCS")

        try:
            url = blob.generate_signed_url(version="v4", expiration=600, method="GET")
        except Exception as e:
            logger.exception("Error generating signed URL (permission or signing issue)")
            # Provide a helpful hint without exposing sensitive info
            detail_msg = (
                "Impossible de générer le lien signé. Vérifiez que le service account a les droits GCS "
                "et la capacité de signer des URL (roles/storage.objectViewer et permissions de signature). "
                + "Détails: " + str(e)
            )
            # Fallback: offer a proxied download endpoint (secure, authenticated)
            proxy_url = f"/documents/{document_id}/download"
            logger.info(f"Falling back to proxy download for document {document_id}")
            return {"proxy_url": proxy_url, "note": "Signed URL generation failed; using authenticated proxy download."}

        logger.info(f"Signed URL generated for document {document_id}")
        return {"signed_url": url}

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        logger = logging.getLogger("main.download_url")
        logger.error(f"Unexpected error generating signed URL for document {document_id}: {e}\n{tb}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la génération du lien de téléchargement. Vérifiez les logs du backend.")


@app.get("/documents/{document_id}/download")
async def proxy_download_document(document_id: int, user_id: str = Depends(verify_token), db: Session = Depends(get_db)):
    """Stream the object from GCS through the backend as an authenticated proxy.
    This is a secure fallback when signed URL generation is not possible from the environment.
    """
    import mimetypes
    document = db.query(Document).filter(Document.id == document_id, Document.user_id == int(user_id)).first()
    if not document or not document.gcs_url:
        raise HTTPException(status_code=404, detail="Document non trouvé ou pas de fichier GCS")

    from urllib.parse import urlparse, unquote
    gcs_url = document.gcs_url
    parsed = urlparse(gcs_url)
    path = parsed.path.lstrip('/')
    path_parts = path.split('/')
    bucket_name = path_parts[0]
    blob_name_encoded = '/'.join(path_parts[1:])
    blob_name = unquote(blob_name_encoded)
    logger = logging.getLogger("main.download_url")
    logger.info(f"Proxy download: bucket={bucket_name}, blob_encoded={blob_name_encoded}, blob_decoded={blob_name}")

    client = storage.Client()
    bucket = client.bucket(bucket_name)

    # Attempt to get blob and check existence
    def get_blob(name: str):
        return bucket.blob(name)

    blob = get_blob(blob_name)

    # Existence check (may raise if permission issues)
    exists = None
    try:
        exists = blob.exists()
    except Exception:
        logger.exception(f"Error checking existence for blob {bucket_name}/{blob_name} (possible permission issue)")
        # keep exists as None and try download below

    if exists is False:
        logger.error(f"Blob not found for proxy: {bucket_name}/{blob_name}")
        raise HTTPException(status_code=404, detail="Fichier introuvable dans le bucket GCS")

    data = None
    # Try direct download
    try:
        data = blob.download_as_bytes()
    except Exception as exc:
        logger.exception(f"Initial download attempt failed for {bucket_name}/{blob_name}: {exc}")

        # If download failed, try unicode normalization variants (NFC/NFD)
        try:
            import unicodedata
            tried = []
            for norm in ("NFC", "NFD"):
                alt_name = unicodedata.normalize(norm, blob_name)
                if alt_name in tried or alt_name == blob_name:
                    continue
                tried.append(alt_name)
                logger.info(f"Retrying download with normalized blob name ({norm}): {alt_name}")
                alt_blob = get_blob(alt_name)
                try:
                    data = alt_blob.download_as_bytes()
                    # successful: use this blob
                    blob = alt_blob
                    blob_name = alt_name
                    logger.info(f"Download succeeded with normalized name ({norm})")
                    break
                except Exception as exc2:
                    logger.exception(f"Download failed with normalized name {alt_name}: {exc2}")
        except Exception as norm_exc:
            logger.exception(f"Error during unicode normalization retries: {norm_exc}")

    if data is None:
        # Determine if likely permission issue vs not found
        # If exists is None, we couldn't determine existence due to permission; respond with 403 hint
        if exists is None:
            logger.error(f"Download failed and existence unknown for {bucket_name}/{blob_name}. Likely permission issue.")
            raise HTTPException(status_code=403, detail="Le service n'a pas les permissions nécessaires pour lire l'objet GCS. Vérifiez roles/storage.objectViewer.")
        else:
            logger.error(f"All attempts to download blob failed for {bucket_name}/{blob_name}")
            raise HTTPException(status_code=500, detail="Impossible de récupérer le fichier depuis GCS")

    # Guess mimetype
    mime, _ = mimetypes.guess_type(document.filename)
    if not mime:
        mime = 'application/octet-stream'

    from fastapi.responses import StreamingResponse
    from io import BytesIO
    # Ensure filename is safe; use the stored document filename
    safe_filename = document.filename or os.path.basename(blob_name)
    headers = {
        'Content-Disposition': f'attachment; filename="{safe_filename}"'
    }
    return StreamingResponse(BytesIO(data), media_type=mime, headers=headers)

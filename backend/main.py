
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
        content = response.text
        filename = request.url.split("//")[-1][:100].replace("/", "_") + ".txt"

        # Indexer le document comme pour un upload classique
        doc_id = process_document_for_user(filename, content.encode(), int(user_id), db, agent_id=request.agent_id)

        logger.info(f"URL ajoutée pour user {user_id}, agent {request.agent_id}: {request.url}")
        event_tracker.track_document_upload(int(user_id), request.url, len(content))

        return {"url": request.url, "document_id": doc_id, "agent_id": request.agent_id, "status": "uploaded"}
    except Exception as e:
        logger.error(f"Erreur lors de l'ajout d'URL: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout de l'URL")
    


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permissif pour Cloud Run
    allow_credentials=False,  # Doit être False avec allow_origins=["*"]
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
    agent_type: str = None  # Optional agent type for specialized prompts

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
        db_user = db.query(User).filter(User.username == user.username).first()
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

@app.post("/ask")
async def ask_question(
    request: QuestionRequest,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Ask question to RAG system"""
    start_time = time.time()
    
    try:
        logger.info(f"Processing question from user {user_id}: {request.question}")
        logger.info(f"Selected documents: {request.selected_documents}")
        
        # Get only the answer (plus simple)
        answer = get_answer(
            request.question, 
            int(user_id), 
            db, 
            selected_doc_ids=request.selected_documents,
            agent_type=request.agent_type
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
                    "created_at": doc.created_at.isoformat()
                }
                # Safely try to add agent_id if it exists
                if hasattr(doc, 'agent_id'):
                    doc_data["agent_id"] = doc.agent_id
                result.append(doc_data)
            except Exception as doc_error:
                logger.error(f"Error processing document {doc.id}: {doc_error}")
                # Skip problematic documents but continue
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
    agent: AgentCreate,
    user_id: str = Depends(verify_token),
    db: Session = Depends(get_db)
):
    """Create a new agent"""
    try:
        # Check if email already exists for another agent
        if db.query(Agent).filter(Agent.email == agent.email).first():
            raise HTTPException(status_code=400, detail="Email already registered for another agent")
        # Hash password
        from auth import hash_password
        hashed_password = hash_password(agent.password)
        db_agent = Agent(
            name=agent.name,
            contexte=agent.contexte,
            biographie=agent.biographie,
            profile_photo=agent.profile_photo,
            email=agent.email,
            password=hashed_password,
            user_id=int(user_id)
        )
        db.add(db_agent)
        db.commit()
        db.refresh(db_agent)
        return {"agent": db_agent}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating agent: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

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

## Suppression des endpoints de génération de fichiers CSV et PDF

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

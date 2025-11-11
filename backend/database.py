import os
import logging
from typing import List, Optional
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy import UniqueConstraint
from datetime import datetime

# Configuration logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database configuration
def get_database_url():
    """Get database URL from environment or use default"""
    # First check if DATABASE_URL is explicitly provided
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url
    
    # Otherwise, build from components
    if os.getenv("GOOGLE_CLOUD_PROJECT"):
        # Production: Cloud SQL
        db_host = os.getenv("DB_HOST", "localhost")
        db_port = os.getenv("DB_PORT", "5432")
        db_name = os.getenv("DB_NAME", "ragdb")
        db_user = os.getenv("DB_USER", "raguser")
        db_password = os.getenv("DB_PASSWORD", "ragpassword")
        
        return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    else:
        # Development: Local database
        return "postgresql://raguser:ragpassword@localhost:5432/ragdb"

DATABASE_URL = get_database_url()

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relations avec les documents et les agents
    documents = relationship("Document", back_populates="owner", cascade="all, delete-orphan")
    agents = relationship("Agent", back_populates="owner", cascade="all, delete-orphan")

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(128), unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)

    user = relationship("User")

class Agent(Base):
    __tablename__ = "agents"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    contexte = Column(Text, nullable=True)  # contexte pour ChatGPT
    biographie = Column(Text, nullable=True)  # biographie visible côté users
    profile_photo = Column(String(255), nullable=True)  # chemin ou URL de la photo de profil
    email = Column(String(100), unique=True, nullable=True)  # email de connexion (désactivé pour création)
    password = Column(String(255), nullable=True)  # mot de passe hashé (désactivé pour création)
    statut = Column(String(10), nullable=False, default="public")  # 'public' ou 'privé'
    # type: 'conversationnel' | 'actionnable' | 'recherche_live'
    type = Column(String(32), nullable=False, default="conversationnel")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    finetuned_model_id = Column(String(255), nullable=True)  # ID du modèle OpenAI fine-tuné
    slack_bot_token = Column(String(255), nullable=True)  # Token du bot Slack associé à l'agent
    slack_team_id = Column(String(64), nullable=True)  # ID du workspace Slack associé à l'agent
    slack_bot_user_id = Column(String(64), nullable=True)  # Bot user ID (ex: U123ABC) pour identifier le bot dans une team

    # Relations
    owner = relationship("User", back_populates="agents")
    documents = relationship("Document", back_populates="agent", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    content = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)  # Documents peuvent être liés à un agent spécifique
    created_at = Column(DateTime, default=datetime.utcnow)
    gcs_url = Column(String(512), nullable=True)  # URL du fichier dans le bucket GCS

    # Relations
    owner = relationship("User", back_populates="documents")
    agent = relationship("Agent", back_populates="documents")
    # Relation avec les chunks
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(Text)  # JSON string of embedding vector
    chunk_index = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relation avec le document
    document = relationship("Document", back_populates="chunks")


class AgentAction(Base):
    __tablename__ = "agent_actions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    action_type = Column(String(100), nullable=False)
    params = Column(Text, nullable=True)
    result = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    agent = relationship("Agent")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    contexte = Column(Text, nullable=True)
    leader_agent_id = Column(Integer, nullable=False)
    # Store action agent ids as a JSON array string
    action_agent_ids = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")

# Create database engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,
    echo=False  # Set to True for SQL debugging
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Database dependency for FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database tables"""
    try:
        logger.info("Initializing database...")
        Base.metadata.create_all(bind=engine)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise e

def test_connection():
    """Test database connection"""
    try:
        db = SessionLocal()
        db.execute("SELECT 1")
        db.close()
        logger.info("Database connection successful")
        return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False

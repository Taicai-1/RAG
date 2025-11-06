
# Contient la logique RAG améliorée
import json
import logging
import time
from datetime import datetime
from typing import List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from openai_client import get_embedding, get_chat_response, get_embedding_fast
from database import Document, DocumentChunk, User, Agent
from file_loader import load_text_from_pdf, chunk_text
from file_generator import FileGenerator

logger = logging.getLogger(__name__)

# Cache simple pour les réponses récentes
_answer_cache = {}

def get_last_message_for_agent(agent_id: int, db: Session) -> str:
    """Retourne le dernier message envoyé à l'agent (mémoire courte par agent)."""
    from models_conversation import Message, Conversation
    # Récupère la dernière conversation de l'agent
    conv = db.query(Conversation).filter(Conversation.agent_id == agent_id).order_by(Conversation.created_at.desc()).first()
    if not conv:
        return ""
    # Récupère le dernier message de la conversation
    msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.timestamp.desc()).first()
    if not msg:
        return ""
    return msg.content

def get_answer_with_files(question: str, user_id: int, db: Session, selected_doc_ids: List[int] = None, agent_type: str = None) -> Dict[str, Any]:
    """Get answer using RAG with file generation capabilities"""
    try:
        # Créer une clé de cache
        cache_key = f"{user_id}_{hash(question)}_{hash(str(selected_doc_ids))}_{agent_type}"
        
        # Vérifier le cache (garde en cache pendant 5 minutes)
        if cache_key in _answer_cache:
            cached_time, cached_result = _answer_cache[cache_key]
            if datetime.now().timestamp() - cached_time < 300:  # 5 minutes
                logger.info("Returning cached answer")
                return cached_result
        
        # Get the regular answer first
        answer = get_answer(question, user_id, db, selected_doc_ids, agent_type)
        
        # Initialize file generator
        file_gen = FileGenerator()
        
        # Detect if user wants file generation
        generation_info = file_gen.detect_generation_request(question, answer)
        
        # If no table detected but user asked for structured data, create sample data
        if (generation_info['generate_csv'] or generation_info['generate_pdf']) and not generation_info['table_data']:
            sample_data = file_gen.create_sample_data(agent_type or 'sales')
            generation_info['table_data'] = sample_data
            generation_info['has_table'] = True
            
        # Format answer with table if needed
        if generation_info['has_table'] and generation_info['table_data']:
            generation_info['formatted_answer'] = file_gen._format_answer_with_table(answer, generation_info['table_data'])
        else:
            generation_info['formatted_answer'] = answer
            
        result = {
            'answer': generation_info['formatted_answer'],
            'generation_info': generation_info
        }
        
        # Mettre en cache le résultat
        _answer_cache[cache_key] = (datetime.now().timestamp(), result)
        
        # Nettoyer le cache (garder seulement les 10 dernières entrées)
        if len(_answer_cache) > 10:
            oldest_key = min(_answer_cache.keys(), key=lambda k: _answer_cache[k][0])
            del _answer_cache[oldest_key]
            
        return result
        
    except Exception as e:
        logger.error(f"Error getting answer with files: {e}")
        raise Exception(f"Erreur lors du traitement de votre question : {str(e)}")


def get_direct_gpt_response(question: str, db: Session, agent_id: int = None) -> str:
    """Get direct response from GPT without RAG when no documents are available, using agent_id for context"""
    try:
        from database import Agent
        agent = None
        contexte_agent = ""
        if agent_id:
            agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            contexte_agent = ""
        else:
            contexte_agent = agent.contexte or ""
        prompt = f"{contexte_agent}\n\nQuestion : {question}\n\nRéponse :"
        logger.info("Getting direct response from OpenAI (contexte personnalisé, pas de documents, agent_id)")
        response = get_chat_response(prompt)
        logger.info("Successfully got direct response from OpenAI")
        return response
    except Exception as e:
        logger.error(f"Error getting direct GPT response: {e}")
        raise Exception(f"Erreur lors du traitement de votre question : {str(e)}")


def get_answer(
    question: str,
    user_id: int,
    db: Session,
    selected_doc_ids: List[int] = None,
    agent_id: int = None,
    history: list = None,
    model_id: str = None
) -> str:
    """Get answer using RAG for specific user with OpenAI - always using embeddings, memory, and custom model if provided"""
    try:
        # Ajoute la mémoire courte par agent
        last_agent_message = None
        if agent_id:
            last_agent_message = get_last_message_for_agent(agent_id, db)
        # Get documents to consider for RAG
        # If selected_doc_ids provided, use those (and respect agent_id if present)
        if selected_doc_ids:
            q = db.query(Document).filter(Document.id.in_(selected_doc_ids))
            if agent_id:
                q = q.filter(Document.agent_id == agent_id)
            else:
                q = q.filter(Document.user_id == user_id)
            user_docs = q.all()
            logger.info(f"Using {len(user_docs)} selected documents: {selected_doc_ids}")
        else:
            # If we're in an agent context, prefer documents attached to that agent only
            if agent_id:
                user_docs = db.query(Document).filter(Document.agent_id == agent_id).all()
                logger.info(f"Using {len(user_docs)} documents attached to agent {agent_id}")
            else:
                user_docs = db.query(Document).filter(Document.user_id == user_id).all()
                logger.info(f"Using all {len(user_docs)} user documents")

        # Récupérer le contexte personnalisé de l'agent par son id
        agent = None
        contexte_agent = ""
        if agent_id:
            agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            agent = db.query(Agent).filter(Agent.user_id == user_id).first()
        contexte_agent = agent.contexte if agent and agent.contexte else ""

        # Si pas de documents, fallback sur le contexte + mémoire
        if not user_docs:
            if selected_doc_ids:
                return "Aucun des documents sélectionnés n'a été trouvé. Veuillez vérifier votre sélection."
            else:
                logger.info("No documents found, using context + question + memory only")
                # Prépare la liste messages pour OpenAI
                messages = []
                if contexte_agent:
                    messages.append({"role": "system", "content": contexte_agent})
                # Ajoute un résumé des 5 derniers échanges dans le prompt utilisateur
                if history:
                    last_msgs = history[-5:]
                    discussion = "\n".join([f"{m['role']}: {m['content']}" for m in last_msgs])
                    user_prompt = f"Voici la discussion en cours :\n{discussion}\n\nEt maintenant voici ma question : {question}"
                else:
                    user_prompt = question
                messages.append({"role": "user", "content": user_prompt})
                logger.info("[PROMPT OPENAI] %s", json.dumps(messages, ensure_ascii=False, indent=2))
                # If this request is for an actionnable agent, enforce Gemini-only (no OpenAI fallback)
                gemini_only_flag = False
                try:
                    gemini_only_flag = bool(agent and getattr(agent, 'type', '') == 'actionnable')
                except Exception:
                    gemini_only_flag = False
                response = get_chat_response(messages, model_id=model_id, gemini_only=gemini_only_flag)
                return response

        # Always get question embedding with retry
        logger.info(f"Getting embedding for question: {question}")
        query_embedding = get_embedding(question)
        logger.info("Successfully got query embedding")

        # Search similar chunks for this user (with optional document filtering)
        logger.info(f"Searching similar texts for user {user_id}")
        context_results = search_similar_texts_for_user(query_embedding, user_id, db, top_k=8, selected_doc_ids=selected_doc_ids, agent_id=agent_id)

        # Préparer le contexte RAG
        context_by_document = {}
        for result in context_results:
            doc_name = result['document_name']
            if doc_name not in context_by_document:
                context_by_document[doc_name] = []
            context_by_document[doc_name].append(result['text'])

        # Build enhanced context string
        enhanced_context = ""
        for doc_name, contexts in context_by_document.items():
            enhanced_context += f"\n--- Extraits du document '{doc_name}' ---\n"
            for i, context in enumerate(contexts, 1):
                enhanced_context += f"Extrait {i}: {context}\n"

        # Prompt final : contexte agent + mémoire courte + historique + question + extraits RAG
        messages = []
        if contexte_agent:
            messages.append({"role": "system", "content": contexte_agent})
        if last_agent_message:
            messages.append({"role": "assistant", "content": f"Mémoire agent : {last_agent_message}"})
        # Ajoute un résumé des 5 derniers échanges dans le prompt utilisateur
        if history:
            last_msgs = history[-5:]
            discussion = "\n".join([f"{m['role']}: {m['content']}" for m in last_msgs])
            user_content = f"Voici la discussion en cours :\n{discussion}\n\nEt maintenant voici ma question : {question}\n\nExtraits de documents :\n{enhanced_context}"
        else:
            user_content = f"{question}\n\nExtraits de documents :\n{enhanced_context}"
        messages.append({"role": "user", "content": user_content})
        logger.info("[PROMPT OPENAI] %s", json.dumps(messages, ensure_ascii=False, indent=2))
        logger.info("Getting response from OpenAI with structured messages (system, mémoire agent, last 5, user, RAG)")
        gemini_only_flag = False
        try:
            gemini_only_flag = bool(agent and getattr(agent, 'type', '') == 'actionnable')
        except Exception:
            gemini_only_flag = False
        response = get_chat_response(messages, model_id=model_id, gemini_only=gemini_only_flag)
        logger.info("Successfully got response from OpenAI")
        return response
    except Exception as e:
        logger.error(f"Error getting answer: {e}")
        raise Exception(f"Erreur lors du traitement de votre question avec l'API OpenAI : {str(e)}")
def search_similar_texts_for_user(query_embedding: List[float], user_id: int, db: Session, top_k: int = 3, selected_doc_ids: List[int] = None, agent_id: int = None) -> List[dict]:
    """Search similar texts for a specific user - returns structured data with document info"""
    try:
        # Get all chunks for user's documents (filter by selected documents if provided)
        query = db.query(DocumentChunk, Document).join(Document)
        # Respect agent_id when provided: prefer chunks from documents attached to the agent
        if agent_id:
            query = query.filter(Document.agent_id == agent_id)
        else:
            query = query.filter(Document.user_id == user_id)
        if selected_doc_ids:
            query = query.filter(Document.id.in_(selected_doc_ids))
        chunks_with_docs = query.all()
        if not chunks_with_docs:
            return []
        # Similarity search with document info
        similarities = []
        chunk_map = {}  # document_id -> [chunks ordered by chunk_index]
        for chunk, document in chunks_with_docs:
            if chunk.embedding:
                chunk_embedding = json.loads(chunk.embedding)
                similarity = cosine_similarity(query_embedding, chunk_embedding)
                similarities.append({
                    'similarity': similarity,
                    'text': chunk.chunk_text,
                    'document_id': document.id,
                    'document_name': document.filename,
                    'created_at': document.created_at.isoformat(),
                    'chunk_index': chunk.chunk_index
                })
                # Build chunk map for context retrieval
                if document.id not in chunk_map:
                    chunk_map[document.id] = []
                chunk_map[document.id].append((chunk.chunk_index, chunk.chunk_text))
        # Sort by similarity and get top_k
        similarities.sort(key=lambda x: x['similarity'], reverse=True)
        top_chunks = similarities[:top_k]
        # Ajoute les chunks voisins pour le contexte
        context_results = []
        for item in top_chunks:
            doc_id = item['document_id']
            idx = item['chunk_index']
            # Récupère les chunks voisins (avant/après)
            neighbors = []
            if doc_id in chunk_map:
                ordered_chunks = sorted(chunk_map[doc_id], key=lambda x: x[0])
                for i, (chunk_idx, chunk_text) in enumerate(ordered_chunks):
                    if chunk_idx == idx:
                        # Ajoute le chunk principal
                        neighbors.append(chunk_text)
                        # Ajoute le chunk précédent si dispo
                        if i > 0:
                            neighbors.insert(0, ordered_chunks[i-1][1])
                        # Ajoute le chunk suivant si dispo
                        if i < len(ordered_chunks)-1:
                            neighbors.append(ordered_chunks[i+1][1])
                        break
            # Concatène les chunks pour le contexte
            context_text = "\n".join(neighbors)
            context_results.append({
                'similarity': item['similarity'],
                'text': context_text,
                'document_id': item['document_id'],
                'document_name': item['document_name'],
                'created_at': item['created_at']
            })
        return context_results
    except Exception as e:
        logger.error(f"Error searching similar texts: {e}")
        return []

def get_documents_summary(user_id: int, db: Session, selected_doc_ids: List[int] = None) -> List[dict]:
    """Get complete information about user's documents"""
    try:
        if selected_doc_ids:
            documents = db.query(Document).filter(
                Document.user_id == user_id,
                Document.id.in_(selected_doc_ids)
            ).all()
        else:
            documents = db.query(Document).filter(Document.user_id == user_id).all()
        
        doc_info = []
        for doc in documents:
            # Get all chunks for this document
            chunks = db.query(DocumentChunk).filter(DocumentChunk.document_id == doc.id).all()
            content = " ".join([chunk.chunk_text for chunk in chunks])
            
            doc_info.append({
                'id': doc.id,
                'filename': doc.filename,
                'created_at': doc.created_at.isoformat(),
                'content': content[:2000] + "..." if len(content) > 2000 else content,  # Limit content
                'chunk_count': len(chunks)
            })
        
        return doc_info
    
    except Exception as e:
        logger.error(f"Error getting documents summary: {e}")
        return []

def search_text_fallback(question: str, user_id: int, db: Session, top_k: int = 3) -> List[str]:
    """Fallback text search when embeddings are not available"""
    try:
        # Get all chunks for user's documents
        chunks = db.query(DocumentChunk).join(Document).filter(
            Document.user_id == user_id
        ).all()
        
        if not chunks:
            return []
        
        # Simple keyword matching
        question_words = question.lower().split()
        scored_chunks = []
        
        for chunk in chunks:
            chunk_text = chunk.chunk_text.lower()
            score = 0
            
            # Count word matches
            for word in question_words:
                if len(word) > 2:  # Skip very short words
                    score += chunk_text.count(word)
            
            if score > 0:
                scored_chunks.append((score, chunk.chunk_text))
        
        # Sort by score and return top results
        scored_chunks.sort(reverse=True, key=lambda x: x[0])
        return [text for _, text in scored_chunks[:top_k]]
    
    except Exception as e:
        logger.error(f"Error in text fallback search: {e}")
        return []

def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Calculate cosine similarity between two vectors"""
    import numpy as np
    
    vec1 = np.array(vec1)
    vec2 = np.array(vec2)
    
    dot_product = np.dot(vec1, vec2)
    norm_vec1 = np.linalg.norm(vec1)
    norm_vec2 = np.linalg.norm(vec2)
    
    if norm_vec1 == 0 or norm_vec2 == 0:
        return 0
    
    return dot_product / (norm_vec1 * norm_vec2)

def process_document_for_user(filename: str, content: bytes, user_id: int, db: Session, agent_id: int = None) -> int:
    """Process and store document for specific user and optionally for a specific agent"""
    import tempfile
    import os
    
    try:
        logger.info(f"Starting to process document: {filename} for user {user_id}, agent {agent_id}")
        

        # Upload file to GCS
        from google.cloud import storage
        import time
        bucket_name = os.getenv("GCS_BUCKET_NAME", "applydi-documents")
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        gcs_filename = f"{int(time.time())}_{filename.replace(' ', '_')}"
        blob = bucket.blob(gcs_filename)
        blob.upload_from_string(content)
        gcs_url = blob.public_url
        logger.info(f"Document uploaded to GCS: {gcs_url}")

        # Save document to database with GCS URL
        document = Document(
            filename=filename,
            content=content.decode('utf-8') if filename.endswith('.txt') else str(content),
            user_id=user_id,
            agent_id=agent_id,
            gcs_url=gcs_url
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        logger.info(f"Document saved to database with ID: {document.id}")
        
        # Process content based on file type
        if filename.endswith('.pdf'):
            # Save content temporarily to process with pdfplumber
            tmp_file = None
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
                    tmp_file = tmp.name
                    tmp.write(content)
                logger.info(f"Processing PDF file: {tmp_file}")
                text_content = load_text_from_pdf(tmp_file)
            finally:
                # Clean up temporary file
                if tmp_file and os.path.exists(tmp_file):
                    os.unlink(tmp_file)
        else:
            text_content = content.decode('utf-8')
        
        logger.info(f"Extracted text length: {len(text_content)} characters")
        
        # Chunk the text
        chunks = chunk_text(text_content)
        logger.info(f"Created {len(chunks)} chunks")
        
        # Process first few chunks with embeddings, save others without embeddings for now
        max_immediate_chunks = 20  # Process only first 20 chunks immediately
        
        for i, chunk in enumerate(chunks):
            if i < max_immediate_chunks:
                logger.info(f"Processing chunk {i+1}/{len(chunks)} with embedding")
                try:
                    # Get embedding for chunk with shorter timeout
                    embedding = get_embedding_fast(chunk)
                except Exception as e:
                    logger.warning(f"Failed to get embedding for chunk {i}, using dummy: {e}")
                    embedding = [0.0] * 1536
            else:
                logger.info(f"Saving chunk {i+1}/{len(chunks)} without embedding (will process later)")
                embedding = None  # Will be processed later
            
            # Save chunk to database
            doc_chunk = DocumentChunk(
                document_id=document.id,
                chunk_text=chunk,
                embedding=json.dumps(embedding) if embedding else None,
                chunk_index=i
            )
            db.add(doc_chunk)
        
        db.commit()
        logger.info(f"Document processed successfully: {filename} for user {user_id}")
        return document.id
    
    except Exception as e:
        logger.error(f"Error processing document: {e}")
        db.rollback()
        raise e

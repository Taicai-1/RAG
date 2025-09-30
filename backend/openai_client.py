import os
from openai import OpenAI
from google.cloud import secretmanager
import logging

logger = logging.getLogger(__name__)

def get_secret(secret_name: str, project_id: str = None) -> str:
    """Get secret from Google Secret Manager"""
    try:
        if project_id:
            client = secretmanager.SecretManagerServiceClient()
            name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
            response = client.access_secret_version(request={"name": name})
            return response.payload.data.decode("UTF-8")
    except Exception as e:
        logger.warning(f"Could not get secret {secret_name}: {e}")
    
    # Fallback to environment variable
    return os.getenv(secret_name)

# Initialize OpenAI client
project_id = os.getenv("GOOGLE_CLOUD_PROJECT")

# Try environment variable first (injected by Cloud Run --set-secrets)
api_key = os.getenv("OPENAI_API_KEY")

# Clean the API key - remove any whitespace/newlines
if api_key:
    api_key = api_key.strip()

# Fallback to Secret Manager if not in environment
if not api_key:
    api_key = get_secret("OPENAI_API_KEY", project_id)
    if api_key:
        api_key = api_key.strip()

if not api_key:
    raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY environment variable or store in Secret Manager.")

logger.info(f"OpenAI API key found: {'Yes' if api_key else 'No'}")

# Initialize OpenAI client with custom configuration for Cloud Run
import httpx
client = OpenAI(
    api_key=api_key,
    timeout=30.0,
    max_retries=3,
    http_client=httpx.Client(
        timeout=30.0,
        limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
        http2=False  # Force HTTP/1.1 for better Cloud Run compatibility
    )
)

def get_embedding_fast(text: str) -> list:
    """Get embedding for text with fast timeout"""
    try:
        response = client.embeddings.create(
            input=text,
            model="text-embedding-3-small"
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Error getting fast embedding: {e}")
        # Return dummy embedding immediately
        return [0.0] * 1536  # text-embedding-3-small has 1536 dimensions

def get_embedding(text: str) -> list:
    """Get embedding for text with robust retry logic"""
    import time
    max_retries = 5
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Attempting to get embedding (attempt {attempt + 1}/{max_retries})")
            response = client.embeddings.create(
                input=text,
                model="text-embedding-3-small"
            )
            logger.info("Successfully got embedding from OpenAI")
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Error getting embedding (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff
                logger.info(f"Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
            else:
                logger.error("All embedding attempts failed")
                raise e



def get_chat_response(messages: list, model_id: str = None) -> str:
    """Get chat response from OpenAI with robust retry logic, custom model, and structured messages"""
    import time
    max_retries = 5
    model = model_id if model_id else "gpt-4"
    for attempt in range(max_retries):
        try:
            logger.info(f"Attempting to get chat response (attempt {attempt + 1}/{max_retries}) with model {model}")
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=1000,
                temperature=0.7
            )
            logger.info("Successfully got response from OpenAI")
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Error getting chat response (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff
                logger.info(f"Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
            else:
                logger.error("All chat response attempts failed")
                raise e

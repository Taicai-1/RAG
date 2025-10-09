import pdfplumber
from typing import List
import nltk
from nltk.tokenize import sent_tokenize, blankline_tokenize

def load_text_from_pdf(path: str) -> str:
    """Load text from PDF file"""
    text = ""
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"Error loading PDF: {e}")
    return text

def chunk_text(text: str, chunk_size: int = 2000, overlap: int = 200, chunk_type: str = "auto") -> List[str]:
    """
    Découpe le texte en chunks logiques : paragraphes, phrases, ou taille fixe.
    chunk_type: "paragraph", "sentence", "auto" (par défaut : auto)
    """
    nltk.download('punkt', quiet=True)
    chunks = []
    if chunk_type == "paragraph":
        paragraphs = [p for p in blankline_tokenize(text) if p.strip()]
        for p in paragraphs:
            if len(p) > chunk_size:
                # Si le paragraphe est trop long, découpe en phrases
                sentences = sent_tokenize(p)
                current = ""
                for s in sentences:
                    if len(current) + len(s) < chunk_size:
                        current += " " + s
                    else:
                        chunks.append(current.strip())
                        current = s
                if current:
                    chunks.append(current.strip())
            else:
                chunks.append(p.strip())
    elif chunk_type == "sentence":
        sentences = sent_tokenize(text)
        current = ""
        for s in sentences:
            if len(current) + len(s) < chunk_size:
                current += " " + s
            else:
                chunks.append(current.strip())
                current = s
        if current:
            chunks.append(current.strip())
    else:  # auto
        # Si le texte contient beaucoup de retours à la ligne, découpe en paragraphes
        if text.count('\n') > 10:
            return chunk_text(text, chunk_size, overlap, chunk_type="paragraph")
        else:
            return chunk_text(text, chunk_size, overlap, chunk_type="sentence")
    # Ajoute l'overlap
    final_chunks = []
    for i, chunk in enumerate(chunks):
        if i == 0:
            final_chunks.append(chunk)
        else:
            prev = final_chunks[-1]
            overlap_text = prev[-overlap:] if len(prev) > overlap else prev
            final_chunks.append(overlap_text + " " + chunk)
    return [c.strip() for c in final_chunks if c.strip()]

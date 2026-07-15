import os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
import uuid
import io

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Config from environment (injected via ConfigMap + Secret)
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
QDRANT_HOST = os.environ.get("QDRANT_HOST", "qdrant-svc")
QDRANT_PORT = int(os.environ.get("QDRANT_PORT", 6333))
COLLECTION = "documents"

genai.configure(api_key=GEMINI_API_KEY)
gemini = genai.GenerativeModel("gemini-3.1-flash-lite")

embedder = SentenceTransformer("all-MiniLM-L6-v2")

qdrant = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def ensure_collection():
    existing = [c.name for c in qdrant.get_collections().collections]
    if COLLECTION not in existing:
        qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE),
        )


@app.on_event("startup")
def startup():
    ensure_collection()


def chunk_text(text: str, size: int = 500, overlap: int = 50):
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i: i + size])
        chunks.append(chunk)
        i += size - overlap
    return chunks


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    contents = await file.read()
    reader = PdfReader(io.BytesIO(contents))
    text = " ".join(page.extract_text() for page in reader.pages if page.extract_text())

    chunks = chunk_text(text)
    embeddings = embedder.encode(chunks).tolist()

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=emb, payload={"text": chunk})
        for chunk, emb in zip(chunks, embeddings)
    ]
    qdrant.upsert(collection_name=COLLECTION, points=points)

    return {"uploaded": True, "chunks": len(chunks)}


class Query(BaseModel):
    question: str


@app.post("/api/query")
def query(payload: Query):
    embedding = embedder.encode(payload.question).tolist()
    hits = qdrant.search(
        collection_name=COLLECTION,
        query_vector=embedding,
        limit=4,
    )
    context = "\n\n".join(h.payload["text"] for h in hits)

    prompt = f"""Answer the question using only the context below.
If the answer isn't in the context, say "I don't have enough information."

Context:
{context}

Question: {payload.question}
"""
    response = gemini.generate_content(prompt)
    return {
        "answer": response.text,
        "sources": [h.payload["text"][:200] for h in hits],
    }
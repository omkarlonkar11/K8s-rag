# Project — RAG Chatbot on Kubernetes

A full-stack Retrieval-Augmented Generation (RAG) chatbot deployed on a local Kubernetes cluster using kind. Upload a PDF, ask questions about it, and get answers powered by Gemini — all routed through a real Kubernetes Ingress with multiple services talking to each other inside the cluster.

## Architecture

```
                        [ Ingress (nginx) ]
                               |
              ┌────────────────┴────────────────┐
              │                                 │
      /  →  [ React Frontend ]      /api →  [ FastAPI Backend ]
            (nginx container)                   │
                                    ┌───────────┴───────────┐
                                    │                       │
                              [ Qdrant ]              [ Gemini API ]
                           (vector DB, PVC)          (external, Secret)
```

### Services

| Service | Image | Role |
|---|---|---|
| rag-frontend | nginx + React build | Serves UI, proxies `/api` to backend |
| rag-backend | Python 3.11 + FastAPI | Embeds text, queries Qdrant, calls Gemini |
| qdrant | qdrant/qdrant | Vector database, persisted via PVC |

---

## Kubernetes concepts covered

| Concept | Where it appears |
|---|---|
| Namespace | All resources isolated under `rag` |
| Deployment | Frontend, backend (2 replicas), Qdrant |
| ClusterIP Service | Backend and Qdrant only reachable inside cluster |
| Ingress (nginx) | Single entrypoint — routes `/` vs `/api` |
| Secret | Gemini API key injected as env var, never hardcoded |
| ConfigMap | Qdrant host/port config for backend |
| PersistentVolumeClaim | Qdrant data survives pod restarts |
| Inter-pod DNS | Backend reaches Qdrant via `qdrant-svc:6333` |
| readinessProbe + livenessProbe | Backend health gated on `/api/health` |
| resource requests/limits | CPU and memory budgets on every container |
| Multi-stage Dockerfile | Frontend: Node build stage → nginx serve stage |
| imagePullPolicy: Never | Local images loaded into kind, not pulled from DockerHub |

---

## How RAG works

1. User uploads a PDF → backend extracts text, chunks it, embeds each chunk with `all-MiniLM-L6-v2`, stores vectors in Qdrant
2. User asks a question → backend embeds the question, searches Qdrant for the 4 most similar chunks
3. Backend sends context + question to Gemini Flash → returns answer to React UI

---

## Project structure

```
.
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   └── App.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
└── k8s/
    ├── namespace.yaml
    ├── secret.yaml
    ├── configmap.yaml
    ├── qdrant/
    │   ├── pvc.yaml
    │   ├── deployment.yaml
    │   └── service.yaml
    ├── backend/
    │   ├── deployment.yaml
    │   └── service.yaml
    ├── frontend/
    │   ├── deployment.yaml
    │   └── service.yaml
    └── ingress.yaml
```

---

## Prerequisites

- Docker
- kubectl
- kind

---

## Running locally

### 1. Create the kind cluster with Ingress port mappings

```bash
cat > kind-config.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
EOF

kind create cluster --name rag-cluster --config kind-config.yaml
```

### 2. Install nginx Ingress controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

### 3. Add your Gemini API key to the secret

Edit `k8s/secret.yaml` and replace the placeholder with your key from [aistudio.google.com](https://aistudio.google.com).

### 4. Build and load images

```bash
docker build -t rag-backend:v1 ./backend
docker build -t rag-frontend:v1 ./frontend

kind load docker-image rag-backend:v1 --name rag-cluster
kind load docker-image rag-frontend:v1 --name rag-cluster
```

### 5. Apply manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/qdrant/pvc.yaml
kubectl apply -f k8s/qdrant/deployment.yaml
kubectl apply -f k8s/qdrant/service.yaml
kubectl apply -f k8s/backend/deployment.yaml
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### 6. Watch pods come up

```bash
kubectl get pods -n rag -w
```

All 4 pods should reach `Running`. Backend pods take longest — the embedding model loads on startup.

### 7. Open the app

```
http://localhost
```

Upload a PDF, ask a question, get an answer grounded in your document.

---

## Key learnings

- A **Namespace** isolates all resources so `kubectl get pods` doesn't mix your app with kube-system internals — always use `-n rag`
- **ClusterIP** services are only reachable inside the cluster — Qdrant and the backend are intentionally not exposed externally
- **Ingress** is a single entry point that routes traffic to different services based on path — far cleaner than exposing every service as a NodePort
- **Secrets** are base64-encoded in etcd; `stringData` lets you write plain text and Kubernetes handles encoding on apply — never commit real keys
- **PersistentVolumeClaim** decouples storage from the pod lifecycle — deleting the Qdrant pod doesn't lose your indexed documents
- Inter-pod communication uses Kubernetes DNS: `qdrant-svc` resolves to the Qdrant ClusterIP automatically within the same namespace
- The frontend nginx config handles both static file serving and API proxying — no CORS issues since the browser only ever talks to one origin

---

## Teardown

```bash
kind delete cluster --name rag-cluster
docker rmi rag-backend:v1 rag-frontend:v1
docker system prune -a --volumes
```

---

## Stack

- Python 3.11 / FastAPI / Uvicorn
- HuggingFace sentence-transformers (all-MiniLM-L6-v2)
- Qdrant vector database
- Google Gemini Flash API
- React 18 + Vite
- nginx (multi-stage Docker build)
- Kubernetes (kind cluster)
- Fedora 43 KDE

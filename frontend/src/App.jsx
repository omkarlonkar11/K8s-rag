import { useState } from "react";

export default function App() {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState(null);
    const [sources, setSources] = useState([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadMsg, setUploadMsg] = useState("");

    async function handleUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        setUploadMsg("");
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        setUploadMsg(`Uploaded — ${data.chunks} chunks indexed`);
        setUploading(false);
    }

    async function handleQuery() {
        if (!question.trim()) return;
        setLoading(true);
        setAnswer(null);
        setSources([]);
        const res = await fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
        });
        const data = await res.json();
        setAnswer(data.answer);
        setSources(data.sources);
        setLoading(false);
    }

    return (
        <div style={styles.container}>
            <h1 style={styles.title}>RAG Chatbot</h1>

            <div style={styles.card}>
                <h2 style={styles.sectionTitle}>1. Upload a PDF</h2>
                <input type="file" accept=".pdf" onChange={handleUpload} />
                {uploading && <p style={styles.muted}>Uploading...</p>}
                {uploadMsg && <p style={styles.success}>{uploadMsg}</p>}
            </div>

            <div style={styles.card}>
                <h2 style={styles.sectionTitle}>2. Ask a question</h2>
                <textarea
                    style={styles.textarea}
                    rows={3}
                    placeholder="What is this document about?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                />
                <button
                    style={styles.button}
                    onClick={handleQuery}
                    disabled={loading}
                >
                    {loading ? "Thinking..." : "Ask"}
                </button>
            </div>

            {answer && (
                <div style={styles.card}>
                    <h2 style={styles.sectionTitle}>Answer</h2>
                    <p style={styles.answer}>{answer}</p>

                    {sources.length > 0 && (
                        <>
                            <h3 style={styles.sectionTitle}>Sources used</h3>
                            {sources.map((s, i) => (
                                <p key={i} style={styles.source}>
                                    {s}...
                                </p>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

const styles = {
    container: { maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif", padding: "0 16px" },
    title: { fontSize: 28, marginBottom: 24 },
    card: { background: "#f9f9f9", borderRadius: 8, padding: 20, marginBottom: 20, border: "1px solid #e0e0e0" },
    sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
    textarea: { width: "100%", padding: 10, fontSize: 14, borderRadius: 6, border: "1px solid #ccc", boxSizing: "border-box" },
    button: { marginTop: 10, padding: "10px 24px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 },
    answer: { lineHeight: 1.7, fontSize: 15 },
    source: { fontSize: 12, color: "#666", background: "#fff", padding: 8, borderRadius: 4, border: "1px solid #e0e0e0", marginBottom: 8 },
    muted: { color: "#888", fontSize: 13 },
    success: { color: "#16a34a", fontSize: 13 },
};
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const API = import.meta.env.VITE_API_URL || "";

// ── helpers ───────────────────────────────────────────────────────────────────
const fileIcon = (lang) => {
  const m = { Python:"🐍", Java:"☕", JS:"📜", JSX:"📜", TS:"📘", TSX:"📘", HTML:"🌐", CSS:"🎨", JSON:"📋", MD:"📝", SQL:"🗄️", Shell:"⚙️", Go:"🔵", Rust:"🦀", Ruby:"💎", PHP:"🐘" };
  return m[lang] || "📄";
};

const gradeColor = (g) => {
  if (!g) return "var(--muted2)";
  if (g.startsWith("A")) return "var(--green)";
  if (g.startsWith("B")) return "var(--cyan)";
  if (g.startsWith("C")) return "var(--amber)";
  return "var(--red)";
};

const parseApiResponse = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`API error ${res.status}: ${text ? text.slice(0, 1200) : "<empty>"}`);
  }
};

const CHART_COLORS = ["#ffd600","#7c4dff","#00e676","#ffb300","#ff5370","#ff9100"];

// ── sub-components ────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="msg-row model">
      <div className="msg model" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 2 }}>
        <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
      </div>
    </div>
  );
}

function ReportView({ report, onRegenerate, loading, language = "english" }) {
  if (loading) return <div className="loading-state"><div className="loading-spinner" />Generating your report…</div>;
  if (!report) return null;
  const gradeClass = report.grade?.replace("+","").replace("-","")[0] || "C";

  return (
    <div className="report-wrap">
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 16, textTransform: "uppercase", letterSpacing: 1 }}>
        🌐 Language: {language === "hinglish" ? "Hinglish" : "English"}
      </div>
      <div className="score-hero">
        <div>
          <div className="score-grade" style={{ color: gradeColor(report.grade) }}>{report.grade || "—"}</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 4 }}>{report.overallScore}/100</div>
        </div>
        <div className="score-info">
          <div className="score-feedback">{report.overallFeedback}</div>
          {report.strengths?.length > 0 && (
            <div className="strengths-row" style={{ marginTop: 12 }}>
              {report.strengths.map((s, i) => <span key={i} className="strength-tag">{s}</span>)}
            </div>
          )}
          {report.areasToImprove?.length > 0 && (
            <div className="strengths-row" style={{ marginTop: 8 }}>
              {report.areasToImprove.map((a, i) => <span key={i} className="weakness-tag">⚠ {a}</span>)}
            </div>
          )}
        </div>
      </div>

      {report.chartData && (
        <div className="chart-wrap">
          <div className="chart-title">Skill Analysis Radar</div>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={report.chartData}>
              <PolarGrid stroke="var(--border2)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--muted2)", fontSize: 10, fontFamily: "var(--mono)" }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="var(--cyan)" fill="var(--cyan)" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {report.evaluations?.map((ev, i) => (
        <div key={i} className="ev-item">
          <div className="ev-q"><span style={{ color: "var(--cyan)" }}>Q{i + 1}.</span> {ev.question}</div>
          <div className="ev-section your-ans"><div className="ev-label" style={{ color: "var(--muted2)" }}>Your Answer</div>{ev.userAnswer || "No answer provided."}</div>
          <div className="ev-section ideal-ans"><div className="ev-label" style={{ color: "var(--green)" }}>Analysis & Ideal Approach</div>{ev.feedback}</div>
          {ev.mistakes?.length > 0 && (
            <ul className="mistakes-list">{ev.mistakes.map((m, j) => <li key={j}>⚠ {m}</li>)}</ul>
          )}
          {ev.followUpQuestions?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "var(--cyan)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>→ Follow-up Questions</div>
              <ul className="followup-list">{ev.followUpQuestions.map((q, j) => <li key={j}>→ {q}</li>)}</ul>
            </div>
          )}
        </div>
      ))}

      {onRegenerate && (
        <button className="btn-main" onClick={onRegenerate} style={{ marginTop: 8 }}>⟳ Regenerate Report</button>
      )}
    </div>
  );
}

// ── FINAL INTERVIEW MODAL ─────────────────────────────────────────────────────
function FinalInterviewModal({ sessionId, language = "english", onClose }) {
  const [stage, setStage] = useState("loading"); // loading | interview | report
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // idx -> string
  const [isRecording, setIsRecording] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState("");
  const recRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/final-interview-questions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, language })
        });
        const d = await parseApiResponse(r);
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setQuestions(d.questions);
        setStage("interview");
        setTimeout(() => speakText(d.questions[0]?.q), 600);
      } catch (err) {
        alert("Failed to load interview questions: " + err.message);
        onClose();
      }
    })();
  }, []);

  const speakText = (text) => {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(text);
    ut.rate = 0.95; ut.pitch = 1;
    window.speechSynthesis.speak(ut);
  };

  const handleRecord = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Your browser doesn't support speech recognition. Please type your answer.");
    if (isRecording) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false;
    rec.onstart = () => setIsRecording(true);
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join(" ");
      setAnswers(prev => ({ ...prev, [currentIdx]: ((prev[currentIdx] || "") + " " + t).trim() }));
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recRef.current = rec;
    rec.start();
  };

  const handleNext = () => {
    window.speechSynthesis.cancel();
    if (recRef.current) recRef.current.stop();
    setShowHint(false);
    if (currentIdx < questions.length - 1) {
      const next = currentIdx + 1;
      setCurrentIdx(next);
      setTimeout(() => speakText(questions[next]?.q), 400);
    } else {
      generateFinalReport();
    }
  };

  const generateFinalReport = async () => {
    setStage("report"); setReportLoading(true);
    try {
      const qaPairs = questions.map((q, i) => ({
        q: q.q, idealA: q.a, userA: answers[i] || "No answer provided."
      }));
      const r = await fetch(`${API}/api/final-interview-report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language, qaPairs })
      });
      const d = await parseApiResponse(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReport(d);
    } catch (err) {
      setReportError(err.message);
    }
    setReportLoading(false);
  };

  const q = questions[currentIdx];
  const progress = questions.length ? ((currentIdx) / questions.length) * 100 : 0;
  const diffClass = (d) => d === "Easy" ? "badge-easy" : d === "Hard" ? "badge-hard" : "badge-medium";

  return (
    <div className="fi-overlay">
      <div className="fi-nav">
        <div className="fi-nav-title">🎤 Final AI Interview</div>
        {stage === "interview" && (
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>
            Question {currentIdx + 1} of {questions.length}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {stage === "report" && (
            <button className="nav-btn" onClick={() => { setStage("interview"); setCurrentIdx(questions.length - 1); }}>← Back to Interview</button>
          )}
          <button className="nav-btn" onClick={() => { window.speechSynthesis.cancel(); onClose(); }}>✕ Exit</button>
        </div>
      </div>

      <div className="fi-body">
        {stage === "loading" && (
          <div className="fi-loading">
            <div className="fi-loading-spinner" />
            <div>Generating your personalized interview questions…</div>
          </div>
        )}

        {stage === "interview" && q && (
          <div className="fi-card">
            <div className="fi-progress">
              <div className="fi-progress-bar"><div className="fi-progress-fill" style={{ width: `${progress}%` }} /></div>
              <div className="fi-progress-text">{currentIdx + 1}/{questions.length}</div>
            </div>

            <div className="fi-q-label">
              <span>Interview Question</span>
              <span style={{ flex: 1, height: 1, background: "var(--border2)", display: "block" }} />
            </div>

            <div className="fi-question">{q.q}</div>

            <div className="fi-meta">
              {q.difficulty && <span className={`qa-badge ${diffClass(q.difficulty)}`}>{q.difficulty}</span>}
              {q.category && <span className="badge badge-muted">{q.category}</span>}
              <button className="fi-play-btn" onClick={() => speakText(q.q)} title="Replay question">🔊</button>
              <button className="fi-play-btn" onClick={() => setShowHint(h => !h)} title="Show hint" style={{ fontSize: 14 }}>💡 Hint</button>
            </div>

            {showHint && q.hint && <div className="fi-hint">💡 {q.hint}</div>}

            <div className="fi-answer-area">
              <textarea
                className="fi-textarea"
                placeholder="Type your answer here, or click the microphone to speak…"
                value={answers[currentIdx] || ""}
                onChange={e => setAnswers(prev => ({ ...prev, [currentIdx]: e.target.value }))}
              />
            </div>

            {isRecording && (
              <div className="fi-waveform">
                {Array.from({ length: 8 }).map((_, i) => <span key={i} />)}
              </div>
            )}

            <div className="fi-controls">
              <button className={`fi-record-btn ${isRecording ? "rec" : "idle"}`} onClick={handleRecord}>
                {isRecording ? "⏹ Stop Recording" : "🎙 Speak Answer"}
              </button>
              <button className="fi-next-btn" onClick={handleNext}>
                {currentIdx < questions.length - 1 ? "Next Question →" : "Finish & Generate Report ✨"}
              </button>
            </div>
          </div>
        )}

        {stage === "report" && (
          <div style={{ width: "100%", maxWidth: 900 }}>
            {reportLoading && (
              <div className="fi-loading">
                <div className="fi-loading-spinner" />
                <div>Analyzing your performance across all questions…</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>This may take 10-20 seconds</div>
              </div>
            )}
            {reportError && <div className="error-box">{reportError}</div>}
            {report && !reportLoading && <FinalReportPage report={report} language={language} onRestart={() => { setStage("interview"); setCurrentIdx(0); setAnswers({}); setReport(null); setShowHint(false); }} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FINAL REPORT PAGE (inside modal) ─────────────────────────────────────────
function FinalReportPage({ report, onRestart, language = "english" }) {
  const gradeClass = report.grade?.replace("+", "").replace("-", "")[0] || "C";
  const recStyle = report.recommendation?.includes("No") ? "reject" : report.recommendation?.includes("Maybe") ? "maybe" : "hire";

  return (
    <div className="fr-page">
      <div className="fr-header">
        <div style={{ fontFamily: "var(--display)", fontSize: 13, color: "var(--muted2)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Interview Complete · Final Evaluation</span>
          <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 1, color: "var(--muted)" }}>🌐 {language === "hinglish" ? "Hinglish" : "English"}</span>
        </div>
        <div className="fr-hero">
          <div style={{ textAlign: "center" }}>
            <div className="fr-grade" style={{ color: gradeColor(report.grade) }}>{report.grade}</div>
            <div style={{ fontSize: 14, color: "var(--muted2)", marginTop: 4 }}>{report.overallScore}/100</div>
          </div>
          <div>
            {report.recommendation && (
              <div className={`fr-rec ${recStyle}`}>{report.recommendation}</div>
            )}
            <div style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Executive Summary</div>
            <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.8, fontWeight: 300 }}>{report.overallFeedback}</div>
            {report.keyTakeaways?.length > 0 && (
              <ul style={{ marginTop: 14, paddingLeft: 18, fontSize: 13, color: "var(--muted2)", lineHeight: 2 }}>
                {report.keyTakeaways.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            )}
          </div>
        </div>

        <div className="fr-charts">
          {report.chartData && (
            <div className="chart-wrap">
              <div className="chart-title">Skill Radar</div>
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={report.chartData}>
                  <PolarGrid stroke="var(--border2)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--muted2)", fontSize: 10, fontFamily: "var(--mono)" }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar dataKey="score" stroke="var(--violet)" fill="var(--violet)" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          {report.questionScores && (
            <div className="chart-wrap">
              <div className="chart-title">Per-Question Scores</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={report.questionScores} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: "var(--muted2)", fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "var(--muted2)", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                    {report.questionScores.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {(report.strengths?.length > 0 || report.areasToImprove?.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div className="chart-wrap">
              <div className="fr-section-title">✅ Strengths</div>
              <div className="strengths-row">
                {report.strengths?.map((s, i) => <span key={i} className="strength-tag">{s}</span>)}
              </div>
            </div>
            <div className="chart-wrap">
              <div className="fr-section-title">⚠ Areas to Improve</div>
              <div className="strengths-row">
                {report.areasToImprove?.map((a, i) => <span key={i} className="weakness-tag">{a}</span>)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="fr-section-title">Detailed Question Breakdown</div>
      <div className="fr-ev-list">
        {report.evaluations?.map((ev, i) => (
          <div key={i} className="ev-item">
            <div className="ev-q">
              <span style={{ color: "var(--violet)" }}>Q{i + 1}.</span>
              <span style={{ flex: 1 }}>{ev.question}</span>
              {ev.score !== undefined && (
                <span style={{ color: gradeColor(ev.score >= 85 ? "A" : ev.score >= 70 ? "B" : ev.score >= 55 ? "C" : "D"), fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{ev.score}/100</span>
              )}
            </div>
            <div className="ev-section your-ans"><div className="ev-label" style={{ color: "var(--muted2)" }}>Your Answer</div>{ev.userAnswer || "No answer provided."}</div>
            <div className="ev-section feedback"><div className="ev-label" style={{ color: "var(--cyan)" }}>AI Feedback</div>{ev.feedback}</div>
            {ev.idealAnswer && <div className="ev-section ideal-ans"><div className="ev-label" style={{ color: "var(--green)" }}>Ideal Answer</div>{ev.idealAnswer}</div>}
            {ev.mistakes?.length > 0 && <ul className="mistakes-list">{ev.mistakes.map((m, j) => <li key={j}>⚠ {m}</li>)}</ul>}
            {ev.followUpQuestions?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: "var(--cyan)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>→ Natural Follow-up Questions</div>
                <ul className="followup-list">{ev.followUpQuestions.map((q, j) => <li key={j}>→ {q}</li>)}</ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <button className="btn-main" onClick={onRestart} style={{ flex: 1 }}>🔄 Restart Interview</button>
        <button className="nav-btn" onClick={() => window.print()} style={{ padding: "14px 24px" }}>🖨 Print Report</button>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [language, setLanguage] = useState("english"); // english | hinglish
  const [phase, setPhase] = useState("upload"); // upload | analyzing | results
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [sessionId, setSessionId] = useState(null);
  const [files, setFiles] = useState([]);
  const [selFile, setSelFile] = useState(null);
  const [fileViewTab, setFileViewTab] = useState("code");
  const [treeSearch, setTreeSearch] = useState("");

  const [interviewData, setInterviewData] = useState({});
  const [userAnswers, setUserAnswers] = useState({});
  const [reportData, setReportData] = useState({});
  const [recordingIdx, setRecordingIdx] = useState(null);

  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);

  const [showFinalInterview, setShowFinalInterview] = useState(false);

  const chatRef = useRef();
  const fileRef = useRef();
  const recRef = useRef(null);
  
  const [treeWidth, setTreeWidth] = useState(280);
  const [chatWidth, setChatWidth] = useState(380);
  const isResizingRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      if (isResizingRef.current === "left") {
        setTreeWidth(Math.max(150, Math.min(e.clientX - 24, 600)));
      } else if (isResizingRef.current === "right") {
        setChatWidth(Math.max(250, Math.min(window.innerWidth - e.clientX - 24, 800)));
      }
    };
    const handleMouseUp = () => {
      isResizingRef.current = null;
      document.body.style.cursor = "default";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const log = useCallback((msg) => setLogs(l => [...l.slice(-20), msg]), []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatHistory, isChatting]);

  useEffect(() => {
    setFileViewTab("code");
    setRecordingIdx(null);
  }, [selFile]);

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(ut);
  };

  const handleRecord = (idx, filePath) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Browser doesn't support speech recognition.");
    if (recordingIdx === idx) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false;
    rec.onstart = () => setRecordingIdx(idx);
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join(" ");
      setUserAnswers(prev => ({ ...prev, [filePath]: { ...(prev[filePath] || {}), [idx]: ((prev[filePath]?.[idx] || "") + " " + t).trim() } }));
    };
    rec.onend = () => setRecordingIdx(null);
    rec.onerror = () => setRecordingIdx(null);
    recRef.current = rec;
    rec.start();
  };

  // ── file tree (grouped by dir) ─────────────────────────────────────────────
  const filteredFiles = treeSearch
    ? files.filter(f => f.name.toLowerCase().includes(treeSearch.toLowerCase()) || f.path.toLowerCase().includes(treeSearch.toLowerCase()))
    : files;

  const groupedFiles = filteredFiles.reduce((acc, f) => {
    const dir = f.dir || "(root)";
    if (!acc[dir]) acc[dir] = [];
    acc[dir].push(f);
    return acc;
  }, {});

  // ── upload ─────────────────────────────────────────────────────────────────
  const processUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) { setError("No files selected."); return; }
    setError(""); setPhase("analyzing"); setProgress(10); setCurrentStep(0); setLogs([]);
    log("Packing files…");
    const CODE_EXT = new Set([
      ".js",".jsx",".ts",".tsx",".py",".java",".cpp",".c",".cs",".go",".rs",
      ".php",".rb",".swift",".kt",".html",".css",".json",".xml",".yaml",".yml",
      ".md",".sh",".sql",".vue",".svelte",".dart",".scala",".r",".h",".hpp"
    ]);
    const fd = new FormData();
    let fileCount = 0;
    let totalSize = 0;
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const p = f.webkitRelativePath || f.name || "";
      if (p.includes("node_modules") || p.includes(".git") || p.includes(".next") || p.includes("dist") || p.includes(".cache")) continue;
      const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
      if (!CODE_EXT.has(ext)) continue;
      if (f.size > 2 * 1024 * 1024) continue; // skip massive individual files
      if (totalSize + f.size > 4.2 * 1024 * 1024) {
        log(`⚠ Warning: Vercel 4.5MB payload limit reached. Skipping remaining files...`);
        break;
      }
      totalSize += f.size;
      fd.append("files", f);
      fileCount++;
    }
    if (fileCount === 0) { setError("No valid code files found under the size limits."); setPhase("upload"); return; }
    try {
      setCurrentStep(1); setProgress(35);
      log(`Uploading ${fileCount} files to backend…`);
      const res = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text || "{}");
      } catch (jsonErr) {
        throw new Error(`Upload failed (non-JSON response ${res.status}): ${text.slice(0, 1024)}`);
      }
      if (!res.ok) throw new Error(data.error || `Upload failed ${res.status}: ${text.slice(0, 256)}`);
      setProgress(85); setCurrentStep(2);
      log(`Processed ${data.files.length} code files ✓`);
      setSessionId(data.sessionId);
      setFiles(data.files);
      if (data.files.length > 0) setSelFile(data.files[0]);
      setProgress(100); setCurrentStep(3);
      setTimeout(() => setPhase("results"), 700);
    } catch (err) {
      setError("Upload failed: " + err.message);
      setPhase("upload");
    }
  };

  const handleFolderSelect = (e) => processUpload(e.target.files);
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); processUpload(e.dataTransfer.files); };

  // ── chat ───────────────────────────────────────────────────────────────────
  const handleChat = async (override = null) => {
    const msg = typeof override === "string" ? override : chatInput.trim();
    if (!msg || isChatting) return;
    if (typeof override !== "string") setChatInput("");
    setChatHistory(h => [...h, { role: "user", text: msg }]);
    setIsChatting(true);
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language, message: msg, selectedFilePath: selFile?.path || null, history: chatHistory })
      });
      const d = await parseApiResponse(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setChatHistory(h => [...h, { role: "model", text: d.reply }]);
    } catch (err) {
      setChatHistory(h => [...h, { role: "model", text: `⚠ Error: ${err.message}` }]);
    }
    setIsChatting(false);
  };

  // ── interview questions ────────────────────────────────────────────────────
  const handleInterviewGen = async () => {
    if (!selFile || interviewData[selFile.path]?.data || interviewData[selFile.path]?.loading) return;
    setInterviewData(p => ({ ...p, [selFile.path]: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/interview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language, selectedFilePath: selFile.path })
      });
      const d = await parseApiResponse(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setInterviewData(p => ({ ...p, [selFile.path]: { loading: false, data: d.questions } }));
    } catch (err) {
      setInterviewData(p => ({ ...p, [selFile.path]: { loading: false, error: err.message } }));
    }
  };

  // ── file-level report ─────────────────────────────────────────────────────
  const handleGenerateReport = async () => {
    const qData = interviewData[selFile.path]?.data;
    if (!qData) return;
    const answers = userAnswers[selFile.path] || {};
    const qaPairs = qData.map((qa, i) => ({ q: qa.q, idealA: qa.a, userA: answers[i] || "No answer provided." }));
    setReportData(p => ({ ...p, [selFile.path]: { loading: true } }));
    try {
      const res = await fetch(`${API}/api/report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language, selectedFilePath: selFile.path, qaPairs })
      });
      const d = await parseApiResponse(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setReportData(p => ({ ...p, [selFile.path]: { loading: false, data: d } }));
    } catch (err) {
      setReportData(p => ({ ...p, [selFile.path]: { loading: false, error: err.message } }));
    }
  };

  const STEPS = ["Packing files", "Uploading to backend", "Processing structure", "Done!"];
  const diffClass = (d) => d === "Easy" ? "badge-easy" : d === "Hard" ? "badge-hard" : "badge-medium";

  // ══════════════════════════════════════════════════════════════════════════
  //  UPLOAD SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === "upload") return (
    <div className="app">
      <div className="grid-bg" />
      <nav className="nav"><div className="nav-inner">
        <div className="nav-logo">PROJECT<span>-HELPER</span></div>
      </div></nav>
      <div className="wrap"><div className="upload-screen"><div className="upload-box">
        <div className="upload-tag">AI-Powered Code Intelligence Platform</div>
        <div className="upload-title">Understand Your<br /><em>Codebase.</em></div>
        <div className="upload-sub">Upload your entire project folder. Get instant AI explanations, voice-led technical interview practice, and a comprehensive performance report — all in one workspace.</div>

        <div className="api-row">
          <div className="api-label">Response Language</div>
          <div className="api-input-wrap" style={{ display: 'flex', gap: 8 }}>
            <select className="api-input" value={language} onChange={e => setLanguage(e.target.value)} style={{ width: '100%' }}>
              <option value="english">English</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>
        </div>

        <input ref={fileRef} type="file" webkitdirectory="" directory="" style={{ display: "none" }} onChange={handleFolderSelect} multiple />
        <div
          className={`drop-zone ${isDragging ? "drag-over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <span className="drop-icon">📁</span>
          <div className="drop-title">{isDragging ? "Drop to Upload!" : "Select Project Folder"}</div>
          <div className="drop-sub">Click to browse · Drag & drop a folder · Supports JS, Python, Java, Go, Rust, PHP + more</div>
        </div>

        {error && <div className="error-box" style={{ marginTop: 16 }}>⚠ {error}</div>}
        <button className="btn-main" onClick={() => fileRef.current?.click()}>
          ⚡ Upload & Analyze Project
        </button>
      </div></div></div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  //  ANALYZING SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === "analyzing") return (
    <div className="app">
      <div className="grid-bg" />
      <nav className="nav"><div className="nav-inner"><div className="nav-logo">PROJECT<span>-HELPER</span></div></div></nav>
      <div className="wrap"><div className="progress-screen"><div className="progress-box">
        <div className="progress-title">Indexing Codebase…</div>
        <div className="progress-sub">Sending your project to the backend and building context for Gemini</div>
        <div className="p-steps">
          {STEPS.map((s, i) => {
            const st = i < currentStep ? "done" : i === currentStep ? "active" : "wait";
            return <div className="p-step" key={i}>
              <div className={`p-icon ${st}`}>{st === "done" ? "✓" : st === "active" ? "⟳" : "○"}</div>
              <span className={`p-text ${st}`}>{s}</span>
            </div>;
          })}
        </div>
        <div className="p-bar-bg"><div className="p-bar-fill" style={{ width: `${progress}%` }} /></div>
        <div className="p-pct">{progress}% complete</div>
        <div className="p-log">{logs.map((l, i) => <div className="p-log-line" key={i}>› <span>{l}</span></div>)}</div>
      </div></div></div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  //  RESULTS / WORKSPACE
  // ══════════════════════════════════════════════════════════════════════════
  const iData = selFile ? interviewData[selFile.path] : null;
  const rData = selFile ? reportData[selFile.path] : null;

  return (
    <div className="app">
      <div className="grid-bg" />
      <nav className="nav"><div className="nav-inner">
        <div className="nav-logo">PROJECT<span>-HELPER</span></div>
        <div className="nav-pill" style={{ color: "var(--green)", borderColor: "var(--green)", background: "rgba(0,230,118,0.08)" }}>✓ {files.length} files indexed</div>
        
        <select 
          style={{ background: "var(--s1)", border: "1px solid var(--border2)", color: "var(--text)", padding: "4px 10px", borderRadius: "16px", fontSize: "11px", fontFamily: "var(--mono)", outline: "none", cursor: "pointer", marginLeft: "12px" }} 
          value={language} 
          onChange={e => setLanguage(e.target.value)}
        >
          <option value="english">English</option>
          <option value="hinglish">Hinglish</option>
        </select>

        <button className="nav-btn primary" onClick={() => setShowFinalInterview(true)}>🎤 Final AI Interview</button>
        <button className="nav-btn" onClick={() => { setPhase("upload"); setSessionId(null); setFiles([]); setChatHistory([]); setInterviewData({}); setReportData({}); setUserAnswers({}); }}>↩ New Project</button>
      </div></nav>

      {showFinalInterview && (
        <FinalInterviewModal sessionId={sessionId} language={language} onClose={() => setShowFinalInterview(false)} />
      )}

      <div className="wrap">
        <div className="workspace">
          <div className="ws-header">
            <div className="ws-title">Codebase <em>Workspace.</em></div>
            <div className="ws-sub">Exploring {files.length} files · Select any file to analyze, ask questions, or start an interview</div>
          </div>

          <div className="file-grid" style={{ display: "flex", gap: 0 }}>
            {/* ── 1. FILE TREE ── */}
            <div className="panel" style={{ width: treeWidth, flexShrink: 0 }}>
              <div className="panel-hdr"><span>📁 Explorer</span><span style={{ color: "var(--muted)" }}>{files.length}</span></div>
              <div className="tree-search">
                <input placeholder="🔍 Search files…" value={treeSearch} onChange={e => setTreeSearch(e.target.value)} />
              </div>
              <div className="tree-list">
                {Object.entries(groupedFiles).map(([dir, dirFiles]) => (
                  <div key={dir}>
                    <div className="tree-dir">{dir}</div>
                    {dirFiles.map((f, i) => (
                      <div key={i} className={`tree-item ${selFile?.path === f.path ? "sel" : ""}`} onClick={() => setSelFile(f)}>
                        <span>{fileIcon(f.lang)}</span>
                        <span className="tree-name">{f.name}</span>
                        <span className="tree-lang">{f.lang}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="resizer" onMouseDown={() => { isResizingRef.current = "left"; document.body.style.cursor = "col-resize"; }} />

            {/* ── 2. ANALYSIS PANEL ── */}
            <div className="panel" style={{ flex: 1, minWidth: 200, width: "auto" }}>
              {selFile ? (<>
                <div className="ap-header">
                  <div>
                    <div className="ap-fname">{selFile.path}</div>
                  </div>
                  <div className="ap-meta">
                    <span className="badge badge-muted">{selFile.lines} lines</span>
                    <span className="badge badge-cyan">{selFile.lang}</span>
                  </div>
                </div>
                <div className="tabs-bar">
                  <div className={`tab-item ${fileViewTab === "code" ? "active" : ""}`} onClick={() => setFileViewTab("code")}>Source Code</div>
                  <div className={`tab-item ${fileViewTab === "interview" ? "active" : ""}`} onClick={() => { setFileViewTab("interview"); handleInterviewGen(); }}>Interview Q&A</div>
                  <div className={`tab-item ${fileViewTab === "report" ? "active" : ""}`} onClick={() => setFileViewTab("report")}>Final Report</div>
                </div>
                <div className="ap-content">
                  {/* SOURCE CODE TAB */}
                  {fileViewTab === "code" && (
                    <pre className="code-view">{selFile.content}</pre>
                  )}

                  {/* INTERVIEW TAB */}
                  {fileViewTab === "interview" && (
                    <div>
                      {iData?.loading && <div className="loading-state"><div className="loading-spinner" />Generating interview questions for {selFile.name}…</div>}
                      {iData?.error && <div className="error-box">{iData.error}</div>}
                      {iData?.data && (
                        <div className="qa-list">
                          <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 12 }}>
                            Answer each question, then switch to <strong style={{ color: "var(--cyan)" }}>Final Report</strong> tab for your evaluation.
                          </div>
                          {iData.data.map((qa, idx) => (
                            <div key={idx} className="qa-item">
                              <div className="qa-q">
                                <span className="qa-num">Q{idx + 1}.</span>
                                <span className="qa-qtext">{qa.q}</span>
                                <span className={`qa-badge ${diffClass(qa.difficulty)}`}>{qa.difficulty}</span>
                                <button className="speak-btn" onClick={() => speak(qa.q)} title="Play audio">🔊</button>
                              </div>
                              {qa.category && <div style={{ fontSize: 10, color: "var(--muted2)", padding: "0 14px 8px 46px", textTransform: "uppercase", letterSpacing: 1 }}>{qa.category}</div>}
                              <div className="qa-answer-area">
                                <textarea
                                  className="answer-textarea"
                                  placeholder="Type your answer… or use Speak"
                                  value={userAnswers[selFile.path]?.[idx] || ""}
                                  onChange={e => setUserAnswers(p => ({ ...p, [selFile.path]: { ...(p[selFile.path] || {}), [idx]: e.target.value } }))}
                                />
                                <div className="qa-controls">
                                  <button
                                    className={`voice-btn ${recordingIdx === idx ? "recording" : ""}`}
                                    onClick={() => handleRecord(idx, selFile.path)}
                                  >{recordingIdx === idx ? "⏹ Stop" : "🎙 Speak"}</button>
                                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
                                    {userAnswers[selFile.path]?.[idx] ? `${userAnswers[selFile.path][idx].length} chars` : "No answer yet"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div style={{ marginTop: 24, textAlign: "center" }}>
                            <button
                              className="btn-main"
                              onClick={() => {
                                setFileViewTab("report");
                                handleGenerateReport();
                              }}
                            >
                              🚀 Submit Paper & Get Final Report
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* REPORT TAB */}
                  {fileViewTab === "report" && (
                    <div>
                      {rData?.loading && <div className="loading-state"><div className="loading-spinner" />Evaluating your answers…</div>}
                      {rData?.error && <div className="error-box">{rData.error}</div>}
                      {rData?.data && (
                        <ReportView report={rData.data} onRegenerate={handleGenerateReport} loading={false} language={language} />
                      )}
                      {!rData && (
                        <div style={{ textAlign: "center", padding: "48px 24px" }}>
                          <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
                          <div style={{ color: "var(--muted2)", fontSize: 13, marginBottom: 24, lineHeight: 1.9 }}>
                            {iData?.data
                              ? "Answer the interview questions, then generate your personalized performance report."
                              : "Switch to the Interview Q&A tab first to generate and answer questions."}
                          </div>
                          <button className="btn-main" disabled={!iData?.data} onClick={handleGenerateReport}>
                            ✨ Generate Performance Report
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>) : (
                <div style={{ padding: 40, color: "var(--muted2)", fontSize: 13, textAlign: "center", margin: "auto", lineHeight: 2 }}>
                  ← Select a file from the explorer<br />to view source, run interviews, and get reports
                </div>
              )}
            </div>

            <div className="resizer" onMouseDown={() => { isResizingRef.current = "right"; document.body.style.cursor = "col-resize"; }} />

            {/* ── 3. CHAT PANEL ── */}
            <div className="panel chat-panel" style={{ width: chatWidth, flexShrink: 0 }}>
              <div className="chat-hdr">
                <div className="chat-title">🤖 PROJECT-HELPER</div>
                <div className="chat-sub">Context: {selFile ? `Focused on ${selFile.name}` : "Entire codebase"}</div>
              </div>

              <div className="chat-messages" ref={chatRef}>
                {chatHistory.length === 0 && (
                  <div className="chat-empty">
                    Ask anything about this project<br /><br />
                    <strong>✨ Detail about the code of the file</strong>
                    <strong>🗺 Explain the project flow</strong>
                    <strong>🔍 Find potential bugs</strong>
                  </div>
                )}
                {chatHistory.map((h, i) => (
                  <div key={i} className={`msg-row ${h.role}`}>
                    <div className={`msg ${h.role}`}>{h.text}</div>
                  </div>
                ))}
                {isChatting && <TypingIndicator />}
              </div>

              <div className="quick-bar">
                <span className="quick-label">Quick:</span>
                {selFile ? (
                  <button className="action-btn" disabled={isChatting}
                    onClick={() => handleChat("Detail about the code of the file. Break it down line-by-line or function-by-function. Explain what each piece of code does—whether it's for logic, structure, design, or specific functionality—so I fully understand its purpose and structure.")}>
                    ✨ Detail Code
                  </button>
                ) : (
                  <button className="action-btn" disabled={isChatting}
                    onClick={() => handleChat("Explain the project flow. How is the project structured, what are the main execution flows, and how do the components interact with each other?")}>
                    🗺 Project Flow
                  </button>
                )}
                <button className="action-btn" disabled={isChatting}
                  onClick={() => handleChat(selFile ? `What are the potential bugs, security issues, or improvements in ${selFile.name}? Be specific and thorough.` : "What are the overall potential bugs, security issues, or architectural improvements in this project?")}>
                  🔍 Find Issues
                </button>
                <button className="action-btn" disabled={isChatting}
                  onClick={() => handleChat(selFile ? `What design patterns are used in ${selFile.name}? How could the code quality be improved?` : "What design patterns are used in this project? Provide a high-level architectural review.")}>
                  🏗 Patterns
                </button>
              </div>

              <div className="chat-input-bar">
                <textarea
                  className="chat-in"
                  placeholder="Ask about the code…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                  disabled={isChatting}
                  rows={1}
                />
                <button className="chat-send" onClick={handleChat} disabled={isChatting || !chatInput.trim()}>Send ↗</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// In-memory store for sessions
const sessions = new Map();

const DEFAULT_KEY = process.env.GROQ_API_KEY || "";

const CODE_EXT = new Set([
  ".js",".jsx",".ts",".tsx",".py",".java",".cpp",".c",".cs",".go",".rs",
  ".php",".rb",".swift",".kt",".html",".css",".json",".xml",".yaml",".yml",
  ".md",".sh",".sql",".vue",".svelte",".dart",".scala",".r",".m",".h",".hpp"
]);

const LANG_MAP = {
  ".js":"JS",".jsx":"JSX",".ts":"TS",".tsx":"TSX",".py":"Python",".java":"Java",
  ".cpp":"C++",".c":"C",".cs":"C#",".go":"Go",".rs":"Rust",".php":"PHP",
  ".rb":"Ruby",".html":"HTML",".css":"CSS",".json":"JSON",".sql":"SQL",
  ".md":"MD",".sh":"Shell",".vue":"Vue",".svelte":"Svelte",".dart":"Dart",
  ".scala":"Scala",".r":"R",".swift":"Swift",".kt":"Kotlin",".h":"C Header",".hpp":"C++ Header"
};

function getLang(name) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return LANG_MAP[ext] || ext.replace(".","").toUpperCase();
}

const MODEL_CANDIDATES = [
  process.env.GENERATIVE_MODEL,
  "llama-3.1-8b-instant"
].filter(Boolean);

const LANGUAGE_INSTRUCTIONS = {
  english: "Please answer in English, with clear, concise technical language.",
  hinglish: "Please answer in Hinglish (Hindi in Latin script mixed with English), friendly but technical."
};

function composeLangInstruction(language) {
  return LANGUAGE_INSTRUCTIONS[(language || "english").toLowerCase()] || LANGUAGE_INSTRUCTIONS.english;
}

function extractErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.response?.data) {
    if (typeof err.response.data === "string") return err.response.data;
    if (err.response.data.error?.message) return err.response.data.error.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isModelFallbackError(err) {
  const message = extractErrorMessage(err).toLowerCase();
  return /not found|unsupported|invalid model|404|decommissioned|deprecated/.test(message);
}

async function withFallbackModel(apiKey, handler) {
  const key = apiKey || DEFAULT_KEY;
  const groq = new Groq({ apiKey: key });
  let lastErr = null;

  for (const candidate of MODEL_CANDIDATES) {
    try {
      const result = await handler(groq, candidate);
      return result;
    } catch (err) {
      lastErr = err;
      if (isModelFallbackError(err)) {
        console.warn(`Model fallback: ${candidate} failed. Trying next candidate:`, err.message);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All model candidates failed. Last error: ${lastErr?.message || "unknown"}`);
}

function cleanJson(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/```json/g, "");
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/```/g, "");
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.array('files', 2000), (req, res) => {
  try {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const files = req.files
      .map(f => ({
        path: f.originalname,
        name: f.originalname.split('/').pop(),
        dir: f.originalname.includes('/') ? f.originalname.split('/').slice(0, -1).join('/') : '',
        content: f.buffer.toString('utf-8'),
        lang: getLang(f.originalname),
        lines: f.buffer.toString('utf-8').split('\n').length,
        size: f.size
      }))
      .filter(f => {
        const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase() : '';
        return CODE_EXT.has(ext);
      });

    sessions.set(sessionId, { files, createdAt: Date.now() });

    // Cleanup old sessions (keep last 20)
    if (sessions.size > 20) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      sessions.delete(oldest[0]);
    }

    res.json({ sessionId, files: files.map(f => ({ path: f.path, name: f.name, dir: f.dir, lang: f.lang, lines: f.lines, size: f.size })) });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to process files: " + err.message });
  }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { sessionId, language = "english", message, selectedFilePath, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found. Please re-upload your project." });

  const langInstruction = composeLangInstruction(language);

  try {
    const reply = await withFallbackModel(undefined, async (groq, model) => {
      let filesContext = "PROJECT FILES OVERVIEW:\n";
      session.files.forEach(f => { filesContext += `- ${f.path} (${f.lang}, ${f.lines} lines)\n`; });
      filesContext += "\n\n";

      if (selectedFilePath) {
        const selected = session.files.find(f => f.path === selectedFilePath);
        if (selected) {
          filesContext += `FOCUS FILE (${selectedFilePath}) [${selected.lang}]:\n\`\`\`\n${selected.content.slice(0, 20000)}\n\`\`\`\n\n`;
        }
      } else {
        const topFiles = session.files.slice(0, 10);
        topFiles.forEach(f => {
          filesContext += `FILE (${f.path}):\n\`\`\`\n${f.content.slice(0, 5000)}\n\`\`\`\n\n`;
        });
      }

      const systemPrompt = `You are PROJECT-HELPER, an expert senior software engineer and AI code analyst. ${langInstruction} You have deeply analyzed the user's codebase. Format your responses clearly with sections, bullet points, and code snippets where relevant. Be thorough, insightful, and help the user truly understand their code.\n\n${filesContext}`;

      const messages = [
        { role: "user", content: systemPrompt },
        { role: "assistant", content: "I've thoroughly reviewed the codebase. I'm ready to help you understand any aspect of it — architecture, logic, patterns, or specific files. What would you like to explore?" },
        ...history.map(h => ({ role: h.role === "model" ? "assistant" : "user", content: h.text }))
      ];
      messages.push({ role: "user", content: message });

      const response = await groq.chat.completions.create({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2048
      });
      return response.choices[0].message.content;
    });

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Failed to generate chat response" });
  }
});

// ─── INTERVIEW QUESTIONS (File-Level) ─────────────────────────────────────────
app.post('/api/interview', async (req, res) => {
  const { sessionId, language = "english", selectedFilePath } = req.body;
  if (!selectedFilePath) return res.status(400).json({ error: "File path is required" });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });

  const selected = session.files.find(f => f.path === selectedFilePath);
  if (!selected) return res.status(404).json({ error: "File not found in session." });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a strict senior technical interviewer at a top tech company. ${langInstruction} Analyze this code file carefully.

Generate exactly 5 high-quality technical interview questions that a real interviewer would ask about THIS SPECIFIC code file. Questions should cover:
- Logic and algorithm choices
- Design patterns used
- Time/space complexity
- Potential bugs or improvements  
- Architecture decisions

Return ONLY a valid JSON array. No markdown, no explanation, just the JSON array starting with [ and ending with ].

Each object must have:
- "q": the interview question (clear and specific)
- "a": a comprehensive model answer (3-5 sentences, technically accurate)
- "difficulty": "Easy" | "Medium" | "Hard"
- "category": e.g. "Architecture", "Performance", "Design Patterns", "Security", "Best Practices"

CODE FILE (${selected.lang} - ${selected.path}):
${selected.content.slice(0, 12000)}`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json({ questions: parsed });
  } catch (err) {
    console.error("Interview gen error:", err);
    res.status(500).json({ error: "Failed to generate interview questions: " + err.message });
  }
});

// ─── FINAL AI INTERVIEW QUESTIONS (Project-Wide) ──────────────────────────────
app.post('/api/final-interview-questions', async (req, res) => {
  const { sessionId, language = "english" } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });

  try {
    // Build a rich project summary for context
    let projectContext = `PROJECT OVERVIEW (${session.files.length} files):\n`;
    session.files.forEach(f => {
      projectContext += `\n--- ${f.path} (${f.lang}, ${f.lines} lines) ---\n`;
      projectContext += f.content.slice(0, 2000) + (f.content.length > 2000 ? "\n...[truncated]" : "") + "\n";
    });

    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a senior technical interviewer conducting a final project interview at a top tech company. ${langInstruction} You have reviewed the candidate's entire project codebase.

Generate exactly 8 comprehensive interview questions about the OVERALL PROJECT — covering architecture, technical decisions, design patterns, scalability, security, and best practices. These should feel like real interview questions that probe deep understanding.

Return ONLY a valid JSON array. No markdown, just JSON starting with [ and ending with ].

Each object must have:
- "q": the interview question (thought-provoking, project-specific)
- "a": detailed model answer (4-6 sentences, referencing actual project details)
- "difficulty": "Easy" | "Medium" | "Hard"  
- "category": e.g. "Architecture", "Scalability", "Security", "Design", "Performance", "Best Practices", "Tech Stack"
- "hint": a one-sentence hint if the candidate is stuck

${projectContext.slice(0, 40000)}`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json({ questions: parsed });
  } catch (err) {
    console.error("Final interview questions error:", err);
    res.status(500).json({ error: "Failed to generate final interview questions: " + err.message });
  }
});

// ─── REPORT (File-Level) ──────────────────────────────────────────────────────
app.post('/api/report', async (req, res) => {
  const { sessionId, language = "english", selectedFilePath, qaPairs } = req.body;
  if (!qaPairs || qaPairs.length === 0) return res.status(400).json({ error: "QA pairs are required" });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are an expert technical interviewer evaluating a candidate's interview performance. ${langInstruction}

Here are the Q&A pairs (question, ideal answer, candidate's actual answer):
${JSON.stringify(qaPairs, null, 2)}

Provide a thorough, professional JSON evaluation. Return ONLY valid JSON (no markdown wrappers).

Required structure:
{
  "overallScore": 78,
  "grade": "B+",
  "overallFeedback": "2-3 sentence holistic summary of performance",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "areasToImprove": ["area 1", "area 2"],
  "evaluations": [
    {
      "question": "the question",
      "userAnswer": "candidate answer",
      "idealAnswer": "model answer summary",
      "score": 85,
      "feedback": "detailed specific feedback comparing user vs ideal",
      "mistakes": ["specific mistake 1", "mistake 2"],
      "followUpQuestions": ["follow-up Q 1", "follow-up Q 2"]
    }
  ],
  "chartData": [
    { "subject": "Accuracy", "score": 85, "fullMark": 100 },
    { "subject": "Completeness", "score": 70, "fullMark": 100 },
    { "subject": "Clarity", "score": 90, "fullMark": 100 },
    { "subject": "Technical Depth", "score": 60, "fullMark": 100 },
    { "subject": "Best Practices", "score": 75, "fullMark": 100 }
  ]
}

Be honest and strict. Scores must be integers 0-100.`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json(parsed);
  } catch (err) {
    console.error("Report gen error:", err);
    res.status(500).json({ error: "Failed to generate report: " + err.message });
  }
});

// ─── FINAL INTERVIEW REPORT (Project-Wide) ────────────────────────────────────
app.post('/api/final-interview-report', async (req, res) => {
  const { sessionId, language = "english", qaPairs } = req.body;
  if (!qaPairs || qaPairs.length === 0) return res.status(400).json({ error: "QA pairs are required" });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a panel of senior technical interviewers who just completed a comprehensive project interview with a candidate. ${langInstruction} Evaluate their complete performance across all questions.

Interview Q&A:
${JSON.stringify(qaPairs, null, 2)}

Return ONLY valid JSON (no markdown). Evaluate holistically and honestly.

Required structure:
{
  "overallScore": 78,
  "grade": "B+",
  "recommendation": "Strong Hire" | "Hire" | "Maybe" | "No Hire",
  "overallFeedback": "3-4 sentence executive summary",
  "strengths": ["specific strength from interview 1", "strength 2", "strength 3"],
  "areasToImprove": ["area 1 with specific advice", "area 2"],
  "keyTakeaways": ["key takeaway 1", "key takeaway 2", "key takeaway 3"],
  "evaluations": [
    {
      "question": "the question",
      "userAnswer": "candidate answer",
      "idealAnswer": "reference answer summary",
      "score": 80,
      "feedback": "specific, constructive feedback",
      "mistakes": ["mistake 1"],
      "followUpQuestions": ["natural follow-up Q 1", "natural follow-up Q 2"]
    }
  ],
  "chartData": [
    { "subject": "System Design", "score": 75, "fullMark": 100 },
    { "subject": "Code Quality", "score": 85, "fullMark": 100 },
    { "subject": "Problem Solving", "score": 70, "fullMark": 100 },
    { "subject": "Communication", "score": 90, "fullMark": 100 },
    { "subject": "Best Practices", "score": 65, "fullMark": 100 },
    { "subject": "Architecture", "score": 72, "fullMark": 100 }
  ],
  "questionScores": [
    { "name": "Q1", "score": 80, "maxScore": 100 }
  ]
}

Make questionScores match the number of questions. Scores must be integers 0-100. Grade: A+ (95+), A (90+), B+ (85+), B (80+), C+ (75+), C (70+), D (60+), F (<60).`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 4000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });
    res.json(parsed);
  } catch (err) {
    console.error("Final interview report error:", err);
    res.status(500).json({ error: "Failed to generate final report: " + err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ PROJECT-HELPER Server running on http://localhost:${PORT}`);
});

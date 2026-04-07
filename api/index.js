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
const sessions = new Map();
const DEFAULT_KEY = process.env.GROQ_API_KEY || "";

const CODE_EXT = new Set([
  ".js",".jsx",".ts",".tsx",".py",".java",".cpp",".c",".cs",".go",".rs",
  ".php",".rb",".swift",".kt",".html",".css",".json",".xml",".yaml",".yml",
  ".md",".sh",".sql",".vue",".svelte",".dart",".scala",".r",".swift",".kt",".h",".hpp"
]);

const LANG_MAP = {
  ".js":"JS",".jsx":"JSX",".ts":"TS",".tsx":"TSX",".py":"Python",".java":"Java",
  ".cpp":"C++",".c":"C",".cs":"C#",".go":"Go",".rs":"Rust",".php":"PHP",
  ".rb":"Ruby",".html":"HTML",".css":"CSS",".json":"JSON",".sql":"SQL",
  ".md":"MD",".sh":"Shell",".vue":"Vue",".svelte":"Svelte",".dart":"Dart",
  ".scala":"Scala",".r":"R",".swift":"Swift",".kt":"Kotlin",".h":"C Header",".hpp":"C++ Header"
};

function getLang(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return LANG_MAP[ext] || ext.replace('.', '').toUpperCase();
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

function addRoute(method, path, ...handlers) {
  app[method](path, ...handlers);
  if (path.startsWith('/api/')) {
    app[method](path.slice(4), ...handlers);
  }
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

addRoute('post', '/api/upload', upload.array('files', 2000), (req, res) => {
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
        const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
        return CODE_EXT.has(ext);
      });

    sessions.set(sessionId, { files, createdAt: Date.now() });
    if (sessions.size > 20) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      sessions.delete(oldest[0]);
    }

    res.json({ sessionId, files: files.map(f => ({ path: f.path, name: f.name, dir: f.dir, lang: f.lang, lines: f.lines, size: f.size })) });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process files: ' + err.message });
  }
});

addRoute('post', '/api/chat', async (req, res) => {
  const { sessionId, language = 'english', message, selectedFilePath, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found. Please re-upload your project.' });

  const langInstruction = composeLangInstruction(language);

  try {
    const reply = await withFallbackModel(undefined, async (groq, model) => {
      let filesContext = 'PROJECT FILES OVERVIEW:\n';
      session.files.forEach(f => { filesContext += `- ${f.path} (${f.lang}, ${f.lines} lines)\n`; });
      filesContext += '\n\n';

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
        { role: 'user', content: systemPrompt },
        { role: 'assistant', content: 'I\'ve thoroughly reviewed the codebase. I\'m ready to help you understand any aspect of it — architecture, logic, patterns, or specific files. What would you like to explore?' },
        ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text }))
      ];
      messages.push({ role: 'user', content: message });

      const response = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048
      });
      return response.choices[0].message.content;
    });

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate chat response' });
  }
});

addRoute('post', '/api/interview', async (req, res) => {
  const { sessionId, language = 'english', selectedFilePath } = req.body;
  if (!selectedFilePath) return res.status(400).json({ error: 'File path is required' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const selected = session.files.find(f => f.path === selectedFilePath);
  if (!selected) return res.status(404).json({ error: 'File not found in session.' });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a strict senior technical interviewer at a top tech company. ${langInstruction} Analyze this code file carefully.\n\nGenerate exactly 5 high-quality technical interview questions that a real interviewer would ask about THIS SPECIFIC code file. Questions should cover:\n- Logic and algorithm choices\n- Design patterns used\n- Time/space complexity\n- Potential bugs or improvements  \n- Architecture decisions\n\nReturn ONLY a valid JSON array. No markdown, no explanation, just the JSON array starting with [ and ending with ].\n\nEach object must have:\n- "q": the interview question (clear and specific)\n- "a": a comprehensive model answer (3-5 sentences, technically accurate)\n- "difficulty": "Easy" | "Medium" | "Hard"\n- "category": e.g. "Architecture", "Performance", "Design Patterns", "Security", "Best Practices"\n\nCODE FILE (${selected.lang} - ${selected.path}):\n${selected.content.slice(0, 12000)}`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json({ questions: parsed });
  } catch (err) {
    console.error('Interview gen error:', err);
    res.status(500).json({ error: 'Failed to generate interview questions: ' + err.message });
  }
});

addRoute('post', '/api/final-interview-questions', async (req, res) => {
  const { sessionId, language = 'english' } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  try {
    let projectContext = `PROJECT OVERVIEW (${session.files.length} files):\n`;
    session.files.forEach(f => {
      projectContext += `\n--- ${f.path} (${f.lang}, ${f.lines} lines) ---\n`;
      projectContext += f.content.slice(0, 2000) + (f.content.length > 2000 ? '\n...[truncated]' : '') + '\n';
    });

    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a senior technical interviewer conducting a final project interview at a top tech company. ${langInstruction} You have reviewed the candidate's entire project codebase.\n\nGenerate exactly 8 comprehensive interview questions about the OVERALL PROJECT — covering architecture, technical decisions, design patterns, scalability, security, and best practices. These should feel like real interview questions that probe deep understanding.\n\nReturn ONLY a valid JSON array (no markdown). Each object must have q, a, difficulty, category, hint.\n\n${projectContext.slice(0, 40000)}`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json({ questions: parsed });
  } catch (err) {
    console.error('Final interview questions error:', err);
    res.status(500).json({ error: 'Failed to generate final interview questions: ' + err.message });
  }
});

addRoute('post', '/api/report', async (req, res) => {
  const { sessionId, language = 'english', selectedFilePath, qaPairs } = req.body;
  if (!qaPairs || qaPairs.length === 0) return res.status(400).json({ error: 'QA pairs are required' });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are an expert technical interviewer evaluating a candidate's interview performance. ${langInstruction}\n\nHere are the Q&A pairs (question, ideal answer, candidate's actual answer):\n${JSON.stringify(qaPairs, null, 2)}\n\nProvide a thorough, professional JSON evaluation. Return ONLY valid JSON (no markdown wrappers).`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 3000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });

    res.json(parsed);
  } catch (err) {
    console.error('Report gen error:', err);
    res.status(500).json({ error: 'Failed to generate report: ' + err.message });
  }
});

addRoute('post', '/api/final-interview-report', async (req, res) => {
  const { sessionId, language = 'english', qaPairs } = req.body;
  if (!qaPairs || qaPairs.length === 0) return res.status(400).json({ error: 'QA pairs are required' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  try {
    const langInstruction = composeLangInstruction(language);
    const prompt = `You are a panel of senior technical interviewers who just completed a comprehensive project interview with a candidate. ${langInstruction} Evaluate their complete performance across all questions.\n\nInterview Q&A:\n${JSON.stringify(qaPairs, null, 2)}\n\nReturn ONLY valid JSON (no markdown).`;

    const parsed = await withFallbackModel(undefined, async (groq, model) => {
      const response = await groq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4000
      });
      return JSON.parse(cleanJson(response.choices[0].message.content));
    });
    res.json(parsed);
  } catch (err) {
    console.error('Final interview report error:', err);
    res.status(500).json({ error: 'Failed to generate final report: ' + err.message });
  }
});

export default app;

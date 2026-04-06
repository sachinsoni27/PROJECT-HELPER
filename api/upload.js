import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const CODE_EXT = new Set([
  ".js",".jsx",".ts",".tsx",".py",".java",".cpp",".c",".cs",".go",".rs",
  ".php",".rb",".swift",".kt",".html",".css",".json",".xml",".yaml",".yml",
  ".md",".sh",".sql",".vue",".svelte",".dart",".scala",".r",".h",".hpp"
]);

const LANG_MAP = {
  ".js":"JS",".jsx":"JSX",".ts":"TS",".tsx":"TSX",".py":"Python",".java":"Java",
  ".cpp":"C++",".c":"C",".cs":"C#",".go":"Go",".rs":"Rust",".php":"PHP",
  ".rb":"Ruby",".html":"HTML",".css":"CSS",".json":"JSON",".sql":"SQL",
  ".md":"MD",".sh":"Shell",".vue":"Vue",".svelte":"Svelte",".dart":"Dart",
  ".scala":"Scala",".r":"R",".h":"C Header",".hpp":"C++ Header"
};

function getLang(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return LANG_MAP[ext] || ext.replace('.', '').toUpperCase();
}

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    await runMiddleware(req, res, upload.array('files', 2000));
    const files = (req.files || []).map((f) => ({
      path: f.originalname,
      name: f.originalname.split('/').pop(),
      dir: f.originalname.includes('/') ? f.originalname.split('/').slice(0, -1).join('/') : '',
      content: f.buffer.toString('utf-8'),
      lang: getLang(f.originalname),
      lines: f.buffer.toString('utf-8').split('\n').length,
      size: f.size
    })).filter((f) => {
      const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
      return CODE_EXT.has(ext);
    });

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    res.status(200).json({
      sessionId,
      files: files.map((f) => ({ path: f.path, name: f.name, dir: f.dir, lang: f.lang, lines: f.lines, size: f.size }))
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process files: ' + err.message });
  }
}

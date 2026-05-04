import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('attendance.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    shift_start TEXT NOT NULL,
    shift_end TEXT NOT NULL,
    week_off TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    date TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    check_in TEXT,
    break_start TEXT,
    break_end TEXT,
    check_out TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    PRIMARY KEY (date, staff_id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/staff', (req, res) => {
    const staff = db.prepare('SELECT * FROM staff').all();
    res.json(staff);
  });

  app.post('/api/staff', (req, res) => {
    const { id, name, role, shift_start, shift_end, week_off } = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO staff (id, name, role, shift_start, shift_end, week_off) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(id, name, role, shift_start, shift_end, week_off);
    res.json({ success: true });
  });

  app.delete('/api/staff/:id', (req, res) => {
    db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  app.get('/api/attendance', (req, res) => {
    const { date } = req.query;
    if (date) {
      const records = db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);
      res.json(records);
    } else {
      const records = db.prepare('SELECT * FROM attendance').all();
      res.json(records);
    }
  });

  app.post('/api/attendance', (req, res) => {
    const { date, staff_id, check_in, break_start, break_end, check_out, status, notes } = req.body;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO attendance (date, staff_id, check_in, break_start, break_end, check_out, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(date, staff_id, check_in, break_start, break_end, check_out, status, notes);
    res.json({ success: true });
  });

  app.patch('/api/attendance', (req, res) => {
    const { date, staff_id, ...updates } = req.body;
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const stmt = db.prepare(`UPDATE attendance SET ${setClause} WHERE date = ? AND staff_id = ?`);
    stmt.run(...values, date, staff_id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

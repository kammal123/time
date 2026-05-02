const { sql } = require('@neondatabase/vercel-postgres-compat');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'freelance_timer_super_secret';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, password, name } = req.body;

  if (!action || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    if (action === 'signup') {
      if (!name) return res.status(400).json({ error: 'Name is required for signup' });

      // Check if user exists
      const { rowCount } = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (rowCount > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert user
      const { rows } = await sql`
        INSERT INTO users (email, password, name)
        VALUES (${email}, ${hashedPassword}, ${name})
        RETURNING id, email, name;
      `;

      const user = rows[0];
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

      return res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
      
    } else if (action === 'login') {
      // Find user
      const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = rows[0];

      // Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

      return res.status(200).json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Auth Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const { sql } = require('@neondatabase/vercel-postgres-compat');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'freelance_timer_super_secret';

// Middleware to verify token
const verifyAuth = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.split(' ')[1];
  return jwt.verify(token, JWT_SECRET);
};

module.exports = async function handler(req, res) {
  let user;
  try {
    user = verifyAuth(req);
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT state_json FROM user_states WHERE user_id = ${user.id}`;
      
      if (rows.length === 0) {
        return res.status(200).json({ state: null });
      }
      
      return res.status(200).json({ state: rows[0].state_json });

    } else if (req.method === 'POST') {
      const { state } = req.body;
      if (!state) {
        return res.status(400).json({ error: 'State is required' });
      }

      await sql`
        INSERT INTO user_states (user_id, state_json, updated_at)
        VALUES (${user.id}, ${JSON.stringify(state)}, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) 
        DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = CURRENT_TIMESTAMP;
      `;

      return res.status(200).json({ message: 'State saved successfully' });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('State API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

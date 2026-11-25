// routes/vaccinations.js — Pet Vaccinations (owner-only access)
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// The pet must belong to the logged-in user (pets.user_id holds users.user_no on this database).
async function ownsPet(petId, user) {
  const { rows } = await pool.query(
    `SELECT u.user_no FROM pets p
       JOIN users u ON p.user_id::text IN (u.user_id::text, u.user_no::text)
      WHERE p.id = $1 AND u.user_id::text = $2`,
    [petId, String(user.user_id || user.id)]
  );
  return rows.length ? rows[0] : null;
}

// GET /api/v1/vaccinations/:pet_id — all records for a pet
router.get('/:pet_id', auth, async (req, res) => {
  const petId = parseInt(req.params.pet_id);
  if (isNaN(petId)) return res.status(400).json({ error: 'Invalid pet_id' });
  try {
    if (!(await ownsPet(petId, req.user))) return res.status(404).json({ error: 'Pet not found' });
    const { rows } = await pool.query(
      `SELECT id, pet_id, vaccine_name, given_date, next_due_date,
              vet_name, batch_number, notes, reminder_set, created_at
       FROM pet_vaccinations
       WHERE pet_id=$1
       ORDER BY given_date DESC`,
      [petId]
    );
    res.json({ vaccinations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/v1/vaccinations/upcoming/:pet_id — due in 90 days
router.get('/upcoming/:pet_id', auth, async (req, res) => {
  const petId = parseInt(req.params.pet_id);
  if (isNaN(petId)) return res.status(400).json({ error: 'Invalid pet_id' });
  try {
    if (!(await ownsPet(petId, req.user))) return res.status(404).json({ error: 'Pet not found' });
    const { rows } = await pool.query(
      `SELECT id, pet_id, vaccine_name, given_date, next_due_date, vet_name, notes
       FROM pet_vaccinations
       WHERE pet_id=$1
         AND next_due_date IS NOT NULL
         AND next_due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '90 days')
       ORDER BY next_due_date ASC`,
      [petId]
    );
    res.json({ upcoming: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/v1/vaccinations — add a record
router.post('/', auth, async (req, res) => {
  const { pet_id, vaccine_name, given_date, next_due_date,
          vet_name, batch_number, notes, reminder_set } = req.body;

  if (!pet_id || !vaccine_name || !given_date) {
    return res.status(400).json({ error: 'pet_id, vaccine_name, and given_date are required' });
  }
  const petId = parseInt(pet_id);
  if (isNaN(petId)) return res.status(400).json({ error: 'Invalid pet_id' });

  try {
    const owner = await ownsPet(petId, req.user);
    if (!owner) return res.status(404).json({ error: 'Pet not found' });
    const { rows } = await pool.query(
      `INSERT INTO pet_vaccinations
         (pet_id, user_id, vaccine_name, given_date, next_due_date,
          vet_name, batch_number, notes, reminder_set)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [petId, owner.user_no, vaccine_name, given_date,
       next_due_date || null, vet_name || null,
       batch_number || null, notes || null, reminder_set || false]
    );
    const record = rows[0];

    if (reminder_set && next_due_date) {
      await pool.query(
        `INSERT INTO vaccination_reminders
           (vaccination_id, pet_id, user_id, vaccine_name, reminder_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [record.id, petId, owner.user_no, vaccine_name, next_due_date]
      ).catch(e => console.error('Reminder insert error:', e));
    }

    res.status(201).json({ success: true, vaccination: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/v1/vaccinations/:id — only records of the user's own pets
router.delete('/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(`SELECT pet_id FROM pet_vaccinations WHERE id=$1`, [id]);
    if (!rows.length || !(await ownsPet(rows[0].pet_id, req.user))) return res.status(404).json({ error: 'Record not found' });
    await pool.query(`DELETE FROM vaccination_reminders WHERE vaccination_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM pet_vaccinations WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

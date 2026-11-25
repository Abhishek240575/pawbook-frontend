const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── CREATE PET ────────────────────────────────────────────────
const createPet = async (req, res, next) => {
  const {
    name, species, breed, gender,
    age, weight, color, bio, avatar,
    is_vaccinated, is_neutered, microchip
  } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO pets
         (user_id, name, species, breed, gender,
          age, weight, color, bio, avatar,
          is_vaccinated, is_neutered, microchip)
       VALUES (
         (SELECT user_no FROM users WHERE user_id=$1),
         $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.user.user_id, name, species, breed || null,
       gender || 'unknown', age || null, weight || null,
       color || null, bio || null, avatar || null,
       is_vaccinated || false, is_neutered || false,
       microchip || null]
    );
    return R.created(res, rows[0], 'Pet profile created');
  } catch (err) { next(err); }
};

// ── GET MY PETS ───────────────────────────────────────────────
const getMyPets = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.* FROM pets p
       JOIN users u ON u.user_no = p.user_id
       WHERE u.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// ── GET PET BY ID ─────────────────────────────────────────────
const getPet = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT p.*,
              u.username AS owner_username, u.avatar_url AS owner_avatar
         FROM pets p
         JOIN users u ON u.user_no = p.user_id
        WHERE p.id = $1`,
      [pet_id]
    );
    if (!rows.length) return R.notFound(res, 'Pet not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── UPDATE PET ────────────────────────────────────────────────
const updatePet = async (req, res, next) => {
  const { pet_id } = req.params;
  const {
    name, breed, gender, age, weight,
    color, bio, avatar, is_vaccinated, is_neutered, microchip
  } = req.body;
  try {
    // Ownership check
    const own = await query(
      `SELECT p.user_id, u.user_id AS owner_uuid
         FROM pets p
         JOIN users u ON u.user_no = p.user_id
        WHERE p.id = $1`,
      [pet_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Pet not found');
    if (own.rows[0].owner_uuid !== req.user.user_id && req.user.role !== 'admin')
      return R.forbidden(res, 'Not your pet');

    const { rows } = await query(
      `UPDATE pets
          SET name          = COALESCE($1, name),
              breed         = COALESCE($2, breed),
              gender        = COALESCE($3, gender),
              age           = COALESCE($4, age),
              weight        = COALESCE($5, weight),
              color         = COALESCE($6, color),
              bio           = COALESCE($7, bio),
              avatar        = COALESCE($8, avatar),
              is_vaccinated = COALESCE($9, is_vaccinated),
              is_neutered   = COALESCE($10, is_neutered),
              microchip     = COALESCE($11, microchip),
              updated_at    = NOW()
        WHERE id = $12
        RETURNING *`,
      [name, breed, gender, age, weight,
       color, bio, avatar, is_vaccinated, is_neutered, microchip, pet_id]
    );
    return R.ok(res, rows[0], 'Pet updated');
  } catch (err) { next(err); }
};

// ── DELETE PET ────────────────────────────────────────────────
const deletePet = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    const own = await query(
      `SELECT p.user_id, u.user_id AS owner_uuid
         FROM pets p
         JOIN users u ON u.user_no = p.user_id
        WHERE p.id = $1`,
      [pet_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Pet not found');
    if (own.rows[0].owner_uuid !== req.user.user_id && req.user.role !== 'admin')
      return R.forbidden(res, 'Not your pet');

    await query(`DELETE FROM pets WHERE id = $1`, [pet_id]);
    return R.ok(res, null, 'Pet removed');
  } catch (err) { next(err); }
};

// ── PET HEALTH TIMELINE ───────────────────────────────────────
const getHealthTimeline = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    // Ownership check: only the pet's owner may read its health records
    const own = await query(
      `SELECT 1 FROM pets p
         JOIN users u ON p.user_id::text IN (u.user_id::text, u.user_no::text)
        WHERE p.id::text = $1 AND u.user_id::text = $2`,
      [String(pet_id), String(req.user.user_id)]
    );
    if (!own.rows.length) return R.notFound(res, 'Pet not found');
    const [vaccinations, appointments] = await Promise.all([
      query(
        `SELECT 'vaccination' AS type, vaccine_name AS title,
                given_date AS date, next_due_date AS next_due_at,
                vet_name AS clinic_name
           FROM pet_vaccinations
          WHERE pet_id = $1
          ORDER BY given_date DESC`,
        [pet_id]
      ),
      query(
        `SELECT 'appointment' AS type,
                consult_type AS title,
                appt_date AS date,
                status, notes AS vet_notes
           FROM vet_appointments
          WHERE pet_id = $1
          ORDER BY appt_date DESC`,
        [pet_id]
      )
    ]);

    return R.ok(res, {
      vaccinations: vaccinations.rows,
      medical:      [],
      appointments: appointments.rows
    });
  } catch (err) { next(err); }
};

// ── ADD VACCINATION RECORD ────────────────────────────────────
const addVaccination = async (req, res, next) => {
  const { pet_id } = req.params;
  const {
    vaccine_name, given_date, next_due_date,
    vet_name, batch_number, notes, reminder_set
  } = req.body;
  try {
    // Ownership check
    const own = await query(
      `SELECT p.id FROM pets p
         JOIN users u ON u.user_no = p.user_id
        WHERE p.id = $1 AND u.user_id = $2`,
      [pet_id, req.user.user_id]
    );
    if (!own.rows.length) return R.forbidden(res, 'Not your pet');

    const { rows } = await query(
      `INSERT INTO pet_vaccinations
         (pet_id, user_id, vaccine_name, given_date, next_due_date,
          vet_name, batch_number, notes, reminder_set)
       VALUES ($1,
         (SELECT user_no FROM users WHERE user_id=$2),
         $3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [pet_id, req.user.user_id,
       vaccine_name, given_date, next_due_date || null,
       vet_name || null, batch_number || null,
       notes || null, reminder_set || false]
    );
    return R.created(res, rows[0], 'Vaccination recorded');
  } catch (err) { next(err); }
};

// ── UPCOMING VACCINATION DUES ─────────────────────────────────
const getVaccinationsDue = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT vr.*, p.name AS pet_name, p.avatar AS pet_avatar
         FROM pet_vaccinations vr
         JOIN pets p ON p.id = vr.pet_id
         JOIN users u ON u.user_no = p.user_id
        WHERE u.user_id = $1
          AND vr.next_due_date IS NOT NULL
          AND vr.next_due_date >= CURRENT_DATE
        ORDER BY vr.next_due_date ASC
        LIMIT 20`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

module.exports = {
  createPet, getMyPets, getPet, updatePet, deletePet,
  getHealthTimeline, addVaccination, getVaccinationsDue
};

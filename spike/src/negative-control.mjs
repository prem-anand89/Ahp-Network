// Negative control: proves the invariant tests can actually FAIL.
// Runs the shortlist-cap and accept races against both the correct functions
// and a copy with the row lock removed. A suite that passes both proves nothing.
import pg from 'pg';
import { readFileSync } from 'fs';
const pool = new pg.Pool({ connectionString: process.env.SPIKE_DATABASE_URL
  ?? 'postgres://postgres:spike@127.0.0.1:5432/ahp_spike', max: 40 });
const uuid = () => crypto.randomUUID();
const DELAY = '0.25 seconds';   // forces both callers into the window together

async function loadFunctions({ broken }) {
  let sql = readFileSync(new URL('../sql/002_functions.sql', import.meta.url), 'utf8');
  if (broken) sql = sql.replace(/AND deleted_at IS NULL FOR UPDATE;/g, 'AND deleted_at IS NULL;');
  await pool.query(sql);
}

async function seed(n) {
  const poster = uuid();
  await pool.query('INSERT INTO users (id,name) VALUES ($1,$2)', [poster, 'p']);
  const { rows: [r] } = await pool.query(
    'INSERT INTO home_case_referrals (posted_by_user_id) VALUES ($1) RETURNING id', [poster]);
  const ts = [];
  for (let i = 0; i < n; i++) {
    const t = uuid();
    await pool.query('INSERT INTO users (id,name) VALUES ($1,$2)', [t, 't']);
    const { rows: [ri] } = await pool.query(
      'INSERT INTO referral_interest (referral_id,therapist_user_id) VALUES ($1,$2) RETURNING id', [r.id, t]);
    ts.push({ userId: t, interestId: ri.id });
  }
  return { poster, referralId: r.id, ts };
}

async function capViolations(iters) {
  let bad = 0;
  for (let i = 0; i < iters; i++) {
    const s = await seed(4);
    await Promise.allSettled([
      pool.query('SELECT shortlist_referral($1,$2,$3,$4::interval,$5::interval)',
        [s.referralId, s.poster, [s.ts[0].userId, s.ts[1].userId], '4 hours', DELAY]),
      pool.query('SELECT shortlist_referral($1,$2,$3,$4::interval,$5::interval)',
        [s.referralId, s.poster, [s.ts[2].userId, s.ts[3].userId], '4 hours', DELAY]),
    ]);
    const { rows: [c] } = await pool.query(
      "SELECT count(*) n FROM referral_interest WHERE referral_id=$1 AND status='shortlisted'", [s.referralId]);
    if (+c.n > 2) bad++;
  }
  return bad;
}

async function doubleAccepts(iters) {
  let bad = 0;
  for (let i = 0; i < iters; i++) {
    const s = await seed(2);
    await pool.query('SELECT shortlist_referral($1,$2,$3)', [s.referralId, s.poster, s.ts.map(t => t.userId)]);
    await Promise.allSettled(s.ts.map(t =>
      pool.query('SELECT accept_referral($1,$2,$3,$4,$5::interval,$6::interval)',
        [s.referralId, t.interestId, t.userId, uuid(), '24 hours', DELAY])));
    const { rows: [c] } = await pool.query(
      "SELECT count(*) n FROM referral_interest WHERE referral_id=$1 AND status='accepted'", [s.referralId]);
    if (+c.n !== 1) bad++;
  }
  return bad;
}

const ITERS = 25;
for (const broken of [true, false]) {
  await loadFunctions({ broken });
  const cap = await capViolations(ITERS);
  const acc = await doubleAccepts(ITERS);
  const label = broken ? 'ROW LOCK REMOVED (must fail)' : 'CORRECT FUNCTIONS (must pass)';
  console.log(`\n  ${label}`);
  console.log(`    shortlist-cap violations : ${cap}/${ITERS}`);
  console.log(`    accept-race violations   : ${acc}/${ITERS}`);
  const verdict = broken ? (cap > 0 || acc > 0) : (cap === 0 && acc === 0);
  console.log(`    → ${verdict ? 'AS EXPECTED' : '*** UNEXPECTED — test is not discriminating ***'}`);
}
await loadFunctions({ broken: false });
await pool.end();

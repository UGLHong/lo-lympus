import 'dotenv/config';
import { pool } from '../server/db/client';

async function main() {
  const projectId = process.argv[2];
  if (!projectId) { console.error('usage: tsx scripts/cleanup-project.ts <projectId>'); process.exit(1); }
  const tasksResult = await pool.query('DELETE FROM olympus_tasks WHERE project_id = $1', [projectId]);
  const eventsResult = await pool.query('DELETE FROM olympus_events WHERE project_id = $1', [projectId]);
  const projResult = await pool.query('DELETE FROM olympus_projects WHERE id = $1', [projectId]);
  console.log('deleted tasks:', tasksResult.rowCount, 'events:', eventsResult.rowCount, 'project:', projResult.rowCount);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

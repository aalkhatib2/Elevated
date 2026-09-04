// Milestone 1 infra proof — zero dependencies, zero business logic. Confirms
// /api Functions deploy and run at all before anything else gets built on top.
export default function handler(req, res) {
  return res.status(200).json({ ok: true, service: 'elevated-portal-api' });
}
